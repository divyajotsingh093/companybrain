import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { createGitHub, type Fetch, MAX_README_BYTES } from "../src/github.ts";
import { ACTIVE_AGENT_TOKENS_PER_USER, normaliseTarget, openStore, POSTS_PER_USER_PER_HOUR } from "../src/store.ts";
import { NO_BOARD } from "../src/mcp.ts";
import { agentToken, buildApp, call, connectAgent, counters, fakeGitHub, ORIGIN, sessionCookie } from "./fixtures.ts";

const mcpHeaders = (token: string) => ({ "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` });
const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

test("a huge README is read only up to the cap", async (t) => {
  const github = createGitHub("gh-alice", { apiUrl: "https://api.github.test", fetch: fakeGitHub });
  const readme = (await github.readme("acme/huge")) ?? "";
  assert.equal(readme.length, MAX_README_BYTES);
  const h = buildApp();
  const alice = await connectAgent(t, h, agentToken(h, "gh-alice", "claude_code"));
  assert.equal((await call(alice, "repo_overview", { repo: "acme/huge" })).isError, false);
});

test("GitHub requests never follow redirects", async () => {
  const seen: Array<string | undefined> = [];
  const spy: Fetch = async (input, init) => {
    seen.push(init?.redirect);
    return fakeGitHub(input, init);
  };
  const github = createGitHub("gh-alice", { apiUrl: "https://api.github.test", fetch: spy });
  await github.repo("acme/app");
  await github.readme("acme/app");
  assert.ok(seen.length >= 2 && seen.every((r) => r === "manual"), JSON.stringify(seen));
});

test("a repository answering under a different name is treated as moved", async (t) => {
  const h = buildApp();
  const alice = await connectAgent(t, h, agentToken(h, "gh-alice", "claude_code"));
  assert.equal((await call(alice, "repo_overview", { repo: "acme/alias" })).text, "This repository has moved. Use its current owner/name.");
  assert.equal((await call(alice, "board_read", { repo: "acme/alias" })).text, NO_BOARD);
});

test("unexpected failures return a generic message, never raw exception text", async (t) => {
  const h = buildApp();
  const alice = await connectAgent(t, h, agentToken(h, "gh-alice", "claude_code"));
  const result = await call(alice, "repo_overview", { repo: "acme/garbage" });
  assert.equal(result.text, "Something went wrong on the board server. Try again shortly.");
});

test("claims on a renamed repository can still be released, but not across repositories", async (t) => {
  const h = buildApp();
  const moved = h.store.addPost({ repoId: 102, repoName: "acme/old-name", type: "claim", title: "c", body: "", target: "x", authorLogin: "alice", authorUid: 1, client: "claude_code" });
  const foreign = h.store.addPost({ repoId: 998, repoName: "acme/app", type: "claim", title: "c", body: "", target: "y", authorLogin: "carol", authorUid: 3, client: "cursor" });
  assert.ok(moved.ok && foreign.ok);
  const carol = await connectAgent(t, h, agentToken(h, "gh-carol", "cursor"));
  assert.equal((await call(carol, "board_release", { post_id: moved.post.id })).text, `Released claim ${moved.post.id}.`);
  assert.equal((await call(carol, "board_release", { post_id: foreign.post.id })).text, NO_BOARD);
});

test("the permission fallback ignores an answer for a different user id", async () => {
  const github = createGitHub("gh-dave", { apiUrl: "https://api.github.test", fetch: fakeGitHub });
  assert.equal(await github.collaboratorRole("acme/app", "dave", 4), "write");
  assert.equal(await github.collaboratorRole("acme/app", "dave", 99), "none");
});

test("agent tokens are capped per user and rate limits are shared across a user's tokens", async () => {
  const h = buildApp({ requestsPerMinute: 2 });
  const cookie = sessionCookie(h, "gh-alice");
  const form = { "content-type": "application/x-www-form-urlencoded", cookie, origin: ORIGIN };
  for (let i = 0; i < ACTIVE_AGENT_TOKENS_PER_USER; i++) {
    const res = await h.app.fetch(new Request(`${ORIGIN}/tokens`, { method: "POST", headers: form, body: "client=codex" }));
    assert.equal(res.status, 200, `token ${i}`);
  }
  const over = await h.app.fetch(new Request(`${ORIGIN}/tokens`, { method: "POST", headers: form, body: "client=codex" }));
  assert.equal(over.status, 429);

  const fresh = buildApp({ requestsPerMinute: 2 });
  const tokens = [0, 1, 2].map(() => agentToken(fresh, "gh-bob", "grok"));
  const statuses = [];
  for (const token of tokens) {
    statuses.push((await fresh.app.fetch(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: mcpHeaders(token), body: listTools }))).status);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test("form routes reject oversized bodies and cross-site or opaque origins", async () => {
  const h = buildApp();
  const cookie = sessionCookie(h, "gh-alice");
  const big = await h.app.fetch(
    new Request(`${ORIGIN}/tokens`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: ORIGIN }, body: `client=codex&pad=${"x".repeat(10_000)}` }),
  );
  assert.equal(big.status, 413);
  for (const origin of ["null", "https://evil.example", `${ORIGIN}/`]) {
    const res = await h.app.fetch(new Request(`${ORIGIN}/tokens`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin }, body: "client=codex" }));
    assert.equal(res.status, 403, origin);
  }
});

