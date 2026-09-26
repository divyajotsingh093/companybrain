import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { waitUntil } from "@vercel/functions";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import type { AccessChecker } from "./access.ts";
import { canModerate, canUseBoard } from "./access.ts";
import { answerQuestion, createModel, indexRepo, type Model, modelSummary, readHistory, titleOf } from "./brain.ts";
import { auth as upstreamAuth } from "@modelcontextprotocol/sdk/client/auth.js";
import { DIRECTORY } from "./directory.ts";
import { GATEWAY_NAME, GATEWAY_OAUTH_TTL_MS, gatewayOAuthProvider, gatewayUrlProblem, guardedFetch, MAX_GATEWAYS, openUpstream, publicFetch, sealGatewayToken } from "./gateway.ts";
import type { Auth, Principal } from "./auth.ts";
import type { Config } from "./config.ts";
import { assertRepo, exchangeCode, type Fetch, type GitHubClient, GitHubError } from "./github.ts";
import type { RateLimiter } from "./limits.ts";
import { APP_JS_BASE64 } from "./app-bundle.ts";
import { FAVICON } from "./brand.ts";
import { createBoardServer, describeError, TOOL_NAMES } from "./mcp.ts";
import { createPipedreamAdapter, pipedreamGatewayUrl, pipedreamSlug, PIPEDREAM_MCP_URL } from "./pipedream.ts";
import { AUTHORIZE_PATH, CODE_TTL_MS, formActionFor, MAX_NEXT_LENGTH, issueCode, metadata, NEXT_TTL_MS, readClient, redeemCode, redirectAllowed, registerClient, resourceAllowed, validChallenge, withParams } from "./oauth.ts";
import { forgetReference, quietly, seedHarnessSkill, seedPerson, seedProject, seedReference } from "./seed.ts";
import { AGREEMENT, agentCards, agentsFor, HANDBOOK, packsOf, readWelcome, seedStarterKit, type WelcomeInput } from "./starter.ts";
import { GATE_MIN_GRADED, REFLECT_EVERY_MS, REFLECT_GOAL, REFLECTOR, reflectorRefusal, runGate } from "./improve.ts";
import { ASSISTANT, type AgentProfile, CREATE_WRITES, LIBRARIAN, LIBRARIAN_GOAL, MAX_STEPS, profilesFor, RUN_DEADLINE_MS, runAgent } from "./runner.ts";
import { isMemoryType, MEMORY_PURPOSE, parseMemory, renderMemory } from "./memory.ts";
import { learnInto, PART_PURPOSE, parseSkill, pulse, renderSkill, SKILL_PARTS, STALE_AFTER_MS } from "./skills.ts";
import { candidates, rank, type Signals } from "./suggest.ts";
import { clamp, cleanLine, cleanText } from "./untrusted.ts";
import { ACTIVE_AGENT_TOKENS_PER_USER, ENTRY_KINDS, type EntryKind, type GatewayOAuthRows, type Post, type Proposal, type RunStep, KIND_PURPOSE, MAX_DOC_BODY, MAX_ENTRY_BODY, MAX_ENTRY_NAME, MAX_UPLOAD_NAME, type Store } from "./store.ts";
import { hashToken, isAgentClient, seal, unseal } from "./token.ts";
import { type ErrorCode, isErrorCode, renderBoard, renderConnected, renderDenied, renderHome, renderConsent, renderMessage, renderTokenCreated } from "./web.ts";
import { renderWelcome, WELCOME_CSP } from "./welcome.ts";

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
  defer?: (work: Promise<unknown>) => void;
}

const RUNS_PER_DAY = 30;
const AUTO_BUILD_EVERY_MS = 20 * 3_600_000;
const AUTO_BUILDS_PER_CRON = 10;
const MAX_GOAL = 2_000;
const TEST_COST_IN_RUNS = 3;
const LIBRARIAN_READS = 6;
const REQUEST_ATTEMPTS = 2;
const REQUEST_RUNS_PER_DAY = 20;
const AUTO_REQUEST_MAX_AGE_MS = 14 * 86_400_000;
const GATES_PER_CRON = 3;

