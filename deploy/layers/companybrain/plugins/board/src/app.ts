import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import type { AccessChecker } from "./access.ts";
import type { Config } from "./config.ts";
import { exchangeCode, type Fetch, type GitHubClient } from "./github.ts";
import { createBoardServer } from "./mcp.ts";
import type { Store } from "./store.ts";
import { AGENT_CLIENTS, type AgentClient, mintToken, readToken, seal, unseal } from "./token.ts";
import { renderBoard, renderConnected, renderDenied, renderHome } from "./web.ts";

export interface AppDeps {
  config: Config;
  store: Store;
  access: AccessChecker;
  githubFor: (token: string) => GitHubClient;
  fetch?: Fetch;
  now?: () => number;
}

const SESSION_COOKIE = "cb_session";
const STATE_COOKIE = "cb_state";
const STATE_MAX_AGE_MS = 10 * 60_000;

export function createApp(deps: AppDeps): Hono {
  const { config, store, access, githubFor } = deps;
  const now = deps.now ?? Date.now;
  const secure = config.publicUrl.startsWith("https://");
  const githubConfigured = Boolean(config.githubClientId && config.githubClientSecret);
  const mcpUrl = `${config.publicUrl}/mcp`;
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (c.res.headers.get("content-type")?.startsWith("text/html")) {
      c.header("cache-control", "no-store");
      c.header("x-frame-options", "DENY");
    }
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/", (c) => {
    const identity = readToken(config.secret, getCookie(c, SESSION_COOKIE));
    if (!identity) return c.html(renderHome({ githubConfigured, ...(c.req.query("error") ? { error: c.req.query("error") as string } : {}) }));
    const tokens = Object.fromEntries(
      AGENT_CLIENTS.map((client) => [client, mintToken(config.secret, { ...identity, client, issuedAt: now() })]),
    ) as Record<Exclude<AgentClient, "web">, string>;
    return c.html(renderConnected({ login: identity.login, mcpUrl, tokens }));
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
    const fail = (reason: string) => c.redirect(`/?error=${encodeURIComponent(reason)}`);
    const stored = unseal(config.secret, "state", getCookie(c, STATE_COOKIE) ?? "") as { nonce?: string; at?: number } | null;
    deleteCookie(c, STATE_COOKIE, { path: "/auth/github" });
    const code = c.req.query("code");
    if (!stored?.nonce || !stored.at || stored.nonce !== c.req.query("state") || now() - stored.at > STATE_MAX_AGE_MS) {
      return fail("The sign-in link expired or did not match. Try again.");
    }
    if (!code) return fail("GitHub did not return an authorization code.");
    try {
      const githubToken = await exchangeCode({
        webUrl: config.githubWebUrl,
        clientId: config.githubClientId as string,
        clientSecret: config.githubClientSecret as string,
        code,
        redirectUri: `${config.publicUrl}/auth/github/callback`,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      const viewer = await githubFor(githubToken).viewer();
      const session = mintToken(config.secret, { githubToken, login: viewer.login, uid: viewer.id, client: "web", issuedAt: now() });
      setCookie(c, SESSION_COOKIE, session, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
      return c.redirect("/");
    } catch {
      return fail("GitHub sign-in could not be completed.");
    }
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  app.get("/board/:owner/:repo", async (c) => {
    const identity = readToken(config.secret, getCookie(c, SESSION_COOKIE));
    if (!identity) return c.redirect("/");
    const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !(await access.canUseBoard(identity, repo))) {
      return c.html(renderDenied(), 404);
    }
    return c.html(renderBoard({ repo, login: identity.login, posts: store.list(repo, { limit: 200 }) }));
  });

  app.all("/mcp", async (c) => {
    const identity = readToken(config.secret, c.req.header("authorization"));
    if (!identity) {
      return c.json({ error: "unauthorized", message: `Connect GitHub at ${config.publicUrl} to get a token.` }, 401, {
        "www-authenticate": 'Bearer realm="companybrain-board"',
      });
    }
    if (identity.client === "web") return c.json({ error: "forbidden", message: "Use an agent token, not a browser session." }, 403);
    const server = createBoardServer({ identity, github: githubFor(identity.githubToken), access, store });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, {
        authInfo: { token: "redacted", clientId: identity.client, scopes: [], extra: { login: identity.login } },
      });
    } finally {
      await server.close();
    }
  });

  return app;
}
