import type { EventKind, PostType } from "./store.ts";
import { AGENT_CLIENTS, isAgentClient, type AgentClient } from "./token.ts";
import { escapeHtml, relative } from "./web.ts";

export type Lane = AgentClient | "human";

export const LANES: readonly Lane[] = [...AGENT_CLIENTS, "human"];

const LANE_LABELS: Record<Lane, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  human: "People",
};

const LANE_COLOURS: Record<Lane, string> = {
  claude_code: "var(--warn)",
  codex: "var(--info)",
  cursor: "var(--danger)",
  grok: "var(--accent)",
  human: "var(--muted)",
};

const VERBS: Record<EventKind, string> = {
  "post.created": "posted",
  "claim.released": "released",
  "post.closed": "closed",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface SwimlaneEvent {
  id: number;
  at: number;
  kind: EventKind;
  postId: string;
  postType: PostType;
  title: string;
  actorLogin: string;
  client: string;
  recipient: string | null;
  expiresAt: number | null;
  releasedAt: number | null;
  closedAt: number | null;
}

export interface Placed {
  event: SwimlaneEvent;
  lane: Lane;
  toLane: Lane | null;
  row: number;
  startCol: number;
  endCol: number;
  forward: boolean;
  stamp: string | null;
}

export function laneOf(client: string): Lane {
  return isAgentClient(client) ? client : "human";
}

function columnOf(lane: Lane): number {
  return LANES.indexOf(lane) + 2;
}

export function bucketSize(spanMs: number): number {
  return spanMs <= 2 * HOUR_MS ? MINUTE_MS : spanMs <= 2 * DAY_MS ? HOUR_MS : DAY_MS;
}

function bucketLabel(at: number, size: number): string {
  const iso = new Date(at).toISOString();
  return size >= DAY_MS ? iso.slice(0, 10) : iso.slice(11, 16);
}

export function layout(events: SwimlaneEvent[]): Placed[] {
  const ordered = [...events].sort((a, b) => a.at - b.at || a.id - b.id);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const size = bucketSize(first && last ? last.at - first.at : 0);
  const placed: Placed[] = [];
  let bucket = Number.NaN;
  for (const event of ordered) {
    const lane = laneOf(event.client);
    const recipient = event.postType === "handoff" && event.recipient ? laneOf(event.recipient) : null;
    const toLane = recipient && recipient !== lane ? recipient : null;
    const from = columnOf(lane);
    const to = toLane ? columnOf(toLane) : from;
    const key = Math.floor(event.at / size);
    const fresh = key !== bucket;
    bucket = key;
    placed.push({
      event,
      lane,
      toLane,
      row: placed.length + 2,
      startCol: Math.min(from, to),
      endCol: Math.max(from, to) + 1,
      forward: to > from,
      stamp: fresh ? bucketLabel(event.at, size) : null,
    });
  }
  return placed;
}

const STYLE = `
.swim-wrap { border:1px solid var(--line); border-radius:14px; background:var(--panel); padding:14px; overflow:hidden; }
.swim { display:grid; grid-template-columns:52px repeat(${LANES.length}, minmax(0,1fr)); gap:6px 5px; align-items:start; }
.swim-head { grid-row:1; position:sticky; top:0; font:600 11px var(--mono); text-transform:uppercase; letter-spacing:.06em;
             color:var(--lane); border-bottom:2px solid var(--lane); padding:0 4px 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.swim-axis { grid-column:1; grid-row:1; font:600 11px var(--mono); color:var(--muted); padding:0 0 6px; border-bottom:2px solid var(--line); }
.swim-stamp { grid-column:1; font:12px var(--mono); color:var(--muted); padding-top:5px; white-space:nowrap; }
.swim-ev { --lane:var(--muted); min-width:0; border:1px solid var(--line); border-left:3px solid var(--lane); border-radius:8px;
           background:var(--panel-2); padding:5px 8px; font-size:13px; }
.swim-ev > summary { cursor:pointer; list-style:none; display:block; min-width:0; }
.swim-ev > summary::-webkit-details-marker { display:none; }
.swim-lane { display:none; }
.swim-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; transition:color .15s; }
.swim-ev:hover .swim-title, .swim-ev:focus-within .swim-title { color:var(--lane); }
.swim-ev[open] .swim-title { white-space:normal; overflow-wrap:anywhere; }
.swim-meta { font:12px var(--mono); color:var(--muted); margin:6px 0 0; overflow-wrap:anywhere; }
.swim-ev.cross { border-style:dashed; border-left-style:solid; position:relative; }
.swim-ev.cross::after { content:"\\25B8"; position:absolute; top:4px; right:6px; color:var(--to-lane); }
.swim-ev.cross.back::after { content:"\\25C2"; right:auto; left:6px; }
.swim-ev.cross.back { border-left:1px dashed var(--line); border-right:3px solid var(--lane); }
.swim-ev.cross.back > summary { text-align:right; }
.swim-ev.closed { opacity:.62; }
.swim-ev.closed .swim-title { text-decoration:line-through; }
.swim-ttl { display:block; height:4px; border-radius:999px; background:var(--line); margin-top:7px; overflow:hidden; }
.swim-ttl > span { display:block; height:100%; background:var(--warn); animation:swim-drain var(--drain,0s) linear forwards; }
@keyframes swim-drain { to { width:0; } }
.swim-empty { color:var(--muted); font-size:14px; margin:0; padding:10px 4px; }
@media (max-width:640px) {
  .swim { grid-template-columns:minmax(0,1fr); }
  .swim-head, .swim-axis { display:none; }
  .swim-stamp { grid-column:1 !important; grid-row:auto !important; padding-top:10px; }
  .swim-ev { grid-column:1 !important; grid-row:auto !important; }
  .swim-ev.cross.back > summary { text-align:left; padding-left:14px; }
  .swim-lane { display:block; font:600 10px var(--mono); text-transform:uppercase; letter-spacing:.06em; color:var(--lane); margin-bottom:3px; }
}
@media (prefers-reduced-motion: reduce) { .swim-ev *, .swim-ttl > span { animation:none !important; transition:none !important; } }
`;

function chip(p: Placed, now: number): string {
  const { event } = p;
  const closed = event.closedAt !== null || event.releasedAt !== null || event.kind !== "post.created";
  const live = event.expiresAt !== null && !closed && event.expiresAt > now;
  const remaining = live ? (event.expiresAt as number) - now : 0;
  const total = Math.max(1, (event.expiresAt ?? 0) - event.at);
  const ttl = live
    ? `<span class="swim-ttl" role="img" aria-label="Claim expires ${escapeHtml(relative(event.expiresAt as number, now))}"><span style="width:${Math.min(100, Math.round((remaining / total) * 100))}%;--drain:${Math.round(remaining / 1000)}s"></span></span>`
    : "";
  const meta = [
    `${escapeHtml(event.actorLogin)} via ${escapeHtml(event.client)}`,
    `${VERBS[event.kind]} ${escapeHtml(event.postType)}`,
    relative(event.at, now),
    p.toLane ? `to ${escapeHtml(LANE_LABELS[p.toLane])}` : "",
    event.recipient && !p.toLane ? `for ${escapeHtml(event.recipient)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const classes = ["swim-ev", p.toLane ? "cross" : "", p.toLane && !p.forward ? "back" : "", closed ? "closed" : ""].filter(Boolean).join(" ");
  const style = `grid-row:${p.row};grid-column:${p.startCol}/${p.endCol};--lane:${LANE_COLOURS[p.lane]}${p.toLane ? `;--to-lane:${LANE_COLOURS[p.toLane]}` : ""}`;
  const badge = `<span class="swim-lane">${escapeHtml(LANE_LABELS[p.lane])}${p.toLane ? ` &rarr; ${escapeHtml(LANE_LABELS[p.toLane])}` : ""}</span>`;
  return `<details class="${classes}" style="${style}"><summary>${badge}<span class="swim-title">${escapeHtml(event.title)}</span>${ttl}</summary><p class="swim-meta">${meta}</p></details>`;
}

export function swimlaneTpl(opts: { events: SwimlaneEvent[]; now: number }): string {
  if (!opts.events.length) {
    return `<section class="swim-wrap" aria-label="Agent swimlane timeline"><style>${STYLE}</style>
<p class="swim-empty">No activity yet. Every claim, finding, handoff, release and close lands in its agent's lane here, oldest first, with handoffs drawn across to the lane they are addressed to.</p></section>`;
  }
  const heads = LANES.map(
    (lane) => `<span class="swim-head" style="grid-column:${columnOf(lane)};--lane:${LANE_COLOURS[lane]}">${escapeHtml(LANE_LABELS[lane])}</span>`,
  ).join("");
  const placed = layout(opts.events);
  const cells = placed
    .map((p) => `${p.stamp ? `<span class="swim-stamp" style="grid-row:${p.row}">${escapeHtml(p.stamp)}</span>` : ""}${chip(p, opts.now)}`)
    .join("");
  return `<section class="swim-wrap" aria-label="Agent swimlane timeline"><style>${STYLE}</style>
<div class="swim"><span class="swim-axis">UTC</span>${heads}${cells}</div></section>`;
}
