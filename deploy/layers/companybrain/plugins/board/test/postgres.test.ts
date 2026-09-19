import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import { createAuth } from "../src/auth.ts";
import { createPool, postgres } from "../src/db.ts";
import { openStore, type Store } from "../src/store.ts";
import { counters, fakeGitHub, testConfig } from "./fixtures.ts";

const url = process.env.TEST_DATABASE_URL;
const schema = `board_test_${randomBytes(6).toString("hex")}`;
const pools: pg.Pool[] = [];

function instance(now: () => number = Date.now): Store {
  const pool = createPool(url as string);
  pool.on("connect", (client) => {
    client.query(`SET search_path TO ${schema}`).catch(() => undefined);
  });
  pools.push(pool);
  return openStore(postgres(pool), now);
}

test("real Postgres: locks hold across separate connection pools", { skip: !url && "set TEST_DATABASE_URL to run" }, async (t) => {
  const admin = createPool(url as string);
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await Promise.all(pools.map((p) => p.end()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const stores = [instance(), instance(), instance(), instance()];
  await stores[0]?.hasTask(0, "warm");

  await t.test("one claimant per target", async () => {
    for (let round = 0; round < 3; round++) {
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
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (stores[i % stores.length] as Store).insertToken(token(18 + i))));
    assert.equal(results.filter(Boolean).length, 2);
  });

  await t.test("a user's GitHub token is refreshed once across instances", async () => {
    const config = testConfig();
    const auths = stores.map((store) => createAuth({ config, store, fetch: fakeGitHub }));
    await auths[0]?.saveGrant(700, "alice", { accessToken: "gh-alice", expiresAt: Date.now() - 1, refreshToken: "refresh-1", refreshExpiresAt: Date.now() + 86_400_000 });
    counters.refreshes = 0;
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
      const [renewal] = await Promise.all([(stores[1] as Store).addPost(base), (stores[2] as Store).releaseClaim(first.post.id, 2, { uid: 901, login: "m", client: "cursor" })]);
      assert.ok(renewal.ok);
      assert.equal(renewal.post.releasedAt, null, `round ${round}`);
    }
  });
});
