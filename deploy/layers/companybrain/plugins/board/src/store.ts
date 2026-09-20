import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Database, Param, Query } from "./db.ts";
import { cleanLine } from "./untrusted.ts";

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
const RETAIN_AUDIT_MS = 30 * 24 * 3_600_000;
const EXPIRING_SOON_MS = 30 * 60_000;
export const MAX_AUDIT_PER_USER = 2_000;
export const ACTIVE_CLAIMS_PER_USER = 10;
export const HANDOFFS_PER_PAIR_PER_HOUR = 8;
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
  closedAt: number | null;
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
  | { ok: false; reason: "post_quota" | "claim_quota" | "handoff_loop" };

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

export const EVENT_KINDS = ["post.created", "claim.released", "post.closed"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface Actor {
  uid: number;
  login: string;
  client: string;
}

export interface BoardEvent {
  id: number;
  at: number;
  kind: EventKind;
  postId: string;
  postType: PostType;
  title: string;
  actorLogin: string;
  client: string;
}

export interface AuditEntry {
  at: number;
  client: string;
  tool: string;
  subject: string | null;
  ok: boolean;
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
  closed_at: number | null;
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
    closedAt: r.closed_at,
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


interface CredentialDbRow {
  uid: number;
  login: string;
  access_sealed: string;
  access_expires_at: number | null;
  refresh_sealed: string | null;
  refresh_expires_at: number | null;
  updated_at: number;
}

function toCredential(r: CredentialDbRow): CredentialRow {
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

export interface CredentialLock {
  credential(): Promise<CredentialRow | null>;
  save(c: CredentialRow): Promise<void>;
  dropRefresh(): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    repo_name TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    target TEXT,
    recipient TEXT,
    author_login TEXT NOT NULL,
    author_uid BIGINT NOT NULL,
    client TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT,
    released_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS posts_repo_created ON posts (repo_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS posts_author ON posts (author_uid, created_at);
  CREATE INDEX IF NOT EXISTS posts_claims ON posts (repo_id, target) WHERE type = 'claim' AND released_at IS NULL;
  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    uid BIGINT NOT NULL,
    kind TEXT NOT NULL,
    client TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    last_used_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS tokens_uid ON tokens (uid);
  CREATE TABLE IF NOT EXISTS credentials (
    uid BIGINT PRIMARY KEY,
    login TEXT NOT NULL,
    access_sealed TEXT NOT NULL,
    access_expires_at BIGINT,
    refresh_sealed TEXT,
    refresh_expires_at BIGINT,
    updated_at BIGINT NOT NULL
  );
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS closed_at BIGINT;
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS closed_by BIGINT;
  CREATE INDEX IF NOT EXISTS posts_open ON posts (repo_id, type, created_at) WHERE closed_at IS NULL;
  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    at BIGINT NOT NULL,
    uid BIGINT NOT NULL,
    token_id TEXT NOT NULL,
    client TEXT NOT NULL,
    tool TEXT NOT NULL,
    subject TEXT,
    ok BOOLEAN NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_log_uid_at ON audit_log (uid, at);
  CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);
  CREATE TABLE IF NOT EXISTS board_events (
    id BIGSERIAL PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    at BIGINT NOT NULL,
    kind TEXT NOT NULL,
    post_id TEXT NOT NULL,
    post_type TEXT NOT NULL,
    title TEXT NOT NULL,
    actor_uid BIGINT NOT NULL,
    actor_login TEXT NOT NULL,
    client TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS board_events_repo_id ON board_events (repo_id, id);
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    window_start BIGINT NOT NULL,
    hits INTEGER NOT NULL
  );
`;

const recordEvent = (q: Query, repoId: number, at: number, kind: EventKind, post: { id: string; type: PostType; title: string }, actor: Actor) =>
  q.query(`INSERT INTO board_events (repo_id, at, kind, post_id, post_type, title, actor_uid, actor_login, client) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    repoId,
    at,
    kind,
    post.id,
    post.type,
    post.title,
    actor.uid,
    actor.login,
    actor.client,
  ]);

const lock = (q: Query, key: string) => q.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);

export type Store = ReturnType<typeof openStore>;

export function openStore(db: Database, now: () => number = Date.now) {
  let migrated: Promise<void> | null = null;

  function ready(): Promise<void> {
    migrated ??= db
      .transaction(async (tx) => {
        await tx.query(`SET LOCAL lock_timeout = '10s'`);
        const current = async () =>
          (await tx.query<{ ok: boolean }>(`SELECT to_regclass('rate_limits') IS NOT NULL AND to_regclass('posts_open') IS NOT NULL AND to_regclass('audit_log_at') IS NOT NULL AND to_regclass('board_events_repo_id') IS NOT NULL AS ok`)).rows[0]?.ok;
        if (await current()) return;
        await lock(tx, "companybrain-board:schema");
        if (await current()) return;
        for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await tx.query(statement);
      })
      .catch((err) => {
        migrated = null;
        throw err;
      });
    return migrated;
  }

  async function rows<T>(text: string, params: Param[] = []): Promise<T[]> {
    await ready();
    return (await db.query<T>(text, params)).rows;
  }

  async function changed(text: string, params: Param[] = []): Promise<number> {
    await ready();
    return (await db.query(text, params)).count;
  }

  async function first<T>(text: string, params: Param[] = []): Promise<T | undefined> {
    return (await rows<T>(text, params))[0];
  }

  async function transaction<T>(run: (tx: Query) => Promise<T>): Promise<T> {
    await ready();
    return db.transaction(run);
  }

  const count = async (q: Query, text: string, params: Param[]) => (await q.query<{ n: number }>(text, params)).rows[0]?.n ?? 0;

  async function addPost(input: NewPost): Promise<AddResult> {
    const p = { ...input, title: cleanLine(input.title, 200) };
    return transaction(async (tx) => {
      await lock(tx, `user:${p.authorUid}`);
      await lock(tx, `repo:${p.repoId}`);
      const createdAt = now();
      if (!p.system) {
        const recent = await count(tx, `SELECT COUNT(*) AS n FROM posts WHERE repo_id = $1 AND author_uid = $2 AND created_at > $3`, [
          p.repoId,
          p.authorUid,
          createdAt - HOUR_MS,
        ]);
        if (recent >= POSTS_PER_HOUR) return { ok: false, reason: "post_quota" } as const;
        const everywhere = await count(tx, `SELECT COUNT(*) AS n FROM posts WHERE author_uid = $1 AND created_at > $2`, [p.authorUid, createdAt - HOUR_MS]);
        if (everywhere >= POSTS_PER_USER_PER_HOUR) return { ok: false, reason: "post_quota" } as const;
      }
      if (!p.system && p.type === "handoff" && p.to) {
        const pair = await count(
          tx,
          `SELECT COUNT(*) AS n FROM posts WHERE repo_id = $1 AND type = 'handoff' AND author_uid = $2 AND recipient = $3 AND created_at > $4`,
          [p.repoId, p.authorUid, p.to, createdAt - HOUR_MS],
        );
        if (pair >= HANDOFFS_PER_PAIR_PER_HOUR) return { ok: false, reason: "handoff_loop" } as const;
      }
      let target = p.target ?? null;
      let expiresAt: number | null = null;
      if (p.type === "claim") {
        target = normaliseTarget(target ?? "");
        const minutes = Math.min(Math.max(p.ttlMinutes ?? DEFAULT_CLAIM_MINUTES, 1), MAX_CLAIM_MINUTES);
        expiresAt = createdAt + minutes * 60_000;
        const existing = (
          await tx.query<PostRow>(
            `SELECT * FROM posts WHERE repo_id = $1 AND type = 'claim' AND target = $2 AND released_at IS NULL AND expires_at > $3
             ORDER BY created_at DESC LIMIT 1`,
            [p.repoId, target, createdAt],
          )
        ).rows[0];
        if (existing) {
          if (existing.author_uid !== p.authorUid || existing.client !== p.client) {
            return { ok: false, reason: "conflict", conflict: toPost(existing) } as const;
          }
          const renewed = await tx.query<PostRow>(`UPDATE posts SET expires_at = $1, title = $2, body = $3 WHERE id = $4 RETURNING *`, [
            expiresAt,
            p.title,
            p.body,
            existing.id,
          ]);
          return { ok: true, post: toPost(renewed.rows[0] as PostRow), renewed: true } as const;
        }
        if (!p.system) {
          const active = await count(
            tx,
            `SELECT COUNT(*) AS n FROM posts WHERE repo_id = $1 AND author_uid = $2 AND type = 'claim' AND released_at IS NULL AND expires_at > $3`,
            [p.repoId, p.authorUid, createdAt],
          );
          if (active >= ACTIVE_CLAIMS_PER_USER) return { ok: false, reason: "claim_quota" } as const;
        }
      }
      const inserted = await tx.query<PostRow>(
        `INSERT INTO posts (id, repo_id, repo_name, type, title, body, target, recipient, author_login, author_uid, client, created_at, expires_at, released_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL) RETURNING *`,
        [randomUUID(), p.repoId, p.repoName, p.type, p.title, p.body, target, p.to ?? null, p.authorLogin, p.authorUid, p.client, createdAt, expiresAt],
      );
      const post = toPost(inserted.rows[0] as PostRow);
      await recordEvent(tx, p.repoId, createdAt, "post.created", post, { uid: p.authorUid, login: p.authorLogin, client: p.client });
      return { ok: true, post, renewed: false } as const;
    });
  }

  async function readBoard(repoId: number, opts: { type?: PostType; limit?: number } = {}): Promise<Board> {
    const t = now();
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const posts = async (text: string, params: Param[]) => (await rows<PostRow>(text, params)).map(toPost);
    const wants = (type: PostType) => !opts.type || opts.type === type;
    const [tasks, claims, recent] = await Promise.all([
      wants("task") ? posts(`SELECT * FROM posts WHERE repo_id = $1 AND type = 'task' AND closed_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 200`, [repoId]) : [],
      wants("claim")
        ? posts(
            `SELECT * FROM posts WHERE repo_id = $1 AND type = 'claim' AND released_at IS NULL AND expires_at > $2 ORDER BY created_at DESC, id DESC LIMIT 200`,
            [repoId, t],
          )
        : [],
      opts.type === "task" || opts.type === "claim"
        ? []
        : posts(
            `SELECT * FROM posts WHERE repo_id = $1 AND type IN ('finding', 'handoff') AND closed_at IS NULL AND ($2::text = '' OR type = $2::text) ORDER BY created_at DESC, id DESC LIMIT $3`,
            [repoId, opts.type ?? "", limit],
          ),
    ]);
    return { tasks, claims, recent };
  }

  async function getPost(id: string): Promise<Post | null> {
    const row = await first<PostRow>(`SELECT * FROM posts WHERE id = $1`, [id]);
    return row ? toPost(row) : null;
  }

  async function releaseClaim(id: string, repoId: number, actor: Actor): Promise<boolean> {
    return transaction(async (tx) => {
      await lock(tx, `repo:${repoId}`);
      const at = now();
      const released = await tx.query<{ title: string }>(
        `UPDATE posts SET released_at = $1 WHERE id = $2 AND repo_id = $3 AND type = 'claim' AND released_at IS NULL RETURNING title`,
        [at, id, repoId],
      );
      const row = released.rows[0];
      if (!row) return false;
      await recordEvent(tx, repoId, at, "claim.released", { id, type: "claim", title: row.title }, actor);
      return true;
    });
  }

  async function closePost(id: string, repoId: number, actor: Actor): Promise<boolean> {
    return transaction(async (tx) => {
      await lock(tx, `repo:${repoId}`);
      const at = now();
      const closed = await tx.query<{ type: PostType; title: string }>(
        `UPDATE posts SET closed_at = $1, closed_by = $2 WHERE id = $3 AND repo_id = $4 AND type <> 'claim' AND closed_at IS NULL RETURNING type, title`,
        [at, actor.uid, id, repoId],
      );
      const row = closed.rows[0];
      if (!row) return false;
      await recordEvent(tx, repoId, at, "post.closed", { id, ...row }, actor);
      return true;
    });
  }

  async function inbox(opts: { uid: number; login: string; client: string; now: number; limit: number }): Promise<{ handoffs: Post[]; expiring: Post[] }> {
    const [handoffs, expiring] = await Promise.all([
      rows<PostRow>(
        `SELECT * FROM posts WHERE type = 'handoff' AND closed_at IS NULL AND recipient IN ($1, $2) AND created_at > $3
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [opts.login, opts.client, opts.now - RETAIN_EXPIRED_MS, opts.limit],
      ),
      rows<PostRow>(
        `SELECT * FROM posts WHERE type = 'claim' AND author_uid = $1 AND client = $2 AND released_at IS NULL
           AND expires_at > $3 AND expires_at < $4
         ORDER BY expires_at ASC LIMIT $5`,
        [opts.uid, opts.client, opts.now, opts.now + EXPIRING_SOON_MS, opts.limit],
      ),
    ]);
    return { handoffs: handoffs.map(toPost), expiring: expiring.map(toPost) };
  }

  async function events(repoId: number, opts: { after?: number; limit?: number } = {}): Promise<BoardEvent[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const list = await rows<{ id: number; at: number; kind: EventKind; post_id: string; post_type: PostType; title: string; actor_login: string; client: string }>(
      opts.after === undefined
        ? `SELECT * FROM (SELECT id, at, kind, post_id, post_type, title, actor_login, client FROM board_events WHERE repo_id = $1 ORDER BY id DESC LIMIT $2) recent ORDER BY id ASC`
        : `SELECT id, at, kind, post_id, post_type, title, actor_login, client FROM board_events WHERE repo_id = $1 AND id > $3 ORDER BY id ASC LIMIT $2`,
      opts.after === undefined ? [repoId, limit] : [repoId, limit, opts.after],
    );
    return list.map((e) => ({ id: e.id, at: e.at, kind: e.kind, postId: e.post_id, postType: e.post_type, title: e.title, actorLogin: e.actor_login, client: e.client }));
  }

  async function audit(entry: { uid: number; tokenId: string; client: string; tool: string; subject: string | null; ok: boolean }): Promise<void> {
    await changed(`INSERT INTO audit_log (at, uid, token_id, client, tool, subject, ok) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      now(),
      entry.uid,
      entry.tokenId,
      entry.client,
      entry.tool,
      entry.subject,
      entry.ok ? "true" : "false",
    ]);
  }

  async function recentRepos(uid: number, limit = 6): Promise<string[]> {
    const list = await rows<{ subject: string }>(
      `SELECT subject FROM audit_log WHERE uid = $1 AND ok AND subject LIKE '%/%' GROUP BY subject ORDER BY MAX(at) DESC LIMIT $2`,
      [uid, limit],
    );
    return list.map((r) => r.subject);
  }

  async function auditTrail(uid: number, limit = 50): Promise<AuditEntry[]> {
    return rows(`SELECT at, client, tool, subject, ok FROM audit_log WHERE uid = $1 ORDER BY at DESC, id DESC LIMIT $2`, [uid, limit]);
  }

  async function hasTask(repoId: number, title: string): Promise<boolean> {
    return Boolean(await first(`SELECT 1 FROM posts WHERE repo_id = $1 AND type = 'task' AND title = $2`, [repoId, title]));
  }

  async function insertToken(row: Omit<TokenRow, "revokedAt" | "lastUsedAt">): Promise<boolean> {
    return transaction(async (tx) => {
      await lock(tx, `user:${row.uid}`);
      if (row.kind === "agent") {
        const active = await count(tx, `SELECT COUNT(*) AS n FROM tokens WHERE uid = $1 AND kind = 'agent' AND revoked_at IS NULL AND expires_at > $2`, [row.uid, now()]);
        if (active >= ACTIVE_AGENT_TOKENS_PER_USER) return false;
      }
      await tx.query(`INSERT INTO tokens (id, hash, uid, kind, client, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        row.id,
        row.hash,
        row.uid,
        row.kind,
        row.client,
        row.createdAt,
        row.expiresAt,
      ]);
      return true;
    });
  }

  async function tokenByHash(hash: string): Promise<TokenRow | null> {
    const row = await first<TokenDbRow>(`SELECT * FROM tokens WHERE hash = $1`, [hash]);
    return row ? toToken(row) : null;
  }

  async function touchToken(id: string, at: number): Promise<void> {
    await changed(`UPDATE tokens SET last_used_at = $1 WHERE id = $2`, [at, id]);
  }

  async function activeTokens(uid: number, kind: TokenKind): Promise<TokenRow[]> {
    return (
      await rows<TokenDbRow>(`SELECT * FROM tokens WHERE uid = $1 AND kind = $2 AND revoked_at IS NULL AND expires_at > $3 ORDER BY created_at DESC`, [
        uid,
        kind,
        now(),
      ])
    ).map(toToken);
  }

  async function revokeToken(id: string, uid: number): Promise<boolean> {
    return (await changed(`UPDATE tokens SET revoked_at = $1 WHERE id = $2 AND uid = $3 AND revoked_at IS NULL`, [now(), id, uid])) > 0;
  }

  async function revokeAllTokens(uid: number): Promise<number> {
    return changed(`UPDATE tokens SET revoked_at = $1 WHERE uid = $2 AND revoked_at IS NULL`, [now(), uid]);
  }

  const upsertCredential = (q: Query, c: CredentialRow) =>
    q.query(
      `INSERT INTO credentials (uid, login, access_sealed, access_expires_at, refresh_sealed, refresh_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (uid) DO UPDATE SET login = excluded.login, access_sealed = excluded.access_sealed,
         access_expires_at = excluded.access_expires_at, refresh_sealed = excluded.refresh_sealed,
         refresh_expires_at = excluded.refresh_expires_at, updated_at = excluded.updated_at`,
      [c.uid, c.login, c.accessSealed, c.accessExpiresAt, c.refreshSealed, c.refreshExpiresAt, c.updatedAt],
    );

  const selectCredential = async (q: Query, uid: number) => {
    const row = (await q.query<CredentialDbRow>(`SELECT * FROM credentials WHERE uid = $1`, [uid])).rows[0];
    return row ? toCredential(row) : null;
  };

  const clearRefresh = (q: Query, uid: number) => q.query(`UPDATE credentials SET refresh_sealed = NULL, refresh_expires_at = NULL WHERE uid = $1`, [uid]);

  async function saveCredential(c: CredentialRow): Promise<void> {
    await transaction(async (tx) => {
      await lock(tx, `credential:${c.uid}`);
      await upsertCredential(tx, c);
    });
  }

  async function credential(uid: number): Promise<CredentialRow | null> {
    await ready();
    return selectCredential(db, uid);
  }

  async function withCredentialLock<T>(uid: number, run: (held: CredentialLock) => Promise<T>): Promise<T> {
    return transaction(async (tx) => {
      await tx.query(`SET LOCAL lock_timeout = '15s'`);
      await lock(tx, `credential:${uid}`);
      return run({
        credential: () => selectCredential(tx, uid),
        save: async (c) => {
          await upsertCredential(tx, c);
        },
        dropRefresh: async () => {
          await clearRefresh(tx, uid);
        },
      });
    });
  }

  async function deleteCredential(uid: number): Promise<void> {
    await transaction(async (tx) => {
      await lock(tx, `credential:${uid}`);
      await tx.query(`DELETE FROM credentials WHERE uid = $1`, [uid]);
      await tx.query(`DELETE FROM audit_log WHERE uid = $1`, [uid]);
    });
  }

  async function hit(key: string, windowMs: number): Promise<number> {
    const t = now();
    const row = await first<{ hits: number }>(
      `INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE SET
         window_start = CASE WHEN $2 - rate_limits.window_start >= $3 THEN $2 ELSE rate_limits.window_start END,
         hits = CASE WHEN $2 - rate_limits.window_start >= $3 THEN 1 ELSE rate_limits.hits + 1 END
       RETURNING hits`,
      [key, t, windowMs],
    );
    return row?.hits ?? 1;
  }

  async function purge(): Promise<{ posts: number; tokens: number }> {
    const t = now();
    const cutoff = t - RETAIN_EXPIRED_MS;
    let posts = await changed(`DELETE FROM posts WHERE type = 'claim' AND (released_at < $1 OR (released_at IS NULL AND expires_at < $1))`, [cutoff]);
    posts += await changed(`DELETE FROM posts WHERE type IN ('finding', 'handoff') AND created_at < $1`, [t - RETAIN_POSTS_MS]);
    posts += await changed(
      `DELETE FROM posts WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at DESC, id DESC) AS rank
           FROM posts WHERE type IN ('finding', 'handoff')
         ) ranked WHERE rank > $1
       )`,
      [MAX_POSTS_PER_REPO],
    );
    const tokens = await changed(`DELETE FROM tokens WHERE revoked_at < $1 OR expires_at < $1`, [cutoff]);
    await changed(`DELETE FROM rate_limits WHERE window_start < $1`, [t - HOUR_MS]);
    await changed(`DELETE FROM audit_log WHERE at < $1`, [t - RETAIN_AUDIT_MS]);
    await changed(`DELETE FROM board_events WHERE at < $1`, [t - RETAIN_POSTS_MS]);
    await changed(
      `DELETE FROM board_events WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY id DESC) AS rank FROM board_events) ranked WHERE rank > $1)`,
      [MAX_POSTS_PER_REPO],
    );
    await changed(
      `DELETE FROM audit_log WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY at DESC, id DESC) AS rank FROM audit_log) ranked WHERE rank > $1)`,
      [MAX_AUDIT_PER_USER],
    );
    return { posts, tokens };
  }

  return {
    addPost,
    readBoard,
    getPost,
    releaseClaim,
    hasTask,
    closePost,
    events,
    inbox,
    audit,
    auditTrail,
    recentRepos,
    insertToken,
    tokenByHash,
    touchToken,
    activeTokens,
    revokeToken,
    revokeAllTokens,
    saveCredential,
    credential,
    withCredentialLock,
    deleteCredential,
    hit,
    purge,
    close: () => db.close(),
  };
}
