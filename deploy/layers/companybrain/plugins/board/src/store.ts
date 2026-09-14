import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const POST_TYPES = ["task", "claim", "finding", "handoff"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const AGENT_POST_TYPES: readonly PostType[] = ["claim", "finding", "handoff"];

export interface Post {
  id: string;
  repo: string;
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
  repo: string;
  type: PostType;
  title: string;
  body: string;
  target?: string | null;
  to?: string | null;
  authorLogin: string;
  authorUid: number;
  client: string;
  ttlMinutes?: number;
}

export type AddResult = { ok: true; post: Post } | { ok: false; conflict: Post };

export const MAX_CLAIM_MINUTES = 480;
export const DEFAULT_CLAIM_MINUTES = 60;

interface Row {
  id: string;
  repo: string;
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

function toPost(r: Row): Post {
  return {
    id: r.id,
    repo: r.repo,
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

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string, now: () => number = Date.now) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS posts_repo_created ON posts (repo, created_at DESC);
  `);

  const activeClaim = db.prepare(
    `SELECT * FROM posts WHERE repo = ? AND type = 'claim' AND target = ? AND released_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO posts (id, repo, type, title, body, target, recipient, author_login, author_uid, client, created_at, expires_at, released_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  const byId = db.prepare(`SELECT * FROM posts WHERE id = ?`);

  function add(p: NewPost): AddResult {
    const repo = p.repo.toLowerCase();
    const createdAt = now();
    let expiresAt: number | null = null;
    if (p.type === "claim") {
      const target = p.target ?? "";
      const existing = activeClaim.get(repo, target, createdAt) as Row | undefined;
      if (existing) return { ok: false, conflict: toPost(existing) };
      const minutes = Math.min(Math.max(p.ttlMinutes ?? DEFAULT_CLAIM_MINUTES, 1), MAX_CLAIM_MINUTES);
      expiresAt = createdAt + minutes * 60_000;
    }
    const id = randomUUID();
    insert.run(
      id,
      repo,
      p.type,
      p.title,
      p.body,
      p.target ?? null,
      p.to ?? null,
      p.authorLogin,
      p.authorUid,
      p.client,
      createdAt,
      expiresAt,
    );
    return { ok: true, post: toPost(byId.get(id) as unknown as Row) };
  }

  function list(repo: string, opts: { type?: PostType; limit?: number } = {}): Post[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = db
      .prepare(
        `SELECT * FROM posts
         WHERE repo = ?
           AND (? IS NULL OR type = ?)
           AND (type != 'claim' OR (released_at IS NULL AND expires_at > ?))
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(repo.toLowerCase(), opts.type ?? null, opts.type ?? null, now(), limit) as unknown as Row[];
    return rows.map(toPost);
  }

  function release(id: string, uid: number, client: string): Post | null {
    const row = byId.get(id) as Row | undefined;
    if (!row || row.type !== "claim" || row.released_at !== null) return null;
    if (row.author_uid !== uid || row.client !== client) return null;
    db.prepare(`UPDATE posts SET released_at = ? WHERE id = ?`).run(now(), id);
    return toPost(byId.get(id) as unknown as Row);
  }

  function hasTask(repo: string, title: string): boolean {
    return Boolean(db.prepare(`SELECT 1 FROM posts WHERE repo = ? AND type = 'task' AND title = ?`).get(repo.toLowerCase(), title));
  }

  return { add, list, release, hasTask, close: () => db.close() };
}
