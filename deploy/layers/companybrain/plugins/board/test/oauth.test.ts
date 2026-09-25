import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { buildApp, type Harness, ORIGIN, sessionCookie } from "./fixtures.ts";

const REDIRECT = "https://claude.example/api/mcp/auth_callback";

const send = (h: Harness, url: string | URL, init?: RequestInit) => Promise.resolve(h.app.fetch(new Request(url, init)));

function provider(redirect = REDIRECT) {
  const saved: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; authorizeUrl?: URL } = {};
  const p: OAuthClientProvider = {
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return { client_name: "Claude", redirect_uris: [redirect], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    clientInformation: () => saved.client,
    saveClientInformation: (info) => void (saved.client = info),
    tokens: () => saved.tokens,
    saveTokens: (tokens) => void (saved.tokens = tokens),
    redirectToAuthorization: (url) => void (saved.authorizeUrl = url),
    saveCodeVerifier: (v) => void (saved.verifier = v),
    codeVerifier: () => saved.verifier as string,
  };
  return { p, saved };
}

async function consent(h: Harness, cookie: string, authorizeUrl: URL, decision = "allow"): Promise<URL> {
  const page = await send(h, authorizeUrl, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Connect Claude\?/);
  assert.ok((page.headers.get("content-security-policy") ?? "").includes(`form-action 'self' ${new URL(authorizeUrl.searchParams.get("redirect_uri") as string).origin}`));
  const fields = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields.set(m[1] as string, (m[2] as string).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  fields.set("decision", decision);
  const res = await send(h, `${ORIGIN}/oauth/authorize`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: fields });
  assert.equal(res.status, 302);
  return new URL(res.headers.get("location") as string);
}

test("any MCP client connects by URL alone: discovery, registration, consent, token, tools", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const unauth = await send(h, `${ORIGIN}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/board\.test\/\.well-known\/oauth-protected-resource\/mcp"/);

  const { p, saved } = provider();
  const fetchFn = (url: string | URL, init?: RequestInit) => send(h, url, init);
  const first = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: p, fetch: fetchFn });
  await assert.rejects(new Client({ name: "claude", version: "1" }).connect(first), UnauthorizedError);
  assert.ok(saved.authorizeUrl, "the client was sent to sign in");
  assert.equal(saved.authorizeUrl.origin + saved.authorizeUrl.pathname, `${ORIGIN}/oauth/authorize`);

  const back = await consent(h, cookie, saved.authorizeUrl);
  assert.equal(back.origin + back.pathname, REDIRECT);
  const code = back.searchParams.get("code") as string;
  assert.ok(code);
  await first.finishAuth(code);
  assert.equal(saved.tokens?.token_type, "Bearer");

  const client = new Client({ name: "claude", version: "1" });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: p, fetch: fetchFn }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "memory_index"));

  const tokens = await h.store.activeTokens(1, "agent");
  assert.ok(tokens.some((row) => row.client === "oauth:Claude"), "the connection shows up under the app's own name");

  const replay = await send(h, `${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: (saved.client as { client_id: string }).client_id, redirect_uri: REDIRECT, code_verifier: saved.verifier as string }),
  });
  assert.equal(replay.status, 400);
  assert.equal(((await replay.json()) as { error: string }).error, "invalid_grant");
});

