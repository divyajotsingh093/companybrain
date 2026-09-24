import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, ORIGIN, sessionCookie } from "./fixtures.ts";

type H = Awaited<ReturnType<typeof buildApp>>;

const cron = (h: H, secret = "cron-secret-for-tests") =>
  h.app.fetch(new Request(`${ORIGIN}/cron/reindex`, { headers: { authorization: `Bearer ${secret}` } }));

const sources = async (h: H, cookie: string) =>
  ((await (await h.app.fetch(new Request(`${ORIGIN}/api/app/sources`, { headers: { cookie } }))).json()) as {
    sources: Array<{ repoName: string; documents: number; indexedAt: number }>;
  }).sources;

const index = (h: H, cookie: string, repo: string) =>
  h.app.fetch(
    new Request(`${ORIGIN}/api/app/sources`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
  );

test("the reindex job only runs for the scheduler", async () => {
  const h = await buildApp();
  assert.equal((await h.app.fetch(new Request(`${ORIGIN}/cron/reindex`))).status, 404);
  assert.equal((await cron(h, "wrong")).status, 404);
  assert.equal((await cron(h)).status, 200);
});

test("a source that has gone stale is refreshed, and a fresh one is left alone", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  await index(h, cookie, "acme/app");
  const first = (await sources(h, cookie))[0];
  assert.ok(first);

  const early = (await (await cron(h)).json()) as { checked: number };
  assert.equal(early.checked, 0, "a source indexed moments ago is not touched");

  h.clock.now += 21 * 3_600_000;
  const report = (await (await cron(h)).json()) as { checked: number; refreshed: number; dropped: number };
  assert.deepEqual({ checked: report.checked, refreshed: report.refreshed, dropped: report.dropped }, { checked: 1, refreshed: 1, dropped: 0 });

  const after = (await sources(h, cookie))[0];
  assert.equal(after?.indexedAt, h.clock.now, "it now reads as freshly indexed");
  assert.equal(after?.documents, first.documents, "refreshing replaces rather than duplicates");
});

test("losing access to a repository deletes your copies of its documents, not just hides them", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  await h.store.putDocument({ ownerUid: 1, repoId: 999, repoName: "secret-org/private-thing", path: "docs/keys.md", title: "Keys", body: "vault path prod/staging" });

  h.clock.now += 21 * 3_600_000;
  const report = (await (await cron(h)).json()) as { dropped: number };
  assert.equal(report.dropped, 1);

  assert.equal((await h.store.search(1, "vault", { allow: async () => true })).length, 0, "the text is gone from the database, even to a caller that skips the access check");
  assert.equal((await sources(h, cookie)).length, 0);
});

test("a source whose owner has disconnected is cleaned up", async () => {
  const h = await buildApp();
  await h.store.putDocument({ ownerUid: 77, repoId: 100, repoName: "acme/app", path: "README.md", title: "acme", body: "orphaned copy" });

  h.clock.now += 21 * 3_600_000;
  const report = (await (await cron(h)).json()) as { dropped: number };
  assert.equal(report.dropped, 1, "no stored credential means no way to re-check access, so the copy goes");
});

test("re-indexing replaces a repository in one step", async () => {
  const h = await buildApp();
  await h.store.replaceRepo(1, { repoId: 100, repoName: "acme/app" }, [
    { path: "a.md", title: "A", body: "first" },
    { path: "b.md", title: "B", body: "second" },
  ]);
  const stored = await h.store.replaceRepo(1, { repoId: 100, repoName: "acme/app" }, [{ path: "c.md", title: "C", body: "third" }]);
  assert.equal(stored, 1);

  const left = (await h.store.sources(1))[0];
  assert.equal(left?.documents, 1, "documents that disappeared from the repository disappear from the brain");
  assert.equal((await h.store.search(1, "first", { allow: async () => true })).length, 0);
});
