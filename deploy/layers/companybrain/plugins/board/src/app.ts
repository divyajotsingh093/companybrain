import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import type { AccessChecker } from "./access.ts";
import { canUseBoard } from "./access.ts";
import type { Auth, Principal } from "./auth.ts";
import type { Config } from "./config.ts";
import { exchangeCode, type Fetch, type GitHubClient, GitHubError } from "./github.ts";
import type { RateLimiter } from "./limits.ts";
import { createBoardServer } from "./mcp.ts";
import type { Store } from "./store.ts";
import { isAgentClient, seal, unseal } from "./token.ts";
import { type ErrorCode, isErrorCode, renderBoard, renderConnected, renderDenied, renderHome, renderMessage, renderTokenCreated } from "./web.ts";

export interface AppDeps {
  config: Config;
  store: Store;
  auth: Auth;
  access: AccessChecker;
  githubFor: (token: string) => GitHubClient;
  limiter: RateLimiter;
  fetch?: Fetch;
  now?: () => number;
}

const SESSION_COOKIE = "cb_session";
const STATE_COOKIE = "cb_state";
const STATE_MAX_AGE_MS = 10 * 60_000;
const MCP_BODY_LIMIT = 256 * 1024;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function createApp(deps: AppDeps): Hono {
  const { config, store, auth, access, githubFor, limiter } = deps;
  const now = deps.now ?? Date.now;
  const secure = config.publicUrl.startsWith("https://");
  const origin = new URL(config.publicUrl).origin;
  const githubConfigured = Boolean(config.githubClientId && config.githubClientSecret);
  const mcpUrl = `${config.publicUrl}/mcp`;
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (secure) c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (c.res.headers.get("content-type")?.startsWith("text/html")) {
      c.header("cache-control", "no-store");
      c.header("x-frame-options", "DENY");
      c.header("content-security-policy", CSP);
    }
  });

  const session = (c: Context): Principal | null => auth.verify(getCookie(c, SESSION_COOKIE), "session");

  const sameOrigin = (c: Context): boolean => {
    const header = c.req.header("origin");
    if (header) return header === origin;
    return c.req.header("sec-fetch-site") === "same-origin";
  };

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/", (c) => {
    const principal = session(c);
    if (!principal) {
      const code = c.req.query("error");
      return c.html(renderHome({ githubConfigured, ...(isErrorCode(code) ? { error: code } : {}) }));
    }
    return c.html(renderConnected({ login: principal.login, tokens: store.activeTokens(principal.uid, "agent") }));
  });

  app.post("/tokens", async (c) => {
    const principal = session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    const form = await c.req.parseBody();
    const client = typeof form.client === "string" ? form.client : "";
    if (!isAgentClient(client)) return c.html(renderMessage("Unknown agent", "Choose Claude Code, Codex, Cursor or Grok."), 400);
    const issued = auth.issue(principal.uid, "agent", client, config.agentTokenTtlMs);
    return c.html(renderTokenCreated({ login: principal.login, client, token: issued.token, mcpUrl, expiresAt: issued.row.expiresAt }));
  });

  app.post("/tokens/revoke-all", (c) => {
    const principal = session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    store.revokeAllTokens(principal.uid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  app.post("/tokens/:id/revoke", (c) => {
    const principal = session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    store.revokeToken(c.req.param("id"), principal.uid);
    return c.redirect("/");
  });

  app.get("/auth/github/start", (c) => {
    if (!githubConfigured) return c.text("GitHub sign-in is not configured.", 503);
    const nonce = randomBytes(18).toString("base64url");
    setCookie(c, STATE_COOKIE, seal(config.secret, "state", { nonce, at: now() }), {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/auth/github",
      maxAge: STATE_MAX_AGE_MS / 1000,
    });
    const params = new URLSearchParams({
      client_id: config.githubClientId as string,
      redirect_uri: `${config.publicUrl}/auth/github/callback`,
      state: nonce,
    });
    return c.redirect(`${config.githubWebUrl}/login/oauth/authorize?${params.toString()}`);
  });

  app.get("/auth/github/callback", async (c) => {
    if (!githubConfigured) return c.text("GitHub sign-in is not configured.", 503);
    const fail = (code: ErrorCode) => c.redirect(`/?error=${code}`);
    const stored = unseal(config.secret, "state", getCookie(c, STATE_COOKIE) ?? "") as { nonce?: string; at?: number } | null;
    deleteCookie(c, STATE_COOKIE, { path: "/auth/github" });
    if (!stored?.nonce || !stored.at || stored.nonce !== c.req.query("state") || now() - stored.at > STATE_MAX_AGE_MS) return fail("state");
    const code = c.req.query("code");
    if (!code) return fail("code");
    try {
      const grant = await exchangeCode({
        webUrl: config.githubWebUrl,
        clientId: config.githubClientId as string,
        clientSecret: config.githubClientSecret as string,
        code,
        redirectUri: `${config.publicUrl}/auth/github/callback`,
        now: now(),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      const viewer = await githubFor(grant.accessToken).viewer();
      auth.saveGrant(viewer.id, viewer.login, grant);
      const issued = auth.issue(viewer.id, "session", "web", config.sessionTtlMs);
      setCookie(c, SESSION_COOKIE, issued.token, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
      return c.redirect("/");
    } catch {
      return fail("exchange");
    }
  });

  app.post("/auth/logout", (c) => {
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    const principal = session(c);
    if (principal) store.revokeToken(principal.tokenId, principal.uid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  app.get("/board/:owner/:repo", async (c) => {
    const principal = session(c);
    if (!principal) return c.redirect("/");
    const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
    try {
      const a = await access.check(principal.uid, principal.login, repo);
      if (!canUseBoard(a.role)) return c.html(renderDenied(), 404);
      return c.html(renderBoard({ repo: a.fullName, login: principal.login, board: store.readBoard(a.repoId, { limit: 100 }) }));
    } catch (err) {
      if (err instanceof GitHubError && (err.kind === "unauthorized" || err.kind === "rate_limited" || err.kind === "unavailable")) {
        return c.html(renderMessage("GitHub problem", "GitHub could not confirm your access right now. Reconnect or try again shortly."), 503);
      }
      return c.html(renderDenied(), 404);
    }
  });

  const rpcError = (c: Context, status: 400 | 401 | 403 | 405 | 413 | 429, code: number, message: string, headers: Record<string, string> = {}) =>
    c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);

  app.on(["GET", "DELETE", "PUT", "PATCH"], ["/mcp", "/mcp/"], (c) => rpcError(c, 405, -32000, "Method not allowed. This server is stateless; use POST.", { allow: "POST" }));

  app.post(
    "/mcp",
    bodyLimit({ maxSize: MCP_BODY_LIMIT, onError: (c) => rpcError(c, 413, -32000, "Request body too large.") }),
    async (c) => {
      const principal = auth.verify(c.req.header("authorization"), "agent");
      if (!principal) {
        return rpcError(c, 401, -32001, `Unauthorized. Connect GitHub and create an agent token at ${config.publicUrl}.`, {
          "www-authenticate": 'Bearer realm="companybrain-board"',
        });
      }
      if (!limiter.allow(principal.tokenId)) return rpcError(c, 429, -32000, "Too many requests. Slow down.", { "retry-after": "60" });
      let parsed: unknown;
      try {
        parsed = await c.req.json();
      } catch {
        return rpcError(c, 400, -32700, "Parse error.");
      }
      if (Array.isArray(parsed)) return rpcError(c, 400, -32600, "Batch requests are not supported.");
      const server = createBoardServer({
        principal,
        access,
        store,
        publicUrl: config.publicUrl,
        now,
        github: async () => githubFor(await auth.githubToken(principal.uid)),
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        return await transport.handleRequest(c.req.raw, {
          parsedBody: parsed,
          authInfo: { token: "redacted", clientId: principal.client, scopes: [], extra: { login: principal.login } },
        });
      } finally {
        await server.close();
      }
    },
  );

  app.post("/mcp/", (c) => c.redirect("/mcp", 308));

  return app;
}
