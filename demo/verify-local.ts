// Calls the real Vercel handler with mock req/res objects, so this exercises exactly the
// code Vercel will run — not a reimplementation of it. Run after seed.ts:
//   DATABASE_URL=... node --experimental-strip-types demo/verify-local.ts
import handler from "./api/search.ts";
import { DEMO_ASKERS } from "./seed-data.ts";

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

async function run(query: string) {
  console.log(`\n=== "${query}" ===`);
  for (const { label, asker } of DEMO_ASKERS) {
    const req = { method: "POST", body: { query, asker } } as never;
    const res = mockRes();
    await handler(req, res as never);
    const body = res.state.body as { hits?: { title: string }[]; error?: string };
    const titles = body.hits?.map((h) => h.title).join(" | ") || (body.error ? `ERROR: ${body.error}` : "(none)");
    console.log(`  ${label}\n    -> ${titles}`);
  }
}

async function main() {
  await run("AI");
  await run("compensation");
  await run("runbook");
  await run("annuity");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