const SESSION_COOKIE = "cb_session";
const STATE_COOKIE = "cb_state";
const NEXT_COOKIE = "cb_next";
const OAUTH_BODY_LIMIT = 16 * 1024;
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
const SEED_WAIT_MS = 3_000;
const PRIVACY_URL = "https://www.getvortic.com/privacy";
const WELCOME_PER_MINUTE = 10;
const SUGGEST_PER_MINUTE = 30;
const REINDEX_BUDGET_MS = 150_000;
const INDEX_PER_MINUTE = 6;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function auditSubject(tool: string, args: Record<string, unknown>): string | null {
  const gatewayTarget = typeof args.server === "string" ? `${args.server}:${typeof args.tool === "string" ? args.tool : "tools"}` : null;
  const named = typeof args.name === "string" && (tool.startsWith("skill_") || tool === "memory_save") ? `${tool.startsWith("skill_") ? "skill" : "memory"}:${cleanLine(args.name, MAX_ENTRY_NAME)}` : null;
  return typeof args.repo === "string" ? args.repo : typeof args.post_id === "string" ? args.post_id : (gatewayTarget ?? named);
}

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

  const rememberNext = (c: Context, path: string) =>
    setCookie(c, NEXT_COOKIE, seal(config.secret, "next", { path, at: now() }), { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: NEXT_TTL_MS / 1000 });
  const takeNext = (c: Context): string | null => {
    const raw = getCookie(c, NEXT_COOKIE);
    if (!raw) return null;
    deleteCookie(c, NEXT_COOKIE, { path: "/" });
    const stored = unseal(config.secret, "next", raw) as { path?: unknown; at?: unknown } | null;
    if (typeof stored?.path !== "string" || typeof stored.at !== "number" || now() - stored.at > NEXT_TTL_MS) return null;
    return stored.path.startsWith(`${AUTHORIZE_PATH}?`) ? stored.path : null;
  };

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
    if (!(await store.profile(principal.uid))) return c.redirect("/welcome");
    return c.html(
      renderConnected({
        login: principal.login,
        mcpUrl,
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

  const prepareAgent = (uid: number, login: string) =>
    Promise.race([
      quietly("person", async () => {
        const repos = (await githubFor(await auth.githubToken(uid)).listRepos(12)).map((r) => r.fullName);
        await seedPerson(store, uid, login, repos);
        await weaveHarness(uid, login, repos);
      }),
      new Promise((resolve) => setTimeout(resolve, SEED_WAIT_MS)),
    ]);

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
    await prepareAgent(principal.uid, principal.login);
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
    const asked = c.req.query("next");
    const next = asked && asked.startsWith(`${AUTHORIZE_PATH}?`) && asked.length <= MAX_NEXT_LENGTH ? asked : undefined;
    setCookie(c, STATE_COOKIE, seal(config.secret, "state", { nonce, at: now(), ...(next ? { next } : {}) }), {
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
    const stored = unseal(config.secret, "state", getCookie(c, STATE_COOKIE) ?? "") as { nonce?: string; at?: number; next?: string } | null;
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
      const profile = await store.profile(viewer.id);
      await Promise.race([
        quietly("person", async () => seedPerson(store, viewer.id, viewer.login, (await githubFor(grant.accessToken).listRepos(12)).map((r) => r.fullName))),
        new Promise((resolve) => setTimeout(resolve, SEED_WAIT_MS)),
      ]);
      setCookie(c, SESSION_COOKIE, issued.token, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
      const next = typeof stored.next === "string" && stored.next.startsWith(`${AUTHORIZE_PATH}?`) ? stored.next : null;
      if (profile) return c.redirect(next ?? "/app");
      if (next) rememberNext(c, next);
      return c.redirect("/welcome");
    } catch {
      return fail("exchange");
    }
  });

  const within = <T>(work: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), SEED_WAIT_MS))]);

  const tooFast = async (uid: number) => (await store.hit(`welcome:${uid}`, 60_000)) > WELCOME_PER_MINUTE;

  app.get("/welcome", async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (await tooFast(principal.uid)) return c.html(renderMessage("Slow down", "Too many requests. Wait a minute and reload."), 429);
    const existing = await store.profile(principal.uid);
    const github = existing
      ? null
      : await within(
          (async () => githubFor(await auth.githubToken(principal.uid)).viewer())(),
          null,
        );
    const values: WelcomeInput = existing
      ? { name: existing.name, email: existing.email, company: existing.company, role: existing.role, teamSize: existing.teamSize, goals: existing.goals, agents: existing.agents, kit: existing.kit, updates: existing.updates }
      : { name: cleanLine(github?.name ?? "", 80), email: cleanLine(github?.email ?? "", 200), company: "", role: "", teamSize: "", goals: [], agents: [], kit: "both", updates: false };
    c.header("content-security-policy", WELCOME_CSP);
    return c.html(renderWelcome({ login: principal.login, values, errors: {}, editing: existing !== null, privacyUrl: PRIVACY_URL }));
  });

  app.post("/welcome", formLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    if (await tooFast(principal.uid)) return c.html(renderMessage("Slow down", "Too many requests. Wait a minute and try again."), 429);
    const existing = await store.profile(principal.uid);
    const read = readWelcome(await c.req.parseBody({ all: true }));
    const again = (status: 400 | 503, failure?: string) => {
      c.header("content-security-policy", WELCOME_CSP);
      return c.html(renderWelcome({ login: principal.login, values: read.values, errors: read.errors, editing: existing !== null, privacyUrl: PRIVACY_URL, ...(failure ? { failure } : {}) }), status);
    };
    if (!read.profile) return again(400);
    let profile: Awaited<ReturnType<typeof store.profile>>;
    try {
      await store.saveProfile({ ...read.profile, uid: principal.uid, login: principal.login });
      profile = await store.profile(principal.uid);
    } catch {
      return again(503, "Your details could not be saved just now. Nothing was lost; try again in a moment.");
    }
    if (profile) {
      const added = existing ? packsOf(profile.kit).filter((p) => !packsOf(existing.kit).includes(p)) : undefined;
      if (!existing || added?.length) {
        await quietly("starter", () => seedStarterKit(store, profile, { about: `About ${principal.login}`, now: now(), ...(added ? { packs: added } : {}) }));
      }
      const repos = await within(
        (async () => (await githubFor(await auth.githubToken(principal.uid)).listRepos(12)).map((r) => r.fullName))(),
        [] as string[],
      );
      await quietly("harness", () => weaveHarness(principal.uid, principal.login, repos));
      await quietly("person", () => seedPerson(store, principal.uid, principal.login, repos));
    }
    return c.redirect(takeNext(c) ?? "/app");
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
    if (!(await store.profile(principal.uid))) return c.redirect("/welcome");
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
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!(await store.profile(principal.uid))) return c.redirect("/welcome");
    c.header("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("cache-control", "no-store");
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><link rel="icon" href="${FAVICON}"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&display=swap">
<title>Company Brain</title></head><body style="margin:0;background:#08080a"><div id="root"></div><script type="module" src="/app/bundle.js"></script></body></html>`,
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
      const [repos, profile, roles] = await Promise.all([github.listRepos(12), store.profile(principal.uid), store.listEntries("role", principal.uid)]);
      return c.json({
        login: principal.login,
        profile: profile ? { name: profile.name, company: profile.company, kit: profile.kit, agents: profile.agents, askedAt: profile.askedAt } : null,
        starterAgents: profile ? agentCards(profile, new Set(roles.map((r) => r.name))) : [],
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

  const jsonLimit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) });

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

  const gatherSignals = async (principal: Principal): Promise<Signals> => {
    const read = canRead(principal);
    const since = now() - STALE_AFTER_MS;
    const [tasks, open, unanswered, missing, sources, skills, gateways, reads] = await Promise.all([
      store.requestsBy(principal.uid),
      store.openDecisions(principal.uid),
      store.unansweredQuestions(principal.uid, since),
      store.missingEntries(principal.uid),
      store.sources(principal.uid),
      store.listEntries("skill", principal.uid, 50),
      store.listGateways(principal.uid),
      store.recentSkillReads(principal.uid, since),
    ]);
    const repos = new Map([...tasks, ...open].map((p) => [p.repoId, p.repoName]));
    const allowed = new Map(await Promise.all([...repos].map(async ([id, name]) => [id, await read(name, id)] as const)));
    const visible = <T extends { repoId: number }>(posts: T[]): T[] => posts.filter((p) => allowed.get(p.repoId) === true);
    const observed = await Promise.all(reads.map(async (skill) => ({ skill, tools: (await store.skillUsage(principal.uid, skill, since)).tools })));
    return {
      now: now(),
      reviews: visible(tasks.filter((t) => t.status === "review")),
      decisions: visible(open),
      unanswered,
      missing,
      sources,
      skills: skills.map((e) => ({ name: e.name, body: e.body, updatedAt: e.updatedAt })),
      gateways: gateways.map((g) => g.name),
      observed,
    };
  };

  app.get("/api/app/suggestions", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if ((await store.hit(`suggest:${principal.uid}`, 60_000)) > SUGGEST_PER_MINUTE) return c.json({ error: "rate_limited" }, 429);
    const [signals, history] = await Promise.all([gatherSignals(principal), store.suggestionHistory(principal.uid)]);
    const choices = history.stats.reduce((n, s) => n + s.n, 0);
    return c.json({ suggestions: rank(candidates(signals), history, now()), choices, now: now() });
  });

  app.post("/api/app/suggestions", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if ((await store.hit(`suggest:${principal.uid}`, 60_000)) > SUGGEST_PER_MINUTE) return c.json({ error: "rate_limited" }, 429);
    let payload: { key?: unknown; verdict?: unknown };
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "bad_json" }, 400);
    }
    const verdict = payload.verdict === "accepted" || payload.verdict === "snoozed" || payload.verdict === "dismissed" ? payload.verdict : null;
    if (typeof payload.key !== "string" || !verdict) return c.json({ error: "bad_fields" }, 400);
    const found = candidates(await gatherSignals(principal)).find((s) => s.key === payload.key);
    if (!found) return c.json({ error: "not_found" }, 404);
    if (verdict === "accepted" && found.action.type === "reindex") {
      if ((await store.hit(`index:${principal.uid}`, 60_000)) > INDEX_PER_MINUTE) return c.json({ error: "rate_limited" }, 429);
      try {
        if (!(await indexFor(principal.uid, principal.login, found.action.repo))) return c.json({ error: "no_access" }, 404);
      } catch (err) {
        if (err instanceof GitHubError) return c.json({ error: "github", message: describeError(err, config.publicUrl) }, 200);
        return c.json({ error: "no_access" }, 404);
      }
    }
    if (verdict === "accepted" && found.action.type === "learn") {
      const { skill, part, note } = found.action;
      const result = await store.putEntry({
        kind: "skill",
        ownerUid: principal.uid,
        name: skill,
        author: "web",
        body: (current) => {
          const next = learnInto(current ?? "", part, note, "company-brain", now());
          return "full" in next ? null : next.body;
        },
      });
      if (!result.ok) return c.json({ error: result.reason === "too_long" || result.reason === "refused" ? "too_long" : result.reason }, 400);
    }
    await store.recordSuggestion(principal.uid, found.kind, found.key, verdict);
    return c.json({ ok: true, action: found.action });
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


  const model = deps.model ?? createModel(process.env, deps.fetch ?? fetch);

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
      const started = await kickRequests(principal.uid, principal.login);
      return c.json({ id: result.post.id, ...(started?.requestId === result.post.id ? { runId: started.runId } : {}) });
    } catch {
      return c.json({ error: "no_access" }, 404);
    }
  });

  app.get("/api/app/work", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const read = canRead(principal);
    if (c.req.query("pickup") === "1" && sameOrigin(c)) await kickRequests(principal.uid, principal.login);
    const tasks = await store.requestsBy(principal.uid);
    const repos = new Map(tasks.map((t) => [t.repoId, t.repoName]));
    const visible = new Map(await Promise.all([...repos].map(async ([id, name]) => [id, await read(name, id)] as const)));
    const shown = tasks.filter((t) => visible.get(t.repoId) === true);
    const runs = await store.requestRuns(principal.uid, shown.map((t) => t.id));
    const requests = await Promise.all(
      shown.map(async (t) => {
        const updates = await store.workUpdates(t.id);
        const run = runs.get(t.id) ?? null;
        const stalled = t.status === "working" && updates.at(-1)?.client === "runner" && run?.status !== "running";
        return { ...t, updates, run, stalled };
      }),
    );
    return c.json({ requests, autoRequests: await store.autoRequests(principal.uid), canRun: model !== null, now: now() });
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

  const upstreamFetch = deps.gatewayFetch ?? publicFetch;
  const pipedream = config.pipedream ? createPipedreamAdapter({ config: config.pipedream, fetch: upstreamFetch, now }) : null;
  const oauthCallbackUrl = `${config.publicUrl}/gateway/oauth/callback`;
  const storedRows = (uid: number, name: string): GatewayOAuthRows => ({
    read: () => store.gatewayOAuth(uid, name),
    save: (url, sealed) => store.saveGatewayOAuth(uid, name, url, sealed),
  });
  const providerFor = (rows: GatewayOAuthRows, url: string, live: boolean, state = "") =>
    gatewayOAuthProvider({ rows, secret: config.secret, url, state, callbackUrl: oauthCallbackUrl, live, now });

  const refreshIfDue = async (uid: number, name: string, url: string) =>
    (await providerFor(storedRows(uid, name), url, true).refreshDue()) &&
    store
      .withGatewayOAuthLock(uid, name, async (held) => {
        const flow = providerFor(held, url, true);
        if (await flow.refreshDue()) await upstreamAuth(flow.provider, { serverUrl: url, fetchFn: guardedFetch(upstreamFetch) });
      })
      .catch((err: unknown) => console.error(`gateway refresh failed: ${err instanceof Error ? err.name : typeof err}`));

  const upstreamFor = (uid: number) => async (name: string) => {
    const g = await store.gateway(uid, name);
    if (!g) return null;
    if (g.auth === "pipedream") {
      const target = new URL(g.url);
      const slug = target.searchParams.get("app") ?? "";
      if (!pipedream || config.pipedream?.environment !== "development" || target.origin + target.pathname !== PIPEDREAM_MCP_URL || !pipedreamSlug(slug) || target.href !== pipedreamGatewayUrl(slug)) throw new Error("Invalid Pipedream connection");
      return pipedream.open(uid, slug);
    }
    if (g.auth !== "oauth") return openUpstream({ url: g.url, sealedToken: g.tokenSealed, secret: config.secret, fetch: upstreamFetch });
    await refreshIfDue(uid, name, g.url);
    return openUpstream({ url: g.url, sealedToken: null, secret: config.secret, fetch: upstreamFetch, authProvider: providerFor(storedRows(uid, name), g.url, true).provider });
  };

  const finishOAuthServer = async (uid: number, login: string, name: string, url: string): Promise<number> => {
    const upstream = await openUpstream({ url, sealedToken: null, secret: config.secret, fetch: upstreamFetch, authProvider: providerFor(storedRows(uid, name), url, true).provider });
    let tools: number;
    try {
      tools = (await upstream.tools()).length;
    } finally {
      await upstream.close().catch(() => undefined);
    }
    if (!(await store.putGateway(uid, { name, url: new URL(url).href, tokenSealed: null, auth: "oauth" }, MAX_GATEWAYS))) throw new Error("too_many");
    await quietly("reference", async () => {
      await seedReference(store, uid, name, url, tools);
      await weaveHarness(uid, login);
    });
    return tools;
  };

  app.get("/api/app/directory", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    c.header("cache-control", "private, max-age=3600");
    return c.json({ servers: DIRECTORY.filter((d) => d.transport === "http") });
  });

  app.post("/api/app/gateway/oauth/start", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const payload = (await c.req.json().catch(() => null)) as { name?: unknown; url?: unknown } | null;
    const name = typeof payload?.name === "string" ? payload.name.trim().toLowerCase() : "";
    const url = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (!GATEWAY_NAME.test(name) || !url || url.length > 500) return c.json({ error: "bad_fields" }, 400);
    if (name.startsWith("pd-")) return c.json({ error: "reserved_name" }, 400);
    const problem = gatewayUrlProblem(url);
    if (problem) return c.json({ error: "bad_url", message: problem }, 400);
    if ((await store.hit(`gateway-add:${principal.uid}`, 60_000)) > 10) return c.json({ error: "rate_limited" }, 429);
    const held = await store.listGateways(principal.uid);
    if (held.length >= MAX_GATEWAYS && !held.some((g) => g.name === name)) return c.json({ error: "too_many" }, 409);
    await store.startGatewayOAuth(principal.uid, name, new URL(url).href, randomBytes(24).toString("base64url"));
    const row = await store.gatewayOAuth(principal.uid, name);
    if (!row) return c.json({ error: "unavailable" }, 503);
    const flow = providerFor(storedRows(principal.uid, name), row.url, false, row.state);
    try {
      const result = await upstreamAuth(flow.provider, { serverUrl: row.url, fetchFn: guardedFetch(upstreamFetch) });
      if (result === "REDIRECT") {
        const target = flow.authorizationUrl();
        if (!target || target.protocol !== "https:") return c.json({ error: "unreachable", message: "The server did not offer a secure sign-in page." }, 400);
        return c.json({ redirect: target.toString() });
      }
      return c.json({ ok: true, name, tools: await finishOAuthServer(principal.uid, principal.login, name, row.url) });
    } catch (err) {
      if (err instanceof Error && err.message === "too_many") return c.json({ error: "too_many" }, 409);
      console.error(`gateway sign-in start failed: ${err instanceof Error ? err.name : typeof err}`);
      return c.json({ error: "unreachable", message: "That server's sign-in could not be started. Check the address, or try again later." }, 400);
    }
  });

  app.get("/gateway/oauth/callback", async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    const back = (params: Record<string, string>) => c.redirect(`/app?${new URLSearchParams({ screen: "gateway", ...params }).toString()}`);
    const state = c.req.query("state") ?? "";
    const row = state ? await store.claimGatewayOAuth(principal.uid, state, now() - GATEWAY_OAUTH_TTL_MS, randomBytes(24).toString("base64url")) : undefined;
    if (!row) return back({ failed: "expired" });
    const code = c.req.query("code");
    if (!code) return back({ failed: "denied", name: row.name });
    try {
      const result = await upstreamAuth(providerFor(storedRows(row.ownerUid, row.name), row.url, false, state).provider, { serverUrl: row.url, authorizationCode: code, fetchFn: guardedFetch(upstreamFetch) });
      if (result !== "AUTHORIZED") return back({ failed: "signin", name: row.name });
      await finishOAuthServer(row.ownerUid, principal.login, row.name, row.url);
      return back({ connected: row.name });
    } catch (err) {
      return back({ failed: err instanceof Error && err.message === "too_many" ? "too_many" : "signin", name: row.name });
    }
  });

  app.get("/api/app/gateway", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const [listed, calls] = await Promise.all([store.listGateways(principal.uid), store.auditTrail(principal.uid, 50, "gateway_call")]);
    const servers = await Promise.all(
      listed.map(async (g) => ({ ...g, signedIn: g.auth === "oauth" ? await providerFor(storedRows(principal.uid, g.name), g.url, true).signedIn() : true })),
    );
    return c.json({ servers, calls, max: MAX_GATEWAYS, model: { configured: model !== null, summary: modelSummary(process.env), dailyLimit: ASK_PER_DAY }, mcpUrl: `${config.publicUrl}/mcp`, pipedreamAvailable: Boolean(pipedream && config.pipedream?.environment === "development"), now: now() });
  });

  // Explicit per-user, per-app opt-in. No third-party account is connected by this step:
  // Pipedream returns its Connect Link when an authorized tool needs an account.
  app.post("/api/app/gateway/pipedream", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!pipedream) return c.json({ error: "not_configured" }, 503);
    if (config.pipedream?.environment !== "development") return c.json({ error: "production_not_enabled" }, 403);
    const payload = (await c.req.json().catch(() => null)) as { app?: unknown } | null;
    const slug = typeof payload?.app === "string" ? payload.app.trim().toLowerCase() : "";
    if (!pipedreamSlug(slug)) return c.json({ error: "bad_app" }, 400);
    const name = `pd-${slug}`;
    if (!GATEWAY_NAME.test(name)) return c.json({ error: "bad_app" }, 400);
    if ((await store.hit(`gateway-add:${principal.uid}`, 60_000)) > 10) return c.json({ error: "rate_limited" }, 429);
    if (!(await store.putGateway(principal.uid, { name, url: pipedreamGatewayUrl(slug), tokenSealed: null, auth: "pipedream" }, MAX_GATEWAYS))) return c.json({ error: "too_many" }, 409);
    await quietly("reference", async () => weaveHarness(principal.uid, principal.login));
    return c.json({ ok: true, name, status: "configured", accountConnected: false });
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
    if (name.startsWith("pd-")) return c.json({ error: "reserved_name" }, 400);
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
    const name = (c.req.query("name") ?? "").toLowerCase();
    if (!(await store.deleteGateway(principal.uid, name))) return c.json({ error: "not_found" }, 404);
    await quietly("reference", async () => {
      await forgetReference(store, principal.uid, name);
      await weaveHarness(principal.uid, principal.login);
    });
    return c.json({ ok: true });
  });

  app.get("/api/app/sources", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const [sources, uploads] = await Promise.all([store.sources(principal.uid), store.listUploads(principal.uid)]);
    const ownFiles = uploads.filter((u) => u.name !== HANDBOOK && u.name !== AGREEMENT).length;
    return c.json({ sources, ownFiles, canAsk: model !== null, now: now() });
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
    if (!found.length) {
      await store.audit({ uid: principal.uid, tokenId: "web", client: "web", tool: "ask", subject: cleanLine(payload.question, 201), ok: false }).catch(() => undefined);
    }
    try {
      const answer = await answerQuestion({ question: payload.question, found, model, history, signal: c.req.raw.signal });
      await store.markAsked(principal.uid).catch(() => undefined);
      const id = randomBytes(12).toString("base64url");
      const skills = found.filter((f) => f.kind === "skill").map((f) => f.title);
      const outcomeId = await store
        .addOutcome({ id, uid: principal.uid, kind: "ask", client: "web", goal: payload.question, outcome: found.length ? "done" : "failed", summary: answer.answer, skills })
        .then(() => id)
        .catch(() => undefined);
      return c.json({ ...answer, ...(outcomeId ? { outcomeId } : {}), related: [...related.values()].slice(0, 8) });
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
    const result = await store.putEntry({ kind, ownerUid: principal.uid, name: payload.name, body, author: "web" });
    if (!result.ok) return c.json({ error: result.reason }, result.reason === "entry_quota" ? 429 : 400);
    return c.json({ entry: result.entry, created: result.created });
  });

  app.delete("/api/app/brain", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const kind = ENTRY_KINDS.find((k) => k === c.req.query("kind"));
    if (!kind) return c.json({ error: "bad_kind" }, 400);
    if (!(await store.deleteEntry(kind, principal.uid, c.req.query("name") ?? "", { keepHistory: false }))) return c.json({ error: "not_found" }, 404);
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

  const oauthCors = cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"],
    exposeHeaders: ["www-authenticate", "mcp-session-id"],
    maxAge: 86_400,
  });
  for (const path of ["/.well-known/*", "/oauth/register", "/oauth/token", "/mcp"]) app.use(path, oauthCors);
  const discovery = metadata(config.publicUrl);
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(discovery.protectedResource));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(discovery.protectedResource));
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(discovery.authorizationServer));

  const oauthError = (c: Context, status: 400 | 401 | 413, error: string, description: string) =>
    c.json({ error, error_description: description }, status, { "cache-control": "no-store" });
  const oauthLimit = bodyLimit({ maxSize: OAUTH_BODY_LIMIT, onError: (c) => oauthError(c, 413, "invalid_request", "Request body too large.") });

  app.post("/oauth/register", oauthLimit, async (c) => {
    const registered = registerClient(config.secret, await c.req.json().catch(() => null), now());
    if ("error" in registered) return oauthError(c, 400, "invalid_redirect_uri", registered.error);
    return c.json(registered.client, 201, { "cache-control": "no-store" });
  });

  const authorizeRequest = (field: (name: string) => string | undefined) => {
    const clientId = field("client_id") ?? "";
    const redirectUri = field("redirect_uri") ?? "";
    const client = readClient(config.secret, clientId);
    if (!client) return { fatal: "This app's registration is not recognised. Remove the connector and add it again." };
    if (!redirectAllowed(client, redirectUri)) return { fatal: "This app asked to return somewhere it did not register, so the sign-in was stopped." };
    const state = field("state");
    const fail = (description: string) => ({ fatal: `${description} Remove the connector and add it again, or ask the app's maker.` });
    if (field("response_type") !== "code") return fail("Only the code response type is supported.");
    const challenge = field("code_challenge") ?? "";
    if (field("code_challenge_method") !== "S256" || !validChallenge(challenge)) return fail("PKCE with S256 is required.");
    if (state !== undefined && state.length > 500) return fail("The state value is too long.");
    const resource = field("resource");
    if (!resourceAllowed(resource, config.publicUrl)) return fail("This server only grants access to its own MCP endpoint.");
    const fields: Record<string, string> = { client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
    if (state !== undefined) fields.state = state;
    if (resource !== undefined) fields.resource = resource;
    return { client, clientId, redirectUri, challenge, state, fields };
  };

  app.get(AUTHORIZE_PATH, async (c) => {
    const req = authorizeRequest((name) => c.req.query(name));
    if ("fatal" in req) return c.html(renderMessage("Cannot connect this app", req.fatal as string), 400);
    const here = `${AUTHORIZE_PATH}?${new URLSearchParams(req.fields).toString()}`;
    if (here.length > MAX_NEXT_LENGTH) return c.html(renderMessage("Cannot connect this app", "This app's sign-in request is too large. Remove the connector and add it again."), 400);
    const principal = await session(c);
    if (!principal) {
      if (!githubConfigured) return c.text("GitHub sign-in is not configured.", 503);
      return c.redirect(`/auth/github/start?next=${encodeURIComponent(here)}`);
    }
    if (!(await store.profile(principal.uid))) {
      rememberNext(c, here);
      return c.redirect("/welcome");
    }
    const target = new URL(req.redirectUri);
    c.header("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self' ${formActionFor(req.redirectUri)}; frame-ancestors 'none'; base-uri 'none'`);
    return c.html(renderConsent({ login: principal.login, clientName: req.client.name, redirectHost: target.host ? `${target.protocol}//${target.host}` : target.protocol, fields: req.fields }));
  });

  app.post(AUTHORIZE_PATH, oauthLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.redirect("/");
    if (!sameOrigin(c)) return c.html(renderMessage("Request blocked", "That request did not come from this site."), 403);
    const form = await c.req.parseBody();
    const field = (name: string) => (typeof form[name] === "string" ? form[name] : undefined);
    const req = authorizeRequest(field);
    if ("fatal" in req) return c.html(renderMessage("Cannot connect this app", req.fatal as string), 400);
    if (!(await store.profile(principal.uid))) return c.redirect("/welcome");
    const state: Record<string, string> = req.state !== undefined ? { state: req.state } : {};
    if (field("decision") !== "allow") return c.redirect(withParams(req.redirectUri, { error: "access_denied", ...state }));
    const active = await store.activeTokens(principal.uid, "agent");
    if (active.length >= ACTIVE_AGENT_TOKENS_PER_USER && !active.some((t) => t.client === `oauth:${req.client.name}`)) {
      return c.html(renderMessage("Token limit reached", `You have ${ACTIVE_AGENT_TOKENS_PER_USER} active agent tokens. Revoke one on the setup page, then connect again.`), 429);
    }
    const code = issueCode(config.secret, { uid: principal.uid, clientId: req.clientId, redirectUri: req.redirectUri, challenge: req.challenge }, now());
    return c.redirect(withParams(req.redirectUri, { code, ...state }));
  });

  app.post("/oauth/token", oauthLimit, async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : undefined);
    if (field("grant_type") !== "authorization_code") return oauthError(c, 400, "unsupported_grant_type", "Only authorization_code is supported.");
    const basic = /^Basic\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    const clientId = field("client_id") ?? (basic ? (Buffer.from(basic, "base64").toString("utf8").split(":")[0] ?? "") : "");
    const client = readClient(config.secret, clientId);
    if (!client) return oauthError(c, 401, "invalid_client", "Unknown client. Register again.");
    const redeemed = redeemCode(config.secret, { code: field("code") ?? "", clientId, redirectUri: field("redirect_uri") ?? "", verifier: field("code_verifier") ?? "" }, now());
    const invalid = () => oauthError(c, 400, "invalid_grant", "The authorization code is invalid, expired or already used.");
    if (!redeemed || (await store.hit(`oauth-code:${redeemed.nonce}`, CODE_TTL_MS * 2)) > 1) return invalid();
    const cred = await store.credential(redeemed.uid);
    if (!cred) return invalid();
    const tag = `oauth:${client.name}`;
    let issued = await auth.issue(redeemed.uid, "agent", tag, config.agentTokenTtlMs);
    if (!issued) {
      const oldest = (await store.activeTokens(redeemed.uid, "agent")).filter((t) => t.client === tag).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) {
        await store.revokeToken(oldest.id, redeemed.uid);
        issued = await auth.issue(redeemed.uid, "agent", tag, config.agentTokenTtlMs);
      }
    }
    if (!issued) return oauthError(c, 400, "invalid_grant", `You have ${ACTIVE_AGENT_TOKENS_PER_USER} active agent tokens. Revoke one at ${config.publicUrl} and connect again.`);
    await prepareAgent(redeemed.uid, cred.login);
    return c.json({ access_token: issued.token, token_type: "Bearer", expires_in: Math.floor(config.agentTokenTtlMs / 1000) }, 200, { "cache-control": "no-store", pragma: "no-cache" });
  });

  const profilesOf = async (uid: number): Promise<AgentProfile[]> => {
    const profile = await store.profile(uid);
    return profilesFor(profile ? agentsFor(profile.kit) : []);
  };

  const executeRun = async (uid: number, login: string, id: string, profile: AgentProfile, goal: string, allowChanges: boolean, forRequest: Post | null = null): Promise<void> => {
    const principal: Principal = { tokenId: `run:${id}`, uid, login, kind: "agent", client: profile.reflects ? "reflector" : "runner" };
    const skillsRead = new Set<string>();
    let reads = 0;
    const record = async (step: Omit<RunStep, "at">) => store.addRunStep(id, { ...step, at: now() });
    let client: Client | null = null;
    let server: ReturnType<typeof createBoardServer> | null = null;
    const deadline = AbortSignal.timeout(RUN_DEADLINE_MS);
    try {
      if (!model) throw new Error("model_unconfigured");
      server = createBoardServer({ principal, access, store, publicUrl: config.publicUrl, now, github: async () => githubFor(await auth.githubToken(uid)), upstream: upstreamFor(uid) });
      client = new Client({ name: "companybrain-runner", version: "1.0.0" });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      const outcome = await runAgent({
        model,
        client,
        profile,
        goal,
        signal: deadline,
        record,
        onCall: async (tool, args, ok) => {
          const subject = auditSubject(tool, args);
          if (tool === "skill_read" && typeof args.name === "string") skillsRead.add(args.name);
          await store.audit({ uid, tokenId: principal.tokenId, client: principal.client, tool, subject: subject === null ? null : cleanLine(subject, 201), ok }).catch(() => undefined);
        },
        gate: async (tool, args, readOnly) => {
          if (profile.reflects) {
            const refused = reflectorRefusal(tool, args, readOnly);
            if (refused || tool !== "brain_write") return refused;
            const wanted = cleanLine(String(args.name ?? ""), MAX_ENTRY_NAME).toLowerCase();
            const taken = (await store.listEntries("lesson", uid)).some((l) => l.name.toLowerCase() === wanted);
            return taken ? "A lesson with that name already exists. Write a new lesson with its own name." : null;
          }
          if (forRequest && !readOnly) {
            const refused = await requestRefusal(forRequest, tool, args);
            if (refused) return refused;
            if (!CREATE_WRITES.has(tool)) return null;
          }
          if (readOnly && profile.builds && ++reads > LIBRARIAN_READS) return "You have read enough. Write the entries the sources support now with brain_write, or finish.";
          if (readOnly) return null;
          if (allowChanges && !profile.builds) return null;
          if (!CREATE_WRITES.has(tool)) return profile.builds ? "The librarian only reads sources and adds new entries." : "Changes are off for this run, so this tool is not allowed. The person can allow changes when starting a run.";
          const kind = tool === "memory_save" ? "memory" : String(args.kind ?? "");
          const name = String(args.name ?? "");
          if ((ENTRY_KINDS as readonly string[]).includes(kind) && name && (await store.getEntry(kind as EntryKind, uid, name))) {
            return `An entry named "${cleanLine(name, 80)}" already exists. Without changes allowed, runs only add new entries, so pick another name or skip it.`;
          }
          return null;
        },
      });
      await store.finishRun(id, outcome.status, outcome.answer);
      if (forRequest && outcome.status === "done") {
        const task = await store.getPost(forRequest.id);
        if (task && !task.closedAt && ["open", "working", "changes"].includes(task.status ?? "open")) {
          await store.advanceWork(forRequest.id, "submitted", clamp(outcome.answer, 8_000), { uid, login, client: principal.client }).catch(() => undefined);
        }
      }
      if (!profile.reflects) {
        await store.addOutcome({ id, uid, kind: "run", client: profile.id, goal, outcome: outcome.status, summary: outcome.answer, skills: [...skillsRead] }).catch(() => undefined);
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message === "model_unconfigured"
          ? "No model is configured, so agents cannot run yet."
          : deadline.aborted
            ? "The run hit its time limit and was stopped."
            : err instanceof Error && err.message.startsWith("model_unavailable")
              ? "The model could not be reached. Try again in a moment."
              : "The run failed on the server. Try again shortly.";
      console.error(`agent run failed: ${err instanceof Error ? err.name : typeof err}`);
      await record({ kind: "error", text: message }).catch(() => undefined);
      await store.finishRun(id, "failed", message).catch(() => undefined);
      if (!profile.reflects) {
        await store.addOutcome({ id, uid, kind: "run", client: profile.id, goal, outcome: "failed", summary: message, skills: [...skillsRead] }).catch(() => undefined);
      }
    } finally {
      await client?.close().catch(() => undefined);
      await server?.close().catch(() => undefined);
    }
  };

  const defer = deps.defer ?? waitUntil;

  const openReplayClient = (uid: number, login: string) => async () => {
    const principal: Principal = { tokenId: `replay:${randomBytes(6).toString("hex")}`, uid, login, kind: "agent", client: "replay" };
    const server = createBoardServer({ principal, access, store, publicUrl: config.publicUrl, now, github: async () => githubFor(await auth.githubToken(uid)), upstream: upstreamFor(uid) });
    const client = new Client({ name: "companybrain-replay", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      },
    };
  };

  const applyProposal = async (uid: number, proposal: Proposal, author: string): Promise<Proposal | undefined> => {
    const result = await store.putEntry({
      kind: proposal.kind,
      ownerUid: uid,
      name: proposal.name,
      author,
      cause: `proposal:${proposal.id}`,
      body: (current) => (current === proposal.current ? proposal.proposed : null),
    });
    if (!result.ok) {
      if (result.reason !== "refused") return undefined;
      await store.refreshProposalBase(uid, proposal.id, (await store.getEntry(proposal.kind, uid, proposal.name))?.body ?? null);
      return store.moveProposal(uid, proposal.id, ["waiting", "testing", "failed_gate", "stale"], { status: "stale" });
    }
    return store.moveProposal(uid, proposal.id, ["waiting", "testing", "failed_gate", "stale"], { status: "applied", appliedVersion: result.versionId, appliedCreated: result.created, decided: true });
  };

  const testProposal = async (uid: number, login: string, proposal: Proposal): Promise<void> => {
    try {
      if (!model) throw new Error("model_unconfigured");
      const current = (await store.getEntry(proposal.kind, uid, proposal.name))?.body ?? null;
      if (current !== proposal.current) {
        await store.refreshProposalBase(uid, proposal.id, current);
        await store.moveProposal(uid, proposal.id, ["testing"], { status: "stale" });
        return;
      }
      const gate = await runGate({ model, store, uid, proposal, open: openReplayClient(uid, login), deadline: AbortSignal.timeout(RUN_DEADLINE_MS) });
      if (gate.verdict === "fail") {
        await store.moveProposal(uid, proposal.id, ["testing"], { status: "failed_gate", gate });
        return;
      }
      const needsApproval =
        gate.verdict !== "pass" || proposal.kind !== "skill" || !(await store.improveSettings(uid)).improve || (await store.humanTouched(uid, proposal.kind, proposal.name));
      const tested = await store.moveProposal(uid, proposal.id, ["testing"], { status: needsApproval ? "waiting" : "testing", gate, needsApproval });
      if (tested && !needsApproval) await applyProposal(uid, tested, proposal.source);
    } catch (err) {
      console.error(`proposal test failed: ${err instanceof Error ? err.name : typeof err}`);
      await store.moveProposal(uid, proposal.id, ["testing"], { status: "queued" }).catch(() => undefined);
    }
  };

  const revertProposal = async (uid: number, proposal: Proposal): Promise<Proposal | "changed" | undefined> => {
    const cause = `revert:${proposal.id}`;
    const live = (await store.getEntry(proposal.kind, uid, proposal.name))?.body ?? null;
    if (live !== proposal.proposed) return "changed";
    if (proposal.appliedCreated) {
      await store.deleteEntry(proposal.kind, uid, proposal.name);
    } else if (proposal.appliedVersion !== null) {
      const version = await store.entryVersion(uid, proposal.appliedVersion);
      if (!version) return undefined;
      const restored = await store.putEntry({ kind: proposal.kind, ownerUid: uid, name: proposal.name, author: version.author, cause, body: version.body });
      if (!restored.ok) return undefined;
    }
    return store.moveProposal(uid, proposal.id, ["applied"], { status: "reverted", decided: true });
  };

  const publicProposal = (p: Proposal) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    reason: p.reason,
    current: p.current,
    proposed: p.proposed,
    status: p.status,
    gate: p.gate,
    needsApproval: p.needsApproval,
    source: p.source,
    createdAt: p.createdAt,
    decidedAt: p.decidedAt,
  });

  const mondayOf = (at: number): string => {
    const d = new Date(at);
    const back = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
  };

  app.get("/api/app/learning", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const uid = principal.uid;
    await store.settleStaleTesting(uid);
    const since = now() - 8 * 7 * 86_400_000;
    const [settings, graded, points, lessons, proposals, reflections] = await Promise.all([
      store.improveSettings(uid),
      store.gradedCount(uid),
      store.outcomeWeeks(uid, since),
      store.listEntries("lesson", uid),
      store.listProposals(uid, 30),
      store.listRuns(uid, 5, REFLECTOR.id),
    ]);
    const weeks = Array.from({ length: 8 }, (_, i) => ({ week: mondayOf(now() - (7 - i) * 7 * 86_400_000), done: 0, failed: 0, up: 0, down: 0 }));
    for (const p of points) {
      const w = weeks.find((x) => x.week === mondayOf(p.at));
      if (!w) continue;
      if (p.outcome === "done") w.done++;
      else if (p.outcome === "failed" || p.outcome === "stopped") w.failed++;
      if (p.score === 1) w.up++;
      if (p.score === -1) w.down++;
    }
    return c.json({
      enabled: settings.improve,
      graded,
      gateMin: GATE_MIN_GRADED,
      weeks,
      lessons: lessons.filter((l) => l.author === "reflector").slice(0, 10).map((l) => ({ name: l.name, body: l.body, createdAt: l.createdAt })),
      proposals: proposals.map(publicProposal),
      reflections: reflections.map((r) => ({ id: r.id, status: r.status, answer: r.answer, createdAt: r.createdAt })),
      canRun: model !== null,
      now: now(),
    });
  });

  app.post("/api/app/learning", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const payload = (await c.req.json().catch(() => null)) as { enabled?: unknown; reflectNow?: unknown } | null;
    if (typeof payload?.enabled === "boolean") await store.setImprove(principal.uid, payload.enabled);
    const enabled = (await store.improveSettings(principal.uid)).improve;
    if (payload?.reflectNow !== true) return c.json({ enabled });
    if (!model) return c.json({ error: "no_model" }, 503);
    if (await store.hasRunningRun(principal.uid)) return c.json({ error: "busy" }, 409);
    if ((await store.hit(`runs:${principal.uid}`, 86_400_000)) > RUNS_PER_DAY) return c.json({ error: "rate_limited" }, 429);
    const runId = await startRun(principal.uid, principal.login, REFLECTOR, REFLECT_GOAL, false);
    return runId ? c.json({ enabled, runId }, 202) : c.json({ error: "busy" }, 409);
  });

  app.post("/api/app/proposals/:id", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const uid = principal.uid;
    const proposal = await store.getProposal(uid, c.req.param("id"));
    if (!proposal) return c.json({ error: "not_found" }, 404);
    const action = ((await c.req.json().catch(() => null)) as { action?: unknown } | null)?.action;
    let next: Proposal | undefined;
    if (action === "accept" && proposal.status === "waiting") {
      next = await applyProposal(uid, proposal, "web");
      if (next?.status === "stale") return c.json({ error: "changed_since", proposal: publicProposal(next) }, 409);
    } else if (action === "accept" && ["failed_gate", "stale"].includes(proposal.status)) {
      const current = (await store.getEntry(proposal.kind, uid, proposal.name))?.body ?? null;
      await store.refreshProposalBase(uid, proposal.id, current);
      next = await applyProposal(uid, { ...proposal, current }, "web");
    } else if (action === "reject" && ["waiting", "failed_gate", "stale", "queued"].includes(proposal.status)) {
      next = await store.moveProposal(uid, proposal.id, [proposal.status], { status: "rejected", decided: true });
    } else if (action === "revert" && proposal.status === "applied") {
      const reverted = await revertProposal(uid, proposal);
      if (reverted === "changed") return c.json({ error: "changed_since" }, 409);
      next = reverted;
    } else if (action === "test" && ["queued", "failed_gate", "stale"].includes(proposal.status)) {
      if (!model) return c.json({ error: "no_model" }, 503);
      let used = 0;
      for (let i = 0; i < TEST_COST_IN_RUNS; i++) used = await store.hit(`runs:${uid}`, 86_400_000);
      if (used > RUNS_PER_DAY) return c.json({ error: "rate_limited" }, 429);
      if (proposal.status === "stale") await store.refreshProposalBase(uid, proposal.id, (await store.getEntry(proposal.kind, uid, proposal.name))?.body ?? null);
      next = await store.moveProposal(uid, proposal.id, [proposal.status], { status: "testing" });
      if (next) {
        const claimed = next;
        defer(testProposal(uid, principal.login, claimed));
      }
    } else {
      return c.json({ error: "wrong_state" }, 409);
    }
    return next ? c.json({ proposal: publicProposal(next) }) : c.json({ error: "wrong_state" }, 409);
  });

  app.post("/api/app/feedback", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const payload = (await c.req.json().catch(() => null)) as { id?: unknown; score?: unknown } | null;
    if (typeof payload?.id !== "string" || (payload.score !== 1 && payload.score !== -1)) return c.json({ error: "bad_fields" }, 400);
    return (await store.scoreOutcome(principal.uid, payload.id, payload.score)) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  app.get("/cron/reflect", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    if (!model) return c.json({ reflected: 0, reason: "no_model" });
    const uids = await store.claimReflections(now() - REFLECT_EVERY_MS, AUTO_BUILDS_PER_CRON);
    const done = await Promise.allSettled(
      uids.map(async (uid) => {
        const cred = await store.credential(uid);
        if (!cred || !(await store.profile(uid))) return false;
        const id = randomBytes(12).toString("base64url");
        if (!(await store.createRun({ id, uid, agent: REFLECTOR.id, goal: REFLECT_GOAL, allowActions: false }))) return false;
        await executeRun(uid, cred.login, id, REFLECTOR, REFLECT_GOAL, false);
        return true;
      }),
    );
    return c.json({ reflected: done.filter((d) => d.status === "fulfilled" && d.value).length });
  });

  app.get("/cron/gate", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    if (!model) return c.json({ tested: 0, reason: "no_model" });
    await store.settleStaleTesting();
    const uids = await store.usersWithQueuedProposals(GATES_PER_CRON);
    const done = await Promise.allSettled(
      uids.map(async (uid) => {
        const cred = await store.credential(uid);
        const proposal = cred ? await store.nextQueuedProposal(uid) : undefined;
        if (!cred || !proposal) return false;
        await testProposal(uid, cred.login, proposal);
        return true;
      }),
    );
    return c.json({ tested: done.filter((d) => d.status === "fulfilled" && d.value).length });
  });

  const startRun = async (uid: number, login: string, profile: AgentProfile, goal: string, allowChanges: boolean, request?: Post): Promise<string | null> => {
    const id = randomBytes(12).toString("base64url");
    if (!(await store.createRun({ id, uid, agent: profile.id, goal, allowActions: allowChanges, ...(request ? { requestId: request.id } : {}) }))) return null;
    defer(executeRun(uid, login, id, profile, goal, allowChanges, request ?? null).catch((err: unknown) => console.error(`agent run crashed: ${err instanceof Error ? err.name : typeof err}`)));
    return id;
  };

  const requestRefusal = async (request: Post, tool: string, args: Record<string, unknown>): Promise<string | null> => {
    const scope = "This run works on one request, so it can only report on that request, claim work and ask you in its repository, and add new brain entries.";
    if (CREATE_WRITES.has(tool) || tool === "run_report") return null;
    if (tool === "board_release") {
      const claim = typeof args.post_id === "string" ? await store.getPost(args.post_id) : undefined;
      return claim && claim.type === "claim" && claim.authorUid === request.authorUid && claim.client === "runner" && claim.repoName === request.repoName ? null : scope;
    }
    if (tool === "work_update") return args.task_id === request.id ? null : scope;
    if (tool === "board_post") return args.type === "claim" && args.repo === request.repoName ? null : scope;
    if (tool === "board_ask") return args.repo === request.repoName ? null : scope;
    return scope;
  };

  const requestGoal = async (request: Post): Promise<string> => {
    const changes = await store.latestChangeNote(request.id);
    return clamp(
      [
        `Work on this request from ${request.authorLogin} on the repository ${request.repoName}. Its task id is ${request.id}.`,
        `Request: ${request.title}`,
        request.body ? `Details: ${clamp(request.body, 1_500)}` : "",
        changes ? `The person reviewed an earlier attempt and asked for changes: ${clamp(changes, 1_000)}` : "",
        `You can read the repository and the brain and add new brain entries, but you cannot change code, files or anything outside Company Brain.`,
        `Steps: call board_read for ${request.repoName}. Report that you started with work_update kind progress. Do what your tools allow: research, answers, plans and new brain entries. If the request needs changes you cannot make, do not say you made them: submit a plan that says exactly what to change, where and why, and that a person or a coding agent must make it. When ready, call work_update kind submitted with what you did and how to check it. If it needs a decision only a person can make, ask with board_ask and stop.`,
      ]
        .filter(Boolean)
        .join("\n"),
      MAX_GOAL + 3_000,
    );
  };

  const workRequest = async (uid: number, login: string, request: Post): Promise<string | null> => {
    if (!model) return null;
    if ((await store.hit(`request-runs:${uid}`, 86_400_000)) > REQUEST_RUNS_PER_DAY) return null;
    return startRun(uid, login, ASSISTANT, await requestGoal(request), false, request);
  };

  const workNextRequest = async (uid: number, login: string): Promise<{ runId: string; requestId: string } | null> => {
    if (!model || !(await store.autoRequests(uid)) || (await store.hasRunningRun(uid))) return null;
    const next = await store.nextWaitingRequest(uid, REQUEST_ATTEMPTS, now() - AUTO_REQUEST_MAX_AGE_MS);
    const runId = next ? await workRequest(uid, login, next) : null;
    return next && runId ? { runId, requestId: next.id } : null;
  };

  const kickRequests = (uid: number, login: string) =>
    workNextRequest(uid, login).catch((err: unknown) => {
      console.error(`request pickup failed: ${err instanceof Error ? err.name : typeof err}`);
      return null;
    });

  app.post("/api/app/requests/:id/run", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!model) return c.json({ error: "no_model" }, 503);
    const request = await store.waitingRequest(principal.uid, c.req.param("id"));
    if (!request) return c.json({ error: "wrong_state" }, 409);
    if (await store.hasRunningRun(principal.uid)) return c.json({ error: "busy" }, 409);
    if ((await store.hit(`runs:${principal.uid}`, 86_400_000)) > RUNS_PER_DAY) return c.json({ error: "rate_limited" }, 429);
    const id = await startRun(principal.uid, principal.login, ASSISTANT, await requestGoal(request), false, request);
    return id ? c.json({ id }, 202) : c.json({ error: "busy" }, 409);
  });

  app.post("/api/app/requests/auto", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const on = ((await c.req.json().catch(() => null)) as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") return c.json({ error: "bad_fields" }, 400);
    await store.setAutoRequests(principal.uid, on);
    const started = on ? await kickRequests(principal.uid, principal.login) : null;
    return c.json({ autoRequests: on, ...(started ? { runId: started.runId } : {}) });
  });

  app.get("/cron/requests", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    if (!model) return c.json({ started: 0, reason: "no_model" });
    const uids = await store.usersWithWaitingRequests(REQUEST_ATTEMPTS, now() - AUTO_REQUEST_MAX_AGE_MS, AUTO_BUILDS_PER_CRON);
    const started = await Promise.all(
      uids.map(async (uid) => {
        const cred = await store.credential(uid);
        return cred ? kickRequests(uid, cred.login) : null;
      }),
    );
    return c.json({ started: started.filter(Boolean).length });
  });

  app.get("/api/app/runs", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const agent = c.req.query("agent");
    const [runs, profiles, settings] = await Promise.all([store.listRuns(principal.uid, 20, agent), profilesOf(principal.uid), store.brainSettings(principal.uid)]);
    return c.json({
      runs,
      agents: profiles.map((p) => ({ id: p.id, name: p.name, summary: p.summary, suggestions: p.suggestions, builds: p.builds === true })),
      autoBuild: settings,
      canRun: model !== null,
      maxSteps: MAX_STEPS,
      perDay: RUNS_PER_DAY,
      now: now(),
    });
  });

  app.get("/api/app/runs/:id", async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    const run = await store.getRun(principal.uid, c.req.param("id"));
    return run ? c.json({ run, now: now() }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/api/app/runs", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    if (!model) return c.json({ error: "no_model" }, 503);
    const payload = (await c.req.json().catch(() => null)) as { agent?: unknown; goal?: unknown; allowChanges?: unknown } | null;
    const profile = (await profilesOf(principal.uid)).find((p) => p.id === payload?.agent);
    const goal = typeof payload?.goal === "string" ? cleanText(payload.goal, MAX_GOAL).trim() : "";
    if (!profile || !goal) return c.json({ error: "bad_fields" }, 400);
    if (await store.hasRunningRun(principal.uid)) return c.json({ error: "busy" }, 409);
    if ((await store.hit(`runs:${principal.uid}`, 86_400_000)) > RUNS_PER_DAY) return c.json({ error: "rate_limited" }, 429);
    const id = await startRun(principal.uid, principal.login, profile, goal, payload?.allowChanges === true);
    return id ? c.json({ id }, 202) : c.json({ error: "busy" }, 409);
  });

  app.post("/api/app/build", jsonLimit, async (c) => {
    const principal = await session(c);
    if (!principal) return c.json({ error: "sign_in" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "blocked" }, 403);
    const payload = (await c.req.json().catch(() => null)) as { autoBuild?: unknown; now?: unknown } | null;
    if (typeof payload?.autoBuild === "boolean") await store.setAutoBuild(principal.uid, payload.autoBuild);
    if (payload?.now !== true) return c.json({ autoBuild: await store.brainSettings(principal.uid) });
    if (!model) return c.json({ error: "no_model" }, 503);
    if (await store.hasRunningRun(principal.uid)) return c.json({ error: "busy" }, 409);
    if ((await store.hit(`runs:${principal.uid}`, 86_400_000)) > RUNS_PER_DAY) return c.json({ error: "rate_limited" }, 429);
    const id = await startRun(principal.uid, principal.login, LIBRARIAN, LIBRARIAN_GOAL, false);
    return id ? c.json({ id, autoBuild: await store.brainSettings(principal.uid) }, 202) : c.json({ error: "busy" }, 409);
  });

  app.get("/cron/build", async (c) => {
    if (!cronAuthorized(c)) return c.text("Not found.", 404);
    if (!model) return c.json({ built: 0, reason: "no_model" });
    const uids = await store.claimAutoBuilds(now() - AUTO_BUILD_EVERY_MS, AUTO_BUILDS_PER_CRON);
    const builds = await Promise.allSettled(
      uids.map(async (uid) => {
        const cred = await store.credential(uid);
        if (!cred || !(await store.profile(uid))) return false;
        const id = randomBytes(12).toString("base64url");
        if (!(await store.createRun({ id, uid, agent: LIBRARIAN.id, goal: LIBRARIAN_GOAL, allowActions: false }))) {
          await store.releaseAutoBuild(uid);
          return false;
        }
        await executeRun(uid, cred.login, id, LIBRARIAN, LIBRARIAN_GOAL, false);
        if ((await store.getRun(uid, id))?.status === "failed") await store.releaseAutoBuild(uid);
        return true;
      }),
    );
    return c.json({ built: builds.filter((b) => b.status === "fulfilled" && b.value).length });
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
        return rpcError(c, 401, -32001, `Unauthorized. Sign in from your MCP client, or create an agent token at ${config.publicUrl}.`, {
          "www-authenticate": `Bearer realm="companybrain-board", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp"`,
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
          const tool = String(call.params?.name ?? "");
          const subject = auditSubject(tool, (call.params?.arguments ?? {}) as Record<string, unknown>);
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
