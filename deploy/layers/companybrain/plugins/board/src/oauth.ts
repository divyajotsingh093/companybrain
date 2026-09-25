import { createHash, randomBytes } from "node:crypto";
import { seal, unseal } from "./token.ts";
import { cleanLine } from "./untrusted.ts";

export const CODE_TTL_MS = 2 * 60_000;
export const NEXT_TTL_MS = 30 * 60_000;
export const AUTHORIZE_PATH = "/oauth/authorize";
const MAX_REDIRECTS = 5;
const MAX_REDIRECT_LENGTH = 300;
const MAX_REDIRECT_TOTAL = 600;
const MAX_CLIENT_NAME = 40;
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);
const PLAIN_HOST = /^[a-z0-9.-]+$/i;
export const MAX_NEXT_LENGTH = 2400;
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export interface OAuthClient {
  name: string;
  redirectUris: string[];
}

interface CodeGrant {
  uid: number;
  client: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
  nonce: string;
}

export function redirectProblem(uri: string): string | null {
  if (uri.length > MAX_REDIRECT_LENGTH) return `is longer than ${MAX_REDIRECT_LENGTH} characters`;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "is not an absolute URL";
  }
  if (url.hash) return "must not contain a fragment";
  if (BLOCKED_SCHEMES.has(url.protocol)) return "uses a scheme that cannot receive a sign-in";
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) return "must use https unless it points at localhost or 127.0.0.1";
  if ((url.protocol === "http:" || url.protocol === "https:") && !PLAIN_HOST.test(url.hostname)) return "must use a plain host name";
  return null;
}

export function registerClient(secret: string, body: unknown, now: number): { client: Record<string, unknown> } | { error: string } {
  const input = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS || !uris.every((u) => typeof u === "string")) {
    return { error: `redirect_uris must list 1 to ${MAX_REDIRECTS} URLs` };
  }
  if ((uris as string[]).join("").length > MAX_REDIRECT_TOTAL) return { error: `redirect_uris must total at most ${MAX_REDIRECT_TOTAL} characters` };
  for (const uri of uris as string[]) {
    const problem = redirectProblem(uri);
    if (problem) return { error: `redirect URI ${problem}` };
  }
  const name = cleanLine(typeof input.client_name === "string" ? input.client_name : "", MAX_CLIENT_NAME) || "MCP client";
  const clientId = seal(secret, "oauth-client", { n: name, r: uris });
  return {
    client: {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

export function readClient(secret: string, clientId: string): OAuthClient | null {
  const raw = unseal(secret, "oauth-client", clientId) as { n?: unknown; r?: unknown } | null;
  if (!raw || typeof raw.n !== "string" || !Array.isArray(raw.r) || !raw.r.every((u) => typeof u === "string")) return null;
  return { name: raw.n, redirectUris: raw.r as string[] };
}

export function redirectAllowed(client: OAuthClient, uri: string): boolean {
  if (client.redirectUris.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !LOOPBACK.has(asked.hostname)) return false;
  return client.redirectUris.some((registered) => {
    const r = new URL(registered);
    return r.protocol === "http:" && r.hostname === asked.hostname && r.pathname === asked.pathname && r.search === asked.search;
  });
}

export function resourceAllowed(resource: string | undefined, publicUrl: string): boolean {
  if (!resource) return true;
  const trimmed = resource.replace(/\/+$/, "");
  return trimmed === publicUrl || trimmed === `${publicUrl}/mcp`;
}

const fingerprint = (clientId: string): string => createHash("sha256").update(clientId).digest("base64url").slice(0, 22);

export function issueCode(secret: string, grant: { uid: number; clientId: string; redirectUri: string; challenge: string }, now: number): string {
  const sealed: CodeGrant = {
    uid: grant.uid,
    client: fingerprint(grant.clientId),
    redirectUri: grant.redirectUri,
    challenge: grant.challenge,
    expiresAt: now + CODE_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
  };
  return seal(secret, "oauth-code", sealed);
}

export function redeemCode(
  secret: string,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
  now: number,
): { uid: number; nonce: string } | null {
  const grant = unseal(secret, "oauth-code", input.code) as CodeGrant | null;
  if (!grant || typeof grant.uid !== "number" || typeof grant.nonce !== "string") return null;
  if (grant.expiresAt <= now || grant.client !== fingerprint(input.clientId) || grant.redirectUri !== input.redirectUri) return null;
  if (!VERIFIER.test(input.verifier)) return null;
  if (createHash("sha256").update(input.verifier).digest("base64url") !== grant.challenge) return null;
  return { uid: grant.uid, nonce: grant.nonce };
}

export const validChallenge = (challenge: string): boolean => CHALLENGE.test(challenge);

export function formActionFor(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
}

export function withParams(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function metadata(publicUrl: string) {
  return {
    protectedResource: {
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
      bearer_methods_supported: ["header"],
      resource_name: "Company Brain",
    },
    authorizationServer: {
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}${AUTHORIZE_PATH}`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
  };
}
