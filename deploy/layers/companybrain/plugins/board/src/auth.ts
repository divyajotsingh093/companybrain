import { randomBytes, randomUUID } from "node:crypto";
import type { Config } from "./config.ts";
import { type Fetch, GitHubError, type GitHubGrant, refreshGrant } from "./github.ts";
import type { CredentialRow, Store, TokenKind, TokenRow } from "./store.ts";
import { hashToken, seal, unseal } from "./token.ts";

export const TOKEN_PREFIX = "cb2_";
const TOUCH_INTERVAL_MS = 5 * 60_000;
const REFRESH_SKEW_MS = 60_000;

export interface Principal {
  tokenId: string;
  uid: number;
  login: string;
  kind: TokenKind;
  client: string;
}

export interface IssuedToken {
  token: string;
  row: TokenRow;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(opts: { config: Config; store: Store; fetch?: Fetch; now?: () => number }) {
  const { config, store } = opts;
  const now = opts.now ?? Date.now;
  const refreshing = new Map<number, Promise<string>>();

  async function issue(uid: number, kind: TokenKind, client: string, ttlMs: number): Promise<IssuedToken | null> {
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const createdAt = now();
    const row: TokenRow = {
      id: randomUUID(),
      hash: hashToken(token),
      uid,
      kind,
      client,
      createdAt,
      expiresAt: createdAt + ttlMs,
      revokedAt: null,
      lastUsedAt: null,
    };
    return (await store.insertToken(row)) ? { token, row } : null;
  }

  async function verify(presented: string | null | undefined, kind: TokenKind): Promise<Principal | null> {
    if (!presented) return null;
    const token = presented.replace(/^Bearer\s+/i, "").trim();
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    const row = await store.tokenByHash(hashToken(token));
    const t = now();
    if (!row || row.kind !== kind || row.revokedAt !== null || row.expiresAt <= t) return null;
    const cred = await store.credential(row.uid);
    if (!cred) return null;
    if (!row.lastUsedAt || t - row.lastUsedAt > TOUCH_INTERVAL_MS) await store.touchToken(row.id, t);
    return { tokenId: row.id, uid: row.uid, login: cred.login, kind: row.kind, client: row.client };
  }

  function sealGrant(uid: number, login: string, grant: GitHubGrant): CredentialRow {
    return {
      uid,
      login,
      accessSealed: seal(config.secret, "github-access", grant.accessToken),
      accessExpiresAt: grant.expiresAt,
      refreshSealed: grant.refreshToken ? seal(config.secret, "github-refresh", grant.refreshToken) : null,
      refreshExpiresAt: grant.refreshExpiresAt,
      updatedAt: now(),
    };
  }

  async function saveGrant(uid: number, login: string, grant: GitHubGrant): Promise<void> {
    await store.saveCredential(sealGrant(uid, login, grant));
  }

  function usable(cred: CredentialRow, t: number): string | null {
    if (cred.accessExpiresAt !== null && cred.accessExpiresAt - REFRESH_SKEW_MS <= t) return null;
    const access = unseal(config.secret, "github-access", cred.accessSealed);
    if (typeof access !== "string") throw new GitHubError(401, "unauthorized", "GitHub authorization unreadable");
    return access;
  }

  async function refresh(uid: number): Promise<string> {
    const outcome = await store.withCredentialLock(uid, async (held): Promise<{ token: string } | { error: unknown }> => {
      const cred = await held.credential();
      if (!cred) return { error: new GitHubError(401, "unauthorized", "no GitHub authorization") };
      const t = now();
      const current = usable(cred, t);
      if (current) return { token: current };
      if (!cred.refreshSealed || (cred.refreshExpiresAt !== null && cred.refreshExpiresAt <= t)) {
        return { error: new GitHubError(401, "unauthorized", "GitHub authorization expired") };
      }
      const refreshToken = unseal(config.secret, "github-refresh", cred.refreshSealed);
      if (typeof refreshToken !== "string" || !config.githubClientId || !config.githubClientSecret) {
        return { error: new GitHubError(401, "unauthorized", "GitHub authorization expired") };
      }
      let grant: GitHubGrant;
      try {
        grant = await refreshGrant({
          webUrl: config.githubWebUrl,
          clientId: config.githubClientId,
          clientSecret: config.githubClientSecret,
          refreshToken,
          now: t,
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
        });
      } catch (err) {
        if (err instanceof GitHubError && err.kind === "unauthorized") await held.dropRefresh();
        return { error: err };
      }
      await held.save(sealGrant(uid, cred.login, grant));
      return { token: grant.accessToken };
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.token;
  }

  async function githubToken(uid: number): Promise<string> {
    const cred = await store.credential(uid);
    if (!cred) throw new GitHubError(401, "unauthorized", "no GitHub authorization");
    const current = usable(cred, now());
    if (current) return current;
    const pending = refreshing.get(uid);
    if (pending) return pending;
    const run = refresh(uid).finally(() => refreshing.delete(uid));
    refreshing.set(uid, run);
    return run;
  }

  return { issue, verify, saveGrant, githubToken };
}
