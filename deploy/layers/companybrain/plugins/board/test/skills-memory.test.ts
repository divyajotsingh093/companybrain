import assert from "node:assert/strict";
import test from "node:test";
import { parseMemory, renderMemory } from "../src/memory.ts";
import { HARNESS_SKILL } from "../src/seed.ts";
import { learnInto, parseSkill, pulse, renderSkill, SKILL_PARTS } from "../src/skills.ts";
import { agentToken, buildApp, call, connectAgent, ORIGIN, outsideFences, sessionCookie } from "./fixtures.ts";

type H = Awaited<ReturnType<typeof buildApp>>;
const DAY = 24 * 3_600_000;
const json = (h: H, path: string, cookie: string, method = "GET", body?: unknown) =>
  h.app.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

test("a skill has eight parts, and learnings are appended with a date and who learned them", () => {
  const plain = renderSkill(parseSkill("Ship with [[Release checklist]]."));
  assert.deepEqual(
    plain.split("\n").filter((l) => l.startsWith("## ")),
    SKILL_PARTS.map((p) => `## ${p}`),
  );
  assert.equal(parseSkill(plain).parts.Skill.text, "Ship with [[Release checklist]].", "an unstructured body becomes the Skill part");

  let body = plain;
  for (const note of ["Never ship on a Friday.", "never ship on a friday."]) {
    const next = learnInto(body, "Soul", note, "claude_code", Date.UTC(2026, 8, 24));
    assert.ok("body" in next);
    body = next.body;
  }
  const soul = parseSkill(body).parts.Soul.learned;
  assert.deepEqual(soul, [{ at: "2026-09-24", by: "claude_code", note: "Never ship on a Friday." }], "the same learning twice is kept once");

  const skill = parseSkill(body);
  assert.equal(pulse(skill, 0, 0, Date.UTC(2026, 8, 25)).state, "fresh");
  assert.equal(pulse(skill, 0, 0, Date.UTC(2026, 9, 5)).state, "quiet");
  assert.equal(pulse(skill, 0, 0, Date.UTC(2026, 11, 1)).state, "stale");
  assert.equal(pulse(parseSkill(""), 0, 0, Date.UTC(2026, 8, 25)).state, "new");
});

test("a memory keeps Claude's shape: type, description, fact, why and how to apply", () => {
  const body = renderMemory({ type: "feedback", description: "Prefers terse answers", fact: "Keep replies short.", why: "Long answers bury the point.", how: "Lead with the result.", auto: false });
  assert.deepEqual(parseMemory(body), { type: "feedback", description: "Prefers terse answers", fact: "Keep replies short.", why: "Long answers bury the point.", how: "Lead with the result.", auto: false });
  const legacy = parseMemory("Alice reviews anything touching auth.");
  assert.equal(legacy.type, "topic");
  assert.equal(legacy.description, "Alice reviews anything touching auth.");
});

