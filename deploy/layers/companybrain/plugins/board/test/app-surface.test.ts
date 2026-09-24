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

test("the brain endpoint serves only the signed-in person's entries, and caps the page", async (t) => {
  const h = await buildApp();
  await h.store.putEntry({ kind: "memory", ownerUid: 1, name: "alice note", body: "hers" });
  await h.store.putEntry({ kind: "project", ownerUid: 2, name: "bob note", body: "his" });

  const signedOut = await h.app.fetch(new Request(`${ORIGIN}/api/app/brain`));
  assert.equal(signedOut.status, 401, "it needs a session");

  const res = await h.app.fetch(new Request(`${ORIGIN}/api/app/brain`, { headers: { cookie: await sessionCookie(h, "gh-alice") } }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { kinds: Record<string, Array<{ name: string }> | undefined>; limit: number };
  assert.deepEqual(body.kinds.memory?.map((e) => e.name), ["alice note"]);
  assert.deepEqual(body.kinds.project, [], "bob's project is not in alice's brain");
  assert.deepEqual(body.kinds.skill, [], "every kind is present even when empty");

  for (let i = 0; i < body.limit + 10; i++) await h.store.putEntry({ kind: "skill", ownerUid: 1, name: `skill ${i}`, body: "x" });
  const big = await h.app.fetch(new Request(`${ORIGIN}/api/app/brain`, { headers: { cookie: await sessionCookie(h, "gh-alice") } }));
  const page = (await big.json()) as { kinds: Record<string, unknown[]>; limit: number };
  assert.equal(page.kinds.skill?.length, page.limit, "the response is bounded rather than growing without limit");
});

test("the app bundle revalidates instead of re-downloading on every load", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");

  const first = await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`, { headers: { cookie } }));
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag ?? "", /^"[\w-]{27}"$/, "it carries a content-derived etag");
  assert.doesNotMatch(first.headers.get("cache-control") ?? "", /no-store/, "no-store would force a full re-download every time");
  assert.ok((await first.text()).length > 1000);

  const again = await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`, { headers: { cookie, "if-none-match": etag as string } }));
  assert.equal(again.status, 304, "a returning browser gets a 304, not the whole bundle");
  assert.equal(await again.text(), "", "and no body");

  const stale = await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`, { headers: { cookie, "if-none-match": '"deployed-before"' } }));
  assert.equal(stale.status, 200, "a stale etag from an older deploy still gets the new bundle");

  const signedOut = await h.app.fetch(new Request(`${ORIGIN}/app/bundle.js`, { headers: { "if-none-match": etag as string } }));
  assert.equal(signedOut.status, 401, "revalidation does not bypass the session check");
});

test("the app can write and remove its own brain entries, and cross-site pages cannot", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    h.app.fetch(
      new Request(`${ORIGIN}/api/app/brain`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  const created = await post({ kind: "memory", name: "written from the app", body: "a person typed this" });
  assert.equal(created.status, 200);
  assert.equal(((await created.json()) as { created: boolean }).created, true);
  assert.equal((await h.store.getEntry("memory", 1, "written from the app"))?.body, "a person typed this");

  const replaced = await post({ kind: "memory", name: "written from the app", body: "edited" });
  assert.equal(((await replaced.json()) as { created: boolean }).created, false, "saving the same name edits rather than duplicates");

  assert.equal((await post({ kind: "nonsense", name: "x", body: "y" })).status, 400, "an unknown kind is refused");
  assert.equal((await post({ kind: "memory", name: "x" })).status, 400, "a missing body is refused");
  assert.equal((await post({ kind: "memory", name: "x", body: "y" }, { origin: "https://evil.example" })).status, 403, "a cross-site page cannot write");

  const signedOut = await h.app.fetch(
    new Request(`${ORIGIN}/api/app/brain`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }),
  );
  assert.equal(signedOut.status, 401);

  const del = (query: string, headers: Record<string, string> = {}) =>
    h.app.fetch(new Request(`${ORIGIN}/api/app/brain?${query}`, { method: "DELETE", headers: { cookie, origin: ORIGIN, ...headers } }));

  assert.equal((await del("kind=memory&name=written from the app", { origin: "https://evil.example" })).status, 403, "nor delete");
  assert.equal((await del("kind=memory&name=written from the app")).status, 200);
  assert.equal(await h.store.getEntry("memory", 1, "written from the app"), null);
  assert.equal((await del("kind=memory&name=written from the app")).status, 404, "deleting it twice says so");
});

test("one person cannot delete another person's entry through the app", async (t) => {
  const h = await buildApp();
  await h.store.putEntry({ kind: "memory", ownerUid: 1, name: "alice only", body: "hers" });

  const bob = await sessionCookie(h, "gh-bob");
  const res = await h.app.fetch(
    new Request(`${ORIGIN}/api/app/brain?kind=memory&name=alice only`, { method: "DELETE", headers: { cookie: bob, origin: ORIGIN } }),
  );
  assert.equal(res.status, 404, "it reads as absent, never as forbidden, so existence does not leak");
  assert.ok(await h.store.getEntry("memory", 1, "alice only"), "and it is still there");
});
