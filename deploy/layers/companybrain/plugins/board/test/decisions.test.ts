import assert from "node:assert/strict";
import test from "node:test";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

const answer = (h: Awaited<ReturnType<typeof buildApp>>, cookie: string, body: unknown, headers: Record<string, string> = {}) =>
  h.app.fetch(
    new Request(`${ORIGIN}/api/app/decisions`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

test("an agent that hits a judgement call asks, stops, and reads the ruling next session", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  const asked = await call(agent, "board_ask", {
    repo: "acme/app",
    question: "Should the migration drop the legacy column or keep it for a release?",
    context: "Dropping it is simpler but unrecoverable. Keeping it costs one release of dead schema. I recommend keeping it.",
  });
  assert.equal(asked.isError, false);
  assert.match(asked.text, /Decisions queue/);
  assert.match(asked.text, /Do not wait for it now/, "the agent is told not to block on it");

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json();
  const open = (queue as { open: Array<{ id: string; title: string; body: string }> }).open;
  assert.equal(open.length, 1, "it is waiting on the person whose agent asked");
  assert.match(open[0]?.title ?? "", /drop the legacy column/);
  assert.match(open[0]?.body ?? "", /I recommend keeping it/, "with the agent's reasoning");

  const before = await call(agent, "board_inbox", {});
  assert.doesNotMatch(before.text, /Answers to what you asked/, "nothing to collect before it is answered");

  assert.equal((await answer(h, cookie, { id: open[0]?.id, answer: "Keep it for one release, then drop it." })).status, 200);

  const after = await call(agent, "board_inbox", {});
  assert.match(after.text, /Answers to what you asked/);
  assert.match(after.text, /Keep it for one release/, "the agent collects the ruling next session");
});

test("an unanswered decision never reads as decided", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "board_ask", { repo: "acme/app", question: "Ship on Friday?", context: "Risk is moderate." });

  const board = await call(agent, "board_read", { repo: "acme/app" });
  assert.match(board.text, /answered: not yet, do not assume an answer/, "the board states plainly that no ruling exists");
  assert.doesNotMatch(board.text, /answered: ship/i);
});

test("only the person who was asked can answer, and only once", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "board_ask", { repo: "acme/app", question: "Refund the customer?", context: "Policy is unclear." });

  const aliceCookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie: aliceCookie } }))).json()) as {
    open: Array<{ id: string }>;
  };
  const id = queue.open[0]?.id as string;

  const carol = await sessionCookie(h, "gh-carol");
  assert.equal((await answer(h, carol, { id, answer: "Yes" })).status, 404, "someone else's ruling is not theirs to make, and does not leak");

  assert.equal((await answer(h, aliceCookie, { id, answer: "Yes" }, { origin: "https://evil.example" })).status, 403, "nor can a cross-site page answer");

  assert.equal((await answer(h, aliceCookie, { id, answer: "Yes, refund in full." })).status, 200);
  assert.equal((await answer(h, aliceCookie, { id, answer: "Actually no" })).status, 409, "a ruling cannot be silently overwritten");

  const still = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie: aliceCookie } }))).json()) as { open: unknown[] };
  assert.equal(still.open.length, 0, "and it leaves the queue once answered");
});

test("an empty answer is refused rather than closing the decision blank", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "board_ask", { repo: "acme/app", question: "Proceed?", context: "Unclear." });

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: Array<{ id: string }> };
  const id = queue.open[0]?.id as string;

  assert.equal((await answer(h, cookie, { id, answer: "   " })).status, 400);
  const still = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: unknown[] };
  assert.equal(still.open.length, 1, "it is still waiting");
});

test("a decision asked about a repository the agent cannot reach is refused", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-bob", "codex"));
  const asked = await call(agent, "board_ask", { repo: "acme/app", question: "Anything?", context: "Trying." });
  assert.equal(asked.isError, true, "read-only access cannot raise a decision");

  const cookie = await sessionCookie(h, "gh-bob");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: unknown[] };
  assert.equal(queue.open.length, 0);
});

test("an agent cannot close the question it raised, and the queue keeps it", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "board_ask", { repo: "acme/app", question: "Delete the production table?", context: "It looks unused." });

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: Array<{ id: string }> };
  const id = queue.open[0]?.id as string;

  const closed = await call(agent, "board_close", { post_id: id });
  assert.equal(closed.isError, true, "the agent that asked cannot make the question go away");
  assert.match(closed.text, /must not act as though it were decided/);

  const still = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: unknown[] };
  assert.equal(still.open.length, 1, "it is still waiting on the person");
});

test("a maintainer cannot quietly close someone else's decision either", async (t) => {
  const h = await buildApp();
  const alice = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const carol = await connectAgent(t, h, await agentToken(h, "gh-carol", "cursor"));
  await call(alice, "board_ask", { repo: "acme/app", question: "Refund in full?", context: "Policy is unclear." });

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: Array<{ id: string }> };

  const moderated = await call(carol, "board_close", { post_id: queue.open[0]?.id as string });
  assert.equal(moderated.isError, true, "moderation does not extend to answering for someone");

  const still = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: unknown[] };
  assert.equal(still.open.length, 1);
});

test("a ruling is still collectable long after it was given", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "board_ask", { repo: "acme/app", question: "Ship on Friday?", context: "Moderate risk." });

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: Array<{ id: string }> };
  await answer(h, cookie, { id: queue.open[0]?.id, answer: "No, ship on Monday." });

  h.clock.now += 20 * 24 * 3_600_000;

  const inbox = await call(agent, "board_inbox", {});
  assert.match(inbox.text, /answered: No, ship on Monday/, "well past the seven day window that used to drop it");
});

test("a decision about a repository the person lost access to is neither shown nor answerable", async (t) => {
  const h = await buildApp();
  await h.store.addPost({
    repoId: 99,
    repoName: "secret-org/private-thing",
    type: "decision",
    title: "Rotate the production key?",
    body: "Contains the production account id.",
    authorLogin: "alice",
    authorUid: 1,
    client: "claude_code",
    system: true,
  });

  const cookie = await sessionCookie(h, "gh-alice");
  const queue = (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/decisions`, { headers: { cookie } }))).json()) as { open: unknown[] };
  assert.equal(queue.open.length, 0, "a repo she cannot reach does not leak its decision body");

  const post = (await h.store.openDecisions(1))[0];
  assert.equal((await answer(h, cookie, { id: post?.id, answer: "Yes" })).status, 404, "and she cannot answer into it");
});
