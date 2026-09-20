import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=host></div>");
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;

const { render } = await import("lit");
const map = await import("../src/brain-map.ts");
const {
  brainMapTpl,
  branchesFor,
  hubsFor,
  isGap,
  panelFields,
  radialLayout,
  skillKey,
  statusStage,
  treeLayout,
} = map;
type MapSkill = Parameters<typeof hubsFor>[0][number];

const host = dom.window.document.getElementById("host") as HTMLElement;

const skill = (over: Partial<MapSkill> & { name: string }): MapSkill => ({
  id: over.id ?? `id-${over.name}`,
  description: `what ${over.name} does`,
  scope: "channel",
  scopeId: "channel:ops",
  status: "published",
  version: 1,
  source: "native",
  ...over,
});

const ROWS: MapSkill[] = [
  skill({ name: "close-books" }),
  skill({ name: "chase-invoice", status: "draft" }),
  skill({ name: "triage", scope: "org", scopeId: "org:acme", pack: { packId: "anthropic", commit: "abcdef1234", upstreamName: "triage" } }),
  skill({ name: "standup", scope: "org", scopeId: "org:acme" }),
  skill({ name: "notes", scope: "personal", scopeId: "personal:ada", status: "reviewed" }),
];

const draw = (over: Partial<Parameters<typeof brainMapTpl>[0]> = {}): void => {
  render(
    brainMapTpl({
      skills: ROWS,
      scopeId: null,
      selectedKey: null,
      detail: null,
      detailError: "",
      loading: false,
      error: "",
      onScope: () => undefined,
      onSelect: () => undefined,
      ...over,
    }),
    host,
  );
};

const text = (): string => (host.textContent ?? "").replace(/\s+/g, " ");

test("a hub exists only for a scope the server actually returned skills for", () => {
  const hubs = hubsFor(ROWS.filter((row) => row.scopeId !== "org:acme"));
  assert.deepEqual(
    hubs.map((hub) => hub.scopeId),
    ["personal:ada", "channel:ops"],
  );
  assert.equal(hubsFor([]).length, 0);
  draw({ skills: ROWS.filter((row) => row.scopeId !== "org:acme") });
  assert.doesNotMatch(text(), /acme/);
  assert.equal(host.querySelectorAll(".brain-hub").length, 2);
});

test("each hub counts live against the total it was given, and nothing else", () => {
  const hubs = hubsFor(ROWS);
  const ops = hubs.find((hub) => hub.scopeId === "channel:ops");
  assert.equal(ops?.skills.length, 2);
  assert.equal(ops?.live, 1);
  draw();
  assert.match(text(), /1 of 2 live/);
  assert.match(text(), /2 of 2 live/);
});

