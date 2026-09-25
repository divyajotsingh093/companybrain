import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { kindColor } from "./kinds";
import { tokens, type Palette } from "./ui";

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  purposes: Record<string, string>;
  now: number;
}

export interface SimNode extends SimulationNodeDatum, GraphNode {
  r: number;
  degree: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  relation: string;
  from: string;
  to: string;
}

interface Neighbor {
  node: SimNode;
  relation: string;
  outgoing: boolean;
}

export interface Model {
  nodes: SimNode[];
  links: SimLink[];
  byId: Map<string, SimNode>;
  around: Map<string, Neighbor[]>;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export const LABEL_CHAR = 0.56;
export const LABEL_GAP = 14;

function radius(kind: string, degree: number): number {
  if (kind === "repo") return Math.min(26, 12 + Math.sqrt(degree) * 2.6);
  if (kind === "document") return 3.2;
  if (kind === "decision") return 6.5;
  if (kind === "missing") return Math.min(12, 5 + Math.sqrt(degree) * 1.6);
  return Math.min(18, 5 + Math.sqrt(degree) * 2.4);
}

export function waiting(node: GraphNode): boolean {
  return node.kind === "decision" && node.detail === "Waiting on you";
}

export function buildModel(view: GraphView): Model {
  const byId = new Map<string, SimNode>();
  for (const n of view.nodes) byId.set(n.id, { ...n, r: 0, degree: 0 });
  const around = new Map<string, Neighbor[]>();
  const links: SimLink[] = [];
  view.edges.forEach((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || a === b) return;
    a.degree += 1;
    b.degree += 1;
    links.push({ source: a.id, target: b.id, from: a.id, to: b.id, relation: e.relation });
    around.set(a.id, [...(around.get(a.id) ?? []), { node: b, relation: e.relation, outgoing: true }]);
    around.set(b.id, [...(around.get(b.id) ?? []), { node: a, relation: e.relation, outgoing: false }]);
  });
  const rank = (n: SimNode): number => (n.kind === "repo" ? 0 : waiting(n) ? 1 : n.kind === "document" ? 4 : n.kind === "missing" ? 3 : 2);
  const nodes = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.degree - a.degree);
  for (const n of nodes) n.r = radius(n.kind, n.degree);
  return { nodes, links, byId, around };
}

export function bounds(nodes: SimNode[]): [number, number, number, number] | null {
  if (!nodes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, (n.x ?? 0) - n.r);
    y0 = Math.min(y0, (n.y ?? 0) - n.r);
    x1 = Math.max(x1, (n.x ?? 0) + n.r);
    y1 = Math.max(y1, (n.y ?? 0) + n.r);
  }
  return [x0, y0, x1, y1];
}

export function toward(model: Model, hidden: Set<string>, id: string, [ux, uy]: [number, number]): string | null {
  const n = model.byId.get(id);
  if (!n) return null;
  let best: string | null = null;
  let score = Infinity;
  for (const { node: m } of model.around.get(id) ?? []) {
    if (hidden.has(m.kind)) continue;
    const dx = (m.x ?? 0) - (n.x ?? 0);
    const dy = (m.y ?? 0) - (n.y ?? 0);
    const d = Math.hypot(dx, dy) || 1;
    const cos = (dx * ux + dy * uy) / d;
    if (cos <= 0) continue;
    const s = d * (3 - 2 * cos);
    if (s < score) {
      score = s;
      best = m.id;
    }
  }
  return best;
}

export function clusters(nodes: SimNode[], links: SimLink[]): number {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    parent.set(id, r);
    return r;
  };
  for (const l of links) if (parent.has(l.from) && parent.has(l.to)) parent.set(root(l.from), root(l.to));
  return new Set(nodes.map((n) => root(n.id))).size;
}

