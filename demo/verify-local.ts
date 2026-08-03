// Calls the real Vercel handler with mock req/res objects, so this exercises exactly the
// code Vercel will run — not a reimplementation of it. Run after seed.ts:
//   DATABASE_URL=... node --experimental-strip-types demo/verify-local.ts
//
// Asserts the ADR-0002 acceptance test on the seeded data: people with different access
// get different, correct results for the same question. This is what CI's `demo` job
// actually gates on — printing the results without asserting them would let a permission
// regression through silently.
import assert from "node:assert/strict";
import handler from "./api/search.ts";
import { DEMO_ASKERS } from "./seed-data.ts";

const [OWNER, BRIAN, ALICE, OUTSIDER] = DEMO_ASKERS;

function mockRes() {
  const state = { status: 0, body: undefined as unknown };
  return {
    state,
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
}

async function search(query: string, asker: (typeof DEMO_ASKERS)[number]["asker"]) {
  const req = { method: "POST", body: { query, asker } } as never;
  const res = mockRes();
  await handler(req, res as never);
  const body = res.state.body as { hits?: { title: string }[]; error?: string };
  if (body.error) throw new Error(`search failed for ${asker.principalId}: ${body.error}`);
  return body.hits ?? [];
}

async function run(query: string) {
  console.log(`\n=== "${query}" ===`);
  const results = new Map<string, { title: string }[]>();
  for (const { label, asker } of DEMO_ASKERS) {
    const hits = await search(query, asker);
    results.set(asker.principalId, hits);
    console.log(`  ${label}\n    -> ${hits.map((h) => h.title).join(" | ") || "(none)"}`);
  }
  return results;
}

function titlesOf(hits: { title: string }[]) {
  return new Set(hits.map((h) => h.title));
}

async function main() {
  const ai = await run("AI");
  assert.ok(
    [...titlesOf(ai.get(OWNER.asker.principalId)!)].some((t) => t.includes("Resume")),
    "the resume's owner should find their own resume",
  );
  for (const other of [BRIAN, ALICE, OUTSIDER]) {
    assert.ok(
      ![...titlesOf(ai.get(other.asker.principalId)!)].some((t) => t.includes("Resume")),
      `${other.asker.principalId} must not see the owner-only resume`,
    );
  }

  const comp = await run("compensation");
  assert.ok(
    [...titlesOf(comp.get(ALICE.asker.principalId)!)].some((t) => t.includes("Compensation")),
    "Alice has the principal grant and should find the synthetic comp review",
  );
  for (const other of [OWNER, BRIAN, OUTSIDER]) {
    assert.equal(
      comp.get(other.asker.principalId)!.length,
      0,
      `${other.asker.principalId} has no grant and must get zero results`,
    );
  }

  const runbook = await run("runbook");
  assert.ok(
    [...titlesOf(runbook.get(ALICE.asker.principalId)!)].some((t) => t.includes("Runbook")),
    "Alice is in the grantee group and should find the synthetic runbook",
  );
  for (const other of [OWNER, BRIAN, OUTSIDER]) {
    assert.equal(
      runbook.get(other.asker.principalId)!.length,
      0,
      `${other.asker.principalId} is not in the group and must get zero results`,
    );
  }

  const annuity = await run("annuity");
  for (const { asker } of DEMO_ASKERS) {
    assert.ok(
      [...titlesOf(annuity.get(asker.principalId)!)].some((t) => t.includes("Whitepaper")),
      `${asker.principalId} should see the public whitepaper`,
    );
  }

  console.log("\nall assertions passed — different askers, different correct answers");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
