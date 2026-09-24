import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, ORIGIN, sessionCookie } from "./fixtures.ts";

const index = (h: Awaited<ReturnType<typeof buildApp>>, cookie: string, repo: unknown, headers: Record<string, string> = {}) =>
  h.app.fetch(
    new Request(`${ORIGIN}/api/app/sources`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      body: JSON.stringify({ repo }),
    }),
  );

test("indexing a repository makes its documentation answerable", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");

  const res = await index(h, cookie, "acme/app");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { repo: string; indexed: number };
  assert.equal(body.repo, "acme/app");
  assert.ok(body.indexed > 0, "at least the README was captured");

  const listed = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/sources`, { headers: { cookie } }))).json()) as {
    sources: Array<{ repoName: string; documents: number }>;
  };
  assert.equal(listed.sources[0]?.repoName, "acme/app");
  assert.equal(listed.sources[0]?.documents, body.indexed, "what it reports indexing is what it stored");
});

test("re-indexing replaces the previous pass instead of doubling it", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");

  const first = (await (await index(h, cookie, "acme/app")).json()) as { indexed: number };
  const second = (await (await index(h, cookie, "acme/app")).json()) as { indexed: number };
  assert.equal(second.indexed, first.indexed);

  const listed = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/sources`, { headers: { cookie } }))).json()) as {
    sources: Array<{ documents: number }>;
  };
  assert.equal(listed.sources[0]?.documents, first.indexed, "one copy, not two");
});

test("a person cannot index a repository they cannot reach", async (t) => {
  const h = await buildApp();
  assert.equal((await index(h, await sessionCookie(h, "gh-bob"), "acme/app")).status, 404, "read-only access is not enough to index");

  const listed = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/sources`, { headers: { cookie: await sessionCookie(h, "gh-bob") } }))).json()) as {
    sources: unknown[];
  };
  assert.equal(listed.sources.length, 0);
});

test("indexing is refused for signed-out and cross-site callers", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  assert.equal(
    (await h.app.fetch(new Request(`${ORIGIN}/api/app/sources`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }))).status,
    401,
  );
  assert.equal((await index(h, cookie, "acme/app", { origin: "https://evil.example" })).status, 403);
  assert.equal((await index(h, cookie, 42)).status, 400);
});

test("an empty repository indexes to nothing rather than failing", async (t) => {
  const h = await buildApp();
  const res = await index(h, await sessionCookie(h, "gh-alice"), "acme/empty");
  assert.notEqual(res.status, 500, "an empty repo is a normal case, not a crash");
});
