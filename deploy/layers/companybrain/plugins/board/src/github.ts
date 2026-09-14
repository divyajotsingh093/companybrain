import { cleanLine } from "./untrusted.ts";

export type Fetch = typeof fetch;

export type GitHubErrorKind =
  | "invalid"
  | "unauthorized"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "moved"
  | "empty"
  | "unprocessable"
  | "unavailable";

export class GitHubError extends Error {
  readonly status: number;
  readonly kind: GitHubErrorKind;

  constructor(status: number, kind: GitHubErrorKind, message: string) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

export const DEFINITIVE_KINDS: ReadonlySet<GitHubErrorKind> = new Set(["not_found", "forbidden", "moved", "invalid"]);

export type RepoRole = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export interface RepoPermissions {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
  triage?: boolean;
  pull?: boolean;
}

export interface RepoSummary {
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  pushedAt: string | null;
}

export interface RepoDetail extends RepoSummary {
  id: number;
  permissions: RepoPermissions | null;
}

export interface CodeHit {
  repo: string;
  path: string;
  fragments: string[];
}

export type FileResult =
  | { kind: "file"; path: string; content: string }
  | { kind: "dir"; path: string; entries: string[] }
  | { kind: "too_large"; path: string; size: number }
  | { kind: "binary"; path: string; size: number }
  | { kind: "other"; path: string; type: string };

export interface GitHubGrant {
  accessToken: string;
  expiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
}

export const MAX_FILE_BYTES = 1_000_000;

const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

export function assertRepo(repo: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2 || parts.some((p) => !SEGMENT.test(p) || /^\.+$/.test(p))) {
    throw new GitHubError(400, "invalid", "repo must look like owner/name");
  }
  return repo;
}

function encodePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) throw new GitHubError(400, "invalid", "path is required");
  if (segments.some((s) => /^\.+$/.test(s))) throw new GitHubError(400, "invalid", "path may not contain . or .. segments");
  return segments.map(encodeURIComponent).join("/");
}

const SEARCH_ESCAPE = /(^|\s)-?(repo|org|user|owner|fork|is|in|archived):/i;
const DANGLING_OPERATOR = /(^|\s)(NOT|OR|AND)\s*$|^\s*(NOT|OR|AND)(\s|$)/;

export function assertSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) throw new GitHubError(400, "invalid", "query is required");
  if (SEARCH_ESCAPE.test(trimmed)) throw new GitHubError(400, "invalid", "query may not contain repo:, org:, user: or other scope qualifiers");
  if (DANGLING_OPERATOR.test(trimmed)) throw new GitHubError(400, "invalid", "query may not start or end with NOT, OR or AND");
  return trimmed;
}

async function errorFor(res: Response, path: string): Promise<GitHubError> {
  const s = res.status;
  if (s >= 300 && s < 400) return new GitHubError(s, "moved", "repository has moved");
  if (s === 401) return new GitHubError(s, "unauthorized", "GitHub authorization expired or was revoked");
  if (s === 429 || (s === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))) {
    return new GitHubError(s, "rate_limited", "GitHub rate limit reached");
  }
  if (s === 403) return new GitHubError(s, "forbidden", "forbidden");
  if (s === 404) return new GitHubError(s, "not_found", "not found");
  if (s === 409) return new GitHubError(s, "empty", "repository is empty");
  if (s === 422) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return new GitHubError(s, "unprocessable", cleanLine(body.message ?? "request rejected", 200));
  }
  if (s >= 500) return new GitHubError(s, "unavailable", "GitHub is unavailable");
  return new GitHubError(s, "invalid", `GitHub returned ${s} for ${path}`);
}

interface RawRepo {
  id: number;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  pushed_at: string | null;
  permissions?: RepoPermissions;
}

function summary(r: RawRepo): RepoSummary {
  return {
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
  };
}

export function roleFromPermissions(p: RepoPermissions | null): RepoRole {
  if (!p) return "none";
  if (p.admin) return "admin";
  if (p.maintain) return "maintain";
  if (p.push) return "write";
  if (p.triage) return "triage";
  if (p.pull) return "read";
  return "none";
}

const ROLE_NAMES: ReadonlySet<string> = new Set(["admin", "maintain", "write", "triage", "read"]);

export type GitHubClient = ReturnType<typeof createGitHub>;

