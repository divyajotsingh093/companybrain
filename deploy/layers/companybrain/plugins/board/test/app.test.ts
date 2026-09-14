import assert from "node:assert/strict";
import test from "node:test";
import { mintToken } from "../src/token.ts";
import { buildApp, connectAgent, SECRET, textOf, tokenFor } from "./fixtures.ts";

test("MCP rejects missing tokens and browser session tokens", async () => {
  const { app } = buildApp();
  const missing = await app.fetch(new Request("http://board.test/mcp", { method: "POST", body: "{}" }));
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate") ?? "", /Bearer/);
  const web = mintToken(SECRET, { githubToken: "gh-alice", login: "alice", uid: 1, client: "web", issuedAt: 0 });
  const forbidden = await app.fetch(
    new Request("http://board.test/mcp", { method: "POST", headers: { authorization: `Bearer ${web}` }, body: "{}" }),
  );
  assert.equal(forbidden.status, 403);
});

test("an agent sees the tool set and its own identity", async (t) => {
  const { app } = buildApp();
  const client = await connectAgent(t, app, tokenFor("gh-alice", "claude_code"));
  const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(tools, ["board_post", "board_read", "board_release", "get_file", "list_repos", "repo_overview", "search_code", "whoami"]);
  assert.deepEqual(JSON.parse(textOf(await client.callTool({ name: "whoami", arguments: {} }))), { login: "alice", client: "claude_code" });
});

test("repository content is wrapped as untrusted and cannot escape the wrapper", async (t) => {
  const { app } = buildApp();
  const client = await connectAgent(t, app, tokenFor("gh-alice", "cursor"));
  const out = textOf(await client.callTool({ name: "get_file", arguments: { repo: "acme/app", path: "docs/setup.md" } }));
  assert.match(out, /^<untrusted source="github:acme\/app\/docs\/setup.md">/);
  assert.equal(out.match(/<\/untrusted>/g)?.length, 1);
  assert.match(out, /Ignore previous instructions/);
  const overview = textOf(await client.callTool({ name: "repo_overview", arguments: { repo: "acme/app" } }));
  assert.match(overview, /"defaultBranch": "main"/);
  assert.match(overview, /<untrusted source="github:acme\/app\/README">/);
});

