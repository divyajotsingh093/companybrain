export type Fetch = typeof fetch;

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RepoSummary {
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  pushedAt: string | null;
}

export interface RepoPermissions {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
  triage?: boolean;
  pull?: boolean;
}

export interface RepoDetail extends RepoSummary {
  permissions: RepoPermissions | null;
}

export interface CodeHit {
  path: string;
  fragments: string[];
}

export type FileResult = { kind: "file"; path: string; content: string } | { kind: "dir"; path: string; entries: string[] };

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function assertRepo(repo: string): string {
  if (!REPO_PATTERN.test(repo)) throw new GitHubError(400, "repo must look like owner/name");
  return repo;
}

function encodePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) throw new GitHubError(400, "path may not contain . or ..");
  return segments.map(encodeURIComponent).join("/");
}

interface RawRepo {
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

export type GitHubClient = ReturnType<typeof createGitHub>;

export function createGitHub(token: string, opts: { apiUrl: string; fetch?: Fetch }) {
  const doFetch = opts.fetch ?? fetch;

  async function request(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const res = await doFetch(`${opts.apiUrl}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept,
        "x-github-api-version": "2022-11-28",
        "user-agent": "companybrain-board",
      },
    });
    if (!res.ok) throw new GitHubError(res.status, `GitHub returned ${res.status}`);
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
      return { ...summary(r), permissions: r.permissions ?? null };
    },

    async readme(repo: string): Promise<string | null> {
      try {
        return await (await request(`/repos/${assertRepo(repo)}/readme`, "application/vnd.github.raw+json")).text();
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
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
        message: r.commit.message.split("\n")[0] ?? "",
        author: r.commit.author.name,
        date: r.commit.author.date,
      }));
    },

    async searchCode(repo: string, query: string): Promise<CodeHit[]> {
      const q = encodeURIComponent(`${query} repo:${assertRepo(repo)}`);
      const res = await request(`/search/code?q=${q}&per_page=20`, "application/vnd.github.text-match+json");
      const body = (await res.json()) as { items: Array<{ path: string; text_matches?: Array<{ fragment: string }> }> };
      return body.items.map((i) => ({ path: i.path, fragments: (i.text_matches ?? []).map((m) => m.fragment) }));
    },

    async getFile(repo: string, path: string, ref?: string): Promise<FileResult> {
      const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const base = `/repos/${assertRepo(repo)}/contents/${encodePath(path)}${suffix}`;
      const body = await json<unknown>(base);
      if (Array.isArray(body)) {
        return { kind: "dir", path, entries: body.map((e: { name: string; type: string }) => (e.type === "dir" ? `${e.name}/` : e.name)) };
      }
      const file = body as { type: string; encoding?: string; content?: string };
      if (file.type !== "file") throw new GitHubError(400, `unsupported content type ${file.type}`);
      if (file.encoding === "base64" && file.content) {
        return { kind: "file", path, content: Buffer.from(file.content, "base64").toString("utf8") };
      }
      return { kind: "file", path, content: await (await request(base, "application/vnd.github.raw+json")).text() };
    },
  };
}

export async function exchangeCode(opts: {
  webUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: Fetch;
}): Promise<string> {
  const res = await (opts.fetch ?? fetch)(`${opts.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new GitHubError(res.status || 401, body.error ?? "GitHub code exchange failed");
  return body.access_token;
}