export function createGitHub(token: string | null, opts: { apiUrl: string; fetch?: Fetch }) {
  const doFetch = opts.fetch ?? fetch;

  async function request(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const headers: Record<string, string> = {
      accept,
      "x-github-api-version": "2022-11-28",
      "user-agent": "companybrain-board",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await doFetch(`${opts.apiUrl}${path}`, { headers, redirect: "manual" });
    if (!res.ok) throw await errorFor(res, path);
    return res;
  }

  async function json<T>(path: string): Promise<T> {
    return (await request(path)).json() as Promise<T>;
  }

  return {
    viewer: () => json<{ login: string; id: number }>("/user"),

    async listRepos(limit: number): Promise<RepoSummary[]> {
      const rows = await json<RawRepo[]>(`/user/repos?per_page=${Math.min(Math.max(limit, 1), 100)}&sort=pushed`);
      return rows.map(summary);
    },

    async repo(repo: string): Promise<RepoDetail> {
      const r = await json<RawRepo>(`/repos/${assertRepo(repo)}`);
      if (r.full_name.toLowerCase() !== repo.toLowerCase()) throw new GitHubError(301, "moved", "repository has moved");
      return { ...summary(r), id: r.id, permissions: r.permissions ?? null };
    },

    async collaboratorRole(repo: string, login: string): Promise<RepoRole> {
      const body = await json<{ permission?: string; role_name?: string }>(
        `/repos/${assertRepo(repo)}/collaborators/${encodeURIComponent(login)}/permission`,
      );
      if (body.role_name && ROLE_NAMES.has(body.role_name)) return body.role_name as RepoRole;
      if (body.permission === "admin") return "admin";
      if (body.permission === "write") return "write";
      if (body.permission === "read") return "read";
      return "none";
    },

    async readme(repo: string): Promise<string | null> {
      try {
        return await (await request(`/repos/${assertRepo(repo)}/readme`, "application/vnd.github.raw+json")).text();
      } catch (err) {
        if (err instanceof GitHubError && (err.kind === "not_found" || err.kind === "empty")) return null;
        throw err;
      }
    },

    languages: (repo: string) => json<Record<string, number>>(`/repos/${assertRepo(repo)}/languages`),

    async topLevel(repo: string): Promise<string[]> {
      const rows = await json<Array<{ name: string; type: string }>>(`/repos/${assertRepo(repo)}/contents`);
      return rows.map((r) => (r.type === "dir" ? `${r.name}/` : r.name));
    },

    async recentCommits(repo: string, limit: number): Promise<Array<{ sha: string; message: string; author: string; date: string }>> {
      const rows = await json<Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>>(
        `/repos/${assertRepo(repo)}/commits?per_page=${Math.min(Math.max(limit, 1), 30)}`,
      );
      return rows.map((r) => ({
        sha: r.sha.slice(0, 7),
        message: r.commit.message.split(/\r?\n/)[0] ?? "",
        author: r.commit.author.name,
        date: r.commit.author.date,
      }));
    },

    async searchCode(repo: string, query: string): Promise<CodeHit[]> {
      const name = assertRepo(repo);
      const q = encodeURIComponent(`${assertSearchQuery(query)} repo:${name}`);
      const res = await request(`/search/code?q=${q}&per_page=20`, "application/vnd.github.text-match+json");
      const body = (await res.json()) as {
        items: Array<{ path: string; repository?: { full_name?: string }; text_matches?: Array<{ fragment: string }> }>;
      };
      return body.items
        .filter((i) => (i.repository?.full_name ?? "").toLowerCase() === name.toLowerCase())
        .map((i) => ({
          repo: i.repository?.full_name ?? name,
          path: i.path,
          fragments: (i.text_matches ?? []).map((m) => m.fragment),
        }));
    },

    async getFile(repo: string, path: string, ref?: string): Promise<FileResult> {
      const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const body = await json<unknown>(`/repos/${assertRepo(repo)}/contents/${encodePath(path)}${suffix}`);
      if (Array.isArray(body)) {
        return { kind: "dir", path, entries: body.map((e: { name: string; type: string }) => (e.type === "dir" ? `${e.name}/` : e.name)) };
      }
      const file = body as { type: string; size?: number; encoding?: string; content?: string };
      if (file.type !== "file") return { kind: "other", path, type: file.type };
      const size = file.size ?? 0;
      if (size > MAX_FILE_BYTES || (size > 0 && file.encoding !== "base64")) return { kind: "too_large", path, size };
      const bytes = Buffer.from(file.content ?? "", "base64");
      if (bytes.includes(0)) return { kind: "binary", path, size };
      return { kind: "file", path, content: bytes.toString("utf8") };
    },
  };
}

function grantFrom(body: Record<string, unknown>, now: number): GitHubGrant | null {
  if (typeof body.access_token !== "string" || !body.access_token) return null;
  const seconds = (value: unknown) => (typeof value === "number" && value > 0 ? now + value * 1000 : null);
  return {
    accessToken: body.access_token,
    expiresAt: seconds(body.expires_in),
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    refreshExpiresAt: seconds(body.refresh_token_expires_in),
  };
}

async function tokenRequest(opts: { webUrl: string; fetch?: Fetch; now: number }, params: Record<string, string>): Promise<GitHubGrant> {
  const res = await (opts.fetch ?? fetch)(`${opts.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(params),
    redirect: "manual",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const grant = res.ok ? grantFrom(body, opts.now) : null;
  if (!grant) throw new GitHubError(res.ok ? 401 : res.status, "unauthorized", cleanLine(String(body.error ?? "GitHub token request failed"), 120));
  return grant;
}

export function exchangeCode(opts: {
  webUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: Fetch;
  now: number;
}): Promise<GitHubGrant> {
  return tokenRequest(opts, {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
}

export function refreshGrant(opts: {
  webUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: Fetch;
  now: number;
}): Promise<GitHubGrant> {
  return tokenRequest(opts, {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
  });
}
