import assert from "node:assert/strict";
import test from "node:test";
import { HANDOFFS_PER_PAIR_PER_HOUR } from "../src/store.ts";
import { NO_BOARD } from "../src/mcp.ts";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

test("two agents claim the same work and the second backs off, knowing who holds it", async (t) => {
  const h = await buildApp();
  const claude = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const codex = await connectAgent(t, h, await agentToken(h, "gh-carol", "codex"));

  const first = await call(claude, "board_post", {
    repo: "acme/app",
    type: "claim",
    title: "Fix the login redirect",
    body: "Starting now.",
    target: "src/login.ts",
    ttl_minutes: 60,
  });
  assert.equal(first.isError, false);

  const second = await call(codex, "board_post", { repo: "acme/app", type: "claim", title: "Login", body: "", target: "src/login.ts" });
  assert.equal(second.isError, true, "the second agent is refused");
  assert.match(second.text, /Already claimed until/);
  assert.match(second.text, /Pick other work, or ask the claimant to hand off/);
  assert.match(second.text, /alice via claude_code/, "it can see who to ask");

  const board = await call(codex, "board_read", { repo: "acme/app" });
  assert.match(board.text, /Fix the login redirect/, "and can see the claim on the board");

  const elsewhere = await call(codex, "board_post", { repo: "acme/app", type: "claim", title: "Other", body: "", target: "src/signup.ts" });
  assert.equal(elsewhere.isError, false, "other work is still free to take");
});

test("a handoff carries enough context for the next agent to continue, and reaches its inbox", async (t) => {
  const h = await buildApp();
  const claude = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const codex = await connectAgent(t, h, await agentToken(h, "gh-carol", "codex"));

  const body = [
    "Done: traced the redirect loop to src/login.ts:42, which re-reads a cookie the server already cleared.",
    "Next: delete the second read, then run test/login.test.ts.",
    "Careful: acme/app pins its session cookie name in config/app.json.",
  ].join("\n");
  const handoff = await call(claude, "board_post", { repo: "acme/app", type: "handoff", title: "Login redirect loop", body, to: "codex" });
  assert.equal(handoff.isError, false);

  const inbox = await call(codex, "board_inbox", {});
  assert.match(inbox.text, /Handed off to you/);
  assert.match(inbox.text, /Login redirect loop/);
  for (const fact of ["src/login.ts:42", "test/login.test.ts", "config/app.json"]) {
    assert.ok(inbox.text.includes(fact), `the handoff lost ${fact}`);
  }
  assert.match(inbox.text, /<untrusted-[0-9a-f]{16} source="board:acme\/app">/, "and arrives as data, not instructions");
});

test("an agent acting for one user cannot see another user's board, or learn that a post exists", async (t) => {
  const h = await buildApp();
  const alice = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const bob = await connectAgent(t, h, await agentToken(h, "gh-bob", "grok"));

  const secret = await call(alice, "board_post", { repo: "acme/app", type: "finding", title: "Acme pays late", body: "invoice 88 is 40 days overdue" });
  const id = (/finding ([0-9a-f-]{36})/.exec(secret.text) as RegExpExecArray)[1] as string;

  assert.equal((await call(bob, "board_read", { repo: "acme/app" })).text, NO_BOARD, "bob cannot read the board");
  assert.equal((await call(bob, "board_events", { repo: "acme/app" })).text, NO_BOARD, "nor its activity");
  assert.equal((await call(bob, "board_close", { post_id: id })).text, NO_BOARD, "nor act on a post he was told about");
  assert.equal(
    (await call(bob, "board_close", { post_id: "00000000-0000-4000-8000-000000000000" })).text,
    NO_BOARD,
    "and a real id answers exactly like a made-up one, so existence never leaks",
  );
  assert.equal((await call(bob, "board_inbox", {})).text, "Nothing is waiting for you.");

  const web = await h.app.fetch(new Request(`${ORIGIN}/board/acme/app`, { headers: { cookie: await sessionCookie(h, "gh-bob") } }));
  assert.equal(web.status, 404, "the web board hides it too");
  assert.doesNotMatch(await web.text(), /Acme pays late|invoice 88/);
});

test("two agents cannot hand the same work back and forth for ever", async (t) => {
  const h = await buildApp();
  const claude = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const post = (i: number) => call(claude, "board_post", { repo: "acme/app", type: "handoff", title: `Round ${i}`, body: "over to you", to: "codex" });

  for (let i = 0; i < HANDOFFS_PER_PAIR_PER_HOUR; i++) assert.equal((await post(i)).isError, false, `handoff ${i}`);
  const stopped = await post(HANDOFFS_PER_PAIR_PER_HOUR);
  assert.equal(stopped.isError, true);
  assert.match(stopped.text, /handed off to codex 8 times in the last hour/);
  assert.match(stopped.text, /Finish the work or ask a human/);

  const other = await call(claude, "board_post", { repo: "acme/app", type: "handoff", title: "Different partner", body: "", to: "cursor" });
  assert.equal(other.isError, false, "a different recipient is unaffected");
  const finding = await call(claude, "board_post", { repo: "acme/app", type: "finding", title: "Still able to record what I learned", body: "" });
  assert.equal(finding.isError, false, "and other post types are unaffected");
});

test("a claim about to expire is surfaced to the agent holding it, before it lapses", async (t) => {
  const h = await buildApp();
  const claude = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(claude, "board_post", { repo: "acme/app", type: "claim", title: "Long job", body: "", target: "src/a.ts", ttl_minutes: 120 });
  await call(claude, "board_post", { repo: "acme/app", type: "claim", title: "Nearly up", body: "", target: "src/b.ts", ttl_minutes: 20 });

  const inbox = await call(claude, "board_inbox", {});
  assert.match(inbox.text, /Your claims expiring soon/);
  assert.match(inbox.text, /Nearly up/);
  assert.doesNotMatch(inbox.text, /Long job/, "a claim with hours left is not nagged about");
});
