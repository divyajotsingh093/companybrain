import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import type { AccessChecker } from "./access.ts";
import { canModerate, canUseBoard } from "./access.ts";
import { answerQuestion, gatewayModel, indexRepo, type Model, modelName, readHistory, titleOf } from "./brain.ts";
import { GATEWAY_NAME, gatewayUrlProblem, MAX_GATEWAYS, openUpstream, publicFetch, sealGatewayToken } from "./gateway.ts";
import type { Auth, Principal } from "./auth.ts";
import type { Config } from "./config.ts";
import { assertRepo, exchangeCode, type Fetch, type GitHubClient, GitHubError } from "./github.ts";
import type { RateLimiter } from "./limits.ts";
import { APP_JS_BASE64 } from "./app-bundle.ts";
import { createBoardServer, describeError, TOOL_NAMES } from "./mcp.ts";
import { quietly, seedHarnessSkill, seedPerson, seedProject, seedReference } from "./seed.ts";
import { isMemoryType, MEMORY_PURPOSE, parseMemory, renderMemory } from "./memory.ts";
import { PART_PURPOSE, parseSkill, pulse, renderSkill, SKILL_PARTS, STALE_AFTER_MS } from "./skills.ts";
import { cleanLine, cleanText } from "./untrusted.ts";
import { ACTIVE_AGENT_TOKENS_PER_USER, ENTRY_KINDS, KIND_PURPOSE, MAX_DOC_BODY, MAX_ENTRY_BODY, MAX_ENTRY_NAME, MAX_UPLOAD_NAME, type Store } from "./store.ts";
import { hashToken, isAgentClient, seal, unseal } from "./token.ts";
import { type ErrorCode, isErrorCode, renderBoard, renderConnected, renderDenied, renderHome, renderMessage, renderTokenCreated } from "./web.ts";

export interface AppDeps {
  model?: Model;
  config: Config;
  store: Store;
  auth: Auth;
  access: AccessChecker;
  githubFor: (token: string) => GitHubClient;
  limiter: RateLimiter;
  fetch?: Fetch;
  gatewayFetch?: typeof fetch;
  now?: () => number;
}