async function register(h: Harness, redirect_uris: string[]) {
  return send(h, `${ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris }) });
}

function authorizeUrl(clientId: string, redirect: string, challenge: string, extra: Record<string, string> = {}): URL {
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", ...extra })) url.searchParams.set(k, v);
  return url;
}

const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

test("authorization refuses what a real client would never send", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  assert.equal((await register(h, ["http://evil.example/cb"])).status, 400);
  assert.equal((await register(h, ["javascript:alert(1)"])).status, 400);
  const { client_id } = (await (await register(h, [REDIRECT, "http://127.0.0.1:4000/callback"])).json()) as { client_id: string };

  const elsewhere = await send(h, authorizeUrl(client_id, "https://evil.example/cb", CHALLENGE), { headers: { cookie } });
  assert.equal(elsewhere.status, 400, "an unregistered redirect never receives a code");

  assert.equal((await register(h, ["http://[::1]:4000/cb"])).status, 400);
  const noPkce = await send(h, authorizeUrl(client_id, REDIRECT, CHALLENGE, { code_challenge_method: "plain" }), { headers: { cookie } });
  assert.equal(noPkce.status, 400);
  const otherResource = await send(h, authorizeUrl(client_id, REDIRECT, CHALLENGE, { resource: "https://other.example/mcp" }), { headers: { cookie } });
  assert.equal(otherResource.status, 400);
  const { client_id: evil } = (await (await register(h, ["https://evil.example/x"])).json()) as { client_id: string };
  const bounce = await send(h, authorizeUrl(evil, "https://evil.example/x", CHALLENGE, { response_type: "bogus" }));
  assert.equal(bounce.status, 400, "a malformed request never bounces a visitor to the registered site");
  assert.equal(bounce.headers.get("location"), null);

  const basic = await send(h, `${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from("%zz:x").toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: "x" }),
  });
  assert.equal(basic.status, 401);

  const denied = await consent(h, cookie, authorizeUrl(client_id, REDIRECT, CHALLENGE), "deny");
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("state"), "s1");

  const loopback = await consent(h, cookie, authorizeUrl(client_id, "http://127.0.0.1:53111/callback", CHALLENGE));
  assert.equal(loopback.port, "53111", "loopback redirects may pick any port");
  const wrongVerifier = await send(h, `${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: loopback.searchParams.get("code") as string, client_id, redirect_uri: "http://127.0.0.1:53111/callback", code_verifier: "w".repeat(50) }),
  });
  assert.equal(wrongVerifier.status, 400);

  const crossSite = await send(h, `${ORIGIN}/oauth/authorize`, {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", decision: "allow" }),
  });
  assert.equal(crossSite.status, 403);
});

test("signing in or finishing the welcome step returns to the connection request", async () => {
  const h = await buildApp();
  const { client_id } = (await (await register(h, [REDIRECT])).json()) as { client_id: string };
  const url = authorizeUrl(client_id, REDIRECT, CHALLENGE);
  const anonymous = await send(h, url);
  assert.equal(anonymous.status, 302);
  const start = new URL(anonymous.headers.get("location") as string, ORIGIN);
  assert.equal(start.pathname, "/auth/github/start");
  assert.equal(start.searchParams.get("next"), `${url.pathname}${url.search}`);
  assert.equal(anonymous.headers.get("set-cookie"), null, "nothing lingers to hijack a later sign-in");
  const toGitHub = await send(h, start);
  assert.match(toGitHub.headers.get("location") ?? "", /login\/oauth\/authorize/);

  const newcomer = await sessionCookie(h, "gh-bob", { welcomed: false });
  const toWelcome = await send(h, url, { headers: { cookie: newcomer } });
  assert.equal(toWelcome.headers.get("location"), "/welcome");
  const next = /cb_next=([^;]+)/.exec(toWelcome.headers.get("set-cookie") ?? "")?.[1];
  assert.ok(next);

  const body = new URLSearchParams({ name: "Bob", email: "bob@acme.test", company: "Acme", role: "engineering", teamSize: "small", kit: "engineering" });
  const welcomed = await send(h, `${ORIGIN}/welcome`, { method: "POST", headers: { cookie: `${newcomer}; cb_next=${next}`, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(welcomed.status, 302);
  assert.equal(welcomed.headers.get("location"), `${url.pathname}${url.search}`);
});

test("discovery documents point clients at this server", async () => {
  const h = await buildApp();
  const resource = (await (await send(h, `${ORIGIN}/.well-known/oauth-protected-resource/mcp`)).json()) as { resource: string; authorization_servers: string[] };
  assert.equal(resource.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  const server = await send(h, `${ORIGIN}/.well-known/oauth-authorization-server`);
  assert.equal(server.headers.get("access-control-allow-origin"), "*");
  const meta = (await server.json()) as { issuer: string; code_challenge_methods_supported: string[] };
  assert.equal(meta.issuer, ORIGIN);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
});

test("at the token limit the board says so before spending the code", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  for (let i = 0; i < 20; i++) await h.auth.issue(1, "agent", "codex", h.config.agentTokenTtlMs);
  const { client_id } = (await (await register(h, [REDIRECT])).json()) as { client_id: string };
  const fields = new URLSearchParams({ client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", decision: "allow" });
  const res = await send(h, `${ORIGIN}/oauth/authorize`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, body: fields });
  assert.equal(res.status, 429);
  assert.match(await res.text(), /Token limit reached/);
});

test("reconnecting the same app at the limit replaces its oldest connection", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  for (let i = 0; i < 19; i++) await h.auth.issue(1, "agent", "codex", h.config.agentTokenTtlMs);
  const old = await h.auth.issue(1, "agent", "oauth:Claude", h.config.agentTokenTtlMs);
  const { client_id } = (await (await register(h, [REDIRECT])).json()) as { client_id: string };
  const back = await consent(h, cookie, authorizeUrl(client_id, REDIRECT, CHALLENGE));
  const res = await send(h, `${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") as string, client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
  });
  assert.equal(res.status, 200);
  const active = await h.store.activeTokens(1, "agent");
  assert.equal(active.length, 20);
  assert.ok(!active.some((t) => t.id === old?.row.id), "the previous Claude connection was revoked");
});