function short(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}...` : label;
}

export interface Hud {
  dark: boolean;
  bg: string;
  glow: string;
  grid: string;
  gridMajor: string;
  ring: string;
  sweep: string;
  vignette: string;
  edge: string;
  label: string;
  labelDim: string;
  halo: string;
  teal: string;
  tealSoft: string;
  focus: string;
  warning: string;
  rim: string;
  panel: string;
  line: string;
  dim: number;
}

function lightness(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const v = parseInt(m[1] ?? "0", 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

export function hudPalette(pal: Palette): Hud {
  if (lightness(pal.bg) < 0.5) {
    return {
      dark: true,
      bg: "#04090a",
      glow: "rgba(15,174,147,0.13)",
      grid: "rgba(45,212,180,0.045)",
      gridMajor: "rgba(45,212,180,0.09)",
      ring: "rgba(45,212,180,0.12)",
      sweep: "45,212,180",
      vignette: "rgba(0,0,0,0.6)",
      edge: "rgba(160,215,205,0.2)",
      label: "#e9f5f2",
      labelDim: "rgba(214,236,231,0.66)",
      halo: "rgba(4,9,10,0.92)",
      teal: "#2dd4b4",
      tealSoft: "rgba(45,212,180,0.32)",
      focus: pal.accent,
      warning: pal.warning,
      rim: "rgba(255,255,255,0.55)",
      panel: "rgba(8,14,15,0.8)",
      line: "rgba(45,212,180,0.22)",
      dim: 0.12,
    };
  }
  return {
    dark: false,
    bg: "#f3f8f7",
    glow: "rgba(15,174,147,0.12)",
    grid: "rgba(12,110,96,0.05)",
    gridMajor: "rgba(12,110,96,0.1)",
    ring: "rgba(12,110,96,0.16)",
    sweep: "15,174,147",
    vignette: "rgba(12,60,54,0.07)",
    edge: "rgba(24,62,58,0.22)",
    label: "#0c1f1c",
    labelDim: "rgba(12,31,28,0.68)",
    halo: "rgba(243,248,247,0.94)",
    teal: "#0fae93",
    tealSoft: "rgba(15,174,147,0.3)",
    focus: "#0b7f6c",
    warning: "#b26a00",
    rim: "rgba(255,255,255,0.95)",
    panel: "rgba(255,255,255,0.86)",
    line: "rgba(15,174,147,0.3)",
    dim: 0.18,
  };
}

type Tone = (alpha: number) => string;

interface Swatch {
  solid: string;
  fill: string;
  line: string;
  wash: string;
  ring: string;
  dash: string;
  hover: string;
}

function toneOf(kind: string, dark: boolean): Tone {
  const [l = 0.8, c = 0.1, h = 0] = (/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(kindColor(kind).ink) ?? []).slice(1).map(Number);
  const L = dark ? Math.min(0.9, l + 0.02) : l > 0.85 ? 0.34 : l - 0.24;
  const C = dark ? c * 1.3 : Math.max(c * 1.35, 0.02);
  return (alpha) => `oklch(${L} ${C} ${h} / ${alpha})`;
}

const swatches = new Map<string, Swatch>();

function swatch(kind: string, dark: boolean): Swatch {
  const key = `${kind}:${dark}`;
  const known = swatches.get(key);
  if (known) return known;
  const t = toneOf(kind, dark);
  const made = { solid: t(1), fill: t(dark ? 0.92 : 1), line: t(0.9), wash: t(dark ? 0.16 : 0.14), ring: t(0.45), dash: t(0.95), hover: t(0.9) };
  swatches.set(key, made);
  return made;
}

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(kind: string, dark: boolean): HTMLCanvasElement {
  const key = `${kind}:${dark}`;
  const known = sprites.get(key);
  if (known) return known;
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  const g = c.getContext("2d");
  if (g) {
    const t = toneOf(kind, dark);
    const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grad.addColorStop(0, t(dark ? 0.55 : 0.28));
    grad.addColorStop(0.35, t(dark ? 0.18 : 0.1));
    grad.addColorStop(1, t(0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
  }
  sprites.set(key, c);
  return c;
}

interface Frame {
  w: number;
  h: number;
  dpr: number;
  view: View;
  time: number;
  motion: boolean;
  hud: Hud;
  nodes: SimNode[];
  links: SimLink[];
  fade: Map<string, number>;
  spotlight: Set<string> | null;
  focusId: string | null;
  focusKind: string | null;
  selected: string | null;
  hover: string | null;
  cursor: string | null;
  matches: Set<string>;
  placed: Set<string>;
  byId: Map<string, SimNode>;
  describe: (n: SimNode) => string;
}

const TAU = Math.PI * 2;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const fract = (x: number): number => x - Math.floor(x);

const pos = (n: SimNode | string | number | undefined): [number, number] => (typeof n === "object" ? [n.x ?? 0, n.y ?? 0] : [0, 0]);

function lit(f: Frame, l: SimLink): boolean {
  if (!f.spotlight) return false;
  if (f.focusId) return l.from === f.focusId || l.to === f.focusId;
  return f.spotlight.has(l.from) && f.spotlight.has(l.to);
}

function backdrop(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, view: v, hud } = f;
  const glow = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, Math.max(w, h) * 0.75);
  glow.addColorStop(0, hud.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  let step = 40 * v.k;
  while (step < 26) step *= 2;
  while (step > 104) step /= 2;
  const minor = new Path2D();
  const major = new Path2D();
  const i0 = Math.ceil(-v.x / step);
  for (let i = i0; v.x + i * step < w; i += 1) {
    const x = Math.round(v.x + i * step) + 0.5;
    (i % 4 === 0 ? major : minor).rect(x, 0, 0, h);
  }
  const j0 = Math.ceil(-v.y / step);
  for (let j = j0; v.y + j * step < h; j += 1) {
    const y = Math.round(v.y + j * step) + 0.5;
    (j % 4 === 0 ? major : minor).rect(0, y, w, 0);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = hud.grid;
  ctx.stroke(minor);
  ctx.strokeStyle = hud.gridMajor;
  ctx.stroke(major);

  const far = Math.hypot(Math.max(v.x, w - v.x), Math.max(v.y, h - v.y));
  const gap = Math.max(60, 180 * v.k);
  ctx.strokeStyle = hud.ring;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  for (let r = gap, i = 0; r < far && i < 12; r += gap, i += 1) {
    ctx.moveTo(v.x + r, v.y);
    ctx.arc(v.x, v.y, r, 0, TAU);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(v.x - 10, v.y);
  ctx.lineTo(v.x + 10, v.y);
  ctx.moveTo(v.x, v.y - 10);
  ctx.lineTo(v.x, v.y + 10);
  ctx.strokeStyle = hud.tealSoft;
  ctx.stroke();

  if (f.motion && "createConicGradient" in ctx) {
    const a = fract(f.time / 10) * TAU;
    const sweep = ctx.createConicGradient(a, v.x, v.y);
    sweep.addColorStop(0, `rgba(${hud.sweep},0)`);
    sweep.addColorStop(0.86, `rgba(${hud.sweep},0)`);
    sweep.addColorStop(1, `rgba(${hud.sweep},${hud.dark ? 0.07 : 0.06})`);
    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.arc(v.x, v.y, Math.min(far, Math.max(w, h) * 0.55), 0, TAU);
    ctx.fill();
  }
}

function edges(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { hud, view: v } = f;
  const k = v.k;
  const litTone = f.focusKind ? swatch(f.focusKind, hud.dark) : null;
  const glowing: SimLink[] = [];
  ctx.lineCap = "round";
  for (const l of f.links) {
    const [ax, ay] = pos(l.source);
    const [bx, by] = pos(l.target);
    if (lit(f, l)) {
      glowing.push(l);
      continue;
    }
    const fade = Math.min(f.fade.get(l.from) ?? 1, f.fade.get(l.to) ?? 1);
    ctx.globalAlpha = (l.relation === "documents" ? 0.55 : 1) * fade;
    ctx.strokeStyle = hud.edge;
    ctx.lineWidth = (l.relation === "documents" ? 0.7 : 1) / k;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  if (hud.dark) ctx.globalCompositeOperation = "lighter";
  for (const l of glowing) {
    const [ax, ay] = pos(l.source);
    const [bx, by] = pos(l.target);
    const t = litTone ?? swatch(f.byId.get(l.from)?.kind ?? "", hud.dark);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.wash;
    ctx.lineWidth = 5 / k;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 1.5 / k;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function particles(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { hud, view: v, time, byId } = f;
  const k = v.k;
  const size = 1.6 / Math.max(k, 0.55);
  if (hud.dark) ctx.globalCompositeOperation = "lighter";
  f.links.forEach((l, i) => {
    const on = lit(f, l);
    if (!on && l.relation === "documents") return;
    const fade = on ? 1 : Math.min(f.fade.get(l.from) ?? 1, f.fade.get(l.to) ?? 1) * 0.7;
    if (fade < 0.05) return;
    const [ax, ay] = pos(l.source);
    const [bx, by] = pos(l.target);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return;
    const count = on ? 3 : 1;
    const speed = on ? 64 : 26;
    const kind = on && f.focusKind ? f.focusKind : (byId.get(l.from)?.kind ?? "");
    ctx.fillStyle = swatch(kind, hud.dark).solid;
    for (let j = 0; j < count; j += 1) {
      const p = fract((time * speed) / len + ((i * 0.618) % 1) + j / count);
      ctx.globalAlpha = fade * Math.sin(p * Math.PI) * (on ? 1 : 0.8);
      ctx.beginPath();
      ctx.arc(ax + (bx - ax) * p, ay + (by - ay) * p, on ? size * 1.3 : size, 0, TAU);
      ctx.fill();
    }
  });
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function nodes(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { hud, view: v } = f;
  const k = v.k;
  if (hud.dark) ctx.globalCompositeOperation = "lighter";
  for (let i = f.nodes.length - 1; i >= 0; i -= 1) {
    const n = f.nodes[i];
    if (!n) continue;
    if (n.kind === "document" || n.kind === "missing") continue;
    const fade = f.fade.get(n.id) ?? 1;
    const boost = n.id === f.selected || n.id === f.hover ? 1.5 : 1;
    const R = n.r * (n.kind === "repo" ? 3.6 : 3.2) * boost;
    ctx.globalAlpha = Math.min(1, fade * (hud.dark ? 0.9 : 0.8) * boost);
    ctx.drawImage(sprite(n.kind, hud.dark), (n.x ?? 0) - R, (n.y ?? 0) - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  for (let i = f.nodes.length - 1; i >= 0; i -= 1) {
    const n = f.nodes[i];
    if (!n) continue;
    const fade = f.fade.get(n.id) ?? 1;
    const t = swatch(n.kind, hud.dark);
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, n.r, 0, TAU);
    if (n.kind === "missing") {
      ctx.fillStyle = hud.dark ? "rgba(4,9,10,0.7)" : "rgba(243,248,247,0.8)";
      ctx.fill();
      ctx.setLineDash([3 / k, 2.5 / k]);
      ctx.strokeStyle = t.dash;
      ctx.lineWidth = 1.3 / k;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = t.fill;
    ctx.fill();
    if (n.kind === "document") continue;
    ctx.strokeStyle = hud.rim;
    ctx.lineWidth = 1 / k;
    ctx.stroke();
    if (n.kind === "repo") {
      ctx.beginPath();
      ctx.arc(x, y, n.r * 0.42, 0, TAU);
      ctx.fillStyle = hud.dark ? "rgba(4,9,10,0.55)" : "rgba(255,255,255,0.7)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, n.r + 4, 0, TAU);
      ctx.strokeStyle = t.ring;
      ctx.lineWidth = 1 / k;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function marks(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { hud, view: v, time, motion, byId } = f;
  const k = v.k;
  for (const n of f.nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const fade = f.fade.get(n.id) ?? 1;
    if (waiting(n)) {
      ctx.globalAlpha = fade * (motion ? 0.6 + 0.4 * Math.sin(time * 2.6) : 1);
      ctx.beginPath();
      ctx.arc(x, y, n.r + 4, 0, TAU);
      ctx.strokeStyle = hud.warning;
      ctx.lineWidth = 1.6 / k;
      ctx.stroke();
    }
    if (f.matches.has(n.id) && n.id !== f.selected) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, n.r + 3.5, 0, TAU);
      ctx.strokeStyle = hud.teal;
      ctx.lineWidth = 1.6 / k;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const hovered = f.hover && f.hover !== f.selected ? byId.get(f.hover) : undefined;
  if (hovered) {
    ctx.beginPath();
    ctx.arc(hovered.x ?? 0, hovered.y ?? 0, hovered.r + 3, 0, TAU);
    ctx.strokeStyle = swatch(hovered.kind, hud.dark).hover;
    ctx.lineWidth = 1.2 / k;
    ctx.stroke();
  }

  const chosen = f.selected ? byId.get(f.selected) : undefined;
  if (chosen) {
    const x = chosen.x ?? 0;
    const y = chosen.y ?? 0;
    const t = swatch(chosen.kind, hud.dark);
    ctx.beginPath();
    ctx.arc(x, y, chosen.r + 3.5, 0, TAU);
    ctx.strokeStyle = t.solid;
    ctx.lineWidth = 1.8 / k;
    ctx.stroke();
    if (motion) {
      for (let j = 0; j < 2; j += 1) {
        const p = fract(time / 2 + j / 2);
        ctx.globalAlpha = (1 - p) * (1 - p) * 0.8;
        ctx.beginPath();
        ctx.arc(x, y, chosen.r + 4 + p * (24 + chosen.r), 0, TAU);
        ctx.strokeStyle = hud.teal;
        ctx.lineWidth = 1.3 / k;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const R = chosen.r + 10 / Math.max(k, 0.6);
    const spin = motion ? time * 0.7 : 0;
    ctx.strokeStyle = hud.teal;
    ctx.lineWidth = 1.5 / k;
    for (let q = 0; q < 4; q += 1) {
      const a = spin + (q * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(x, y, R, a + 0.22, a + Math.PI / 2 - 0.22);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let q = 0; q < 4; q += 1) {
      const a = (q * Math.PI) / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(x + c * (R + 3 / k), y + s * (R + 3 / k));
      ctx.lineTo(x + c * (R + 9 / k), y + s * (R + 9 / k));
    }
    ctx.stroke();
  }

  const aimed = f.cursor ? byId.get(f.cursor) : undefined;
  if (aimed) {
    const x = aimed.x ?? 0;
    const y = aimed.y ?? 0;
    const s = aimed.r + 7 / Math.max(k, 0.6);
    const arm = Math.max(4 / k, s * 0.5);
    ctx.strokeStyle = hud.focus;
    ctx.lineWidth = 2 / k;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      ctx.moveTo(x + sx * s, y + sy * (s - arm));
      ctx.lineTo(x + sx * s, y + sy * s);
      ctx.lineTo(x + sx * (s - arm), y + sy * s);
    }
    ctx.stroke();
    ctx.lineCap = "round";
  }
}

function labels(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { hud, view: v, w, h } = f;
  const k = v.k;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  for (const n of f.nodes) {
    if (!f.placed.has(n.id)) continue;
    const sx = (n.x ?? 0) * k + v.x;
    const sy = (n.y ?? 0) * k + v.y;
    if (sx < -200 || sx > w + 200 || sy < -40 || sy > h + 40) continue;
    const forced = n.id === f.selected || n.id === f.hover || n.id === f.cursor || f.matches.has(n.id);
    const on = f.spotlight?.has(n.id) ?? false;
    const zoom = forced || on || n.kind === "repo" ? 1 : smooth(6, 11, n.r * k);
    const alpha = zoom * (f.fade.get(n.id) ?? 1);
    if (alpha < 0.03) continue;
    const size = n.kind === "repo" ? 12.5 : 11.5;
    const strong = n.kind === "repo" || n.id === f.selected;
    ctx.font = `${strong ? 550 : 450} ${size}px ${tokens.font.sans}`;
    const text = n.id === f.selected || n.id === f.hover || n.id === f.cursor ? n.label : short(n.label);
    const y = sy + n.r * k + LABEL_GAP;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hud.halo;
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, sx, y);
    ctx.fillStyle = on || strong || forced ? hud.label : hud.labelDim;
    ctx.fillText(text, sx, y);
  }
  ctx.globalAlpha = 1;
}

function tag(ctx: CanvasRenderingContext2D, f: Frame): void {
  const n = f.selected ? f.byId.get(f.selected) : undefined;
  if (!n) return;
  const { view: v, hud } = f;
  const sx = (n.x ?? 0) * v.k + v.x;
  const sy = (n.y ?? 0) * v.k + v.y - n.r * v.k - 16;
  ctx.font = `500 9.5px ${tokens.font.mono}`;
  ctx.textAlign = "center";
  const label = f.describe(n);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = hud.panel;
  ctx.fillRect(sx - tw / 2 - 6, sy - 10, tw + 12, 15);
  ctx.strokeStyle = hud.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(sx - tw / 2 - 6) + 0.5, Math.round(sy - 10) + 0.5, Math.round(tw + 12), 15);
  ctx.fillStyle = hud.teal;
  ctx.fillText(label, sx, sy + 1);
}

export function paint(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, dpr, view: v, hud } = f;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = hud.bg;
  ctx.fillRect(0, 0, w, h);
  backdrop(ctx, f);
  ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
  edges(ctx, f);
  if (f.motion) particles(ctx, f);
  nodes(ctx, f);
  marks(ctx, f);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  labels(ctx, f);
  tag(ctx, f);
}