const SESSION_COOKIE = "cb_session";
const STATE_COOKIE = "cb_state";
const STATE_MAX_AGE_MS = 10 * 60_000;
const MCP_BODY_LIMIT = 256 * 1024;
const FORM_BODY_LIMIT = 4 * 1024;
const APP_ENTRY_LIMIT = 50;
const UPLOAD_BODY_LIMIT = 256 * 1024;
const UPLOADABLE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const REINDEX_AFTER_MS = 20 * 3_600_000;
const REINDEX_BATCH = 50;
const REINDEX_GIVE_UP_MS = 30 * 24 * 3_600_000;
const ASK_PER_DAY = 200;
const REINDEX_BUDGET_MS = 150_000;
const INDEX_PER_MINUTE = 6;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function createApp(deps: AppDeps): Hono {
  const { config, store, auth, access, githubFor, limiter } = deps;
  const now = deps.now ?? Date.now;
  const secure = config.publicUrl.startsWith("https://");
  const origin = new URL(config.publicUrl).origin;
  const githubConfigured = Boolean(config.githubClientId && config.githubClientSecret);
  const mcpUrl = `${config.publicUrl}/mcp`;

  const weaveHarness = async (uid: number, login: string, extraRepos: string[] = []): Promise<void> => {
    const [sources, servers] = await Promise.all([store.sources(uid), store.listGateways(uid)]);
    const repos = [...new Set([...extraRepos, ...sources.map((s) => s.repoName).filter((n) => n.includes("/"))])];
    await seedHarnessSkill(store, uid, { login, tools: [...TOOL_NAMES].sort(), repos, servers: servers.map((g) => g.name), mcpUrl });
  };
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    if (secure) c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (c.res.headers.get("content-type")?.startsWith("text/html")) {
      c.header("cache-control", "no-store");
      c.header("x-frame-options", "DENY");
      if (!c.res.headers.get("content-security-policy")) c.header("content-security-policy", CSP);
    }
  });

  const session = (c: Context): Promise<Principal | null> => auth.verify(getCookie(c, SESSION_COOKIE), "session");

  const sameOrigin = (c: Context): boolean => {
    const header = c.req.header("origin");
    if (header) return header === origin;
    return c.req.header("sec-fetch-site") === "same-origin";
  };

  app.get("/health", (c) => c.json({ ok: true }));

  const cronAuthorized = (c: Context): boolean =>
    Boolean(config.cronSecret) && hashToken(c.req.header("authorization") ?? "") === hashToken(`Bearer ${config.cronSecret}`);

  app.get("/cron/purge", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    return c.json(await store.purge());
  });

  app.get("/", async (c) => {
    const principal = await session(c);
    if (!principal) {
      const code = c.req.query("error");
      return c.html(renderHome({ githubConfigured, ...(isErrorCode(code) ? { error: code } : {}) }));
    }
    return c.html(
      renderConnected({
        login: principal.login,
        tokens: await store.activeTokens(principal.uid, "agent"),
        activity: await store.auditTrail(principal.uid, 20),
        indexed: (await store.sources(principal.uid)).length > 0,
        boards: (await store.recentRepos(principal.uid)).filter((r) => {
          try {
            return assertRepo(r) === r;
          } catch {
            return false;
          }
        }),
        now: now(),
      }),
    );
  });

  const formLimit = bodyLimit({ maxSize: FORM_BODY_LIMIT, onError: (c) => c.text("Request body too large.", 413) });

  app.post("/tokens", formLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    const form = await c.req.parseBody();
    const client = typeof form.client === "string" ? form.client : "";
    if (!isAgentClient(client)) return c.html(renderMessage("Unknown agent", "Choose Claude Code, Codex, Cursor or Grok."), 400);
    const issued = await auth.issue(principal.uid, "agent", client, config.agentTokenTtlMs);
    if (!issued) {
      return c.html(renderMessage("Token limit reached", `You have ${ACTIVE_AGENT_TOKENS_PER_USER} active agent tokens. Revoke one before creating another.`), 429);
    }
    await quietly("person", async () => {
      const repos = (await githubFor(await auth.githubToken(principal.uid)).listRepos(12)).map((r) => r.fullName);
      await seedPerson(store, principal.uid, principal.login, repos);
      await weaveHarness(principal.uid, principal.login, repos);
    });
    return c.html(renderTokenCreated({ login: principal.login, client, token: issued.token, mcpUrl, expiresAt: issued.row.expiresAt }));
  });

  app.post("/tokens/revoke-all", formLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    await store.revokeAllTokens(principal.uid);
    await store.deleteCredential(principal.uid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  app.post("/tokens/:id/revoke", formLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    await store.revokeToken(c.req.param("id"), principal.uid);
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
      await auth.saveGrant(viewer.id, viewer.login, grant);
      const issued = await auth.issue(viewer.id, "session", "web", config.sessionTtlMs);
      if (!issued) return fail("exchange");
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

  app.post("/auth/logout", formLimit, async (c) => {
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    const principal = await session(c);
    if (principal) await store.revokeToken(principal.tokenId, principal.uid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  app.get("/board", (c) => {
    const repo = (c.req.query("repo") ?? "").trim();
    try {
      const [owner, name] = assertRepo(repo).split("/");
      return c.redirect(`/board/${encodeURIComponent(owner as string)}/${encodeURIComponent(name as string)}`);
    } catch {
      return c.html(renderMessage("Check the repository", "Enter a repository as owner/name."), 400);
    }
  });

  app.get("/board/:owner/:repo", async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
    try {
      const a = await access.check(principal.uid, principal.login, repo);
      if (!canUseBoard(a.role)) return c.html(renderDenied(), 404);
      return c.html(renderBoard({ repo: a.fullName, login: principal.login, board: await store.readBoard(a.repoId, { limit: 100 }), events: await store.events(a.repoId, { limit: 40 }), timeline: await store.timeline(a.repoId, { limit: 60 }), now: now() }));
    } catch (err) {
      if (!(err instanceof GitHubError) || err.kind === "unauthorized" || err.kind === "rate_limited" || err.kind === "unavailable") {
        return c.html(renderMessage("GitHub problem", "GitHub could not confirm your access right now. Reconnect or try again shortly."), 503);
      }
      return c.html(renderDenied(), 404);
    }
  });

  const appJs = Buffer.from(APP_JS_BASE64, "base64").toString("utf8");

  app.get("/app", async (c) => {
    if (!(await session(c))) return c.redirect("/");
    c.header("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("cache-control", "no-store");
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&display=swap">
<title>Company Brain</title></head><body style="margin:0;background:#050505"><div id="root"></div><script type="module" src="/app/bundle.js"></script></body></html>`,
    );
  });

  const appJsETag = `"${createHash("sha256").update(appJs).digest("base64url").slice(0, 27)}"`;

  app.get("/app/bundle.js", async (c) => {
    if (!(await session(c))) return c.text("", 401);
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "private, no-cache");
    c.header("etag", appJsETag);
    if (c.req.header("if-none-match") === appJsETag) return c.body(null, 304);
    return c.body(appJs);
  });

  app.get("/api/app/me", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    try {
      const github = githubFor(await auth.githubToken(principal.uid));
      const repos = await github.listRepos(12);
      return c.json({
        login: principal.login,
        repos: repos.map((repo) => ({ fullName: repo.fullName, private: repo.private, pushedAt: repo.pushedAt })),
        tokens: (await store.activeTokens(principal.uid, "agent")).map((t) => ({
          id: t.id,
          client: t.client,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          expiresAt: t.expiresAt,
        })),
        activity: await store.auditTrail(principal.uid, 12),
      });
    } catch (err) {
      return c.json({ error: "github", message: describeError(err instanceof GitHubError ? err : new GitHubError(503, "unavailable", ""), config.publicUrl) }, 200);
    }
  });

  app.get("/api/app/brain", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const kinds = await Promise.all(
      ENTRY_KINDS.map(async (kind) => {
        const entries = await store.listEntries(kind, principal.uid, APP_ENTRY_LIMIT);
        if (kind === "memory") return [kind, entries.map((e) => ({ ...e, memory: parseMemory(e.body) }))] as const;
        if (kind === "skill") return [kind, entries.map((e) => ({ ...e, skill: parseSkill(e.body).parts }))] as const;
        return [kind, entries] as const;
      }),
    );
    return c.json({ kinds: Object.fromEntries(kinds), limit: APP_ENTRY_LIMIT, memoryTypes: MEMORY_PURPOSE, skillParts: PART_PURPOSE, now: now() });
  });

  app.get("/api/app/skill", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const entry = await store.getEntry("skill", principal.uid, c.req.query("name") ?? "");
    if (!entry) return c.json({ error: "not_found" }, 404);
    const skill = parseSkill(entry.body);
    const [usage, links, servers] = await Promise.all([
      store.skillUsage(principal.uid, entry.name, now() - STALE_AFTER_MS),
      store.connections(principal.uid, entry.name),
      store.listGateways(principal.uid),
    ]);
    const known = new Set(servers.map((g) => g.name));
    const connectorText = [skill.parts.Connectors.text, ...skill.parts.Connectors.learned.map((l) => l.note)].join("\n");
    const wanted = [...new Set([...connectorText.matchAll(/gateway:([a-z0-9][a-z0-9-]{0,39})/gi)].map((m) => (m[1] as string).toLowerCase()))];
    return c.json({
      name: entry.name,
      parts: skill.parts,
      pulse: pulse(skill, entry.updatedAt, usage.uses, now()),
      observed: usage.tools,
      links,
      connectors: wanted.map((name) => ({ name, connected: known.has(name) })),
      now: now(),
    });
  });

  const jsonLimit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) });

  const model = deps.model ?? gatewayModel(process.env, deps.fetch ?? fetch);

  const canRead = (principal: Principal) => async (repoName: string, repoId: number): Promise<boolean> => {
    const allowed = async (name: string) => {
      const a = await access.check(principal.uid, principal.login, assertRepo(name));
      return a.repoId === repoId && canUseBoard(a.role);
    };
    try {
      return await allowed(repoName);
    } catch (err) {
      if (!(err instanceof GitHubError && err.kind === "moved")) return false;
      try {
        return await allowed((await githubFor(await auth.githubToken(principal.uid)).repoById(repoId)).fullName);
      } catch {
        return false;
      }
    }
  };

  const reachable = (principal: Principal, post: { repoId: number; repoName: string }): Promise<boolean> => canRead(principal)(post.repoName, post.repoId);

  app.get("/api/app/graph", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const view = await store.graphView(principal.uid, canRead(principal));
    return c.json({ ...view, purposes: KIND_PURPOSE, now: now() });
  });

  const indexFor = async (uid: number, login: string, repoName: string, expectedId?: number): Promise<{ repo: string; indexed: number; skipped: number } | null> => {
    const a = await access.check(uid, login, assertRepo(repoName));
    if (!canUseBoard(a.role) || (expectedId !== undefined && a.repoId !== expectedId)) return null;
    const result = await indexRepo(githubFor(await auth.githubToken(uid)), a.fullName);
    const indexed = await store.replaceRepo(uid, { repoId: a.repoId, repoName: a.fullName }, result.indexed);
    await quietly("project", () => seedProject(store, uid, a.fullName, result.indexed));
    return { repo: a.fullName, indexed, skipped: result.skipped.length };
  };

  app.get("/cron/reindex", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    const started = now();
    const report = { checked: 0, refreshed: 0, dropped: 0, deferred: 0 };
    for (const source of await store.staleSources(started - REINDEX_AFTER_MS, REINDEX_BATCH)) {
      if (now() - started > REINDEX_BUDGET_MS) break;
      report.checked += 1;
      const owner = await store.credential(source.ownerUid);
      if (!owner) {
        await store.clearRepo(source.ownerUid, source.repoId);
        report.dropped += 1;
        continue;
      }
      try {
        const current = await githubFor(await auth.githubToken(source.ownerUid)).repoById(source.repoId);
        if (await indexFor(source.ownerUid, owner.login, current.fullName, source.repoId)) {
          report.refreshed += 1;
          continue;
        }
      } catch (err) {
        if (err instanceof GitHubError && err.kind === "not_found") {
          await store.clearRepo(source.ownerUid, source.repoId);
          report.dropped += 1;
          continue;
        }
      }
      if (source.indexedAt < started - REINDEX_GIVE_UP_MS) {
        await store.clearRepo(source.ownerUid, source.repoId);
        report.dropped += 1;
      } else {
        await store.deferRepo(source.ownerUid, source.repoId);
        report.deferred += 1;
      }
    }
    return c.json(report);
  });


  const uploadLimit = bodyLimit({ maxSize: UPLOAD_BODY_LIMIT, onError: (c) => c.json({ error: "too_large" }, 413) });

  app.post("/api/app/requests", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { repo?: unknown; title?: unknown; body?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.repo !== "string" || typeof payload.title !== "string" || !payload.title.trim()) return c.json({ error: "bad_fields" }, 400);
    const body = typeof payload.body === "string" ? payload.body : "";
    try {
      const a = await access.check(principal.uid, principal.login, assertRepo(payload.repo));
      if (!canUseBoard(a.role)) return c.json({ error: "no_access" }, 404);
      const result = await store.addPost({ repoId: a.repoId, repoName: a.fullName, type: "task", title: payload.title, body, authorLogin: principal.login, authorUid: principal.uid, client: "web" });
      if (!result.ok) return c.json({ error: "rate_limited" }, 429);
      return c.json({ id: result.post.id });
    } catch {
      return c.json({ error: "no_access" }, 404);
    }
  });

  app.get("/api/app/work", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const read = canRead(principal);
    const tasks = await store.requestsBy(principal.uid);
    const repos = new Map(tasks.map((t) => [t.repoId, t.repoName]));
    const visible = new Map(await Promise.all([...repos].map(async ([id, name]) => [id, await read(name, id)] as const)));
    const requests = await Promise.all(
      tasks.filter((t) => visible.get(t.repoId) === true).map(async (t) => ({ ...t, updates: await store.workUpdates(t.id) })),
    );
    return c.json({ requests, now: now() });
  });

  app.post("/api/app/work/review", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { id?: unknown; verdict?: unknown; note?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.id !== "string" || (payload.verdict !== "accept" && payload.verdict !== "changes")) return c.json({ error: "bad_fields" }, 400);
    const note = typeof payload.note === "string" ? payload.note : "";
    if (payload.verdict === "changes" && !note.trim()) return c.json({ error: "needs_note" }, 400);
    const task = await store.getPost(payload.id);
    if (!task || task.type !== "task" || task.authorUid !== principal.uid || !(await canRead(principal)(task.repoName, task.repoId))) return c.json({ error: "not_found" }, 404);
    const result = await store.advanceWork(task.id, payload.verdict === "accept" ? "accepted" : "changes", note, { uid: principal.uid, login: principal.login, client: "web" });
    if (!result.ok) return c.json({ error: result.reason === "wrong_state" ? "not_in_review" : result.reason }, 409);
    return c.json({ status: result.status });
  });

  app.get("/api/app/files", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    return c.json({ files: await store.listUploads(principal.uid), now: now() });
  });

  app.post("/api/app/files", uploadLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { name?: unknown; content?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.name !== "string" || typeof payload.content !== "string") return c.json({ error: "bad_fields" }, 400);
    const name = cleanLine(payload.name.split(/[\\/]/).pop() ?? "", MAX_UPLOAD_NAME);
    if (!name || !UPLOADABLE.test(name)) return c.json({ error: "unsupported_file" }, 415);
    if (!payload.content.trim()) return c.json({ error: "empty_file" }, 400);
    if (payload.content.length > MAX_DOC_BODY) return c.json({ error: "too_long" }, 400);
    if (!(await store.putUpload(principal.uid, name, titleOf(name, payload.content), payload.content))) return c.json({ error: "document_quota" }, 429);
    return c.json({ name });
  });

  app.delete("/api/app/files", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!(await store.deleteUpload(principal.uid, c.req.query("name") ?? ""))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  const upstreamFor = (uid: number) => async (name: string) => {
    const g = await store.gateway(uid, name);
    return g ? openUpstream({ url: g.url, sealedToken: g.tokenSealed, secret: config.secret, fetch: deps.gatewayFetch ?? publicFetch }) : null;
  };

  app.get("/api/app/gateway", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const [servers, calls] = await Promise.all([store.listGateways(principal.uid), store.auditTrail(principal.uid, 50, "gateway_call")]);
    return c.json({ servers, calls, max: MAX_GATEWAYS, model: { configured: model !== null, name: modelName(process.env), dailyLimit: ASK_PER_DAY }, mcpUrl: `${config.publicUrl}/mcp`, now: now() });
  });

  app.post("/api/app/gateway", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { name?: unknown; url?: unknown; token?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    const name = typeof payload.name === "string" ? payload.name.trim().toLowerCase() : "";
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const token = typeof payload.token === "string" ? payload.token.trim() : "";
    if (!GATEWAY_NAME.test(name) || !url || url.length > 500 || token.length > 4_000) return c.json({ error: "bad_fields" }, 400);
    const problem = gatewayUrlProblem(url);
    if (problem) return c.json({ error: "bad_url", message: problem }, 400);
    if ((await store.hit(`gateway-add:${principal.uid}`, 60_000)) > 10) return c.json({ error: "rate_limited" }, 429);
    const tokenSealed = token ? sealGatewayToken(config.secret, token) : null;
    let tools: number;
    try {
      const upstream = await openUpstream({ url, sealedToken: tokenSealed, secret: config.secret, fetch: deps.gatewayFetch ?? publicFetch });
      try {
        tools = (await upstream.tools()).length;
      } finally {
        await upstream.close().catch(() => undefined);
      }
    } catch (err) {
      return c.json({ error: "unreachable", message: cleanLine(err instanceof Error ? err.message : "unknown error", 300) }, 400);
    }
    if (!(await store.putGateway(principal.uid, { name, url: new URL(url).href, tokenSealed }, MAX_GATEWAYS))) return c.json({ error: "too_many" }, 409);
    await quietly("reference", async () => {
      await seedReference(store, principal.uid, name, url, tools);
      await weaveHarness(principal.uid, principal.login);
    });
    return c.json({ ok: true, name, tools });
  });

  app.delete("/api/app/gateway", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!(await store.deleteGateway(principal.uid, (c.req.query("name") ?? "").toLowerCase()))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/app/sources", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    return c.json({ sources: await store.sources(principal.uid), canAsk: model !== null, now: now() });
  });

  app.post("/api/app/sources", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { repo?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.repo !== "string") return c.json({ error: "bad_fields" }, 400);
    if ((await store.hit(`index:${principal.uid}`, 60_000)) > INDEX_PER_MINUTE) return c.json({ error: "rate_limited" }, 429);
    try {
      const result = await indexFor(principal.uid, principal.login, payload.repo);
      if (!result) return c.json({ error: "no_access" }, 404);
      return c.json(result);
    } catch (err) {
      if (err instanceof GitHubError) return c.json({ error: "github", message: describeError(err, config.publicUrl) }, 200);
      return c.json({ error: "no_access" }, 404);
    }
  });

  app.post("/api/app/ask", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!model) return c.json({ error: "no_model" }, 503);
    let payload: { question?: unknown; kinds?: unknown; history?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.question !== "string" || !payload.question.trim()) return c.json({ error: "bad_fields" }, 400);
    if (!(await limiter.allow(`ask:${principal.uid}`))) return c.json({ error: "rate_limited" }, 429);
    if ((await store.hit(`ask-day:${principal.uid}`, 24 * 3_600_000)) > ASK_PER_DAY) return c.json({ error: "daily_limit" }, 429);
    const allowedKinds = new Set<string>(["document", ...ENTRY_KINDS]);
    const kinds = Array.isArray(payload.kinds) ? payload.kinds.filter((k): k is string => typeof k === "string" && allowedKinds.has(k)) : [];
    const history = readHistory(payload.history);
    const previous = history.at(-1)?.question ?? "";
    const found = await store.search(principal.uid, `${payload.question} ${previous}`.trim(), { allow: canRead(principal), kinds, limit: 8 });
    const related = new Map<string, { kind: string; name: string }>();
    for (const f of found.filter((x) => x.kind !== "document").slice(0, 3)) {
      const links = await store.connections(principal.uid, f.title);
      for (const l of links.outgoing) related.set(l.toName.toLowerCase(), { kind: l.toKind, name: l.toName });
      for (const l of links.incoming) related.set(l.fromName.toLowerCase(), { kind: l.fromKind, name: l.fromName });
    }
    for (const f of found) related.delete(f.title.toLowerCase());
    try {
      const answer = await answerQuestion({ question: payload.question, found, model, history });
      return c.json({ ...answer, related: [...related.values()].slice(0, 8) });
    } catch {
      return c.json({ error: "model_failed" }, 502);
    }
  });

  app.get("/api/app/decisions", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const open = [];
    for (const post of await store.openDecisions(principal.uid)) if (await reachable(principal, post)) open.push(post);
    return c.json({ open, now: now() });
  });

  app.post("/api/app/decisions", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { id?: unknown; answer?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    if (typeof payload.id !== "string" || typeof payload.answer !== "string" || !cleanText(payload.answer, MAX_ENTRY_BODY).trim()) return c.json({ error: "bad_fields" }, 400);
    const post = await store.getPost(payload.id);
    if (!post || post.type !== "decision" || post.authorUid !== principal.uid) return c.json({ error: "not_found" }, 404);
    if (!(await reachable(principal, post))) return c.json({ error: "not_found" }, 404);
    if (!(await store.closePost(post.id, post.repoId, { uid: principal.uid, login: principal.login, client: "web" }, payload.answer))) {
      return c.json({ error: "already_answered" }, 409);
    }
    return c.json({ ok: true });
  });

  app.post("/api/app/brain", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    let payload: { kind?: unknown; name?: unknown; body?: unknown; memory?: unknown; parts?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    const kind = ENTRY_KINDS.find((k) => k === payload.kind);
    if (!kind) return c.json({ error: "bad_kind" }, 400);
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    let body: string | ((current: string | null) => string) | null = typeof payload.body === "string" ? payload.body : null;
    if (kind === "memory" && payload.memory && typeof payload.memory === "object") {
      const m = payload.memory as Record<string, unknown>;
      const type = str(m.type);
      if (!isMemoryType(type) || !str(m.fact).trim()) return c.json({ error: "bad_fields" }, 400);
      body = renderMemory({ type, description: str(m.description), fact: str(m.fact), why: str(m.why), how: str(m.how), auto: false });
    }
    if (kind === "skill" && payload.parts && typeof payload.parts === "object") {
      const given = payload.parts as Record<string, unknown>;
      body = (current) => {
        const skill = parseSkill(current ?? "");
        for (const p of SKILL_PARTS) skill.parts[p].text = str(given[p]).trim();
        return renderSkill(skill);
      };
    }
    if (typeof payload.name !== "string" || body === null) return c.json({ error: "bad_fields" }, 400);
    if (payload.name.length > MAX_ENTRY_NAME || (typeof body === "string" && body.length > MAX_ENTRY_BODY)) return c.json({ error: "too_long" }, 400);
    const result = await store.putEntry({ kind, ownerUid: principal.uid, name: payload.name, body });
    if (!result.ok) return c.json({ error: result.reason }, result.reason === "entry_quota" ? 429 : 400);
    return c.json({ entry: result.entry, created: result.created });
  });

  app.delete("/api/app/brain", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const kind = ENTRY_KINDS.find((k) => k === c.req.query("kind"));
    if (!kind) return c.json({ error: "bad_kind" }, 400);
    if (!(await store.deleteEntry(kind, principal.uid, c.req.query("name") ?? ""))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/api/app/board", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const repo = (c.req.query("repo") ?? "").trim();
    try {
      const a = await access.check(principal.uid, principal.login, assertRepo(repo));
      if (!canUseBoard(a.role)) return c.json({ error: "no_access" }, 404);
      const board = await store.readBoard(a.repoId, { limit: 100 });
      return c.json({
        repo: a.fullName,
        role: a.role,
        moderator: canModerate(a.role),
        tasks: board.tasks,
        claims: board.claims,
        recent: board.recent,
        events: await store.events(a.repoId, { limit: 40 }),
        now: now(),
      });
    } catch {
      return c.json({ error: "no_access" }, 404);
    }
  });

  const rpcError = (c: Context, status: 400 | 401 | 403 | 405 | 413 | 429, code: number, message: string, headers: Record<string, string> = {}) =>
    c.json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);

  app.on(["GET", "DELETE", "PUT", "PATCH"], ["/mcp", "/mcp/"], (c) => rpcError(c, 405, -32000, "Method not allowed. This server is stateless; use POST.", { allow: "POST" }));

  app.post(
    "/mcp",
    bodyLimit({ maxSize: MCP_BODY_LIMIT, onError: (c) => rpcError(c, 413, -32000, "Request body too large.") }),
    async (c) => {
      const principal = await auth.verify(c.req.header("authorization"), "agent");
      if (!principal) {
        return rpcError(c, 401, -32001, `Unauthorized. Connect GitHub and create an agent token at ${config.publicUrl}.`, {
          "www-authenticate": 'Bearer realm="companybrain-board"',
        });
      }
      if (!(await limiter.allow(`uid:${principal.uid}`))) return rpcError(c, 429, -32000, "Too many requests. Slow down.", { "retry-after": "60" });
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
        upstream: upstreamFor(principal.uid),
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      try {
        const res = await transport.handleRequest(c.req.raw, {
          parsedBody: parsed,
          authInfo: { token: "redacted", clientId: principal.client, scopes: [], extra: { login: principal.login } },
        });
        const call = parsed as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } | null;
        if (call?.method === "tools/call") {
          const reply = (await res.clone().json().catch(() => null)) as { error?: unknown; result?: { isError?: boolean } } | null;
          const args = (call.params?.arguments ?? {}) as { repo?: unknown; post_id?: unknown; server?: unknown; tool?: unknown; name?: unknown };
          const tool = String(call.params?.name ?? "");
          const gatewayTarget = typeof args.server === "string" ? `${args.server}:${typeof args.tool === "string" ? args.tool : "tools"}` : null;
          const named = typeof args.name === "string" && (tool.startsWith("skill_") || tool === "memory_save") ? `${tool.startsWith("skill_") ? "skill" : "memory"}:${args.name}` : null;
          const subject = typeof args.repo === "string" ? args.repo : typeof args.post_id === "string" ? args.post_id : (gatewayTarget ?? named);
          if (TOOL_NAMES.has(tool)) await store
            .audit({
              uid: principal.uid,
              tokenId: principal.tokenId,
              client: principal.client,
              tool,
              subject: subject === null ? null : cleanLine(subject, 201),
              ok: Boolean(reply && !reply.error && !reply.result?.isError),
            })
            .catch((err: unknown) => console.error(`board audit write failed: ${err instanceof Error ? err.name : typeof err}`));
        }
        return res;
      } finally {
        await server.close();
      }
    },
  );

  app.post("/mcp/", (c) => c.redirect("/mcp", 308));

  return app;
}
