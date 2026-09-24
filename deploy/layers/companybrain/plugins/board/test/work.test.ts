import assert from "node:assert/strict";
import test from "node:test";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

type H = Awaited<ReturnType<typeof buildApp>>;

const json = (h: H, path: string, cookie: string, body: unknown, headers: Record<string, string> = {}) =>
  h.app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

type Work = { requests: Array<{ id: string; title: string; status: string; updates: Array<{ kind: string; body: string; client: string }> }> };
const work = async (h: H, cookie: string): Promise<Work> =>
  (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/work`, { headers: { cookie } }))).json()) as Work;

test("a request goes from asked, to worked, to reviewed, to accepted", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  const created = await json(h, "/api/app/requests", cookie, { repo: "acme/app", title: "Add a reconciliation test for refunds", body: "Cover partial refunds." });
  assert.equal(created.status, 200);
  const id = ((await created.json()) as { id: string }).id;
  assert.equal((await work(h, cookie)).requests[0]?.status, "open");

  const board = await call(agent, "board_read", { repo: "acme/app" });
  assert.match(board.text, /Add a reconciliation test for refunds/, "the agent can see the request");
  assert.match(board.text, /status: open/);

  assert.equal((await call(agent, "work_update", { task_id: id, kind: "progress", note: "Found the refund path in adapters/legacy.ts." })).isError, false);
  assert.equal((await work(h, cookie)).requests[0]?.status, "working");

  const submitted = await call(agent, "work_update", { task_id: id, kind: "submitted", note: "Added test/refunds.test.ts covering partial refunds. Run npm test." });
  assert.match(submitted.text, /Submitted task/);
  const inReview = (await work(h, cookie)).requests[0];
  assert.equal(inReview?.status, "review");
  assert.deepEqual(inReview?.updates.map((u) => u.kind), ["progress", "submitted"], "the requester sees the whole timeline");

  const accepted = await json(h, "/api/app/work/review", cookie, { id, verdict: "accept", note: "Looks right." });
  assert.equal(((await accepted.json()) as { status: string }).status, "done");
  assert.equal((await work(h, cookie)).requests[0]?.status, "done");
  assert.doesNotMatch((await call(agent, "board_read", { repo: "acme/app" })).text, /reconciliation test/, "done work leaves the open board");
});

test("asking for changes sends the reviewer's note back to the agent that submitted", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const other = await connectAgent(t, h, await agentToken(h, "gh-alice", "codex"));

  const id = ((await (await json(h, "/api/app/requests", cookie, { repo: "acme/app", title: "Speed up search" })).json()) as { id: string }).id;
  await call(agent, "work_update", { task_id: id, kind: "submitted", note: "Added an index." });

  const needsNote = await json(h, "/api/app/work/review", cookie, { id, verdict: "changes" });
  assert.equal(needsNote.status, 400, "asking for changes without saying what is refused");

  await json(h, "/api/app/work/review", cookie, { id, verdict: "changes", note: "The index is on the wrong column. Use repo_id, not repo_name." });

  const inbox = await call(agent, "board_inbox", {});
  assert.match(inbox.text, /Changes requested on work you submitted/);
  assert.match(inbox.text, /Use repo_id, not repo_name/, "the agent reads exactly what to change");
  assert.doesNotMatch((await call(other, "board_inbox", {})).text, /Use repo_id/, "and it goes to the agent that did the work, not every agent");

  const resubmit = await call(agent, "work_update", { task_id: id, kind: "submitted", note: "Moved the index to repo_id." });
  assert.equal(resubmit.isError, false, "the agent can fix it and resubmit");
  assert.equal((await work(h, cookie)).requests[0]?.status, "review");
});

test("the state machine refuses steps that skip the review", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const id = ((await (await json(h, "/api/app/requests", cookie, { repo: "acme/app", title: "Anything" })).json()) as { id: string }).id;

  const early = await json(h, "/api/app/work/review", cookie, { id, verdict: "accept" });
  assert.equal(early.status, 409, "nothing can be accepted before it is submitted");

  await call(agent, "work_update", { task_id: id, kind: "submitted", note: "Done." });
  const whileReviewing = await call(agent, "work_update", { task_id: id, kind: "progress", note: "One more thing." });
  assert.equal(whileReviewing.isError, true, "an agent cannot keep changing work that is waiting on review");
  assert.match(whileReviewing.text, /wait for the requester/);

  await json(h, "/api/app/work/review", cookie, { id, verdict: "accept" });
  const afterDone = await call(agent, "work_update", { task_id: id, kind: "progress", note: "Reopening." });
  assert.equal(afterDone.isError, true, "accepted work stays accepted");
});

test("only the requester reviews, and nobody reaches work in a repo they cannot see", async (t) => {
  const h = await buildApp();
  const alice = await sessionCookie(h, "gh-alice");
  const carol = await sessionCookie(h, "gh-carol");
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const id = ((await (await json(h, "/api/app/requests", alice, { repo: "acme/app", title: "Private request" })).json()) as { id: string }).id;
  await call(agent, "work_update", { task_id: id, kind: "submitted", note: "Done." });

  assert.equal((await json(h, "/api/app/work/review", carol, { id, verdict: "accept" })).status, 404, "carol cannot accept alice's request");
  assert.equal((await work(h, carol)).requests.length, 0);

  const bob = await sessionCookie(h, "gh-bob");
  assert.equal((await json(h, "/api/app/requests", bob, { repo: "acme/app", title: "x" })).status, 404, "read-only access cannot file requests");

  const reader = await connectAgent(t, h, await agentToken(h, "gh-bob", "codex"));
  const blocked = await call(reader, "work_update", { task_id: id, kind: "progress", note: "x" });
  assert.equal(blocked.isError, true, "and an agent without board access cannot touch it");
});

test("requests are refused for signed-out and cross-site callers", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  assert.equal((await json(h, "/api/app/requests", "", { repo: "acme/app", title: "x" })).status, 401);
  assert.equal((await json(h, "/api/app/requests", cookie, { repo: "acme/app", title: "x" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await json(h, "/api/app/requests", cookie, { repo: "acme/app", title: "   " })).status, 400);
});
