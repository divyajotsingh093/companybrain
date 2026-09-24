import { html, nothing, svg, type TemplateResult } from "lit";
import { AlertTriangle, ArrowLeft, ArrowRight, Boxes, Brain, Network, X } from "lucide";
import { chip, emptyState, icon, type Tone } from "./ui.ts";

export interface MapSkill {
  id?: string;
  name: string;
  description: string;
  scope: string;
  scopeId?: string;
  status?: string;
  version?: number;
  source?: "native" | "pack";
  pack?: { packId: string; commit: string; upstreamName: string };
  assetCount?: number;
  requiredCapabilities?: string[];
  editable?: boolean;
  shadowed?: boolean;
}

export interface MapSkillDetail {
  files?: Array<{ path: string; executable?: boolean }>;
  createdBy?: string;
  grantedCapabilities?: string[];
  updatedAt?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Placed<T> {
  item: T;
  at: Point;
}

export interface Hub {
  scopeId: string;
  label: string;
  kind: string;
  skills: MapSkill[];
  live: number;
}

export interface Branch {
  name: string;
  skills: MapSkill[];
}

export interface RadialLayout {
  width: number;
  height: number;
  centre: Point;
  hubs: Array<{ hub: Hub; at: Point; leaves: Array<Placed<MapSkill>> }>;
}

export interface TreeLayout {
  width: number;
  height: number;
  root: Point;
  branches: Array<{ branch: Branch; at: Point; leaves: Array<Placed<MapSkill>> }>;
}

export type PanelField = { label: string; value: string; note?: string } | { label: string; gap: string };

const VIEW = { width: 1000, height: 640 };
const COLUMN = 232;
const ROW = 64;
const BRANCH_Y = 148;
const LEAF_TOP = 196;

const round = (n: number): number => Math.round(n * 100) / 100;

export function skillKey(skill: MapSkill): string {
  return skill.id ?? `${skill.scopeId ?? skill.scope}/${skill.name}`;
}

export function isLive(skill: MapSkill): boolean {
  return skill.status === "published";
}

export function scopeLabel(scopeId: string): string {
  const cut = scopeId.indexOf(":");
  return (cut >= 0 ? scopeId.slice(cut + 1) : scopeId) || scopeId;
}

export function kindLabel(kind: string): string {
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Scope";
}

export function branchName(skill: MapSkill): string {
  const packId = skill.pack?.packId;
  return packId ? `Pack ${packId}` : "Created here";
}

export function hubsFor(skills: readonly MapSkill[]): Hub[] {
  const byScope = new Map<string, MapSkill[]>();
  for (const skill of skills) {
    const key = skill.scopeId ?? skill.scope;
    const rows = byScope.get(key) ?? [];
    rows.push(skill);
    byScope.set(key, rows);
  }
  return [...byScope.entries()]
    .map(([scopeId, rows]) => ({
      scopeId,
      label: scopeLabel(scopeId),
      kind: rows[0]!.scope,
      skills: [...rows].sort((a, b) => a.name.localeCompare(b.name)),
      live: rows.filter(isLive).length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function branchesFor(hub: Hub): Branch[] {
  const byBranch = new Map<string, MapSkill[]>();
  for (const skill of hub.skills) {
    const key = branchName(skill);
    const rows = byBranch.get(key) ?? [];
    rows.push(skill);
    byBranch.set(key, rows);
  }
  return [...byBranch.entries()]
    .map(([name, skills]) => ({ name, skills }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function liveCountLabel(live: number, total: number): string {
  return `${live} of ${total} live`;
}

function onEllipse(centre: Point, rx: number, ry: number, angle: number, reach: number): Point {
  return {
    x: round(centre.x + rx * reach * Math.cos(angle)),
    y: round(centre.y + ry * reach * Math.sin(angle)),
  };
}

export function radialLayout(hubs: readonly Hub[]): RadialLayout {
  const centre = { x: VIEW.width / 2, y: VIEW.height / 2 };
  const rx = centre.x - 120;
  const ry = centre.y - 60;
  const spokes = Math.max(hubs.length, 1);
  const arc = ((Math.PI * 2) / spokes) * 0.78;
  return {
    width: VIEW.width,
    height: VIEW.height,
    centre,
    hubs: hubs.map((hub, index) => {
      const angle = -Math.PI / 2 + ((Math.PI * 2) / spokes) * index;
      const leaves = hub.skills.map((skill, leafIndex) => {
        const count = hub.skills.length;
        const offset = count > 1 ? (leafIndex - (count - 1) / 2) / (count - 1) : 0;
        const reach = leafIndex % 2 === 0 ? 1 : 0.84;
        return { item: skill, at: onEllipse(centre, rx, ry, angle + arc * offset, reach) };
      });
      return { hub, at: onEllipse(centre, rx, ry, angle, 0.5), leaves };
    }),
  };
}

export function treeLayout(branches: readonly Branch[]): TreeLayout {
  const columns = Math.max(branches.length, 1);
  const width = Math.max(VIEW.width, (columns + 1) * COLUMN);
  const deepest = branches.reduce((most, branch) => Math.max(most, branch.skills.length), 1);
  const height = Math.max(VIEW.height, LEAF_TOP + deepest * ROW + 32);
  const inset = COLUMN / 2;
  return {
    width,
    height,
    root: { x: width / 2, y: 48 },
    branches: branches.map((branch, index) => {
      const x = round(inset + ((width - inset * 2) * (index + 0.5)) / columns);
      return {
        branch,
        at: { x, y: BRANCH_Y },
        leaves: branch.skills.map((skill, leafIndex) => ({
          item: skill,
          at: { x, y: round(LEAF_TOP + (leafIndex + 0.5) * ROW) },
        })),
      };
    }),
  };
}

export function statusStage(status?: string): { label: string; tone: Tone } {
  if (status === "published") return { label: "Live", tone: "ok" };
  if (status === "reviewed") return { label: "In development", tone: "info" };
  if (status === "archived") return { label: "Archived", tone: "neutral" };
  if (status === "draft") return { label: "Not started", tone: "warn" };
  return { label: "Unknown", tone: "neutral" };
}

export function isGap(field: PanelField): field is { label: string; gap: string } {
  return "gap" in field;
}

export function panelFields(skill: MapSkill, detail: MapSkillDetail | null): PanelField[] {
  const files = detail?.files;
  const runnable = files?.filter((file) => file.executable).length ?? 0;
  const fileCount = files?.length ?? skill.assetCount ?? 0;
  const capabilities = skill.requiredCapabilities ?? [];
  return [
    {
      label: "Autonomy",
      gap: "The registry records no autonomy level on a skill. What it may do is decided by the approval rules of the scope it runs in, not by a label here.",
    },
    { label: "Where it sits", value: `${kindLabel(skill.scope)} · ${branchName(skill)}` },
    {
      label: "Status",
      value: statusStage(skill.status).label,
      note: "Read from the skill's lifecycle in the registry. Real run history is not wired into this view yet, so this is not proof it has run.",
    },
    {
      label: "What ships with it",
      value: files
        ? `${fileCount} file${fileCount === 1 ? "" : "s"}, ${runnable} runnable`
        : `${fileCount} file${fileCount === 1 ? "" : "s"}`,
      note: files ? undefined : "Which of them are runnable comes with the skill's own record.",
    },
    { label: "Version", value: `v${skill.version ?? 1}${skill.shadowed ? " · overridden in a narrower scope" : ""}` },
    {
      label: "Who can see it",
      value: skill.scopeId ?? kindLabel(skill.scope),
      note: "Everyone with access to that scope, and nobody else. This map only draws what the server returned for you.",
    },
    {
      label: "Capabilities it asks for",
      value: capabilities.length ? capabilities.join(", ") : "None required",
    },
    {
      label: "Source",
      value: skill.pack ? `Pack ${skill.pack.packId} at ${skill.pack.commit.slice(0, 7)}` : "Created here",
    },
    { label: "Breaks into", gap: "Skills do not compose into sub-skills yet, so there is nothing to list." },
    { label: "Builds on", gap: "No prerequisite edges are recorded, so nothing can be drawn here." },
    { label: "What it replaces", gap: "No value statement is authored alongside a skill yet." },
    { label: "Your notes", gap: "Per-user skill configuration does not exist yet." },
    {
      label: "Live activity",
      gap: "Which agent is running it, open claims, pending approvals and recent runs are not exposed by the skills API yet.",
    },
  ];
}

export interface BrainMapTplOpts {
  skills: MapSkill[];
  scopeId: string | null;
  selectedKey: string | null;
  detail: MapSkillDetail | null;
  detailError: string;
  loading: boolean;
  error: string;
  onScope: (scopeId: string | null) => void;
  onSelect: (skill: MapSkill | null) => void;
}

function edgeTpl(from: Point, to: Point, kind: string): TemplateResult {
  return svg`<line class="brain-edge ${kind}" x1=${from.x} y1=${from.y} x2=${to.x} y2=${to.y} />`;
}

function at(point: Point, width: number, height: number): string {
  return `left:${round((point.x / width) * 100)}%;top:${round((point.y / height) * 100)}%`;
}

function hubButtonTpl(entry: RadialLayout["hubs"][number], layout: RadialLayout, onScope: BrainMapTplOpts["onScope"]): TemplateResult {
  const { hub } = entry;
  return html`<button
    class="brain-hub"
    type="button"
    style=${at(entry.at, layout.width, layout.height)}
    @click=${() => onScope(hub.scopeId)}
  >
    <span class="brain-hub-name">${hub.label}</span>
    <span class="brain-hub-kind">${kindLabel(hub.kind)}</span>
    <span class="brain-hub-count">${liveCountLabel(hub.live, hub.skills.length)}</span>
  </button>`;
}

interface LeafOpts {
  width: number;
  height: number;
  selectedKey: string | null;
  neighbour: boolean;
  onSelect: BrainMapTplOpts["onSelect"];
}

function leafButtonTpl(skill: MapSkill, point: Point, o: LeafOpts): TemplateResult {
  const { width, height, selectedKey, onSelect } = o;
  const key = skillKey(skill);
  const selected = key === selectedKey;
  return html`<button
    class="brain-node ${selected ? "selected" : ""} ${!selected && o.neighbour ? "neighbour" : ""} ${isLive(skill) ? "live" : ""}"
    type="button"
    aria-pressed=${selected ? "true" : "false"}
    style=${at(point, width, height)}
    @click=${() => onSelect(selected ? null : skill)}
  >
    <span class="brain-node-dot" aria-hidden="true"></span>
    <span class="brain-node-name">${skill.name}</span>
  </button>`;
}

function constellationTpl(o: BrainMapTplOpts, hubs: Hub[]): TemplateResult {
  const layout = radialLayout(hubs);
  return html`<div class="brain-canvas-scroll">
    <div class="brain-canvas" style="aspect-ratio:${layout.width} / ${layout.height}">
      <svg class="brain-wires" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">
        ${layout.hubs.map((entry) => [
          edgeTpl(layout.centre, entry.at, "trunk"),
          ...entry.leaves.map((leaf) => edgeTpl(entry.at, leaf.at, "spoke")),
        ])}
      </svg>
      <span class="brain-core" style=${at(layout.centre, layout.width, layout.height)}>
        ${icon(Brain, 22)}<span class="brain-core-label">The brain</span>
      </span>
      ${layout.hubs.map((entry) => {
        const neighbour = entry.leaves.some((leaf) => skillKey(leaf.item) === o.selectedKey);
        return [
          hubButtonTpl(entry, layout, o.onScope),
          ...entry.leaves.map((leaf) =>
            leafButtonTpl(leaf.item, leaf.at, {
              width: layout.width,
              height: layout.height,
              selectedKey: o.selectedKey,
              neighbour,
              onSelect: o.onSelect,
            }),
          ),
        ];
      })}
    </div>
  </div>`;
}

function treeTpl(o: BrainMapTplOpts, hub: Hub): TemplateResult {
  const branches = branchesFor(hub);
  const layout = treeLayout(branches);
  const selectedBranch = branches.find((branch) => branch.skills.some((skill) => skillKey(skill) === o.selectedKey));
  return html`<div class="brain-canvas-scroll">
    <div class="brain-canvas" style="aspect-ratio:${layout.width} / ${layout.height}">
      <svg class="brain-wires" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true" focusable="false">
        ${layout.branches.map((entry) => [
          edgeTpl(layout.root, entry.at, "trunk"),
          ...entry.leaves.map((leaf) => edgeTpl(entry.at, leaf.at, "spoke")),
        ])}
      </svg>
      <span class="brain-core" style=${at(layout.root, layout.width, layout.height)}>
        ${icon(Network, 20)}<span class="brain-core-label">${hub.label}</span>
      </span>
      ${layout.branches.map(
        (entry) => html`<span
          class="brain-branch ${selectedBranch?.name === entry.branch.name ? "selected" : ""}"
          style=${at(entry.at, layout.width, layout.height)}
          >${entry.branch.name}<small>${liveCountLabel(entry.branch.skills.filter(isLive).length, entry.branch.skills.length)}</small></span
        >`,
      )}
      ${layout.branches.map((entry) =>
        entry.leaves.map((leaf) =>
          leafButtonTpl(leaf.item, leaf.at, {
            width: layout.width,
            height: layout.height,
            selectedKey: o.selectedKey,
            neighbour: selectedBranch?.name === entry.branch.name,
            onSelect: o.onSelect,
          }),
        ),
      )}
    </div>
  </div>`;
}

function neighbourTpl(hubs: Hub[], current: Hub, onScope: BrainMapTplOpts["onScope"]): TemplateResult {
  const index = hubs.findIndex((hub) => hub.scopeId === current.scopeId);
  const previous = hubs[(index - 1 + hubs.length) % hubs.length];
  const next = hubs[(index + 1) % hubs.length];
  if (hubs.length < 2 || !previous || !next) return html`<div class="brain-neighbours"></div>`;
  return html`<div class="brain-neighbours">
    <button class="btn brain-neighbour" type="button" @click=${() => onScope(previous.scopeId)}>
      ${icon(ArrowLeft, 15)}<span>${previous.label}</span>
    </button>
    <button class="btn brain-neighbour" type="button" @click=${() => onScope(next.scopeId)}>
      <span>${next.label}</span>${icon(ArrowRight, 15)}
    </button>
  </div>`;
}

function panelTpl(o: BrainMapTplOpts, skill: MapSkill): TemplateResult {
  const stage = statusStage(skill.status);
  return html`<aside class="brain-panel" aria-label=${`Skill ${skill.name}`}>
    <div class="brain-panel-head">
      <div>
        <span class="brain-panel-crumb">${kindLabel(skill.scope)} · ${branchName(skill)}</span>
        <h2 class="brain-panel-title">${skill.name}</h2>
      </div>
      <button class="btn brain-panel-close" type="button" @click=${() => o.onSelect(null)} aria-label="Close the skill panel">
        ${icon(X, 15)}
      </button>
    </div>
    <p class="brain-panel-lede">${skill.description}</p>
    <p class="brain-panel-stage">${chip(stage.label, stage.tone)}</p>
    ${o.detailError ? html`<p class="brain-panel-error">${icon(AlertTriangle, 14)}<span>${o.detailError}</span></p>` : nothing}
    <dl class="brain-panel-fields">
      ${panelFields(skill, o.detail).map((field) =>
        isGap(field)
          ? html`<div class="brain-field gap">
              <dt>${field.label}</dt>
              <dd><span class="brain-gap-mark">Not recorded yet</span><span>${field.gap}</span></dd>
            </div>`
          : html`<div class="brain-field">
              <dt>${field.label}</dt>
              <dd>${field.value}${field.note ? html`<small>${field.note}</small>` : nothing}</dd>
            </div>`,
      )}
    </dl>
  </aside>`;
}
function emptyTpl(o: BrainMapTplOpts): unknown {
  if (o.loading) return html`<p class="empty compact">Loading…</p>`;
  if (o.error) return nothing;
  return emptyState({
    glyph: Boxes,
    headline: "No skills to map",
    body: "Skills you can see appear here as soon as one exists in a scope you belong to.",
  });
}

function bodyTpl(o: BrainMapTplOpts, hubs: Hub[], hub: Hub | undefined): unknown {
  if (!o.skills.length) return emptyTpl(o);
  if (hub) return html`${neighbourTpl(hubs, hub, o.onScope)}${treeTpl(o, hub)}`;
  return constellationTpl(o, hubs);
}


export function brainMapTpl(o: BrainMapTplOpts): TemplateResult {
  const hubs = hubsFor(o.skills);
  const hub = o.scopeId ? hubs.find((row) => row.scopeId === o.scopeId) : undefined;
  const shown = hub ? hub.skills : o.skills;
  const selected = o.selectedKey ? o.skills.find((skill) => skillKey(skill) === o.selectedKey) : undefined;
  return html`
    <div class="brain-map">
      <div class="brain-head">
        <span class="brain-eyebrow">${icon(Boxes, 15)}<span>Brain map</span></span>
        <h1 class="brain-title">${hub ? hub.label : "Every scope you can see"}</h1>
        <p class="brain-sub">
          ${hub
            ? html`Branches are where the skills came from. ${liveCountLabel(hub.live, hub.skills.length)}.`
            : html`One hub per scope, its skills radiating out.
                ${liveCountLabel(shown.filter(isLive).length, shown.length)} across ${hubs.length}
                ${hubs.length === 1 ? "scope" : "scopes"}.`}
        </p>
        ${hub
          ? html`<button class="btn brain-back" type="button" @click=${() => o.onScope(null)}>
              ${icon(ArrowLeft, 15)}<span>All scopes</span>
            </button>`
          : nothing}
      </div>
      ${o.error ? html`<div class="brain-error">${icon(AlertTriangle, 16)}<span>${o.error}</span></div>` : nothing}
      ${bodyTpl(o, hubs, hub)}
      ${selected ? panelTpl(o, selected) : nothing}
    </div>
  `;
}
