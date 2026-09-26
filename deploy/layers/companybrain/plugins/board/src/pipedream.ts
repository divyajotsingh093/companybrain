import type { Config } from "./config.ts";
import { guardedFetch, openUpstream, type Upstream } from "./gateway.ts";

export const PIPEDREAM_MCP_URL = "https://remote.mcp.pipedream.net/v3";
const TOKEN_URL = "https://api.pipedream.com/v1/oauth/token";
const TOKEN_EARLY_MS = 60_000;
export const pipedreamSlug = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{0,36}$/.test(value);
export const pipedreamGatewayUrl = (slug: string): string => `${PIPEDREAM_MCP_URL}?app=${encodeURIComponent(slug)}`;

/** One in-process cache per deployment. A cold instance fetches its own developer token. */
export function createPipedreamAdapter(opts: {
  config: NonNullable<Config["pipedream"]>;
  fetch: typeof fetch;
  now: () => number;
}) {
  let cached: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  const accessToken = async (): Promise<string> => {
    if (cached && cached.expiresAt - TOKEN_EARLY_MS > opts.now()) return cached.value;
    if (!pending) pending = (async () => {
      const response = await guardedFetch(opts.fetch)(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: opts.config.clientId, client_secret: opts.config.clientSecret }),
      });
      if (!response.ok) throw new Error("Pipedream authentication unavailable");
      const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof payload.access_token !== "string" || !payload.access_token || typeof payload.expires_in !== "number" || payload.expires_in <= 0) {
        throw new Error("Pipedream authentication response invalid");
      }
      cached = { value: payload.access_token, expiresAt: opts.now() + payload.expires_in * 1000 };
      return cached.value;
    })().finally(() => { pending = undefined; });
    return pending;
  };
  return {
    async open(uid: number, slug: string): Promise<Upstream> {
      if (!Number.isSafeInteger(uid) || uid <= 0 || !pipedreamSlug(slug)) throw new Error("Invalid Pipedream connection");
      const token = await accessToken();
      return openUpstream({
        url: pipedreamGatewayUrl(slug), sealedToken: null, secret: "", fetch: opts.fetch,
        headers: {
          authorization: `Bearer ${token}`,
          "x-pd-project-id": opts.config.projectId,
          "x-pd-environment": opts.config.environment,
          "x-pd-external-user-id": `companybrain-${uid}`,
          "x-pd-app-slug": slug,
        },
      });
    },
  };
}
