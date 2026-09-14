import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const POST_TYPES = ["task", "claim", "finding", "handoff"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const AGENT_POST_TYPES = ["claim", "finding", "handoff"] as const;

export const MAX_CLAIM_MINUTES = 480;
export const DEFAULT_CLAIM_MINUTES = 60;
export const POSTS_PER_HOUR = 60;
export const POSTS_PER_USER_PER_HOUR = 200;
export const ACTIVE_AGENT_TOKENS_PER_USER = 20;
export const MAX_POSTS_PER_REPO = 5_000;
const RETAIN_POSTS_MS = 180 * 24 * 3_600_000;
export const ACTIVE_CLAIMS_PER_USER = 10;
const HOUR_MS = 3_600_000;
const RETAIN_EXPIRED_MS = 7 * 24 * HOUR_MS;

export interface Post {
  id: string;
  repoId: number;
  repoName: string;
  type: PostType;
  title: string;
  body: string;
  target: string | null;
  to: string | null;
  authorLogin: string;
  authorUid: number;
  client: string;
  createdAt: number;
  expiresAt: number | null;
  releasedAt: number | null;
}

export interface NewPost {
  repoId: number;
  repoName: string;
  type: PostType;
  title: string;
  body: string;
  target?: string | null;
  to?: string | null;
  authorLogin: string;
  authorUid: number;
  client: string;
  ttlMinutes?: number;
  system?: boolean;
}

export type AddResult =
  | { ok: true; post: Post; renewed: boolean }
  | { ok: false; reason: "conflict"; conflict: Post }
  | { ok: false; reason: "post_quota" | "claim_quota" };

export interface Board {
  tasks: Post[];
  claims: Post[];
  recent: Post[];
}

export type TokenKind = "agent" | "session";

export interface TokenRow {
  id: string;
  hash: string;
  uid: number;
  kind: TokenKind;
  client: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

export interface CredentialRow {
  uid: number;
  login: string;
  accessSealed: string;
  accessExpiresAt: number | null;
  refreshSealed: string | null;
  refreshExpiresAt: number | null;
  updatedAt: number;
}

export function normaliseTarget(target: string): string {
  const cleaned = target.trim().replace(/\\/g, "/");
  if (!cleaned.includes("/")) return cleaned;
  const normal = posix.normalize(`/${cleaned}`);
  return normal.replace(/^\/+/, "").replace(/\/+$/, "");
}

interface PostRow {
  id: string;
  repo_id: number;
  repo_name: string;
  type: string;
  title: string;
  body: string;
  target: string | null;
  recipient: string | null;
  author_login: string;
  author_uid: number;
  client: string;
  created_at: number;
  expires_at: number | null;
  released_at: number | null;
}

function toPost(r: PostRow): Post {
  return {
    id: r.id,
    repoId: r.repo_id,
    repoName: r.repo_name,
    type: r.type as PostType,
    title: r.title,
    body: r.body,
    target: r.target,
    to: r.recipient,
    authorLogin: r.author_login,
    authorUid: r.author_uid,
    client: r.client,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    releasedAt: r.released_at,
  };
}

interface TokenDbRow {
  id: string;
  hash: string;
  uid: number;
  kind: string;
  client: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
}

function toToken(r: TokenDbRow): TokenRow {
  return {
    id: r.id,
    hash: r.hash,
    uid: r.uid,
    kind: r.kind as TokenKind,
    client: r.client,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string, now: () => number = Date.now) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      repo_name TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target TEXT,
      recipient TEXT,
      author_login TEXT NOT NULL,
      author_uid INTEGER NOT NULL,
      client TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      released_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS posts_repo_created ON posts (repo_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS posts_author ON posts (repo_id, author_uid, created_at);
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      uid INTEGER NOT NULL,
      kind TEXT NOT NULL,
      client TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tokens_uid ON tokens (uid);
    CREATE TABLE IF NOT EXISTS credentials (
      uid INTEGER PRIMARY KEY,
      login TEXT NOT NULL,
      access_sealed TEXT NOT NULL,
      access_expires_at INTEGER,
      refresh_sealed TEXT,
      refresh_expires_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);

  const postById = db.prepare(`SELECT * FROM posts WHERE id = ?`);
  const activeClaimOn = db.prepare(
    `SELECT * FROM posts WHERE repo_id = ? AND type = 'claim' AND target = ? AND released_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  );
  const insertPost = db.prepare(
    `INSERT INTO posts (id, repo_id, repo_name, type, title, body, target, recipient, author_login, author_uid, client, created_at, expires_at, released_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function addPost(p: NewPost): AddResult {
    return transaction(() => {
      const createdAt = now();
      if (!p.system) {
        const recent = db
          .prepare(`SELECT COUNT(*) AS n FROM posts WHERE repo_id = ? AND author_uid = ? AND created_at > ?`)
          .get(p.repoId, p.authorUid, createdAt - HOUR_MS) as { n: number };
        if (recent.n >= POSTS_PER_HOUR) return { ok: false, reason: "post_quota" } as const;
        const everywhere = db
          .prepare(`SELECT COUNT(*) AS n FROM posts WHERE author_uid = ? AND created_at > ?`)
          .get(p.authorUid, createdAt - HOUR_MS) as { n: number };
        if (everywhere.n >= POSTS_PER_USER_PER_HOUR) return { ok: false, reason: "post_quota" } as const;
      }
      let target = p.target ?? null;
      let expiresAt: number | null = null;
      if (p.type === "claim") {
        target = normaliseTarget(target ?? "");
        const minutes = Math.min(Math.max(p.ttlMinutes ?? DEFAULT_CLAIM_MINUTES, 1), MAX_CLAIM_MINUTES);
        expiresAt = createdAt + minutes * 60_000;
        const existing = activeClaimOn.get(p.repoId, target, createdAt) as PostRow | undefined;
        if (existing) {
          if (existing.author_uid !== p.authorUid || existing.client !== p.client) {
            return { ok: false, reason: "conflict", conflict: toPost(existing) } as const;
          }
          db.prepare(`UPDATE posts SET expires_at = ?, title = ?, body = ? WHERE id = ?`).run(expiresAt, p.title, p.body, existing.id);
          return { ok: true, post: toPost(postById.get(existing.id) as unknown as PostRow), renewed: true } as const;
        }
        if (!p.system) {
          const active = db
            .prepare(
              `SELECT COUNT(*) AS n FROM posts WHERE repo_id = ? AND author_uid = ? AND type = 'claim' AND released_at IS NULL AND expires_at > ?`,
            )
            .get(p.repoId, p.authorUid, createdAt) as { n: number };
          if (active.n >= ACTIVE_CLAIMS_PER_USER) return { ok: false, reason: "claim_quota" } as const;
        }
      }
      const id = randomUUID();
      insertPost.run(id, p.repoId, p.repoName, p.type, p.title, p.body, target, p.to ?? null, p.authorLogin, p.authorUid, p.client, createdAt, expiresAt);
      return { ok: true, post: toPost(postById.get(id) as unknown as PostRow), renewed: false } as const;
    });
  }

  function readBoard(repoId: number, opts: { type?: PostType; limit?: number } = {}): Board {
    const t = now();
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const rows = (sql: string, ...params: Array<number | string>) =>
      (db.prepare(sql).all(...params) as unknown as PostRow[]).map(toPost);
    const wants = (type: PostType) => !opts.type || opts.type === type;
    return {
      tasks: wants("task") ? rows(`SELECT * FROM posts WHERE repo_id = ? AND type = 'task' ORDER BY created_at ASC, id ASC LIMIT 200`, repoId) : [],
      claims: wants("claim")
        ? rows(
            `SELECT * FROM posts WHERE repo_id = ? AND type = 'claim' AND released_at IS NULL AND expires_at > ? ORDER BY created_at DESC, id DESC LIMIT 200`,
            repoId,
            t,
          )
        : [],
      recent:
        opts.type === "task" || opts.type === "claim"
          ? []
          : rows(
              `SELECT * FROM posts WHERE repo_id = ? AND type IN ('finding', 'handoff') AND (? = '' OR type = ?) ORDER BY created_at DESC, id DESC LIMIT ?`,
              repoId,
              opts.type ?? "",
              opts.type ?? "",
              limit,
            ),
    };
  }

  function getPost(id: string): Post | null {
    const row = postById.get(id) as PostRow | undefined;
    return row ? toPost(row) : null;
  }

  function releaseClaim(id: string): Post | null {
    db.prepare(`UPDATE posts SET released_at = ? WHERE id = ? AND type = 'claim' AND released_at IS NULL`).run(now(), id);
    return getPost(id);
  }

  function hasTask(repoId: number, title: string): boolean {
    return Boolean(db.prepare(`SELECT 1 FROM posts WHERE repo_id = ? AND type = 'task' AND title = ?`).get(repoId, title));
  }

  function insertToken(row: Omit<TokenRow, "revokedAt" | "lastUsedAt">): void {
    db.prepare(`INSERT INTO tokens (id, hash, uid, kind, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      row.id,
      row.hash,
      row.uid,
      row.kind,
      row.client,
      row.createdAt,
      row.expiresAt,
    );
  }

  function tokenByHash(hash: string): TokenRow | null {
    const row = db.prepare(`SELECT * FROM tokens WHERE hash = ?`).get(hash) as TokenDbRow | undefined;
    return row ? toToken(row) : null;
  }

  function touchToken(id: string, at: number): void {
    db.prepare(`UPDATE tokens SET last_used_at = ? WHERE id = ?`).run(at, id);
  }

  function activeTokens(uid: number, kind: TokenKind): TokenRow[] {
    return (
      db
        .prepare(`SELECT * FROM tokens WHERE uid = ? AND kind = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`)
        .all(uid, kind, now()) as unknown as TokenDbRow[]
    ).map(toToken);
  }

  function revokeToken(id: string, uid: number): boolean {
    const result = db.prepare(`UPDATE tokens SET revoked_at = ? WHERE id = ? AND uid = ? AND revoked_at IS NULL`).run(now(), id, uid);
    return Number(result.changes) > 0;
  }

  function revokeAllTokens(uid: number): number {
    return Number(db.prepare(`UPDATE tokens SET revoked_at = ? WHERE uid = ? AND revoked_at IS NULL`).run(now(), uid).changes);
  }

  function saveCredential(c: CredentialRow): void {
    db.prepare(
      `INSERT INTO credentials (uid, login, access_sealed, access_expires_at, refresh_sealed, refresh_expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uid) DO UPDATE SET login = excluded.login, access_sealed = excluded.access_sealed,
         access_expires_at = excluded.access_expires_at, refresh_sealed = excluded.refresh_sealed,
         refresh_expires_at = excluded.refresh_expires_at, updated_at = excluded.updated_at`,
    ).run(c.uid, c.login, c.accessSealed, c.accessExpiresAt, c.refreshSealed, c.refreshExpiresAt, c.updatedAt);
  }

  function credential(uid: number): CredentialRow | null {
    const r = db.prepare(`SELECT * FROM credentials WHERE uid = ?`).get(uid) as
      | {
          uid: number;
          login: string;
          access_sealed: string;
          access_expires_at: number | null;
          refresh_sealed: string | null;
          refresh_expires_at: number | null;
          updated_at: number;
        }
      | undefined;
    if (!r) return null;
    return {
      uid: r.uid,
      login: r.login,
      accessSealed: r.access_sealed,
      accessExpiresAt: r.access_expires_at,
      refreshSealed: r.refresh_sealed,
      refreshExpiresAt: r.refresh_expires_at,
      updatedAt: r.updated_at,
    };
  }

  function dropRefresh(uid: number): void {
    db.prepare(`UPDATE credentials SET refresh_sealed = NULL, refresh_expires_at = NULL WHERE uid = ?`).run(uid);
  }

  function deleteCredential(uid: number): void {
    db.prepare(`DELETE FROM credentials WHERE uid = ?`).run(uid);
  }

  function countActiveAgentTokens(uid: number): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM tokens WHERE uid = ? AND kind = 'agent' AND revoked_at IS NULL AND expires_at > ?`).get(uid, now()) as {
        n: number;
      }
    ).n;
  }

  function purge(): { posts: number; tokens: number } {
    const t = now();
    const cutoff = t - RETAIN_EXPIRED_MS;
    let posts = Number(
      db.prepare(`DELETE FROM posts WHERE type = 'claim' AND (released_at < ? OR (released_at IS NULL AND expires_at < ?))`).run(cutoff, cutoff).changes,
    );
    posts += Number(db.prepare(`DELETE FROM posts WHERE type IN ('finding', 'handoff') AND created_at < ?`).run(t - RETAIN_POSTS_MS).changes);
    posts += Number(
      db
        .prepare(
          `DELETE FROM posts WHERE type IN ('finding', 'handoff') AND id IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at DESC, id DESC) AS rank
               FROM posts WHERE type IN ('finding', 'handoff')
             ) WHERE rank > ?
           )`,
        )
        .run(MAX_POSTS_PER_REPO).changes,
    );
    const tokens = db.prepare(`DELETE FROM tokens WHERE revoked_at < ? OR expires_at < ?`).run(cutoff, cutoff).changes;
    return { posts, tokens: Number(tokens) };
  }

  return {
    addPost,
    readBoard,
    getPost,
    releaseClaim,
    hasTask,
    insertToken,
    tokenByHash,
    touchToken,
    activeTokens,
    countActiveAgentTokens,
    revokeToken,
    revokeAllTokens,
    saveCredential,
    credential,
    dropRefresh,
    deleteCredential,
    purge,
    close: () => db.close(),
  };
}