test("agents save and recall memories and grow skills as they work", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  assert.match((await call(agent, "memory_index", {})).text, /No memories yet/);
  await call(agent, "memory_save", { type: "user", name: "Alice's role", description: "Alice leads platform", fact: "Alice leads the platform team." });
  await call(agent, "memory_save", { type: "creative", name: "Launch naming", description: "Prefers one-word names", fact: "Likes one-word product names.", why: "Easy to say." });
  const index = (await call(agent, "memory_index", {})).text;
  assert.match(index, /## user\n- Alice's role: Alice leads platform/);
  assert.match(index, /## creative\n- Launch naming: Prefers one-word names/);
  assert.equal(outsideFences(index).includes("Alice leads"), false, "recalled memories are fenced");

  assert.match((await call(agent, "skill_learn", { name: "Deploying", part: "Process", learned: "Set DATABASE_URL before the build step." })).text, /Learned into Process/);
  await call(agent, "skill_learn", { name: "Deploying", part: "BrainWeaver", learned: "Follows [[Release checklist]]." });
  h.clock.now += 60_000;
  await call(agent, "skill_read", { name: "Deploying" });
  await call(agent, "brain_search", { query: "deploy" });

  const read = (await call(agent, "skill_read", { name: "Deploying" })).text;
  assert.match(read, /heartbeat: fresh, 2 learnings/);
  assert.match(read, /learned by claude_code: Set DATABASE_URL before the build step\./);
  assert.match(read, /-> entry: Release checklist/, "a learned [[link]] is woven into the brain");
  const seen = read.split("## Seen in use after reading this skill")[1] ?? "";
  assert.match(seen, /- brain_search \(1x\)/, "tools used after reading the skill are observed");
  assert.doesNotMatch(seen, /memory_save/, "work from before the skill was read is not attributed to it");
});

test("attaching an agent fills in who the person is and a harness skill; indexing adds the project", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const form = { "content-type": "application/x-www-form-urlencoded" };
  await h.app.fetch(new Request(`${ORIGIN}/tokens`, { method: "POST", headers: { ...form, cookie, origin: ORIGIN }, body: "client=claude_code" }));
  await json(h, "/api/app/sources", cookie, "POST", { repo: "acme/app" });

  const brain = (await (await json(h, "/api/app/brain", cookie)).json()) as {
    kinds: { memory: Array<{ name: string; memory: { type: string; auto: boolean } }>; skill: Array<{ name: string; skill: Record<string, { text: string }> }> };
  };
  const memories = Object.fromEntries(brain.kinds.memory.map((m) => [m.name, m.memory]));
  assert.equal(memories["About alice"]?.type, "user");
  assert.equal(memories["About alice"]?.auto, true);
  assert.equal(memories["acme/app"]?.type, "project");
  const harness = brain.kinds.skill.find((s) => s.name === HARNESS_SKILL);
  assert.match(harness?.skill.Tools?.text ?? "", /- skill_learn/);
  assert.match(harness?.skill.Connectors?.text ?? "", /acme\/app/);

  await json(h, "/api/app/brain", cookie, "POST", { kind: "memory", name: "acme/app", memory: { type: "project", description: "Our storefront", fact: "The storefront, written by hand." } });
  await json(h, "/api/app/sources", cookie, "POST", { repo: "acme/app" });
  const again = (await (await json(h, "/api/app/brain", cookie)).json()) as { kinds: { memory: Array<{ name: string; memory: { fact: string; auto: boolean } }> } };
  const mine = again.kinds.memory.find((m) => m.name === "acme/app");
  assert.equal(mine?.memory.fact, "The storefront, written by hand.", "automatic seeding never overwrites what a person wrote");
});

test("editing a skill in the app keeps what agents learned, and shows its heartbeat", async (t) => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "codex"));
  await call(agent, "skill_learn", { name: "Triage", part: "Soul", learned: "Reproduce before fixing." });

  const parts = Object.fromEntries(SKILL_PARTS.map((p) => [p, ""]));
  const saved = await json(h, "/api/app/brain", cookie, "POST", { kind: "skill", name: "Triage", parts: { ...parts, Skill: "Sort incoming bugs.", Connectors: "- gateway:tickets" } });
  assert.equal(saved.status, 200);

  const view = (await (await json(h, "/api/app/skill?name=Triage", cookie)).json()) as {
    parts: Record<string, { text: string; learned: Array<{ note: string }> }>;
    pulse: { state: string; learned: number };
    connectors: Array<{ name: string; connected: boolean }>;
  };
  assert.equal(view.parts.Skill?.text, "Sort incoming bugs.");
  assert.deepEqual(view.parts.Soul?.learned.map((l) => l.note), ["Reproduce before fixing."]);
  assert.equal(view.pulse.state, "fresh");
  assert.deepEqual(view.connectors, [{ name: "tickets", connected: false }], "connectors that are not connected yet are called out");

  h.clock.now += 40 * DAY;
  const later = (await (await json(h, "/api/app/skill?name=Triage", await sessionCookie(h, "gh-alice"))).json()) as { pulse: { state: string } };
  assert.equal(later.pulse.state, "stale");
});
