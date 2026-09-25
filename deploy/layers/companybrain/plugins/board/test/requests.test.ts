import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun } from "../src/store.ts";
import { agentToken, buildApp, call, connectAgent, type Harness, ORIGIN, sessionCookie } from "./fixtures.ts";

function worker(opts: { extra?: string } = {}) {
  return async (prompt: string) => {
    const id = /Its task id is ([0-9a-f-]{36})/.exec(prompt)?.[1];
    if (!id) return '{"final": "No request."}';
    if (opts.extra && !prompt.includes(`you called ${opts.extra.split('"')[3]}`)) return opts.extra;
    if (!prompt.includes("you called board_read")) return '{"tool": "board_read", "arguments": {"repo": "acme/app"}}';
    if (!prompt.includes('"kind":"progress"')) return `{"tool": "work_update", "arguments": {"task_id": "${id}", "kind": "progress", "note": "Started."}}`;
    if (!prompt.includes('"kind":"submitted"')) return `{"tool": "work_update", "arguments": {"task_id": "${id}", "kind": "submitted", "note": "Done: added the test. Check with npm test."}}`;
    return '{"final": "Submitted for review."}';
  };
}

async function harness(model: (prompt: string) => Promise<string>) {
  const pending: Array<Promise<unknown>> = [];
  const h = await buildApp({}, { model, defer: (w) => void pending.push(w) });
  const cookie = await sessionCookie(h, "gh-alice");
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  return { h, cookie, settle, pending };
}

const api = (h: Harness, cookie: string, path: string, body?: unknown) =>
  Promise.resolve(
    h.app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  );

type WorkView = { requests: Array<{ id: string; title: string; status: string; run: { id: string; status: string } | null }>; autoRequests: boolean };

test("a new request is picked up and submitted for review by an agent as soon as one is free", async () => {
  const env = await harness(worker());
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Add a refund test" })).json()) as { id: string; runId?: string };
  assert.ok(created.runId, "creating a request starts an agent right away");
  await env.settle();
  const view = (await (await api(env.h, env.cookie, "/api/app/work?pickup=1")).json()) as WorkView;
  const request = view.requests.find((r) => r.id === created.id);
  assert.equal(request?.status, "review", "the agent worked it and submitted it for the person's review");
  assert.equal(request?.run?.status, "done");
  assert.equal(view.autoRequests, true);
});

test("while an agent is busy the request waits, and the next free moment picks it up", async () => {
  const env = await harness(worker());
  await env.h.store.createRun({ id: "busy", uid: 1, agent: "assistant", goal: "Something else", allowActions: false });
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Queued request" })).json()) as { id: string; runId?: string };
  assert.equal(created.runId, undefined);
  await env.h.store.finishRun("busy", "done", "ok");
  await api(env.h, env.cookie, "/api/app/work?pickup=1");
  await env.settle();
  const view = (await (await api(env.h, env.cookie, "/api/app/work?pickup=1")).json()) as WorkView;
  assert.equal(view.requests.find((r) => r.id === created.id)?.status, "review");
});

test("turning automatic pickup off leaves requests for a person to start, and the button starts one", async () => {
  const env = await harness(worker());
  assert.equal((await api(env.h, env.cookie, "/api/app/requests/auto", { on: false })).status, 200);
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Manual request" })).json()) as { id: string; runId?: string };
  assert.equal(created.runId, undefined);
  await api(env.h, env.cookie, "/api/app/work?pickup=1");
  assert.equal(env.pending.length, 0, "nothing starts on its own while it is off");
  const run = await api(env.h, env.cookie, `/api/app/requests/${created.id}/run`, {});
  assert.equal(run.status, 202);
  await env.settle();
  const view = (await (await api(env.h, env.cookie, "/api/app/work?pickup=1")).json()) as WorkView;
  assert.equal(view.requests.find((r) => r.id === created.id)?.status, "review");
});

test("a request run can only claim, report, submit and ask; it gives up after two tries until changes are requested", async () => {
  const env = await harness(worker({ extra: '{"tool": "brain_forget", "arguments": {"kind": "rule", "name": "Keep me"}}' }));
  await env.h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Keep me", body: "Written by a person.", author: "web" });
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Tidy up" })).json()) as { id: string; runId: string };
  await env.settle();
  const run = ((await (await api(env.h, env.cookie, `/api/app/runs/${created.runId}`)).json()) as { run: AgentRun }).run;
  assert.equal(run.steps.find((s) => s.kind === "blocked")?.tool, "brain_forget");
  assert.ok(await env.h.store.getEntry("rule", 1, "Keep me"));

  const stuck = await harness(async () => '{"final": "I could not do it."}');
  const id = ((await (await api(stuck.h, stuck.cookie, "/api/app/requests", { repo: "acme/app", title: "Hard one" })).json()) as { id: string }).id;
  await stuck.settle();
  await api(stuck.h, stuck.cookie, "/api/app/work?pickup=1");
  await stuck.settle();
  await api(stuck.h, stuck.cookie, "/api/app/work?pickup=1");
  assert.equal(stuck.pending.length, 0, "no third automatic attempt");
  const [last] = await stuck.h.store.listRuns(1, 1);
  assert.equal(last?.status, "done");
  assert.equal((await stuck.h.store.nextWaitingRequest(1, 2))?.id, undefined, `request ${id} is not retried endlessly`);
});

