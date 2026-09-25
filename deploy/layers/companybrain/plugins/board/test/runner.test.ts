import assert from "node:assert/strict";
import test from "node:test";
import { parseAction } from "../src/runner.ts";
import type { AgentRun } from "../src/store.ts";
import { buildApp, type Harness, ORIGIN, sessionCookie } from "./fixtures.ts";

function scripted(replies: string[], prompts: string[] = []) {
  let i = 0;
  return async (prompt: string) => {
    prompts.push(prompt);
    return replies[Math.min(i++, replies.length - 1)] as string;
  };
}

async function harness(replies: string[], prompts: string[] = []) {
  const pending: Array<Promise<unknown>> = [];
  const h = await buildApp({}, { model: scripted(replies, prompts), defer: (work) => void pending.push(work) });
  const cookie = await sessionCookie(h, "gh-alice");
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  return { h, cookie, settle };
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

async function runOnce(env: Awaited<ReturnType<typeof harness>>, body: unknown): Promise<AgentRun> {
  const started = await api(env.h, env.cookie, "/api/app/runs", body);
  assert.equal(started.status, 202);
  const { id } = (await started.json()) as { id: string };
  await env.settle();
  return ((await (await api(env.h, env.cookie, `/api/app/runs/${id}`)).json()) as { run: AgentRun }).run;
}

test("an agent runs inside the platform, using the same tools a connected agent gets", async () => {
  const prompts: string[] = [];
  const env = await harness(
    [
      '{"thought": "Load what the company knows.", "tool": "memory_index", "arguments": {}}',
      'Sure! ```json\n{"thought": "Record it.", "tool": "brain_write", "arguments": {"kind": "lesson", "name": "Runner lesson", "body": "Always load memory first."}}\n```',
      '{"thought": "Done.", "final": "I loaded memory and saved one lesson."}',
    ],
    prompts,
  );
  const listed = (await (await api(env.h, env.cookie, "/api/app/runs")).json()) as { agents: Array<{ id: string; builds: boolean }>; canRun: boolean };
  assert.equal(listed.canRun, true);
  assert.ok(listed.agents.some((a) => a.id === "assistant"));
  assert.ok(listed.agents.some((a) => a.id === "librarian" && a.builds));
  assert.ok(listed.agents.some((a) => a.id === "release-captain"), "the person's starter agents can be run");

  const run = await runOnce(env, { agent: "assistant", goal: "Learn one thing and save it." });
  assert.equal(run.status, "done");
  assert.equal(run.answer, "I loaded memory and saved one lesson.");
  assert.deepEqual(run.steps.map((s) => s.kind), ["thought", "call", "result", "thought", "call", "result", "thought", "final"]);
  assert.ok(await env.h.store.getEntry("lesson", 1, "Runner lesson"), "the agent's write reached the brain");
  assert.match(prompts[1] as string, /<untrusted-[0-9a-f]{16} source="tool:memory_index">/, "tool results reach the model fenced as data");
  const trail = await env.h.store.auditTrail(1, 10);
  assert.ok(trail.some((e) => e.client === "runner" && e.tool === "brain_write" && e.ok), "every tool call a run makes is audited");
});

test("a run cannot act on connected servers unless the person allowed it", async () => {
  const env = await harness(['{"tool": "gateway_call", "arguments": {"server": "linear", "tool": "create_issue"}}', '{"final": "I could not act on Linear."}']);
  const run = await runOnce(env, { agent: "assistant", goal: "File a bug in Linear." });
  assert.equal(run.steps.find((s) => s.kind === "blocked")?.tool, "gateway_call");
  assert.equal(run.steps.some((s) => s.kind === "call"), false);
});

test("the librarian builds the brain, adding entries without replacing what people wrote", async () => {
  const env = await harness([
    '{"tool": "brain_write", "arguments": {"kind": "rule", "name": "Existing rule", "body": "Overwritten."}}',
    '{"tool": "brain_write", "arguments": {"kind": "rule", "name": "Two reviewers for billing", "body": "Billing changes need two reviewers. See [[Existing rule]]."}}',
    '{"tool": "gateway_servers", "arguments": {}}',
    '{"final": "Added one rule."}',
  ]);
  await env.h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Existing rule", body: "Written by a person." });
  const started = await api(env.h, env.cookie, "/api/app/build", { now: true, autoBuild: true });
  assert.equal(started.status, 202);
  const { id, autoBuild } = (await started.json()) as { id: string; autoBuild: { autoBuild: boolean } };
  assert.equal(autoBuild.autoBuild, true);
  await env.settle();
  const run = ((await (await api(env.h, env.cookie, `/api/app/runs/${id}`)).json()) as { run: AgentRun }).run;
  assert.equal(run.agent, "librarian");
  assert.equal((await env.h.store.getEntry("rule", 1, "Existing rule"))?.body, "Written by a person.");
  assert.ok(await env.h.store.getEntry("rule", 1, "Two reviewers for billing"));
  assert.deepEqual(run.steps.filter((s) => s.kind === "blocked").map((s) => s.tool), ["brain_write", "gateway_servers"], "it may not replace entries or reach outside its toolset");
});

test("the brain keeps building itself each day for people who turned it on", async () => {
  const env = await harness(['{"final": "Nothing new to add today."}']);
  const cron = (auth?: string) => Promise.resolve(env.h.app.fetch(new Request(`${ORIGIN}/cron/build`, { headers: auth ? { authorization: auth } : {} })));
  assert.equal((await cron()).status, 404);
  assert.deepEqual(await (await cron("Bearer cron-secret-for-tests")).json(), { built: 0 });
  await api(env.h, env.cookie, "/api/app/build", { autoBuild: true });
  assert.deepEqual(await (await cron("Bearer cron-secret-for-tests")).json(), { built: 1 });
  assert.deepEqual(await (await cron("Bearer cron-secret-for-tests")).json(), { built: 0 }, "once a day, not on every cron tick");
  const [run] = await env.h.store.listRuns(1, 5);
  assert.deepEqual([run?.agent, run?.status], ["librarian", "done"]);
});

test("runs stop at their step limit, report model outages, and refuse bad requests", async () => {
  const looping = await harness(['{"tool": "whoami", "arguments": {}}']);
  const stuck = await runOnce(looping, { agent: "assistant", goal: "Loop forever." });
  assert.equal(stuck.status, "stopped");
  assert.equal(stuck.steps.filter((s) => s.kind === "call").length, 10);

  const pending: Array<Promise<unknown>> = [];
  const broken = await buildApp({}, { model: async () => { throw new Error("model_unavailable_502"); }, defer: (w) => void pending.push(w) });
  const cookie = await sessionCookie(broken, "gh-alice");
  const res = await api(broken, cookie, "/api/app/runs", { agent: "assistant", goal: "Hi." });
  const { id } = (await res.json()) as { id: string };
  await Promise.all(pending);
  const failed = ((await (await api(broken, cookie, `/api/app/runs/${id}`)).json()) as { run: AgentRun }).run;
  assert.deepEqual([failed.status, failed.answer], ["failed", "The model could not be reached. Try again in a moment."]);

  assert.equal((await api(broken, cookie, "/api/app/runs", { agent: "nobody", goal: "Hi." })).status, 400);
  assert.equal((await api(broken, cookie, "/api/app/runs", { agent: "assistant", goal: "   " })).status, 400);
  const crossSite = await Promise.resolve(broken.app.fetch(new Request(`${ORIGIN}/api/app/runs`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" })));
  assert.equal(crossSite.status, 403);
  const other = await sessionCookie(broken, "gh-bob");
  assert.equal((await api(broken, other, `/api/app/runs/${id}`)).status, 404, "one person's runs are invisible to another");
});

test("replies are read leniently, whatever shape a free model answers in", () => {
  assert.deepEqual(parseAction('<think>hmm</think>{"tool":"whoami","arguments":{}}'), { thought: "", tool: "whoami", arguments: {} });
  assert.deepEqual(parseAction('Here you go: {"thought":"x","final":"done"} hope that helps {'), { thought: "x", final: "done" });
  assert.deepEqual(parseAction('{"tool":"brain_search","arguments":[1]}'), { thought: "", tool: "brain_search", arguments: {} });
  assert.deepEqual(parseAction("Plain prose answer."), { thought: "", final: "Plain prose answer." });
  assert.deepEqual(parseAction('I will {maybe} do this: {"tool":"whoami","arguments":{}}'), { thought: "", tool: "whoami", arguments: {} });
  assert.deepEqual(parseAction('{"tool": "brain_write", "arguments": {"body": "cut off'), { thought: "", invalid: true });
  assert.deepEqual(
    parseAction("<tool_call>get_file\n<arg_key>repo</arg_key>\n<arg_value>acme/app</arg_value><arg_key>path</arg_key>\n<arg_value>docs/release.md</arg_value>\n</tool_call>"),
    { thought: "", tool: "get_file", arguments: { repo: "acme/app", path: "docs/release.md" } },
    "a model's own tool-call format is understood, not saved as the answer",
  );
  assert.deepEqual(parseAction('<tool_call>\n{"name": "brain_search", "arguments": {"query": "release"}}\n</tool_call>'), { thought: "", tool: "brain_search", arguments: { query: "release" } });
  assert.deepEqual(parseAction('<function=skill_read>{"name": "Ship"}</function>'), { thought: "", tool: "skill_read", arguments: { name: "Ship" } });
  assert.deepEqual(parseAction("<tool_call>get_file <arg_key>repo"), { thought: "", invalid: true });
});

test("without changes allowed a run only reads and adds; allowing changes unlocks the rest", async () => {
  const locked = await harness(['{"tool": "brain_forget", "arguments": {"kind": "rule", "name": "Keep me"}}', '{"final": "Could not."}']);
  await locked.h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Keep me", body: "Written by a person." });
  const refused = await runOnce(locked, { agent: "assistant", goal: "Forget a rule." });
  assert.equal(refused.steps.find((s) => s.kind === "blocked")?.tool, "brain_forget");
  assert.ok(await locked.h.store.getEntry("rule", 1, "Keep me"), "a steered run cannot delete what a person wrote");

  const open = await harness(['{"tool": "brain_forget", "arguments": {"kind": "rule", "name": "Keep me"}}', '{"final": "Forgot it."}']);
  await open.h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Keep me", body: "Written by a person." });
  const allowed = await runOnce(open, { agent: "assistant", goal: "Forget a rule.", allowChanges: true });
  assert.equal(allowed.steps.some((s) => s.kind === "blocked"), false);
  assert.equal(await open.h.store.getEntry("rule", 1, "Keep me"), null);
});

test("a reply cut off mid-JSON is retried, never saved as the answer", async () => {
  const env = await harness(['{"thought": "write it", "tool": "brain_write", "arguments": {"kind": "rule", "name": "Half', '{"final": "Wrote nothing this time."}']);
  const run = await runOnce(env, { agent: "assistant", goal: "Write a rule." });
  assert.equal(run.status, "done");
  assert.equal(run.answer, "Wrote nothing this time.");
  assert.equal(run.steps[0]?.kind, "error");
});

test("one run at a time per person, runs are audited like connected agents, and day limits survive the hourly purge", async () => {
  const env = await harness(['{"tool": "skill_read", "arguments": {"name": "Ship a change safely"}}', '{"final": "Read it."}']);
  const first = await api(env.h, env.cookie, "/api/app/runs", { agent: "assistant", goal: "Read the release skill." });
  assert.equal(first.status, 202);
  const second = await api(env.h, env.cookie, "/api/app/runs", { agent: "assistant", goal: "Another." });
  assert.equal(second.status, 409);
  await env.settle();
  assert.ok((await env.h.store.auditTrail(1, 10)).some((e) => e.client === "runner" && e.subject === "skill:Ship a change safely"), "skill use from a run counts, like a connected agent's");

  for (let i = 0; i < 3; i++) await env.h.store.hit("runs:1", 86_400_000);
  env.h.clock.now += 2 * 3_600_000;
  await env.h.store.purge();
  assert.equal(await env.h.store.hit("runs:1", 86_400_000), 5, "a busy refusal costs nothing, and a day-long limit is not wiped by the hourly purge");
});
