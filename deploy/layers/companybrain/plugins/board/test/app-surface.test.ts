import assert from "node:assert/strict";
import test from "node:test";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

test("the app page and its bundle need a session, and ship a policy that allows only their own script", async () => {
  const h = await buildApp();
  assert.equal((await h.app.fetch(new Request(`${ORIGIN}/app`))).status, 302, "signed out goes home");
  assert.equal((await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`))).status, 401);

  const cookie = await sessionCookie(h, "gh-alice");
  const page = await h.app.fetch(new Request(`${ORIGIN}/app`, { headers: { cookie } }));
  assert.equal(page.status, 200);
  const csp = page.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline' https:\/\/cdn/);
  assert.match(csp, /frame-ancestors 'none'/);

  const bundle = await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`, { headers: { cookie } }));
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type") ?? "", /text\/javascript/);
  assert.ok((await bundle.text()).length > 1000, "the bundle is served, not empty");
});

test("the app reads only what the signed-in person may read", async (t) => {
  const h = await buildApp();
  const alice = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(alice, "board_post", { repo: "acme/app", type: "finding", title: "Only alice may see this", body: "" });

  const aliceCookie = await sessionCookie(h, "gh-alice");
  const mine = await (await h.app.fetch(new Request(`${ORIGIN}/api/app/me`, { headers: { cookie: aliceCookie } }))).json();
  assert.equal((mine as { login: string }).login, "alice");
  assert.ok(Array.isArray((mine as { repos: unknown[] }).repos));

  const board = await h.app.fetch(new Request(`${ORIGIN}/api/app/board?repo=acme/app`, { headers: { cookie: aliceCookie } }));
  assert.equal(board.status, 200);
  const view = (await board.json()) as { repo: string; moderator: boolean; recent: Array<{ title: string }> };
  assert.equal(view.repo, "acme/app");
  assert.equal(view.moderator, false, "write access is not moderation");
  assert.ok(view.recent.some((p) => p.title === "Only alice may see this"));

  const bobCookie = await sessionCookie(h, "gh-bob");
  const denied = await h.app.fetch(new Request(`${ORIGIN}/api/app/board?repo=acme/app`, { headers: { cookie: bobCookie } }));
  assert.equal(denied.status, 404, "a read-only collaborator is refused");
  assert.doesNotMatch(await denied.text(), /Only alice may see this/);

  const signedOut = await h.app.fetch(new Request(`${ORIGIN}/api/app/board?repo=acme/app`));
  assert.equal(signedOut.status, 401);
});