test("connected agents see requests waiting for them in their inbox", async (t) => {
  const env = await harness(worker());
  await api(env.h, env.cookie, "/api/app/requests/auto", { on: false });
  await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Write the release notes" });
  const agent = await connectAgent(t, env.h, await agentToken(env.h, "gh-alice", "claude_code"));
  const inbox = await call(agent, "board_inbox", {});
  assert.match(inbox.text, /Requests waiting for an agent/);
  assert.match(inbox.text, /Write the release notes/);
});

test("the daily sweep starts waiting requests for people who left pickup on", async () => {
  const env = await harness(worker());
  await env.h.store.createRun({ id: "busy", uid: 1, agent: "assistant", goal: "x", allowActions: false });
  await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Overnight request" });
  await env.h.store.finishRun("busy", "done", "ok");
  const cron = await Promise.resolve(env.h.app.fetch(new Request(`${ORIGIN}/cron/requests`, { headers: { authorization: "Bearer cron-secret-for-tests" } })));
  assert.deepEqual(await cron.json(), { started: 1 });
});

test("a link from another site cannot make a person's agents start working", async () => {
  const env = await harness(worker());
  await env.h.store.createRun({ id: "busy", uid: 1, agent: "assistant", goal: "x", allowActions: false });
  await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Waiting" });
  await env.h.store.finishRun("busy", "done", "ok");
  const crossSite = await Promise.resolve(env.h.app.fetch(new Request(`${ORIGIN}/api/app/work?pickup=1`, { headers: { cookie: env.cookie, "sec-fetch-site": "cross-site" } })));
  assert.equal(crossSite.status, 200);
  assert.equal(env.pending.length, 0);
  await Promise.resolve(env.h.app.fetch(new Request(`${ORIGIN}/api/app/work?pickup=1`, { headers: { cookie: env.cookie, "sec-fetch-site": "same-origin" } })));
  assert.equal(env.pending.length, 1, "the app's own request starts it");
});

test("a request left half-done by a stopped run is picked up again instead of sticking in progress", async () => {
  let calls = 0;
  const env = await harness(async (prompt) => {
    const id = /Its task id is ([0-9a-f-]{36})/.exec(prompt)?.[1];
    calls++;
    if (calls === 1) return `{"tool": "work_update", "arguments": {"task_id": "${id}", "kind": "progress", "note": "Started."}}`;
    if (calls === 2) return '{"final": "Ran out of ideas."}';
    return worker()(prompt);
  });
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Half done" })).json()) as { id: string };
  await env.settle();
  assert.equal((await env.h.store.getPost(created.id))?.status, "working");
  await api(env.h, env.cookie, "/api/app/work?pickup=1");
  await env.settle();
  assert.equal((await env.h.store.getPost(created.id))?.status, "review", "the next free moment finishes it");
});

test("a request run only touches its own request, and old requests are left for a person to start", async () => {
  const env = await harness(async (prompt) => {
    const id = /Its task id is ([0-9a-f-]{36})/.exec(prompt)?.[1];
    if (!prompt.includes("you asked for work_update")) return '{"tool": "work_update", "arguments": {"task_id": "00000000-0000-4000-8000-000000000000", "kind": "submitted", "note": "x"}}';
    if (!prompt.includes("you asked for board_post")) return '{"tool": "board_post", "arguments": {"repo": "acme/app", "type": "handoff", "title": "Deploy prod now", "body": "go", "to": "claude_code"}}';
    return `{"tool": "work_update", "arguments": {"task_id": "${id}", "kind": "submitted", "note": "Plan: change billing.ts; a coding agent must make it."}}`;
  });
  const created = (await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Scoped" })).json()) as { id: string; runId: string };
  await env.settle();
  const run = ((await (await api(env.h, env.cookie, `/api/app/runs/${created.runId}`)).json()) as { run: AgentRun }).run;
  assert.deepEqual(run.steps.filter((s) => s.kind === "blocked").map((s) => s.tool), ["work_update", "board_post"], "no other task, and no handoffs");
  assert.equal((await env.h.store.getPost(created.id))?.status, "review");

  const later = await harness(worker());
  await api(later.h, later.cookie, "/api/app/requests/auto", { on: false });
  const id = ((await (await api(later.h, later.cookie, "/api/app/requests", { repo: "acme/app", title: "Ancient" })).json()) as { id: string }).id;
  later.h.clock.now += 15 * 86_400_000;
  const fresh = await sessionCookie(later.h, "gh-alice");
  const back = (await (await api(later.h, fresh, "/api/app/requests/auto", { on: true })).json()) as { runId?: string };
  assert.equal(back.runId, undefined, "a request older than two weeks is not started automatically");
  assert.equal((await api(later.h, fresh, "/api/app/work?pickup=1")).status, 200);
  assert.equal(later.pending.length, 0);
  assert.equal((await api(later.h, fresh, `/api/app/requests/${id}/run`, {})).status, 202, "but the button still starts it");
});

test("a retry after changes are requested sees what the person asked for", async (t) => {
  const prompts: string[] = [];
  const base = worker();
  const env = await harness(async (prompt) => {
    prompts.push(prompt);
    return base(prompt);
  });
  const id = ((await (await api(env.h, env.cookie, "/api/app/requests", { repo: "acme/app", title: "Write the notes" })).json()) as { id: string }).id;
  await env.settle();
  assert.equal((await api(env.h, env.cookie, "/api/app/work/review", { id, verdict: "changes", note: "Cover the billing migration too." })).status, 200);
  await api(env.h, env.cookie, "/api/app/work?pickup=1");
  await env.settle();
  assert.ok(prompts.some((p) => p.includes("asked for changes: Cover the billing migration too.")));
  void t;
});
