import { DEFINITIVE_KINDS, type GitHubClient, GitHubError, type RepoRole, roleFromPermissions } from "./github.ts";

export interface RepoAccess {
  repoId: number;
  fullName: string;
  role: RepoRole;
}

export type AccessResolver = (uid: number, login: string, repo: string) => Promise<RepoAccess>;

export interface AccessChecker {
  check(uid: number, login: string, repo: string): Promise<RepoAccess>;
}

const MAX_ENTRIES = 10_000;
const BOARD_ROLES: ReadonlySet<RepoRole> = new Set(["admin", "maintain", "write", "triage"]);
const MODERATOR_ROLES: ReadonlySet<RepoRole> = new Set(["admin", "maintain"]);

export function canUseBoard(role: RepoRole): boolean {
  return BOARD_ROLES.has(role);
}

export function canModerate(role: RepoRole): boolean {
  return MODERATOR_ROLES.has(role);
}

export async function resolveRepoAccess(github: GitHubClient, login: string, repo: string): Promise<RepoAccess> {
  const detail = await github.repo(repo);
  let role = roleFromPermissions(detail.permissions);
  if (!canUseBoard(role)) {
    try {
      role = await github.collaboratorRole(detail.fullName, login);
    } catch (err) {
      if (!(err instanceof GitHubError) || !DEFINITIVE_KINDS.has(err.kind)) throw err;
    }
  }
  return { repoId: detail.id, fullName: detail.fullName, role };
}

export function createAccessChecker(opts: { resolve: AccessResolver; ttlMs: number; now?: () => number }): AccessChecker {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; access?: RepoAccess; error?: GitHubError }>();

  function remember(key: string, entry: { access?: RepoAccess; error?: GitHubError }): void {
    cache.delete(key);
    cache.set(key, { at: now(), ...entry });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }

  return {
    async check(uid, login, repo) {
      const key = `${uid}\0${repo.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < opts.ttlMs) {
        if (hit.error) throw hit.error;
        if (hit.access) return hit.access;
      }
      try {
        const access = await opts.resolve(uid, login, repo);
        remember(key, { access });
        return access;
      } catch (err) {
        if (err instanceof GitHubError && DEFINITIVE_KINDS.has(err.kind)) remember(key, { error: err });
        throw err;
      }
    },
  };
}
