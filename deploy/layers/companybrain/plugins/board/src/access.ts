import type { RepoPermissions } from "./github.ts";
import type { Identity } from "./token.ts";

export type AccessProbe = (identity: Identity, repo: string) => Promise<RepoPermissions | null>;

export interface AccessChecker {
  canUseBoard(identity: Identity, repo: string): Promise<boolean>;
}

const MAX_ENTRIES = 10_000;

export function hasBoardAccess(permissions: RepoPermissions | null): boolean {
  if (!permissions) return false;
  return Boolean(permissions.admin || permissions.maintain || permissions.push || permissions.triage);
}

export function createAccessChecker(opts: { probe: AccessProbe; ttlMs: number; now?: () => number }): AccessChecker {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { allowed: boolean; at: number }>();

  return {
    async canUseBoard(identity, repo) {
      const key = `${identity.uid}\0${repo.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < opts.ttlMs) return hit.allowed;
      let allowed = false;
      try {
        allowed = hasBoardAccess(await opts.probe(identity, repo));
      } catch {
        allowed = false;
      }
      cache.delete(key);
      cache.set(key, { allowed, at: now() });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      return allowed;
    },
  };
}
