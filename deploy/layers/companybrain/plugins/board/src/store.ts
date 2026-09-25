import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Database, Param, Query } from "./db.ts";
import { AGENT_CHOICES, GOALS, KITS, type Profile, ROLES, TEAM_SIZES } from "./starter.ts";
import type { SwimlaneEvent } from "./swimlane.ts";
import { cleanLine, cleanText } from "./untrusted.ts";

export const POST_TYPES = ["task", "claim", "finding", "handoff", "decision"] as const;
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
const RETAIN_SUGGESTIONS_MS = 180 * 24 * 3_600_000;
const EXPIRING_SOON_MS = 30 * 60_000;
export const MAX_AUDIT_PER_USER = 2_000;
export const ACTIVE_CLAIMS_PER_USER = 10;
export const HANDOFFS_PER_PAIR_PER_HOUR = 8;
const HOUR_MS = 3_600_000;
const RETAIN_EXPIRED_MS = 7 * 24 * HOUR_MS;

export const ENTRY_KINDS = ["project", "memory", "skill", "process", "rule", "lesson", "record", "role"] as const;

export const KIND_PURPOSE: Record<(typeof ENTRY_KINDS)[number], string> = {
  project: "a piece of ongoing work and the state it is in",
  memory: "something learned that should survive this session",
  skill: "a reusable instruction someone can follow later",
  process: "how a recurring piece of work actually gets done, step by step",
  rule: "a boundary, policy or approval requirement that constrains what may be done",
  lesson: "what went wrong once and what to do differently",
  record: "an observed fact with its evidence, not an opinion",
  role: "who owns an area and what they decide",
};
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const MAX_ENTRIES_PER_KIND = 200;
export const MAX_ENTRY_BODY = 20_000;
export const MAX_ENTRY_NAME = 120;
export const MAX_POST_BODY = 20_000;
export const MAX_DOC_BODY = 40_000;
export const MAX_DOCS_PER_REPO = 300;
export const MAX_DOCS_PER_USER = 2_000;
export const GRAPH_DOCS_PER_REPO = 12;
export const GRAPH_MAX_LINKS = 4_000;
export const UPLOAD_REPO_ID = 0;
export const WORK_STATUSES = ["open", "working", "review", "changes", "done", "closed"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const UPDATE_KINDS = ["progress", "submitted", "accepted", "changes"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];
export const MAX_UPDATES_PER_TASK = 200;
const ANSWER_VISIBLE_MS = 30 * 24 * 3_600_000;
export const UPLOAD_REPO_NAME = "Uploaded files";
export const MAX_UPLOAD_NAME = 160;

export interface Doc {
  id: string;
  repoId: number;
  repoName: string;
  path: string;
  title: string;
  body: string;
  indexedAt: number;
}

export interface WorkUpdate {
  id: string;
  taskId: string;
  kind: UpdateKind;
  body: string;
  authorLogin: string;
  client: string;
  at: number;
}

export type WorkResult = { ok: true; status: WorkStatus } | { ok: false; reason: "not_found" | "wrong_state" | "update_quota" };

export interface Link {
  fromKind: string;
  fromName: string;
  toKind: string;
  toName: string;
}

export interface Connections {
  outgoing: Link[];
  incoming: Link[];
}

export const MARK_OPEN = "\uE000";
export const MARK_CLOSE = "\uE001";

export function toSearchQuery(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/["']/g, "").replace(/^[-!]+/, ""))
    .filter((w) => w && w.toLowerCase() !== "or")
    .slice(0, 40)
    .join(" or ");
}

export interface SearchOptions {
  allow: (repoName: string, repoId: number) => Promise<boolean>;
  limit?: number;
  kinds?: string[];
}

export interface Found {
  kind: "document" | EntryKind;
  title: string;
  source: string;
  repo: string | null;
  body: string;
  snippet: string;
  rank: number;
}

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface DocRow {
  id: string;
  repo_id: number;
  repo_name: string;
  path: string;
  title: string;
  body: string;
  indexed_at: number;
}

function toDoc(r: DocRow): Doc {
  return { id: r.id, repoId: r.repo_id, repoName: r.repo_name, path: r.path, title: r.title, body: r.body, indexedAt: r.indexed_at };
}

export interface Entry {
  id: string;
  kind: EntryKind;
  ownerUid: number;
  name: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface ProfileRow {
  uid: number;
  login: string;
  name: string;
  email: string;
  company: string;
  role: string;
  team_size: string;
  goals: string;
  agents: string;
  kit: string;
  updates: boolean;
  created_at: number;
  updated_at: number;
  asked_at: number | null;
}

interface EntryRow {
  id: string;
  kind: EntryKind;
  owner_uid: number;
  name: string;
  body: string;
  created_at: number;
  updated_at: number;
}

function toEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    kind: r.kind,
    ownerUid: r.owner_uid,
    name: r.name,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface Post {
  id: string;
  resolution?: string | null;
  status?: WorkStatus;
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

const disownMemory = (kind: EntryKind, body: string): string => (kind === "memory" ? body.replace(/^(---\n[\s\S]*?)\nsource: auto(?=\n)/, "$1") : body);

export type PutEntryResult =
  | { ok: true; entry: Entry; created: boolean }
  | { ok: false; reason: "entry_quota" | "empty_name" | "refused" | "too_long" };

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
  resolution: string | null;
  status: string | null;
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
    resolution: r.resolution ?? null,
    ...(r.type === "task" ? { status: (r.status ?? "open") as WorkStatus } : {}),
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
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS resolution TEXT;
  CREATE INDEX IF NOT EXISTS posts_open_decisions ON posts (author_uid, created_at DESC) WHERE type = 'decision' AND closed_at IS NULL;
  ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT;
  ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_task_status;
  ALTER TABLE posts ADD CONSTRAINT posts_task_status CHECK (status IS NULL OR status IN ('open', 'working', 'review', 'changes', 'done', 'closed'));
  CREATE TABLE IF NOT EXISTS work_updates (
    seq BIGSERIAL,
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    author_uid BIGINT NOT NULL,
    author_login TEXT NOT NULL,
    client TEXT NOT NULL,
    at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_updates_task ON work_updates (task_id, seq);
  CREATE TABLE IF NOT EXISTS links (
    owner_uid BIGINT NOT NULL,
    from_kind TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_kind TEXT NOT NULL,
    to_name TEXT NOT NULL,
    PRIMARY KEY (owner_uid, from_kind, from_name, to_kind, to_name)
  );
  CREATE INDEX IF NOT EXISTS links_incoming ON links (owner_uid, to_kind, to_name);
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_uid BIGINT NOT NULL,
    repo_id BIGINT NOT NULL,
    repo_name TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    indexed_at BIGINT NOT NULL,
    checked_at BIGINT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS documents_unique ON documents (owner_uid, repo_id, path);
  DROP INDEX IF EXISTS documents_search;
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS search tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
  CREATE INDEX IF NOT EXISTS documents_search_v2 ON documents USING GIN (search);
  CREATE TABLE IF NOT EXISTS suggestion_events (
    id BIGSERIAL PRIMARY KEY,
    uid BIGINT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('accepted', 'snoozed', 'dismissed')),
    at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS suggestion_events_uid ON suggestion_events (uid, key, at);
  CREATE TABLE IF NOT EXISTS gateway_servers (
    owner_uid BIGINT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    token_sealed TEXT,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (owner_uid, name)
  );
  ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_decision_needs_resolution;
  ALTER TABLE posts ADD CONSTRAINT posts_decision_needs_resolution CHECK (type <> 'decision' OR closed_at IS NULL OR resolution IS NOT NULL);
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    owner_uid BIGINT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS entries_unique ON entries (kind, owner_uid, name);
  CREATE INDEX IF NOT EXISTS entries_listing ON entries (kind, owner_uid, updated_at DESC);
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS search tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || body)) STORED;
  CREATE INDEX IF NOT EXISTS entries_search ON entries USING GIN (search);
  CREATE TABLE IF NOT EXISTS profiles (
    uid BIGINT PRIMARY KEY,
    login TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    team_size TEXT NOT NULL,
    goals TEXT NOT NULL,
    agents TEXT NOT NULL,
    kit TEXT NOT NULL,
    updates BOOLEAN NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    asked_at BIGINT,
    updates_at BIGINT
  );
`;

const WIKI_LINK = /\[\[([^\]\n]{1,120})\]\]/g;
const REPO_MENTION = /(?:^|[\s(])([A-Za-z][\w-]{0,38})\/([A-Za-z][\w-]{0,99})(?=$|[\s),]|\.(?!\w))/g;

const PROSE_PAIRS: ReadonlySet<string> = new Set([
  "and/or", "either/or", "yes/no", "true/false", "he/she", "his/her", "him/her", "read/write", "input/output",
  "client/server", "on/off", "in/out", "up/down", "pass/fail", "before/after", "left/right", "open/close",
  "start/stop", "win/loss", "and/also", "w/o", "n/a",
]);
export const SKILL_SESSION_MS = 30 * 60_000;
export const MAX_LINKS_PER_ENTRY = 50;

const looksLikeRepo = (owner: string, repo: string): boolean =>
  owner.length >= 2 &&
  repo.length >= 2 &&
  !/^[A-Z]+$/.test(owner) &&
  !/^[A-Z]+$/.test(repo) &&
  !PROSE_PAIRS.has(`${owner}/${repo}`.toLowerCase());

export function extractLinks(body: string): Array<{ toKind: string; toName: string }> {
  const out = new Map<string, { toKind: string; toName: string }>();
  for (const m of body.matchAll(WIKI_LINK)) {
    if (out.size >= MAX_LINKS_PER_ENTRY) break;
    const name = cleanLine(m[1] ?? "", MAX_ENTRY_NAME);
    if (name) out.set(`entry:${name.toLowerCase()}`, { toKind: "entry", toName: name });
  }
  for (const m of body.matchAll(REPO_MENTION)) {
    if (out.size >= MAX_LINKS_PER_ENTRY) break;
    const owner = m[1] ?? "";
    const repo = m[2] ?? "";
    if (!looksLikeRepo(owner, repo)) continue;
    const name = `${owner}/${repo}`;
    if (name.length <= 140) out.set(`repo:${name.toLowerCase()}`, { toKind: "repo", toName: name });
  }
  return [...out.values()];
}

const ENTRY_COLS = "id, kind, owner_uid, name, body, created_at, updated_at";

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
          (await tx.query<{ ok: boolean }>(`SELECT to_regclass('rate_limits') IS NOT NULL AND to_regclass('posts_open') IS NOT NULL AND to_regclass('audit_log_at') IS NOT NULL AND to_regclass('board_events_repo_id') IS NOT NULL AND to_regclass('entries_listing') IS NOT NULL AND to_regclass('posts_open_decisions') IS NOT NULL AND to_regclass('documents_search_v2') IS NOT NULL AND to_regclass('entries_search') IS NOT NULL AND to_regclass('links_incoming') IS NOT NULL AND to_regclass('work_updates_task') IS NOT NULL AND to_regclass('gateway_servers') IS NOT NULL AND to_regclass('suggestion_events_uid') IS NOT NULL AND to_regclass('profiles') IS NOT NULL AS ok`)).rows[0]?.ok;
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
    const p = { ...input, title: cleanLine(input.title, 200), body: cleanText(input.body, MAX_POST_BODY) };
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
            `SELECT * FROM posts WHERE repo_id = $1 AND type IN ('finding', 'handoff', 'decision') AND closed_at IS NULL AND ($2::text = '' OR type = $2::text) ORDER BY created_at DESC, id DESC LIMIT $3`,
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

  async function closePost(id: string, repoId: number, actor: Actor, resolution?: string): Promise<boolean> {
    return transaction(async (tx) => {
      await lock(tx, `repo:${repoId}`);
      const at = now();
      const closed = await tx.query<{ type: PostType; title: string }>(
        `UPDATE posts SET closed_at = $1, closed_by = $2, resolution = $5, status = CASE WHEN type = 'task' THEN 'closed' ELSE status END
         WHERE id = $3 AND repo_id = $4 AND type <> 'claim' AND closed_at IS NULL
           AND (type <> 'decision' OR btrim(coalesce($5::text, '')) <> '')
           AND (type <> 'task' OR coalesce(status, 'open') <> 'review') RETURNING type, title`,
        [at, actor.uid, id, repoId, resolution === undefined ? null : cleanText(resolution, MAX_POST_BODY)],
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

  async function timeline(repoId: number, opts: { limit?: number } = {}): Promise<SwimlaneEvent[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const list = await rows<{
      id: number;
      at: number;
      kind: EventKind;
      post_id: string;
      post_type: PostType;
      title: string;
      actor_login: string;
      client: string;
      recipient: string | null;
      expires_at: number | null;
      released_at: number | null;
      closed_at: number | null;
    }>(
      `SELECT e.id, e.at, e.kind, e.post_id, e.post_type, e.title, e.actor_login, e.client, p.recipient, p.expires_at, p.released_at, p.closed_at
       FROM (SELECT * FROM board_events WHERE repo_id = $1 ORDER BY id DESC LIMIT $2) e
       LEFT JOIN posts p ON p.id = e.post_id ORDER BY e.id ASC`,
      [repoId, limit],
    );
    return list.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      postId: e.post_id,
      postType: e.post_type,
      title: e.title,
      actorLogin: e.actor_login,
      client: e.client,
      recipient: e.recipient,
      expiresAt: e.expires_at,
      releasedAt: e.released_at,
      closedAt: e.closed_at,
    }));
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

  async function auditTrail(uid: number, limit = 50, tool?: string): Promise<AuditEntry[]> {
    if (tool) return rows(`SELECT at, client, tool, subject, ok FROM audit_log WHERE uid = $1 AND tool = $3 ORDER BY at DESC, id DESC LIMIT $2`, [uid, limit, tool]);
    return rows(`SELECT at, client, tool, subject, ok FROM audit_log WHERE uid = $1 AND tool <> 'ask' ORDER BY at DESC, id DESC LIMIT $2`, [uid, limit]);
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
      await tx.query(`DELETE FROM gateway_servers WHERE owner_uid = $1`, [uid]);
      await tx.query(`DELETE FROM suggestion_events WHERE uid = $1`, [uid]);
      await tx.query(`DELETE FROM profiles WHERE uid = $1`, [uid]);
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

  async function putEntry(input: { kind: EntryKind; ownerUid: number; name: string; body: string | ((current: string | null) => string | null) }): Promise<PutEntryResult> {
    const name = cleanLine(input.name, MAX_ENTRY_NAME);
    if (!name) return { ok: false, reason: "empty_name" } as const;
    return transaction(async (tx) => {
      await lock(tx, `entries:${input.ownerUid}:${input.kind}`);
      const at = now();
      const existing = (await tx.query<EntryRow>(`SELECT ${ENTRY_COLS} FROM entries WHERE kind = $1 AND owner_uid = $2 AND name = $3`, [input.kind, input.ownerUid, name])).rows[0];
      const next = typeof input.body === "string" ? disownMemory(input.kind, input.body) : input.body(existing ? existing.body : null);
      if (next === null) return { ok: false, reason: "refused" } as const;
      if (next.length > MAX_ENTRY_BODY) return { ok: false, reason: "too_long" } as const;
      const body = cleanText(next, MAX_ENTRY_BODY);
      if (existing) {
        const updated = await tx.query<EntryRow>(`UPDATE entries SET body = $1, updated_at = $2 WHERE id = $3 RETURNING ${ENTRY_COLS}`, [body, at, existing.id]);
        await rewriteLinks(tx, input.ownerUid, input.kind, name, body);
        return { ok: true, entry: toEntry(updated.rows[0] as EntryRow), created: false } as const;
      }
      const held = await count(tx, `SELECT COUNT(*) AS n FROM entries WHERE kind = $1 AND owner_uid = $2`, [input.kind, input.ownerUid]);
      if (held >= MAX_ENTRIES_PER_KIND) return { ok: false, reason: "entry_quota" } as const;
      const inserted = await tx.query<EntryRow>(
        `INSERT INTO entries (id, kind, owner_uid, name, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${ENTRY_COLS}`,
        [randomUUID(), input.kind, input.ownerUid, name, body, at],
      );
      await rewriteLinks(tx, input.ownerUid, input.kind, name, body);
      return { ok: true, entry: toEntry(inserted.rows[0] as EntryRow), created: true } as const;
    });
  }

  async function rewriteLinks(q: Query, ownerUid: number, kind: string, name: string, body: string): Promise<void> {
    await q.query(`DELETE FROM links WHERE owner_uid = $1 AND from_kind = $2 AND from_name = $3`, [ownerUid, kind, name]);
    for (const link of extractLinks(body)) {
      if (link.toKind === "entry" && link.toName.toLowerCase() === name.toLowerCase()) continue;
      await q.query(
        `INSERT INTO links (owner_uid, from_kind, from_name, to_kind, to_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [ownerUid, kind, name, link.toKind, link.toName],
      );
    }
  }

  async function skillUsage(uid: number, name: string, since: number): Promise<{ uses: number; tools: Array<{ tool: string; subject: string | null; n: number }> }> {
    const subject = `skill:${cleanLine(name, MAX_ENTRY_NAME)}`.slice(0, 201);
    const [uses, tools] = await Promise.all([
      first<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_log WHERE uid = $1 AND tool = 'skill_read' AND subject = $2 AND at > $3 AND ok`, [uid, subject, since]),
      rows<{ tool: string; subject: string | null; n: number }>(
        `WITH reads AS (SELECT token_id, at FROM audit_log WHERE uid = $1 AND tool = 'skill_read' AND subject = $2 AND at > $3 AND ok ORDER BY at DESC LIMIT 200)
         SELECT a.tool, a.subject, COUNT(DISTINCT a.id)::int AS n FROM audit_log a JOIN reads r ON a.token_id = r.token_id AND a.at >= r.at AND a.at <= r.at + $4
         WHERE a.uid = $1 AND a.ok AND a.tool NOT IN ('skill_read', 'skill_learn', 'memory_index', 'memory_save', 'whoami') GROUP BY a.tool, a.subject ORDER BY n DESC, a.tool LIMIT 40`,
        [uid, subject, since, SKILL_SESSION_MS],
      ),
    ]);
    return { uses: uses?.n ?? 0, tools };
  }

  async function recordSuggestion(uid: number, kind: string, key: string, verdict: "accepted" | "snoozed" | "dismissed"): Promise<void> {
    await changed(`INSERT INTO suggestion_events (uid, kind, key, verdict, at) VALUES ($1, $2, $3, $4, $5)`, [uid, kind.slice(0, 40), key.slice(0, 300), verdict, now()]);
  }

  async function suggestionHistory(uid: number): Promise<{ stats: Array<{ kind: string; verdict: string; n: number }>; latest: Array<{ key: string; verdict: string; at: number }> }> {
    const [stats, latest] = await Promise.all([
      rows<{ kind: string; verdict: string; n: number }>(`SELECT kind, verdict, COUNT(*)::int AS n FROM suggestion_events WHERE uid = $1 AND at > $2 GROUP BY kind, verdict`, [uid, now() - RETAIN_SUGGESTIONS_MS]),
      rows<{ key: string; verdict: string; at: number }>(
        `SELECT key, verdict, at FROM (SELECT DISTINCT ON (key) key, verdict, at FROM suggestion_events WHERE uid = $1 ORDER BY key, at DESC, id DESC) latest ORDER BY at DESC LIMIT 2000`,
        [uid],
      ),
    ]);
    return { stats, latest };
  }

  async function missingEntries(ownerUid: number): Promise<Array<{ name: string; n: number }>> {
    return rows(
      `SELECT l.to_name AS name, COUNT(*)::int AS n FROM links l WHERE l.owner_uid = $1 AND l.to_kind = 'entry'
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.owner_uid = $1 AND lower(e.name) = lower(l.to_name))
       GROUP BY l.to_name ORDER BY n DESC, l.to_name LIMIT 10`,
      [ownerUid],
    );
  }

  async function unansweredQuestions(uid: number, since: number): Promise<Array<{ question: string; n: number }>> {
    return rows(
      `SELECT subject AS question, COUNT(*)::int AS n FROM audit_log WHERE uid = $1 AND tool = 'ask' AND NOT ok AND subject IS NOT NULL AND at > $2
       GROUP BY subject ORDER BY n DESC, MAX(at) DESC LIMIT 10`,
      [uid, since],
    );
  }

  async function recentSkillReads(uid: number, since: number): Promise<string[]> {
    return (
      await rows<{ subject: string }>(
        `SELECT subject FROM audit_log WHERE uid = $1 AND tool = 'skill_read' AND ok AND at > $2 AND subject LIKE 'skill:%' GROUP BY subject ORDER BY MAX(at) DESC LIMIT 5`,
        [uid, since],
      )
    ).map((r) => r.subject.slice("skill:".length));
  }

  async function connections(ownerUid: number, name: string): Promise<Connections> {
    const clean = cleanLine(name, MAX_ENTRY_NAME);
    const shape = (r: { from_kind: string; from_name: string; to_kind: string; to_name: string }): Link => ({
      fromKind: r.from_kind,
      fromName: r.from_name,
      toKind: r.to_kind,
      toName: r.to_name,
    });
    const [outgoing, incoming] = await Promise.all([
      rows<{ from_kind: string; from_name: string; to_kind: string; to_name: string }>(
        `SELECT * FROM links WHERE owner_uid = $1 AND from_name = $2 ORDER BY to_kind, to_name LIMIT 50`,
        [ownerUid, clean],
      ),
      rows<{ from_kind: string; from_name: string; to_kind: string; to_name: string }>(
        `SELECT * FROM links WHERE owner_uid = $1 AND lower(to_name) = lower($2) ORDER BY from_kind, from_name LIMIT 50`,
        [ownerUid, clean],
      ),
    ]);
    return { outgoing: outgoing.map(shape), incoming: incoming.map(shape) };
  }

  async function graph(ownerUid: number, limit = 200): Promise<Link[]> {
    return (
      await rows<{ from_kind: string; from_name: string; to_kind: string; to_name: string }>(
        `SELECT * FROM links WHERE owner_uid = $1 ORDER BY from_kind, from_name LIMIT $2`,
        [ownerUid, Math.min(Math.max(limit, 1), 500)],
      )
    ).map((r) => ({ fromKind: r.from_kind, fromName: r.from_name, toKind: r.to_kind, toName: r.to_name }));
  }

  async function graphView(ownerUid: number, allow: (repoName: string, repoId: number) => Promise<boolean>): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const [entryRows, linkRows, docRows, decisionRows] = await Promise.all([
      rows<{ kind: string; name: string; head: string }>(
        `SELECT kind, name, left(body, 400) AS head FROM entries WHERE owner_uid = $1 ORDER BY updated_at DESC LIMIT $2`,
        [ownerUid, MAX_ENTRIES_PER_KIND * ENTRY_KINDS.length],
      ),
      rows<{ from_kind: string; from_name: string; to_kind: string; to_name: string }>(
        `SELECT from_kind, from_name, to_kind, to_name FROM links WHERE owner_uid = $1 ORDER BY from_kind, from_name, to_kind, to_name LIMIT $2`,
        [ownerUid, GRAPH_MAX_LINKS],
      ),
      rows<{ repo_id: number; repo_name: string; path: string; title: string }>(
        `SELECT repo_id, repo_name, path, title FROM (
           SELECT repo_id, repo_name, path, title, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY indexed_at DESC, path) AS rank FROM documents WHERE owner_uid = $1
         ) ranked WHERE rank <= $2`,
        [ownerUid, GRAPH_DOCS_PER_REPO],
      ),
      rows<{ id: string; repo_id: number; repo_name: string; title: string; resolution: string | null }>(
        `SELECT id, repo_id, repo_name, title, resolution FROM posts WHERE type = 'decision' AND author_uid = $1 ORDER BY created_at DESC LIMIT 100`,
        [ownerUid],
      ),
    ]);

    const repoIds = new Map<number, string>();
    for (const d of docRows) if (Number(d.repo_id) !== UPLOAD_REPO_ID) repoIds.set(Number(d.repo_id), d.repo_name);
    for (const p of decisionRows) repoIds.set(Number(p.repo_id), p.repo_name);
    const reachable = new Map(await Promise.all([...repoIds].map(async ([id, name]) => [id, await allow(name, id).catch(() => false)] as const)));
    const canSee = (repoId: number): boolean => Number(repoId) === UPLOAD_REPO_ID || reachable.get(Number(repoId)) === true;

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const firstLine = (body: string): string | null => body.split("\n").find((l) => l.trim())?.trim().slice(0, 160) ?? null;
    const repoNode = (name: string): string => {
      const id = `repo:${name.toLowerCase()}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: "repo", label: name, detail: null });
      return id;
    };
    const entryId = (kind: string, name: string): string => `entry:${kind}:${name.toLowerCase()}`;

    const byName = new Map<string, string[]>();
    for (const e of entryRows) {
      const id = entryId(e.kind, e.name);
      nodes.set(id, { id, kind: e.kind, label: e.name, detail: firstLine(e.head) });
      const key = e.name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), id]);
    }

    for (const l of linkRows) {
      const from = entryId(l.from_kind, l.from_name);
      if (!nodes.has(from)) continue;
      if (l.to_kind === "repo") {
        edges.push({ source: from, target: repoNode(l.to_name), relation: "mentions" });
        continue;
      }
      const targets = byName.get(l.to_name.toLowerCase());
      if (targets?.length) {
        for (const to of targets) if (to !== from) edges.push({ source: from, target: to, relation: "links" });
        continue;
      }
      const gap = `missing:${l.to_name.toLowerCase()}`;
      if (!nodes.has(gap)) nodes.set(gap, { id: gap, kind: "missing", label: l.to_name, detail: "Referenced but never written down" });
      edges.push({ source: from, target: gap, relation: "links" });
    }

    for (const d of docRows) {
      if (!canSee(d.repo_id)) continue;
      const id = `doc:${d.repo_id}/${d.path}`;
      nodes.set(id, { id, kind: "document", label: d.title, detail: `${d.repo_name}/${d.path}` });
      edges.push({ source: id, target: repoNode(d.repo_name), relation: "documents" });
    }

    for (const p of decisionRows) {
      if (!canSee(p.repo_id)) continue;
      const id = `decision:${p.id}`;
      nodes.set(id, { id, kind: "decision", label: p.title, detail: p.resolution ? `Ruled: ${p.resolution.slice(0, 160)}` : "Waiting on you" });
      edges.push({ source: id, target: repoNode(p.repo_name), relation: "decided" });
    }

    return { nodes: [...nodes.values()], edges };
  }


  async function listEntries(kind: EntryKind, ownerUid: number, limit = MAX_ENTRIES_PER_KIND): Promise<Entry[]> {
    const capped = Math.min(Math.max(limit, 1), MAX_ENTRIES_PER_KIND);
    return (await rows<EntryRow>(`SELECT ${ENTRY_COLS} FROM entries WHERE kind = $1 AND owner_uid = $2 ORDER BY updated_at DESC, id DESC LIMIT $3`, [kind, ownerUid, capped])).map(toEntry);
  }

  async function getEntry(kind: EntryKind, ownerUid: number, name: string): Promise<Entry | null> {
    const row = await first<EntryRow>(`SELECT ${ENTRY_COLS} FROM entries WHERE kind = $1 AND owner_uid = $2 AND name = $3`, [kind, ownerUid, cleanLine(name, MAX_ENTRY_NAME)]);
    return row ? toEntry(row) : null;
  }

  async function deleteEntry(kind: EntryKind, ownerUid: number, name: string): Promise<boolean> {
    const clean = cleanLine(name, MAX_ENTRY_NAME);
    return transaction(async (tx) => {
      await lock(tx, `entries:${ownerUid}:${kind}`);
      const removed = (await tx.query(`DELETE FROM entries WHERE kind = $1 AND owner_uid = $2 AND name = $3`, [kind, ownerUid, clean])).count;
      if (removed) await tx.query(`DELETE FROM links WHERE owner_uid = $1 AND from_kind = $2 AND from_name = $3`, [ownerUid, kind, clean]);
      return removed > 0;
    });
  }



  const NEXT: Record<UpdateKind, { from: ReadonlyArray<string>; to: WorkStatus }> = {
    progress: { from: ["open", "working", "changes"], to: "working" },
    submitted: { from: ["open", "working", "changes"], to: "review" },
    accepted: { from: ["review"], to: "done" },
    changes: { from: ["review"], to: "changes" },
  };

  async function advanceWork(taskId: string, kind: UpdateKind, body: string, actor: Actor): Promise<WorkResult> {
    return transaction(async (tx) => {
      const task = (await tx.query<PostRow>(`SELECT * FROM posts WHERE id = $1 AND type = 'task' FOR UPDATE`, [taskId])).rows[0];
      if (!task || task.closed_at !== null) return { ok: false, reason: "not_found" } as const;
      const current = task.status ?? "open";
      const step = NEXT[kind];
      if (!step.from.includes(current)) return { ok: false, reason: "wrong_state" } as const;
      if (kind === "progress" || kind === "submitted") {
        const updates = await count(tx, `SELECT COUNT(*) AS n FROM work_updates WHERE task_id = $1`, [taskId]);
        if (updates >= MAX_UPDATES_PER_TASK) return { ok: false, reason: "update_quota" } as const;
      }
      const at = now();
      await tx.query(
        `INSERT INTO work_updates (id, task_id, kind, body, author_uid, author_login, client, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), taskId, kind, cleanText(body, MAX_POST_BODY), actor.uid, actor.login, actor.client, at],
      );
      if (step.to === "done") {
        await tx.query(`UPDATE posts SET status = 'done', closed_at = $2, closed_by = $3, resolution = $4 WHERE id = $1`, [taskId, at, actor.uid, cleanText(body, MAX_POST_BODY) || "Accepted"]);
        await recordEvent(tx, task.repo_id, at, "post.closed", { id: taskId, type: "task", title: task.title }, actor);
      } else {
        await tx.query(`UPDATE posts SET status = $2 WHERE id = $1`, [taskId, step.to]);
      }
      return { ok: true, status: step.to } as const;
    });
  }

  async function workUpdates(taskId: string): Promise<WorkUpdate[]> {
    return (
      await rows<{ id: string; task_id: string; kind: UpdateKind; body: string; author_login: string; client: string; at: number }>(
        `SELECT * FROM (SELECT * FROM work_updates WHERE task_id = $1 ORDER BY seq DESC LIMIT ${MAX_UPDATES_PER_TASK}) latest ORDER BY seq ASC`,
        [taskId],
      )
    ).map((r) => ({ id: r.id, taskId: r.task_id, kind: r.kind, body: r.body, authorLogin: r.author_login, client: r.client, at: r.at }));
  }

  async function requestsBy(authorUid: number, limit = 100): Promise<Post[]> {
    return (
      await rows<PostRow>(
        `SELECT * FROM posts WHERE type = 'task' AND author_uid = $1 AND (closed_at IS NULL OR closed_at > $2) ORDER BY created_at DESC LIMIT $3`,
        [authorUid, now() - RETAIN_EXPIRED_MS, Math.min(Math.max(limit, 1), 200)],
      )
    ).map(toPost);
  }

  async function changesRequestedFor(uid: number, client: string, limit = 20): Promise<Post[]> {
    return (
      await rows<PostRow>(
        `SELECT p.* FROM posts p WHERE p.type = 'task' AND p.status = 'changes' AND p.closed_at IS NULL
           AND EXISTS (SELECT 1 FROM work_updates u WHERE u.task_id = p.id AND u.kind = 'submitted' AND u.author_uid = $1 AND u.client = $2)
         ORDER BY p.created_at DESC LIMIT $3`,
        [uid, client, Math.min(Math.max(limit, 1), 100)],
      )
    ).map(toPost);
  }

  async function openDecisions(authorUid: number, limit = 50): Promise<Post[]> {
    const capped = Math.min(Math.max(limit, 1), 100);
    return (
      await rows<PostRow>(`SELECT * FROM posts WHERE type = 'decision' AND author_uid = $1 AND closed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $2`, [authorUid, capped])
    ).map(toPost);
  }

  async function answeredDecisions(authorUid: number, client: string, limit = 20): Promise<Post[]> {
    return (
      await rows<PostRow>(
        `SELECT * FROM posts WHERE type = 'decision' AND author_uid = $1 AND client = $2 AND resolution IS NOT NULL AND closed_at > $3
         ORDER BY closed_at DESC, id DESC LIMIT $4`,
        [authorUid, client, now() - ANSWER_VISIBLE_MS, Math.min(Math.max(limit, 1), 100)],
      )
    ).map(toPost);
  }

  async function putDocument(d: { ownerUid: number; repoId: number; repoName: string; path: string; title: string; body: string; createOnly?: boolean }): Promise<boolean> {
    const title = cleanLine(d.title, 200);
    const body = cleanText(d.body, MAX_DOC_BODY);
    if (!title || !body.trim()) return false;
    return transaction(async (tx) => {
      await lock(tx, `documents:${d.ownerUid}`);
      const at = now();
      const existing = (await tx.query<{ id: string }>(`SELECT id FROM documents WHERE owner_uid = $1 AND repo_id = $2 AND path = $3`, [d.ownerUid, d.repoId, d.path])).rows[0];
      if (existing) {
        if (d.createOnly) return false;
        await tx.query(`UPDATE documents SET repo_name = $1, title = $2, body = $3, indexed_at = $4 WHERE id = $5`, [d.repoName, title, body, at, existing.id]);
        return true;
      }
      const held = await count(tx, `SELECT COUNT(*) AS n FROM documents WHERE owner_uid = $1`, [d.ownerUid]);
      if (held >= MAX_DOCS_PER_USER) return false;
      await tx.query(`INSERT INTO documents (id, owner_uid, repo_id, repo_name, path, title, body, indexed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
        randomUUID(),
        d.ownerUid,
        d.repoId,
        d.repoName,
        d.path,
        title,
        body,
        at,
      ]);
      return true;
    });
  }

  async function search(ownerUid: number, query: string, opts: SearchOptions): Promise<Found[]> {
    const q = toSearchQuery(cleanLine(query, 400));
    if (!q) return [];
    const capped = Math.min(Math.max(opts.limit ?? 8, 1), 25);
    const wanted = new Set(opts.kinds?.length ? opts.kinds : ["document", ...ENTRY_KINDS]);
    const entryKinds = ENTRY_KINDS.filter((k) => wanted.has(k));
    const tsq = `websearch_to_tsquery('english', $2)`;
    const headline = (col: string) => `ts_headline('english', ${col}, ${tsq}, 'StartSel=${MARK_OPEN},StopSel=${MARK_CLOSE},MaxWords=26,MinWords=10,MaxFragments=2,FragmentDelimiter= ... ')`;
    const [docs, entries] = await Promise.all([
      wanted.has("document")
        ? rows<DocRow & { rank: number; snippet: string }>(
            `SELECT id, repo_id, repo_name, path, title, body, indexed_at, ts_rank(search, ${tsq}) AS rank, ${headline("body")} AS snippet FROM documents
             WHERE owner_uid = $1 AND search @@ ${tsq} ORDER BY rank DESC LIMIT $3`,
            [ownerUid, q, capped * 6],
          )
        : [],
      entryKinds.length
        ? rows<EntryRow & { rank: number; snippet: string }>(
            `SELECT id, kind, owner_uid, name, body, created_at, updated_at, ts_rank(search, ${tsq}) AS rank, ${headline("body")} AS snippet FROM entries
             WHERE owner_uid = $1 AND kind = ANY(string_to_array($4, ',')) AND search @@ ${tsq} ORDER BY rank DESC LIMIT $3`,
            [ownerUid, q, capped, entryKinds.join(",")],
          )
        : [],
    ]);
    const repos = new Map<number, string>();
    for (const d of docs) if (Number(d.repo_id) !== UPLOAD_REPO_ID) repos.set(Number(d.repo_id), d.repo_name);
    const verdicts = new Map(
      await Promise.all([...repos].map(async ([id, name]) => [id, await opts.allow(name, id).catch(() => false)] as const)),
    );
    const keptDocs = docs.filter((d) => Number(d.repo_id) === UPLOAD_REPO_ID || verdicts.get(Number(d.repo_id)) === true);
    const found: Found[] = [
      ...keptDocs.map((d) => ({
        kind: "document" as const,
        title: d.title,
        source: `${d.repo_name}/${d.path}`,
        repo: d.repo_name,
        body: d.body,
        snippet: d.snippet,
        rank: Number(d.rank),
      })),
      ...entries.map((e) => ({ kind: e.kind, title: e.name, source: `brain/${e.kind}/${e.name}`, repo: null, body: e.body, snippet: e.snippet, rank: Number(e.rank) })),
    ];
    return found.sort((x, y) => y.rank - x.rank).slice(0, capped);
  }



  async function sources(ownerUid: number): Promise<Array<{ repoName: string; documents: number; indexedAt: number }>> {
    return rows<{ repoName: string; documents: number; indexedAt: number }>(
      `SELECT repo_name AS "repoName", COUNT(*)::int AS documents, MAX(indexed_at) AS "indexedAt" FROM documents WHERE owner_uid = $1 GROUP BY repo_name ORDER BY MAX(indexed_at) DESC`,
      [ownerUid],
    );
  }

  async function replaceRepo(ownerUid: number, repo: { repoId: number; repoName: string }, docs: Array<{ path: string; title: string; body: string }>): Promise<number> {
    return transaction(async (tx) => {
      await lock(tx, `documents:${ownerUid}`);
      await tx.query(`DELETE FROM documents WHERE owner_uid = $1 AND repo_id = $2`, [ownerUid, repo.repoId]);
      const held = await count(tx, `SELECT COUNT(*) AS n FROM documents WHERE owner_uid = $1`, [ownerUid]);
      const at = now();
      let stored = 0;
      for (const d of docs) {
        if (held + stored >= MAX_DOCS_PER_USER) break;
        const title = cleanLine(d.title, 200);
        const body = cleanText(d.body, MAX_DOC_BODY);
        const path = cleanLine(d.path, 400);
        if (!title || !path || !body.trim()) continue;
        await tx.query(
          `INSERT INTO documents (id, owner_uid, repo_id, repo_name, path, title, body, indexed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (owner_uid, repo_id, path) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, indexed_at = EXCLUDED.indexed_at`,
          [randomUUID(), ownerUid, repo.repoId, repo.repoName, path, title, body, at],
        );
        stored += 1;
      }
      return stored;
    });
  }

  async function putUpload(ownerUid: number, name: string, title: string, body: string, opts: { createOnly?: boolean } = {}): Promise<boolean> {
    return putDocument({ ownerUid, repoId: UPLOAD_REPO_ID, repoName: UPLOAD_REPO_NAME, path: cleanLine(name, MAX_UPLOAD_NAME), title, body, ...opts });
  }

  async function listUploads(ownerUid: number): Promise<Array<{ name: string; title: string; size: number; indexedAt: number }>> {
    return rows<{ name: string; title: string; size: number; indexedAt: number }>(
      `SELECT path AS name, title, length(body) AS size, indexed_at AS "indexedAt" FROM documents WHERE owner_uid = $1 AND repo_id = ${UPLOAD_REPO_ID} ORDER BY indexed_at DESC LIMIT 200`,
      [ownerUid],
    );
  }

  async function profile(uid: number): Promise<Profile | null> {
    const r = await first<ProfileRow>(`SELECT uid, login, name, email, company, role, team_size, goals, agents, kit, updates, created_at, updated_at, asked_at FROM profiles WHERE uid = $1`, [uid]);
    if (!r) return null;
    const list = (v: string) => v.split(",").filter(Boolean);
    return {
      uid: Number(r.uid),
      login: r.login,
      name: r.name,
      email: r.email,
      company: r.company,
      role: Object.hasOwn(ROLES, r.role) ? (r.role as Profile["role"]) : "other",
      teamSize: Object.hasOwn(TEAM_SIZES, r.team_size) ? (r.team_size as Profile["teamSize"]) : "solo",
      goals: list(r.goals).filter((g) => Object.hasOwn(GOALS, g)) as Profile["goals"],
      agents: list(r.agents).filter((a) => Object.hasOwn(AGENT_CHOICES, a)) as Profile["agents"],
      kit: Object.hasOwn(KITS, r.kit) ? (r.kit as Profile["kit"]) : "both",
      updates: Boolean(r.updates),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      askedAt: r.asked_at === null ? null : Number(r.asked_at),
    };
  }

  async function saveProfile(p: Omit<Profile, "createdAt" | "updatedAt" | "askedAt">): Promise<void> {
    await changed(
      `INSERT INTO profiles (uid, login, name, email, company, role, team_size, goals, agents, kit, updates, created_at, updated_at, updates_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::boolean, $12, $12, CASE WHEN $11::boolean THEN $12::bigint END)
       ON CONFLICT (uid) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, email = EXCLUDED.email, company = EXCLUDED.company, role = EXCLUDED.role,
         team_size = EXCLUDED.team_size, goals = EXCLUDED.goals, agents = EXCLUDED.agents, kit = EXCLUDED.kit, updates = EXCLUDED.updates, updated_at = EXCLUDED.updated_at,
         updates_at = CASE WHEN NOT EXCLUDED.updates THEN NULL WHEN profiles.updates THEN profiles.updates_at ELSE EXCLUDED.updated_at END`,
      [p.uid, p.login, p.name, p.email, p.company, p.role, p.teamSize, p.goals.join(","), p.agents.join(","), p.kit, p.updates ? "true" : "false", now()],
    );
  }

  async function markAsked(uid: number): Promise<void> {
    await changed(`UPDATE profiles SET asked_at = $2 WHERE uid = $1 AND asked_at IS NULL`, [uid, now()]);
  }

  async function listGateways(ownerUid: number): Promise<Array<{ name: string; url: string; hasToken: boolean; createdAt: number }>> {
    return rows(
      `SELECT name, url, token_sealed IS NOT NULL AS "hasToken", created_at AS "createdAt" FROM gateway_servers WHERE owner_uid = $1 ORDER BY name`,
      [ownerUid],
    );
  }

  async function gateway(ownerUid: number, name: string): Promise<{ name: string; url: string; tokenSealed: string | null } | undefined> {
    return first(`SELECT name, url, token_sealed AS "tokenSealed" FROM gateway_servers WHERE owner_uid = $1 AND name = $2`, [ownerUid, name]);
  }

  async function putGateway(ownerUid: number, g: { name: string; url: string; tokenSealed: string | null }, max: number): Promise<boolean> {
    return transaction(async (tx) => {
      await lock(tx, `gateways:${ownerUid}`);
      const held = await count(tx, `SELECT COUNT(*) AS n FROM gateway_servers WHERE owner_uid = $1 AND name <> $2`, [ownerUid, g.name]);
      if (held >= max) return false;
      await tx.query(
        `INSERT INTO gateway_servers (owner_uid, name, url, token_sealed, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_uid, name) DO UPDATE SET url = EXCLUDED.url, token_sealed = EXCLUDED.token_sealed`,
        [ownerUid, g.name, g.url, g.tokenSealed, now()],
      );
      return true;
    });
  }

  async function deleteGateway(ownerUid: number, name: string): Promise<boolean> {
    return (await changed(`DELETE FROM gateway_servers WHERE owner_uid = $1 AND name = $2`, [ownerUid, name])) > 0;
  }

  async function deleteUpload(ownerUid: number, name: string): Promise<boolean> {
    return (await changed(`DELETE FROM documents WHERE owner_uid = $1 AND repo_id = ${UPLOAD_REPO_ID} AND path = $2`, [ownerUid, cleanLine(name, MAX_UPLOAD_NAME)])) > 0;
  }

  async function staleSources(before: number, limit: number): Promise<Array<{ ownerUid: number; repoId: number; repoName: string; indexedAt: number }>> {
    return rows<{ ownerUid: number; repoId: number; repoName: string; indexedAt: number }>(
      `SELECT owner_uid AS "ownerUid", repo_id AS "repoId", MAX(repo_name) AS "repoName", MAX(indexed_at) AS "indexedAt"
       FROM documents WHERE repo_id <> ${UPLOAD_REPO_ID} GROUP BY owner_uid, repo_id
       HAVING MAX(COALESCE(checked_at, indexed_at)) < $1 ORDER BY MAX(COALESCE(checked_at, indexed_at)) ASC LIMIT $2`,
      [before, Math.min(Math.max(limit, 1), 200)],
    );
  }

  async function deferRepo(ownerUid: number, repoId: number): Promise<void> {
    await changed(`UPDATE documents SET checked_at = $3 WHERE owner_uid = $1 AND repo_id = $2`, [ownerUid, repoId, now()]);
  }

  async function clearRepo(ownerUid: number, repoId: number): Promise<number> {
    return changed(`DELETE FROM documents WHERE owner_uid = $1 AND repo_id = $2`, [ownerUid, repoId]);
  }



  async function purge(): Promise<{ posts: number; tokens: number }> {
    const t = now();
    const cutoff = t - RETAIN_EXPIRED_MS;
    let posts = await changed(`DELETE FROM posts WHERE type = 'claim' AND (released_at < $1 OR (released_at IS NULL AND expires_at < $1))`, [cutoff]);
    posts += await changed(`DELETE FROM posts WHERE (type IN ('finding', 'handoff') OR (type = 'decision' AND closed_at IS NOT NULL)) AND created_at < $1`, [t - RETAIN_POSTS_MS]);
    await changed(`DELETE FROM suggestion_events WHERE at < $1`, [t - RETAIN_SUGGESTIONS_MS]);
    posts += await changed(
      `DELETE FROM posts WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at DESC, id DESC) AS rank
           FROM posts WHERE type IN ('finding', 'handoff') OR (type = 'decision' AND closed_at IS NOT NULL)
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
    putDocument,
    search,
    sources,
    clearRepo,
    deferRepo,
    replaceRepo,
    staleSources,
    putUpload,
    listUploads,
    deleteUpload,
    profile,
    saveProfile,
    markAsked,
    listGateways,
    gateway,
    putGateway,
    deleteGateway,
    putEntry,
    connections,
    recordSuggestion,
    suggestionHistory,
    missingEntries,
    unansweredQuestions,
    recentSkillReads,
    skillUsage,
    graph,
    graphView,
    listEntries,
    getEntry,
    deleteEntry,
    addPost,
    readBoard,
    getPost,
    releaseClaim,
    hasTask,
    closePost,
    events,
    advanceWork,
    workUpdates,
    requestsBy,
    changesRequestedFor,
    openDecisions,
    answeredDecisions,
    timeline,
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