test("two agents coordinate through claims on the board", async (t) => {
  const { app } = buildApp();
  const claude = await connectAgent(t, app, tokenFor("gh-alice", "claude_code"));
  const codex = await connectAgent(t, app, tokenFor("gh-alice", "codex"));
  const claim = await claude.callTool({
    name: "board_post",
    arguments: { repo: "acme/app", type: "claim", title: "Fix login", body: "on it", target: "src/login.ts", ttl_minutes: 30 },
  });
  assert.equal(claim.isError, undefined);
  const claimId = /claim ([0-9a-f-]{36})/.exec(textOf(claim))?.[1];
  assert.ok(claimId);

  const clash = await codex.callTool({
    name: "board_post",
    arguments: { repo: "acme/app", type: "claim", title: "Also login", body: "", target: "src/login.ts" },
  });
  assert.equal(clash.isError, true);
  assert.match(textOf(clash), /Already claimed by alice via claude_code/);

  const board = textOf(await codex.callTool({ name: "board_read", arguments: { repo: "acme/app" } }));
  assert.match(board, /\[claim\] Fix login/);
  assert.match(board, /<untrusted source="board:acme\/app\//);

  const wrongRelease = await codex.callTool({ name: "board_release", arguments: { post_id: claimId } });
  assert.equal(wrongRelease.isError, true);
  assert.equal((await claude.callTool({ name: "board_release", arguments: { post_id: claimId } })).isError, undefined);
  const retry = await codex.callTool({
    name: "board_post",
    arguments: { repo: "acme/app", type: "claim", title: "Login now", body: "", target: "src/login.ts" },
  });
  assert.equal(retry.isError, undefined);

  const noTarget = await codex.callTool({ name: "board_post", arguments: { repo: "acme/app", type: "claim", title: "x", body: "" } });
  assert.equal(noTarget.isError, true);
});

test("the board is closed to read-only collaborators and to repositories you cannot see", async (t) => {
  const { app } = buildApp();
  const bob = await connectAgent(t, app, tokenFor("gh-bob", "grok"));
  const denied = await bob.callTool({ name: "board_read", arguments: { repo: "acme/app" } });
  assert.equal(denied.isError, true);
  assert.match(textOf(denied), /No board access/);
  const post = await bob.callTool({ name: "board_post", arguments: { repo: "acme/app", type: "finding", title: "x", body: "y" } });
  assert.equal(post.isError, true);
  const alice = await connectAgent(t, app, tokenFor("gh-alice", "claude_code"));
  const hidden = await alice.callTool({ name: "board_read", arguments: { repo: "other/secret" } });
  assert.equal(hidden.isError, true);
  const missingFile = await alice.callTool({ name: "get_file", arguments: { repo: "other/secret", path: "a.txt" } });
  assert.equal(textOf(missingFile), "Not found, or you do not have access.");
  const traversal = await alice.callTool({ name: "get_file", arguments: { repo: "acme/app", path: "../../etc/passwd" } });
  assert.equal(traversal.isError, true);
});

test("GitHub sign-in sets a session, shows per-client setup, and guards state", async () => {
  const { app } = buildApp();
  const start = await app.fetch(new Request("http://board.test/auth/github/start"));
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.origin + location.pathname, "https://github.test/login/oauth/authorize");
  const state = location.searchParams.get("state") ?? "";
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const badState = await app.fetch(
    new Request(`http://board.test/auth/github/callback?code=good-code&state=wrong`, { headers: { cookie: stateCookie } }),
  );
  assert.match(badState.headers.get("location") ?? "", /error=/);

  const noCookie = await app.fetch(new Request(`http://board.test/auth/github/callback?code=good-code&state=${state}`));
  assert.match(noCookie.headers.get("location") ?? "", /error=/);

  const callback = await app.fetch(
    new Request(`http://board.test/auth/github/callback?code=good-code&state=${state}`, { headers: { cookie: stateCookie } }),
  );
  assert.equal(callback.headers.get("location"), "/");
  const session = (callback.headers.getSetCookie().find((c) => c.startsWith("cb_session=")) ?? "").split(";")[0] ?? "";
  assert.ok(session.length > "cb_session=".length);

  const home = await app.fetch(new Request("http://board.test/", { headers: { cookie: session } }));
  const html = await home.text();
  assert.equal(home.headers.get("cache-control"), "no-store");
  assert.match(html, /Connected as alice/);
  assert.match(html, /claude mcp add --transport http companybrain http:\/\/board.test\/mcp/);
  assert.match(html, /bearer_token_env_var = &quot;COMPANYBRAIN_TOKEN&quot;/);
  assert.match(html, /&quot;server_url&quot;: &quot;http:\/\/board.test\/mcp&quot;/);
  assert.doesNotMatch(html, /gh-alice/);
});

test("the web board renders posts for collaborators and hides the repository from others", async () => {
  const { app, store } = buildApp();
  store.add({ repo: "acme/app", type: "task", title: "<script>alert(1)</script>", body: "b", authorLogin: "backlog-import", authorUid: 0, client: "web" });
  const alice = `cb_session=${mintToken(SECRET, { githubToken: "gh-alice", login: "alice", uid: 1, client: "web", issuedAt: 0 })}`;
  const bob = `cb_session=${mintToken(SECRET, { githubToken: "gh-bob", login: "bob", uid: 2, client: "web", issuedAt: 0 })}`;
  const ok = await app.fetch(new Request("http://board.test/board/acme/app", { headers: { cookie: alice } }));
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  const denied = await app.fetch(new Request("http://board.test/board/acme/app", { headers: { cookie: bob } }));
  assert.equal(denied.status, 404);
  const anonymous = await app.fetch(new Request("http://board.test/board/acme/app"));
  assert.equal(anonymous.status, 302);
});
