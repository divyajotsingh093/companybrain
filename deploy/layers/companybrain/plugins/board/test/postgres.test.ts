import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import { createAuth } from "../src/auth.ts";
import { createPool, postgres } from "../src/db.ts";
import { MAX_ENTRIES_PER_KIND, openStore, type Store } from "../src/store.ts";
import { seedStarterKit } from "../src/starter.ts";
import { counters, fakeGitHub, testConfig } from "./fixtures.ts";

const url = process.env.TEST_DATABASE_URL;
const schema = `board_test_${randomBytes(6).toString("hex")}`;
const pools: pg.Pool[] = [];
const CONNECT_MS = 30_000;

function instance(now: () => number = Date.now): Store {
  const pool = createPool(url as string, CONNECT_MS);
  pool.on("connect", (client) => {
    client.query(`SET search_path TO ${schema}`).catch(() => undefined);
  });
  pools.push(pool);
  return openStore(postgres(pool), now);
}

test("real Postgres: locks hold across separate connection pools", { skip: !url && "set TEST_DATABASE_URL to run" }, async (t) => {
  const admin = createPool(url as string, CONNECT_MS);
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const stores = [instance(), instance(), instance(), instance()];
  const warm = () => Promise.all(stores.flatMap((s) => [s.hasTask(0, "warm"), s.hasTask(0, "warm")]));
  await stores[0]?.hasTask(0, "warm");
  await warm();

  await t.test("one claimant per target", async () => {
    for (let round = 0; round < 3; round++) {
      await warm();
      const results = await Promise.all(
        stores.map((store, i) =>
          store.addPost({ repoId: 1, repoName: "race/check", type: "claim", title: "r", body: "", target: `t${round}`, authorLogin: `u${i}`, authorUid: 100 + i, client: "codex" }),
        ),
      );
      assert.equal(results.filter((r) => r.ok).length, 1, `round ${round}`);
    }
  });

  await t.test("the agent token cap is atomic", async () => {
    const at = Date.now();
    const token = (i: number) => ({ id: `tok-${i}`, hash: `hash-${i}`, uid: 500, kind: "agent" as const, client: "codex", createdAt: at, expiresAt: at + 600_000 });
    for (let i = 0; i < 18; i++) assert.equal(await (stores[0] as Store).insertToken(token(i)), true);
    await warm();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (stores[i % stores.length] as Store).insertToken(token(18 + i))));
    assert.equal(results.filter(Boolean).length, 2);
  });

  await t.test("the brain entry cap is atomic across instances", async () => {
    const at = Date.now();
    await admin.query(
      `INSERT INTO ${schema}.entries (id, kind, owner_uid, name, body, created_at, updated_at)
       SELECT gen_random_uuid()::text, 'memory', 600, 'seed-' || g, 'x', $1, $1 FROM generate_series(1, $2) AS g`,
      [at, MAX_ENTRIES_PER_KIND - 2],
    );
    await warm();
    const raced = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (stores[i % stores.length] as Store).putEntry({ kind: "memory", ownerUid: 600, name: `race-${i}`, body: "x" })),
    );
    assert.equal(raced.filter((r) => r.ok).length, 2, "exactly the two remaining slots are filled, never more");
  });

  await t.test("a user's GitHub token is refreshed once across instances", async () => {
    const config = testConfig();
    const auths = stores.map((store) => createAuth({ config, store, fetch: fakeGitHub }));
    await auths[0]?.saveGrant(700, "alice", { accessToken: "gh-alice", expiresAt: Date.now() - 1, refreshToken: "refresh-1", refreshExpiresAt: Date.now() + 86_400_000 });
    counters.refreshes = 0;
    await warm();
    const tokens = await Promise.all(auths.map((auth) => auth.githubToken(700)));
    assert.deepEqual(tokens, ["gh-alice", "gh-alice", "gh-alice", "gh-alice"]);
    assert.equal(counters.refreshes, 1);
  });

  await t.test("a renewal never resurrects a claim released at the same moment", async () => {
    for (let round = 0; round < 5; round++) {
      const target = `renew-${round}`;
      const base = { repoId: 2, repoName: "race/renew", type: "claim" as const, title: "r", body: "", target, authorLogin: "u", authorUid: 900, client: "codex" };
      const first = await (stores[0] as Store).addPost(base);
      assert.ok(first.ok);
      await warm();
      const [renewal] = await Promise.all([(stores[1] as Store).addPost(base), (stores[2] as Store).releaseClaim(first.post.id, 2, { uid: 901, login: "m", client: "cursor" })]);
      assert.ok(renewal.ok);
      assert.equal(renewal.post.releasedAt, null, `round ${round}`);
    }
  });

  await t.test("profiles upsert, and the starter kit seeds once across instances", async () => {
    const base = { uid: 950, login: "pg-user", name: "Pat", email: "pat@acme.test", company: "Acme", role: "founder" as const, teamSize: "small" as const, goals: ["answers" as const], agents: ["codex" as const], kit: "both" as const, updates: true };
    const s0 = stores[0] as Store;
    await s0.saveProfile(base);
    await (stores[1] as Store).saveProfile({ ...base, company: "Acme Rockets", updates: false });
    const saved = await s0.profile(950);
    assert.equal(saved?.company, "Acme Rockets");
    assert.equal(saved?.updates, false);
    assert.equal(saved?.askedAt, null);
    await (stores[2] as Store).markAsked(950);
    const asked = (await s0.profile(950))?.askedAt;
    await s0.markAsked(950);
    assert.equal((await s0.profile(950))?.askedAt, asked, "the first question is stamped once");
    const profile = saved as NonNullable<typeof saved>;
    await warm();
    await Promise.all(stores.map((s) => seedStarterKit(s, profile, { about: "About pg-user", now: Date.now() })));
    const rules = await s0.listEntries("rule", 950);
    assert.equal(new Set(rules.map((r) => r.name)).size, rules.length, "no duplicate entries when instances seed at once");
    assert.equal((await s0.listUploads(950)).length, 2);
  });

  await t.test("one agent run at a time per person, across instances", async () => {
    await warm();
    const started = await Promise.all(stores.map((s, i) => s.createRun({ id: `run-${i}`, uid: 960, agent: "assistant", goal: "g", allowActions: false })));
    assert.equal(started.filter(Boolean).length, 1);
    const winner = `run-${started.indexOf(true)}`;
    const s0 = stores[0] as Store;
    await s0.addRunStep(winner, { at: Date.now(), kind: "call", tool: "whoami", text: "{}" });
    await s0.addRunStep(winner, { at: Date.now(), kind: "result", tool: "whoami", text: "ok", ok: true });
    await s0.finishRun(winner, "done", "Finished.");
    const [listed] = await s0.listRuns(960, 5);
    assert.deepEqual([listed?.status, listed?.calls, listed?.steps.length], ["done", 1, 0]);
    assert.equal((await s0.getRun(960, winner))?.steps.length, 2);
    assert.equal(await s0.createRun({ id: "run-next", uid: 960, agent: "assistant", goal: "g", allowActions: false }), true, "a finished run frees the slot");
  });

  await t.test("the improvement queue and graded history work on real Postgres", async () => {
    const s0 = stores[0] as Store;
    await s0.putEntry({ kind: "skill", ownerUid: 970, name: "Ship", body: "v1", author: "web" });
    await s0.putEntry({ kind: "skill", ownerUid: 970, name: "Ship", body: "v2", author: "codex" });
    assert.equal(await s0.humanTouched(970, "skill", "ship"), true);
    await s0.addOutcome({ id: "pg-o1", uid: 970, kind: "run", client: "assistant", goal: "g1", outcome: "done", summary: "s", skills: ["Ship"], at: Date.now() - 3 * 86_400_000 });
    await s0.addOutcome({ id: "pg-o2", uid: 970, kind: "run", client: "assistant", goal: "g2", outcome: "done", summary: "s", skills: [], at: Date.now() - 3 * 86_400_000 });
    await s0.scoreOutcome(970, "pg-o1", 1);
    await s0.scoreOutcome(970, "pg-o2", 1);
    assert.equal(await s0.gradedCount(970), 2);
    assert.deepEqual((await s0.replayGoals(970, "Ship", Date.now(), 2)).map((o) => o.id), ["pg-o1", "pg-o2"], "goals that used the skill come first");
    assert.equal(await s0.addProposal({ id: "pg-p1", uid: 970, kind: "skill", name: "Ship", reason: "r", proposed: "v3", source: "reflector" }), "ok");
    await warm();
    const claims = await Promise.all(stores.map((s) => s.nextQueuedProposal(970)));
    assert.equal(claims.filter(Boolean).length, 1, "one instance claims a queued proposal");
  });

  await t.test("a day-long rate limit survives the hourly purge", async () => {
    const s0 = stores[0] as Store;
    await s0.hit("pg-day", 86_400_000);
    await s0.purge();
    assert.equal(await s0.hit("pg-day", 86_400_000), 2);
  });
});