test("revoking everything also deletes the stored GitHub credential", async () => {
  const h = buildApp();
  const cookie = sessionCookie(h, "gh-alice");
  assert.ok(h.store.credential(1));
  await h.app.fetch(new Request(`${ORIGIN}/tokens/revoke-all`, { method: "POST", headers: { cookie, origin: ORIGIN } }));
  assert.equal(h.store.credential(1), null);
});

test("refresh outages are reported as unavailable and keep the refresh token; rejected refresh tokens are dropped", async (t) => {
  const h = buildApp();
  const token = agentToken(h, "gh-alice", "claude_code");
  const seal = (refreshToken: string) =>
    h.auth.saveGrant(1, "alice", { accessToken: "gh-alice", expiresAt: h.clock.now - 1, refreshToken, refreshExpiresAt: h.clock.now + 86_400_000 });
  const alice = await connectAgent(t, h, token);

  seal("refresh-down");
  assert.equal((await call(alice, "list_repos", {})).text, "GitHub is unavailable right now. Try again shortly.");
  assert.notEqual(h.store.credential(1)?.refreshSealed, null);

  seal("refresh-bogus");
  counters.refreshes = 0;
  assert.equal((await call(alice, "list_repos", {})).text, `GitHub authorization expired or was revoked. Reconnect at ${ORIGIN}.`);
  assert.equal(h.store.credential(1)?.refreshSealed, null);
  await call(alice, "list_repos", {});
  assert.equal(counters.refreshes, 1);
});

test("HSTS is sent on https deployments", async () => {
  const h = buildApp({ publicUrl: "https://board.example.com" });
  const res = await h.app.fetch(new Request("https://board.example.com/"));
  assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=/);
});

test("per-user quotas span repositories, and old findings are purged or capped", () => {
  let clock = 5_000_000_000;
  const store = openStore(":memory:", () => clock);
  const base = { body: "b", authorLogin: "alice", authorUid: 1, client: "claude_code", type: "finding" as const };
  let accepted = 0;
  for (let repo = 1; repo <= 5; repo++) {
    for (let i = 0; i < 50; i++) if (store.addPost({ ...base, repoId: repo, repoName: `a/r${repo}`, title: `f${i}` }).ok) accepted++;
  }
  assert.equal(accepted, POSTS_PER_USER_PER_HOUR);
  clock += 181 * 24 * 3_600_000;
  assert.equal(store.purge().posts, POSTS_PER_USER_PER_HOUR);
  store.close();
});

test("claim targets normalise dot segments and leading slashes", () => {
  assert.equal(normaliseTarget("/src/login.ts"), "src/login.ts");
  assert.equal(normaliseTarget("src/./login.ts"), "src/login.ts");
  assert.equal(normaliseTarget("src/../src/login.ts"), "src/login.ts");
  assert.equal(normaliseTarget("harness #1: Sync the fork"), "harness #1: Sync the fork");
});

test("numeric settings must be positive numbers", () => {
  const secret = "x".repeat(40);
  assert.throws(() => loadConfig({ BOARD_SECRET: secret, BOARD_REQUESTS_PER_MINUTE: "abc" }), /BOARD_REQUESTS_PER_MINUTE/);
  assert.throws(() => loadConfig({ BOARD_SECRET: secret, BOARD_TOKEN_TTL_DAYS: "0" }), /BOARD_TOKEN_TTL_DAYS/);
});
