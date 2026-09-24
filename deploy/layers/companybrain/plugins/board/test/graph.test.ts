import assert from "node:assert/strict";
import test from "node:test";
import { extractLinks } from "../src/store.ts";
import { agentToken, buildApp, call, connectAgent } from "./fixtures.ts";

test("writing what you know also records what it connects to", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  await call(agent, "brain_write", {
    kind: "project",
    name: "Billing rewrite",
    body: "Moving invoices off the legacy adapter in acme/app.\nConstrained by [[Refunds must reconcile]] and follows [[Release checklist]].",
  });
  await call(agent, "brain_write", { kind: "rule", name: "Refunds must reconcile", body: "No refund path ships without a reconciliation test." });

  const links = await call(agent, "brain_links", { name: "Billing rewrite" });
  assert.equal(links.isError, false);
  assert.match(links.text, /repo: acme\/app/, "the repository it touches");
  assert.match(links.text, /entry: Refunds must reconcile/, "the rule that constrains it");
  assert.match(links.text, /entry: Release checklist/, "and the process it follows");

  const back = await call(agent, "brain_links", { name: "Refunds must reconcile" });
  assert.match(back.text, /Points at Refunds must reconcile/);
  assert.match(back.text, /project: Billing rewrite/, "the rule knows what depends on it");
});

test("the ontology covers how a company actually thinks, not just notes", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  for (const kind of ["process", "rule", "lesson", "record", "role"]) {
    const written = await call(agent, "brain_write", { kind, name: `a ${kind}`, body: `this is a ${kind}` });
    assert.equal(written.isError, false, `${kind} should be a first class kind`);
  }

  const rules = await call(agent, "brain_read", { kind: "rule" });
  assert.match(rules.text, /a rule/);
  const lessons = await call(agent, "brain_read", { kind: "lesson" });
  assert.match(lessons.text, /a lesson/);
  assert.doesNotMatch(lessons.text, /a rule/, "kinds stay separate");
});

test("rewriting an entry rewrites its connections instead of piling them up", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  await call(agent, "brain_write", { kind: "project", name: "Migration", body: "Touches acme/app and [[Old plan]]." });
  await call(agent, "brain_write", { kind: "project", name: "Migration", body: "Now only touches acme/api." });

  const links = await call(agent, "brain_links", { name: "Migration" });
  assert.match(links.text, /repo: acme\/api/);
  assert.doesNotMatch(links.text, /Old plan/, "a link removed from the body is removed from the graph");
  assert.doesNotMatch(links.text, /acme\/app/, "and so is a stale repository");
});

test("removing an entry removes its edges, leaving no dangling graph", async (t) => {
  const h = await buildApp();
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));

  await call(agent, "brain_write", { kind: "memory", name: "Temporary", body: "About acme/app." });
  await call(agent, "brain_forget", { kind: "memory", name: "Temporary" });

  const links = await call(agent, "brain_links", { name: "Temporary" });
  assert.match(links.text, /Nothing connects to Temporary/);
  assert.equal((await h.store.graph(1)).length, 0);
});

test("one account's graph is not another account's", async (t) => {
  const h = await buildApp();
  const alice = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  const carol = await connectAgent(t, h, await agentToken(h, "gh-carol", "codex"));

  await call(alice, "brain_write", { kind: "project", name: "Secret work", body: "In acme/app, blocked by [[Some rule]]." });

  const leaked = await call(carol, "brain_links", { name: "Secret work" });
  assert.match(leaked.text, /Nothing connects to Secret work/, "carol sees no edges of alice's");
  assert.equal((await h.store.graph(2)).length, 0);
});

test("link extraction takes real references and ignores ordinary prose", async () => {
  const found = extractLinks("Fixes [[Login loop]] in acme/app. See also docs/setup.md and 3/4 of the cases.");
  const names = found.map((f) => `${f.toKind}:${f.toName}`);
  assert.ok(names.includes("entry:Login loop"));
  assert.ok(names.includes("repo:acme/app"));
  assert.ok(!names.some((n) => n.includes("3/4")), "a fraction is not a repository");

  const selfOnly = extractLinks("No references at all here.");
  assert.equal(selfOnly.length, 0);
});