test("radial positions are deterministic and land inside the viewBox", () => {
  const hubs = hubsFor(ROWS);
  const first = radialLayout(hubs);
  const second = radialLayout(hubsFor([...ROWS]));
  assert.deepEqual(first, second);
  const points = first.hubs.flatMap((entry) => [entry.at, ...entry.leaves.map((leaf) => leaf.at)]);
  assert.equal(points.length, hubs.length + ROWS.length);
  for (const point of points) {
    assert.ok(point.x >= 0 && point.x <= first.width, `x ${point.x} outside 0..${first.width}`);
    assert.ok(point.y >= 0 && point.y <= first.height, `y ${point.y} outside 0..${first.height}`);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});

test("a lone hub and a lone skill still get finite positions inside the viewBox", () => {
  const layout = radialLayout(hubsFor([skill({ name: "only" })]));
  const [entry] = layout.hubs;
  assert.ok(entry);
  for (const point of [entry.at, ...entry.leaves.map((leaf) => leaf.at)]) {
    assert.ok(point.x >= 0 && point.x <= layout.width && point.y >= 0 && point.y <= layout.height);
  }
});

test("the tree branches a scope by where its skills came from, and stays inside its viewBox", () => {
  const hub = hubsFor(ROWS).find((row) => row.scopeId === "org:acme");
  assert.ok(hub);
  const branches = branchesFor(hub);
  assert.deepEqual(
    branches.map((branch) => branch.name),
    ["Created here", "Pack anthropic"],
  );
  const layout = treeLayout(branches);
  assert.deepEqual(layout, treeLayout(branchesFor(hub)));
  for (const entry of layout.branches) {
    for (const point of [entry.at, ...entry.leaves.map((leaf) => leaf.at)]) {
      assert.ok(point.x >= 0 && point.x <= layout.width, `x ${point.x} outside the tree viewBox`);
      assert.ok(point.y >= 0 && point.y <= layout.height, `y ${point.y} outside the tree viewBox`);
    }
  }
  assert.ok(layout.root.x > 0 && layout.root.y > 0);
});

test("a tree deep enough to overflow grows its viewBox instead of spilling out", () => {
  const many = Array.from({ length: 24 }, (_, i) => skill({ name: `s${i}` }));
  const layout = treeLayout(branchesFor(hubsFor(many)[0]!));
  const lowest = Math.max(...layout.branches.flatMap((entry) => entry.leaves.map((leaf) => leaf.at.y)));
  assert.ok(lowest <= layout.height, `${lowest} below the ${layout.height} viewBox`);
});

test("status comes from the registry lifecycle, with no fourth invented state", () => {
  assert.equal(statusStage("published").label, "Live");
  assert.equal(statusStage("reviewed").label, "In development");
  assert.equal(statusStage("draft").label, "Not started");
  assert.equal(statusStage("archived").label, "Archived");
  assert.equal(statusStage(undefined).label, "Unknown");
});

test("the panel names every field it cannot source instead of inventing a value", () => {
  const fields = panelFields(ROWS[0]!, null);
  const gaps = fields.filter(isGap).map((field) => field.label);
  assert.deepEqual(gaps, ["Autonomy", "Breaks into", "Builds on", "What it replaces", "Your notes", "Live activity"]);
  for (const field of fields.filter(isGap)) assert.ok(field.gap.length > 20, `${field.label} gap is not explained`);
  for (const field of fields) {
    const value = isGap(field) ? field.gap : field.value;
    assert.doesNotMatch(value, /Fully autonomous/);
  }
});

test("the panel's sourced fields read the skill record, and files wait for the record", () => {
  const packed = ROWS[2]!;
  const before = panelFields(packed, null).find((field) => field.label === "What ships with it");
  assert.ok(before && !isGap(before));
  assert.equal(before.value, "0 files");
  const after = panelFields(packed, { files: [{ path: "run.sh", executable: true }, { path: "README.md" }] }).find(
    (field) => field.label === "What ships with it",
  );
  assert.ok(after && !isGap(after));
  assert.equal(after.value, "2 files, 1 runnable");
  const source = panelFields(packed, null).find((field) => field.label === "Source");
  assert.ok(source && !isGap(source));
  assert.equal(source.value, "Pack anthropic at abcdef1");
  const seen = panelFields(packed, null).find((field) => field.label === "Who can see it");
  assert.ok(seen && !isGap(seen));
  assert.equal(seen.value, "org:acme");
});

test("every hub and node is a real button, and the panel opens on the one that was clicked", () => {
  let scoped: string | null | undefined;
  let picked = "";
  draw({ onScope: (next) => (scoped = next), onSelect: (s) => (picked = s ? skillKey(s) : "") });
  const hubs = [...host.querySelectorAll(".brain-hub")];
  const nodes = [...host.querySelectorAll(".brain-node")];
  assert.equal(hubs.length, 3);
  assert.equal(nodes.length, ROWS.length);
  for (const el of [...hubs, ...nodes]) assert.equal(el.tagName, "BUTTON");
  (hubs[0] as HTMLElement).click();
  assert.equal(scoped, "org:acme");
  (nodes[0] as HTMLElement).click();
  assert.ok(picked.length, "clicking a node selects it");
  assert.equal(host.querySelector(".brain-panel"), null, "the panel only shows for the selected skill");

  draw({ selectedKey: skillKey(ROWS[0]!) });
  assert.equal(host.querySelectorAll(".brain-node.selected").length, 1);
  assert.match(host.querySelector(".brain-panel-title")?.textContent ?? "", /close-books/);
  assert.match(text(), /Not recorded yet/);
});

test("zooming into a scope shows its branches, its neighbours and the way back", () => {
  let scoped: string | null | undefined = "unset";
  draw({ scopeId: "org:acme", onScope: (next) => (scoped = next) });
  assert.equal(host.querySelectorAll(".brain-node").length, 2, "only that scope's skills are drawn");
  assert.equal(host.querySelectorAll(".brain-branch").length, 2);
  assert.equal(host.querySelectorAll(".brain-neighbour").length, 2);
  host.querySelector<HTMLButtonElement>(".brain-back")?.click();
  assert.equal(scoped, null);
  (host.querySelector(".brain-neighbour") as HTMLElement).click();
  assert.equal(scoped, "channel:ops", "the left arrow moves to the previous scope");
});

test("a failure to load says so rather than drawing an empty brain", () => {
  draw({ skills: [], error: "The brain map could not load your skills. Try again shortly." });
  assert.match(text(), /could not load/);
  assert.equal(host.querySelector(".brain-canvas"), null);
  assert.doesNotMatch(text(), /No skills to map/);

  draw({ skills: [] });
  assert.match(text(), /No skills to map/);
});
