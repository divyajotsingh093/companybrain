import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, ORIGIN, sessionCookie } from "./fixtures.ts";

type H = Awaited<ReturnType<typeof buildApp>>;

const upload = (h: H, cookie: string, body: unknown, headers: Record<string, string> = {}) =>
  h.app.fetch(
    new Request(`${ORIGIN}/api/app/files`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

const ask = (h: H, cookie: string, question: string) =>
  h.app.fetch(
    new Request(`${ORIGIN}/api/app/ask`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }),
  );

test("an uploaded document becomes knowledge you can ask about", async () => {
  const h = await buildApp({}, { model: async () => "Use the vendor portal [1]." });
  const cookie = await sessionCookie(h, "gh-alice");

  const res = await upload(h, cookie, { name: "expenses.md", content: "# Expense policy\nClaims over 200 need a receipt uploaded to the vendor portal." });
  assert.equal(res.status, 200);

  const body = (await (await ask(h, cookie, "how do I claim an expense?")).json()) as { sources: Array<{ title: string; source: string }> };
  assert.ok(body.sources.some((s) => s.title === "Expense policy"), "the heading becomes its title");

  const files = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/files`, { headers: { cookie } }))).json()) as { files: Array<{ name: string }> };
  assert.deepEqual(files.files.map((f) => f.name), ["expenses.md"]);
});

test("uploads are private to the person who added them", async () => {
  const h = await buildApp({}, { model: async () => "x [1]" });
  await upload(h, await sessionCookie(h, "gh-alice"), { name: "salaries.md", content: "Salary bands for the platform team." });

  const carol = await sessionCookie(h, "gh-carol");
  const body = (await (await ask(h, carol, "what are the salary bands?")).json()) as { sources: unknown[] };
  assert.equal(body.sources.length, 0, "carol's question finds nothing of alice's");
  const files = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/files`, { headers: { cookie: carol } }))).json()) as { files: unknown[] };
  assert.equal(files.files.length, 0);

  const del = await h.app.fetch(new Request(`${ORIGIN}/api/app/files?name=salaries.md`, { method: "DELETE", headers: { cookie: carol, origin: ORIGIN } }));
  assert.equal(del.status, 404, "and she cannot delete it");
});

test("re-uploading the same name replaces it, and deleting removes it from answers", async () => {
  const h = await buildApp({}, { model: async () => "x [1]" });
  const cookie = await sessionCookie(h, "gh-alice");

  await upload(h, cookie, { name: "oncall.md", content: "Primary on call is Priya." });
  await upload(h, cookie, { name: "oncall.md", content: "Primary on call is Marcus." });
  const files = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/files`, { headers: { cookie } }))).json()) as { files: unknown[] };
  assert.equal(files.files.length, 1, "one file, not two");
  assert.equal((await h.store.search(1, "Priya", { allow: async () => true })).length, 0, "the old version is gone");

  const del = await h.app.fetch(new Request(`${ORIGIN}/api/app/files?name=oncall.md`, { method: "DELETE", headers: { cookie, origin: ORIGIN } }));
  assert.equal(del.status, 200);
  assert.equal((await h.store.search(1, "Marcus", { allow: async () => true })).length, 0);
});

test("only text formats are accepted, and names cannot smuggle paths", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");

  assert.equal((await upload(h, cookie, { name: "report.pdf", content: "%PDF-1.7" })).status, 415);
  assert.equal((await upload(h, cookie, { name: "notes.md", content: "   " })).status, 400);
  assert.equal((await upload(h, cookie, { name: "notes.md", content: "x".repeat(40_001) })).status, 400);
  assert.equal((await upload(h, cookie, { name: "notes.md" })).status, 400);

  const sneaky = await upload(h, cookie, { name: "../../etc/team.md", content: "Team list." });
  assert.equal(sneaky.status, 200);
  assert.equal(((await sneaky.json()) as { name: string }).name, "team.md", "only the file name is kept");
});

test("uploading is refused for signed-out and cross-site callers", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  assert.equal((await upload(h, "", { name: "a.md", content: "x" })).status, 401);
  assert.equal((await upload(h, cookie, { name: "a.md", content: "x" }, { origin: "https://evil.example" })).status, 403);
});

test("the reindex job never tries to fetch an upload from GitHub", async () => {
  const h = await buildApp();
  await upload(h, await sessionCookie(h, "gh-alice"), { name: "handbook.md", content: "Our handbook." });
  h.clock.now += 48 * 3_600_000;

  const report = (await (await h.app.fetch(new Request(`${ORIGIN}/cron/reindex`, { headers: { authorization: "Bearer cron-secret-for-tests" } }))).json()) as {
    checked: number;
  };
  assert.equal(report.checked, 0, "uploads are not a repository, so there is nothing to refresh");
  assert.equal((await h.store.listUploads(1)).length, 1, "and the upload survives");
});
