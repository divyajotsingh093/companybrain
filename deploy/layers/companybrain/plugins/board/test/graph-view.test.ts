import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, ORIGIN, sessionCookie } from "./fixtures.ts";

type View = {
  nodes: Array<{ id: string; kind: string; label: string; detail: string | null }>;
  edges: Array<{ source: string; target: string; relation: string }>;
  purposes: Record<string, string>;
};

const graph = async (h: Awaited<ReturnType<typeof buildApp>>, who: string): Promise<View> =>
  (await (await h.app.fetch(new Request(`${ORIGIN}/api/app/graph`, { headers: { cookie: await sessionCookie(h, who) } }))).json()) as View;

test("the graph joins entries, repositories, documents and decisions into one picture", async () => {
  const h = await buildApp();
  await h.store.putEntry({ kind: "project", ownerUid: 1, name: "Billing rewrite", body: "In acme/app. Constrained by [[Refunds must reconcile]]." });
  await h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Refunds must reconcile", body: "Every refund path needs a reconciliation test." });
  await h.store.putDocument({ ownerUid: 1, repoId: 100, repoName: "acme/app", path: "docs/billing.md", title: "Billing", body: "Refunds live in the adapter." });
  await h.store.addPost({ repoId: 100, repoName: "acme/app", type: "decision", title: "Drop the legacy column?", body: "Unsure.", authorLogin: "alice", authorUid: 1, client: "claude_code", system: true });

  const v = await graph(h, "gh-alice");
  const kinds = new Set(v.nodes.map((n) => n.kind));
  for (const k of ["project", "rule", "repo", "document", "decision"]) assert.ok(kinds.has(k), `${k} is in the graph`);

  const has = (from: string, to: string, rel: string) => v.edges.some((e) => e.source === from && e.target === to && e.relation === rel);
  assert.ok(has("entry:project:billing rewrite", "repo:acme/app", "mentions"));
  assert.ok(has("entry:project:billing rewrite", "entry:rule:refunds must reconcile", "links"));
  assert.ok(has("doc:100/docs/billing.md", "repo:acme/app", "documents"));
  assert.ok(v.edges.some((e) => e.relation === "decided" && e.target === "repo:acme/app"), "the decision hangs off its repository");
  assert.equal(v.nodes.find((n) => n.kind === "decision")?.detail, "Waiting on you");

  for (const e of v.edges) {
    assert.ok(v.nodes.some((n) => n.id === e.source), `edge source ${e.source} exists`);
    assert.ok(v.nodes.some((n) => n.id === e.target), `edge target ${e.target} exists`);
  }
  assert.ok(v.purposes.rule, "the ontology definitions travel with the graph");
});

test("a reference to something never written down shows up as a gap", async () => {
  const h = await buildApp();
  await h.store.putEntry({ kind: "process", ownerUid: 1, name: "Onboarding", body: "Follow [[Laptop setup]] then [[Access requests]]." });
  await h.store.putEntry({ kind: "process", ownerUid: 1, name: "Laptop setup", body: "Install the toolchain." });

  const v = await graph(h, "gh-alice");
  assert.equal(v.nodes.find((n) => n.id === "entry:process:laptop setup")?.kind, "process", "a written entry keeps its kind");
  const gap = v.nodes.find((n) => n.id === "missing:access requests");
  assert.equal(gap?.kind, "missing", "an unwritten one is marked as missing knowledge");
  assert.match(gap?.detail ?? "", /never written down/);
});

test("the graph hides documents and decisions from repositories you cannot reach", async () => {
  const h = await buildApp();
  await h.store.putDocument({ ownerUid: 1, repoId: 999, repoName: "secret-org/private-thing", path: "docs/keys.md", title: "Keys", body: "vault path prod/staging" });
  await h.store.addPost({ repoId: 999, repoName: "secret-org/private-thing", type: "decision", title: "Rotate the key?", body: "x", authorLogin: "alice", authorUid: 1, client: "codex", system: true });

  const v = await graph(h, "gh-alice");
  assert.ok(!v.nodes.some((n) => n.label === "Keys" || n.label === "Rotate the key?"), "nothing from the unreachable repo");
});

test("one person's graph is empty to another, and signed-out callers are refused", async () => {
  const h = await buildApp();
  await h.store.putEntry({ kind: "project", ownerUid: 1, name: "Secret work", body: "In acme/app." });

  const carol = await graph(h, "gh-carol");
  assert.equal(carol.nodes.length, 0);
  assert.equal(carol.edges.length, 0);

  assert.equal((await h.app.fetch(new Request(`${ORIGIN}/api/app/graph`))).status, 401);
});
