import { kindColor } from "./kinds";
import type { Hud } from "./graph-scene";
import { tokens } from "./ui";

export interface Frame {
  w: number;
  h: number;
  t: number;
  motion: boolean;
  hud: Hud;
}

export interface Scene {
  id: string;
  label: string;
  title: string;
  text: string;
  dur: number;
  still: number;
  draw: (g: CanvasRenderingContext2D, f: Frame) => void;
}

type Pt = [number, number];

const TAU = Math.PI * 2;
const SANS = tokens.font.sans;
const MONO = tokens.font.mono;
const BUILT = ["memory", "skill", "process", "rule"] as const;

const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
const ease = (p: number): number => 1 - (1 - clamp(p)) ** 3;
const span = (t: number, start: number, len: number): number => ease((t - start) / len);
const fract = (x: number): number => x - Math.floor(x);
const lerp = (a: Pt, b: Pt, p: number): Pt => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
const quad = (a: Pt, c: Pt, b: Pt, p: number): Pt => lerp(lerp(a, c, p), lerp(c, b, p), p);
const tone = (kind: string, alpha: number): string => kindColor(kind).ink.replace("/ 1)", `/ ${alpha})`);
const teal = (hud: Hud, alpha: number): string => `rgba(${hud.sweep},${alpha})`;

function backdrop(g: CanvasRenderingContext2D, f: Frame, [cx, cy]: Pt): void {
  const { w, h, hud } = f;
  g.fillStyle = hud.bg;
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  glow.addColorStop(0, hud.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  const step = 32;
  const minor = new Path2D();
  const major = new Path2D();
  for (let i = Math.floor(-cx / step); cx + i * step < w; i += 1) (i % 4 === 0 ? major : minor).rect(Math.round(cx + i * step) + 0.5, 0, 0, h);
  for (let j = Math.floor(-cy / step); cy + j * step < h; j += 1) (j % 4 === 0 ? major : minor).rect(0, Math.round(cy + j * step) + 0.5, w, 0);
  g.lineWidth = 1;
  g.strokeStyle = hud.grid;
  g.stroke(minor);
  g.strokeStyle = hud.gridMajor;
  g.stroke(major);

  const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  g.strokeStyle = hud.ring;
  g.setLineDash([2, 7]);
  g.beginPath();
  for (let r = 90; r < far; r += 90) {
    g.moveTo(cx + r, cy);
    g.arc(cx, cy, r, 0, TAU);
  }
  g.stroke();
  g.setLineDash([]);

  if (f.motion && "createConicGradient" in g) {
    const sweep = g.createConicGradient(fract(f.t / 9) * TAU, cx, cy);
    sweep.addColorStop(0, teal(hud, 0));
    sweep.addColorStop(0.86, teal(hud, 0));
    sweep.addColorStop(1, teal(hud, 0.07));
    g.fillStyle = sweep;
    g.beginPath();
    g.arc(cx, cy, far, 0, TAU);
    g.fill();
  }

  const vignette = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, hud.vignette);
  g.fillStyle = vignette;
  g.fillRect(0, 0, w, h);
}

function glow(g: CanvasRenderingContext2D, [x, y]: Pt, r: number, color: (a: number) => string, strength = 1): void {
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 4);
  halo.addColorStop(0, color(0.42 * strength));
  halo.addColorStop(0.35, color(0.12 * strength));
  halo.addColorStop(1, color(0));
  g.fillStyle = halo;
  g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
}

function dot(g: CanvasRenderingContext2D, f: Frame, at: Pt, r: number, color: (a: number) => string, opts: { lit?: number; hollow?: boolean } = {}): void {
  const lit = opts.lit ?? 1;
  if (lit > 0) {
    g.globalCompositeOperation = "lighter";
    glow(g, at, r, color, lit);
    g.globalCompositeOperation = "source-over";
  }
  g.beginPath();
  g.arc(at[0], at[1], r, 0, TAU);
  if (opts.hollow) {
    g.fillStyle = f.hud.bg;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = color(0.7);
    g.stroke();
    return;
  }
  g.fillStyle = color(1);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = f.hud.rim;
  g.globalAlpha *= 0.5;
  g.stroke();
  g.globalAlpha /= 0.5;
}

function text(g: CanvasRenderingContext2D, f: Frame, value: string, [x, y]: Pt, opts: { align?: CanvasTextAlign; size?: number; color?: string; mono?: boolean; weight?: number } = {}): void {
  g.font = `${opts.weight ?? 500} ${opts.size ?? 11.5}px ${opts.mono ? MONO : SANS}`;
  g.textAlign = opts.align ?? "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = 4;
  g.strokeStyle = f.hud.halo;
  g.strokeText(value, x, y);
  g.fillStyle = opts.color ?? f.hud.label;
  g.fillText(value, x, y);
}

function pill(g: CanvasRenderingContext2D, f: Frame, value: string, [x, y]: Pt, opts: { color?: (a: number) => string; mono?: boolean; size?: number; strong?: boolean; check?: boolean } = {}): number {
  const size = opts.size ?? 11;
  g.font = `500 ${size}px ${opts.mono ? MONO : SANS}`;
  const color = opts.color ?? ((a: number) => teal(f.hud, a));
  const lead = 16;
  const tail = opts.check ? 18 : 0;
  const pw = g.measureText(value).width + lead + 10 + tail;
  const ph = size + 12;
  const left = clamp(x - pw / 2, 6, f.w - pw - 6);
  const top = y - ph / 2;
  g.beginPath();
  g.roundRect(left, top, pw, ph, ph / 2);
  g.fillStyle = f.hud.panel;
  g.fill();
  g.fillStyle = color(opts.strong ? 0.16 : 0.07);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = color(opts.strong ? 0.7 : 0.36);
  g.stroke();
  g.beginPath();
  g.arc(left + 10, y, 3, 0, TAU);
  g.fillStyle = color(1);
  g.fill();
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = f.hud.label;
  g.fillText(value, left + lead, y + 0.5);
  if (opts.check) {
    const cx = left + pw - 14;
    g.beginPath();
    g.moveTo(cx - 3.5, y);
    g.lineTo(cx - 1, y + 2.8);
    g.lineTo(cx + 4, y - 3);
    g.lineWidth = 1.6;
    g.lineCap = "round";
    g.strokeStyle = f.hud.focus;
    g.stroke();
  }
  return pw;
}

function wire(g: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width: number, progress = 1, control?: Pt): void {
  if (progress <= 0) return;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  const n = control ? 24 : 1;
  for (let i = 1; i <= n; i += 1) {
    const p = (i / n) * progress;
    const [x, y] = control ? quad(a, control, b, p) : lerp(a, b, p);
    g.lineTo(x, y);
  }
  g.lineWidth = width;
  g.lineCap = "round";
  g.strokeStyle = color;
  g.stroke();
}

function flow(g: CanvasRenderingContext2D, a: Pt, b: Pt, t: number, color: (a: number) => string, opts: { count?: number; speed?: number; seed?: number; control?: Pt; size?: number } = {}): void {
  const count = opts.count ?? 3;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i += 1) {
    const p = fract(t * (opts.speed ?? 0.45) + i / count + (opts.seed ?? 0) * 0.137);
    const at = opts.control ? quad(a, opts.control, b, p) : lerp(a, b, p);
    const fade = Math.sin(p * Math.PI);
    glow(g, at, opts.size ?? 2.2, color, fade);
    g.beginPath();
    g.arc(at[0], at[1], (opts.size ?? 2.2) * 0.7, 0, TAU);
    g.fillStyle = color(fade);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
}

function core(g: CanvasRenderingContext2D, f: Frame, at: Pt, r: number, filled: number, opts: { label?: boolean } = {}): void {
  const { hud, t } = f;
  const [x, y] = at;
  g.globalCompositeOperation = "lighter";
  glow(g, at, r * 1.1, (a) => teal(hud, a), 1.1);
  g.globalCompositeOperation = "source-over";
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  const body = g.createRadialGradient(x, y - r * 0.4, 0, x, y, r);
  body.addColorStop(0, "#0c2320");
  body.addColorStop(1, "#061210");
  g.fillStyle = body;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = teal(hud, 0.75);
  g.stroke();

  const spin = f.motion ? t * 0.6 : 0.4;
  g.lineWidth = 2;
  g.lineCap = "round";
  g.strokeStyle = teal(hud, 0.55);
  for (const [off, dir, len] of [
    [0, 1, 0.9],
    [Math.PI, 1, 0.5],
  ] as const) {
    g.beginPath();
    g.arc(x, y, r * 1.28, spin * dir + off, spin * dir + off + len);
    g.stroke();
  }
  g.strokeStyle = teal(hud, 0.25);
  g.lineWidth = 1;
  g.setLineDash([1.5, 5]);
  g.beginPath();
  g.arc(x, y, r * 1.55, -spin * 0.7, -spin * 0.7 + TAU);
  g.stroke();
  g.setLineDash([]);

  const seeds = Math.min(64, 7 + Math.round(filled));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < seeds; i += 1) {
    const d = Math.sqrt((i + 0.5) / Math.max(seeds, 14)) * r * 0.78;
    const a = i * golden + (f.motion ? t * 0.12 : 0);
    const kind = i < 7 ? null : BUILT[i % BUILT.length] ?? "memory";
    const s = i < 7 ? 1.9 : 1.6;
    const appear = i < 7 ? 1 : clamp(filled + 7 - i);
    g.globalAlpha = appear;
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, TAU);
    g.fillStyle = kind ? tone(kind, 1) : i === 3 ? hud.teal : "#f8f7f2";
    g.fill();
  }
  g.globalAlpha = 1;
  if (opts.label !== false) text(g, f, "Company Brain", [x, y + r * 1.55 + 14], { size: 11.5, weight: 600 });
}

function fadeFor(f: Frame, dur: number): number {
  if (!f.motion) return 1;
  return Math.min(ease(f.t / 0.45), clamp((dur - f.t) / 0.35));
}

function flowAxis(f: Frame, pad = 34): (u: number, v: number) => Pt {
  const narrow = f.w < 560;
  const top = 60;
  return narrow ? (u, v) => [f.w / 2 + v * f.w * 0.4, top + u * (f.h - top - pad)] : (u, v) => [pad + u * (f.w - pad * 2), f.h / 2 + v * f.h * 0.38];
}

const AGENTS = ["Claude Code", "Codex", "Cursor", "Grok", "Claude", "ChatGPT"];
const CALLS = ["memory_index", "brain_search", "skill_read", "board_post", "memory_save", "skill_learn"];

function agents(g: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, t, hud } = f;
  const c: Pt = [w / 2, h / 2 - 6];
  backdrop(g, f, c);
  const r = Math.max(22, Math.min(w, h) * 0.085);
  const narrow = w < 560;
  const rx = narrow ? w * 0.3 : Math.min(w * 0.37, 330);
  const ry = Math.min(h * 0.36, 150);
  AGENTS.forEach((name, i) => {
    const a = -Math.PI / 2 + (i / AGENTS.length) * TAU + Math.PI / AGENTS.length;
    const at: Pt = [c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry];
    const appear = span(t, 0.35 + i * 0.22, 0.55);
    const link = span(t, 0.7 + i * 0.22, 0.8);
    if (appear <= 0) return;
    const edge = lerp(at, c, 1 - r / Math.hypot(at[0] - c[0], at[1] - c[1]));
    g.globalAlpha = appear;
    wire(g, at, edge, hud.edge, 1, link);
    if (link >= 1) {
      g.globalAlpha = 1;
      flow(g, at, edge, t, (x) => teal(hud, x), { seed: i, speed: 0.38, count: 2 });
      flow(g, edge, at, t, (x) => `rgba(233,245,242,${x * 0.8})`, { seed: i + 3, speed: 0.3, count: 1, size: 1.8 });
      const p = fract((t - 2.2 - i * 0.37) / 2.8);
      if (t > 2.2 + i * 0.37 && (!narrow || Math.sin(a) < 0.01)) {
        g.globalAlpha = Math.min(1, Math.sin(p * Math.PI) * 1.6);
        pill(g, f, CALLS[i] ?? "brain_search", lerp(at, edge, narrow ? 0.25 + p * 0.45 : 0.2 + p * 0.6), { mono: true, size: 10 });
      }
    }
    g.globalAlpha = appear;
    dot(g, f, at, 6.5, (x) => `rgba(233,245,242,${x})`, { lit: 0.6 });
    const out = Math.cos(a);
    if (narrow) {
      text(g, f, name, [at[0], at[1] + (Math.sin(a) < -0.5 ? -17 : 17)], { size: 11.5 });
      return;
    }
    text(g, f, name, [at[0] + (Math.abs(out) < 0.3 ? 0 : out > 0 ? 13 : -13), at[1] + (Math.abs(out) < 0.3 ? (Math.sin(a) > 0 ? 18 : -18) : 0)], { align: Math.abs(out) < 0.3 ? "center" : out > 0 ? "left" : "right", size: 12 });
  });
  g.globalAlpha = span(t, 0, 0.5);
  core(g, f, c, r, 6 * span(t, 1, 5));
  g.globalAlpha = 1;
}

const SOURCES = [
  { name: "acme/app", kind: "repo" },
  { name: "acme/docs", kind: "repo" },
  { name: "runbook.md", kind: "document" },
  { name: "faq.md", kind: "document" },
];

function sources(g: CanvasRenderingContext2D, f: Frame): void {
  const { w, t, hud } = f;
  const narrow = w < 560;
  const P = flowAxis(f, narrow ? 30 : 60);
  const c = P(0.72, 0);
  backdrop(g, f, c);
  const r = Math.max(22, Math.min(f.w, f.h) * 0.085);
  const cited = new Set([0, 2]);
  const answered = span(t, 6.1, 0.5);
  const spread = narrow ? 0.95 : 0.78;
  const spots = SOURCES.map((s, i) => P(narrow ? 0 : 0.06, -spread + (i / (SOURCES.length - 1)) * spread * 2));
  SOURCES.forEach((s, i) => {
    const at = spots[i] as Pt;
    const appear = span(t, 0.2 + i * 0.18, 0.5);
    const control: Pt = narrow ? [at[0], (at[1] + c[1]) / 2] : [(at[0] + c[0]) / 2, at[1]];
    g.globalAlpha = appear;
    const lit = cited.has(i) ? answered : 0;
    wire(g, at, c, hud.edge, 1, span(t, 0.6 + i * 0.18, 0.8), control);
    if (lit > 0) {
      g.globalAlpha = lit;
      g.globalCompositeOperation = "lighter";
      wire(g, at, c, teal(hud, 0.18), 5, 1, control);
      wire(g, at, c, teal(hud, 0.85), 1.4, 1, control);
      g.globalCompositeOperation = "source-over";
    }
    g.globalAlpha = appear;
    if (t > 1.2 && t < 6.4) flow(g, at, c, t, (x) => tone(s.kind === "repo" ? "project" : "record", x * Math.min(1, (6.4 - t) * 2)), { seed: i, control, speed: 0.5, count: 3 });
    pill(g, f, s.name, at, { color: (x) => (s.kind === "repo" ? `rgba(233,245,242,${x})` : tone("document", x)), size: narrow ? 10 : 11, strong: lit > 0.5 });
  });
  g.globalAlpha = 1;

  const indexed = Math.round(28 * span(t, 1.4, 4.6));
  for (let k = 0; k < indexed; k += 1) {
    const a = k * 2.399 + t * (f.motion ? 0.25 : 0);
    const d = r * 1.9 + (k % 3) * 7;
    g.beginPath();
    g.arc(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d * 0.9, 1.4, 0, TAU);
    g.fillStyle = tone("document", 0.85);
    g.fill();
  }
  core(g, f, c, r, 4 + indexed * 0.3, { label: false });

  const asked = span(t, 4.9, 0.5);
  if (asked > 0) {
    g.globalAlpha = asked;
    pill(g, f, "How do we ship a change safely?", [c[0], c[1] - r * 2.9 + (1 - asked) * 6], { size: 11 });
  }
  if (answered > 0) {
    g.globalAlpha = answered;
    pill(g, f, "Answer cites [1] acme/app  [2] runbook.md", [c[0], c[1] + r * 2.9 - (1 - answered) * 6], { size: 11, strong: true, color: (x) => `rgba(94,234,176,${x})` });
  }
  g.globalAlpha = 1;
}

const STATIONS = [
  { name: "Sources", short: "Sources" },
  { name: "Extract", short: "Extract" },
  { name: "New entries", short: "Written" },
  { name: "Checked, never replaced", short: "Checked" },
  { name: "Brain grows", short: "Grows" },
  { name: "Agents use it", short: "Used" },
  { name: "Lessons learned", short: "Lessons" },
];
const LAP = 4.2;
const LEAD = 0.8;

function build(g: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, t, hud } = f;
  const narrow = w < 560;
  const c: Pt = [w / 2, h / 2 + (narrow ? 12 : 2)];
  backdrop(g, f, c);
  const rx = Math.min(w * (narrow ? 0.29 : 0.34), 300);
  const ry = Math.min(h * 0.35, 150);
  const at = (p: number): Pt => {
    const a = -Math.PI / 2 + p * TAU;
    return [c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry];
  };
  const n = STATIONS.length;
  const run = Math.max(0, t - LEAD);
  const lap = Math.floor(run / LAP);
  const phase = t < LEAD ? 0 : fract(run / LAP);
  const accepted = lap * 3 + (phase > 4 / n + 0.04 ? 3 : 0);
  const reveal = span(t, 0, 0.8);

  g.globalAlpha = reveal;
  g.setLineDash([3, 6]);
  g.beginPath();
  g.ellipse(c[0], c[1], rx, ry, 0, 0, TAU);
  g.lineWidth = 1;
  g.strokeStyle = teal(hud, 0.3);
  g.stroke();
  g.setLineDash([]);

  if (t >= LEAD) {
    const learning = phase > 6 / n;
    const color = (x: number): string => (learning ? tone("lesson", x) : teal(hud, x));
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 28; i += 1) {
      const p = phase - i * 0.006;
      const pt = at(p);
      g.beginPath();
      g.arc(pt[0], pt[1], 2.6 * (1 - i / 28), 0, TAU);
      g.fillStyle = color(0.9 * (1 - i / 28));
      g.fill();
    }
    glow(g, at(phase), 4, color, 1.4);
    g.globalCompositeOperation = "source-over";
  }

  STATIONS.forEach((s, i) => {
    const sp = i / n;
    const since = fract(phase - sp + 1);
    const lit = t < LEAD ? 0 : since < 0.2 ? 1 - since / 0.2 : 0;
    const pt = at(sp);
    g.globalAlpha = reveal * span(t, 0.1 + i * 0.06, 0.4);
    const kind = i === 6 ? "lesson" : null;
    const color = (x: number): string => (kind ? tone(kind, x) : teal(hud, x));
    dot(g, f, pt, 5 + lit * 2, color, { lit: 0.25 + lit, hollow: lit < 0.05 && i !== 0 });
    const a = -Math.PI / 2 + sp * TAU;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const off = 14;
    const align: CanvasTextAlign = Math.abs(cos) < 0.25 ? "center" : cos > 0 ? "left" : "right";
    const place: Pt = align === "center" ? [pt[0], pt[1] + (sin < 0 ? -off - 2 : off + 2)] : [pt[0] + (cos > 0 ? off : -off), pt[1] + sin * 4];
    text(g, f, narrow ? s.short : s.name, place, { align, size: narrow ? 11 : 12, weight: 550, color: lit > 0.1 ? hud.label : hud.labelDim });
  });

  const r = Math.max(20, Math.min(w, h) * 0.075) * (1 + Math.min(accepted, 12) * 0.018);
  g.globalAlpha = reveal;
  core(g, f, c, r, accepted * 1.6, { label: false });

  if (t >= LEAD) {
    const from = at(2.5 / n);
    const home = lerp(from, c, 0.42);
    for (let j = 0; j < 3; j += 1) {
      const kind = BUILT[(lap * 3 + j) % BUILT.length] ?? "memory";
      const born = span(phase, 2 / n + j * 0.025, 0.06);
      if (born <= 0) continue;
      const fly = span(phase, 4 / n - 0.02 + j * 0.02, 0.07);
      const rest: Pt = [home[0] + (narrow ? -10 : 0), home[1] + (j - 1) * 21];
      const pos = lerp(rest, c, fly);
      g.globalAlpha = born * (1 - fly);
      if (g.globalAlpha <= 0.01) continue;
      pill(g, f, kind, pos, { color: (x) => tone(kind, x), size: 10.5, check: phase > 3 / n + j * 0.015, strong: phase > 3 / n });
    }
    const used = phase > 5 / n - 0.02 && phase < 6 / n + 0.05;
    if (used) {
      g.globalAlpha = 1;
      flow(g, c, at(5 / n), t, (x) => teal(hud, x), { count: 3, speed: 0.9, seed: 2 });
    }
  }

  g.globalAlpha = reveal;
  const clock: Pt = narrow ? [60, h - 18] : [c[0], c[1] + r * 1.55 + 16];
  g.beginPath();
  g.arc(clock[0] - 44, clock[1], 5.5, 0, TAU);
  g.lineWidth = 1.2;
  g.strokeStyle = teal(hud, 0.8);
  g.stroke();
  const hand = (f.motion ? t : 1.2) * 1.4;
  g.beginPath();
  g.moveTo(clock[0] - 44, clock[1]);
  g.lineTo(clock[0] - 44 + Math.cos(hand) * 3.8, clock[1] + Math.sin(hand) * 3.8);
  g.stroke();
  text(g, f, "On a schedule", [clock[0] - 34, clock[1]], { align: "left", size: 11, color: hud.labelDim });
  g.globalAlpha = 1;
}

const TOOLS = ["GitHub", "Linear", "Notion", "Sentry", "Slack", "Figma", "Stripe", "HubSpot"];

function gateway(g: CanvasRenderingContext2D, f: Frame): void {
  const { w, t, hud } = f;
  const narrow = w < 560;
  const P = flowAxis(f, narrow ? 34 : 44);
  const hub = P(narrow ? 0.5 : 0.46, 0);
  backdrop(g, f, hub);
  const brain = P(narrow ? 0.16 : 0.2, 0);
  const r = Math.max(18, Math.min(f.w, f.h) * 0.065);
  const clients = [-0.5, 0, 0.5].map((v) => P(0, v));
  const tools = TOOLS.map((_, i) => {
    const a = -1.2 + (i / (TOOLS.length - 1)) * 2.4;
    return P((narrow ? 0.62 : 0.66) + Math.cos(a) * (narrow ? 0.3 : 0.26), Math.sin(a) * 0.95);
  });
  const reveal = span(t, 0, 0.5);

  g.globalAlpha = reveal;
  clients.forEach((at, i) => {
    wire(g, at, brain, hud.edge, 1, span(t, 0.2 + i * 0.1, 0.6));
    flow(g, at, brain, t, (x) => `rgba(233,245,242,${x * 0.8})`, { seed: i, count: 1, speed: 0.4, size: 1.8 });
    dot(g, f, at, 4.5, (x) => `rgba(233,245,242,${x})`, { lit: 0.4 });
  });
  const first = clients[0] as Pt;
  text(g, f, "Your agents", narrow ? [first[0] - 12, first[1]] : [first[0], first[1] - 17], { size: 11, align: narrow ? "right" : "center", color: hud.labelDim });
  wire(g, brain, hub, teal(hud, 0.5), 1.4, span(t, 0.5, 0.6));

  const active = Math.floor(t / 1.1) % TOOLS.length;
  tools.forEach((at, i) => {
    const appear = span(t, 0.9 + i * 0.12, 0.5);
    if (appear <= 0) return;
    g.globalAlpha = appear;
    const on = t > 2 && i === active;
    wire(g, hub, at, on ? teal(hud, 0.55) : hud.edge, on ? 1.4 : 1, span(t, 1 + i * 0.12, 0.5));
    if (on) {
      const p = fract(t / 1.1);
      flow(g, hub, at, p / 0.8, (x) => teal(hud, x), { count: 1, speed: 1, size: 2.6 });
    }
    dot(g, f, at, on ? 6 : 4.5, (x) => (on ? teal(hud, x) : `rgba(214,236,231,${x * 0.8})`), { lit: on ? 1 : 0.2 });
    const name = TOOLS[i] ?? "";
    text(g, f, name, narrow ? [at[0], at[1] + 15] : [at[0] + 11, at[1]], { align: narrow ? "center" : "left", size: 11.5, color: on ? hud.label : hud.labelDim });
  });

  const extra = span(t, 2, 1.5);
  for (let k = 0; k < 42; k += 1) {
    const a = -1.45 + (k / 41) * 2.9;
    const d = narrow ? 0.4 : 0.34;
    const [x, y] = P((narrow ? 0.62 : 0.66) + Math.cos(a) * d, Math.sin(a) * 1.08);
    g.globalAlpha = extra * 0.5 * (0.5 + 0.5 * Math.sin(k * 1.7 + (f.motion ? t * 1.5 : 0)));
    g.beginPath();
    g.arc(x, y, 1.2, 0, TAU);
    g.fillStyle = teal(hud, 0.9);
    g.fill();
  }

  g.globalAlpha = reveal;
  core(g, f, brain, r, 10, { label: false });
  text(g, f, "Company Brain", [brain[0], brain[1] + r * 1.55 + 13], { size: 11, weight: 600 });

  g.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = Math.PI / 6 + (i / 6) * TAU;
    const x = hub[0] + Math.cos(a) * 17;
    const y = hub[1] + Math.sin(a) * 17;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.globalCompositeOperation = "lighter";
  glow(g, hub, 10, (x) => teal(hud, x), 1);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#061210";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = teal(hud, 0.9);
  g.stroke();
  g.beginPath();
  g.roundRect(hub[0] - 5, hub[1] - 1, 10, 7, 1.5);
  g.fillStyle = teal(hud, 0.9);
  g.fill();
  g.beginPath();
  g.arc(hub[0], hub[1] - 1, 3.2, Math.PI, 0);
  g.lineWidth = 1.4;
  g.stroke();
  text(g, f, "Gateway", narrow ? [hub[0] - 26, hub[1]] : [hub[0], hub[1] + 30], { size: 11.5, weight: 600, align: narrow ? "right" : "center" });

  if (t > 2) {
    g.globalAlpha = span(t, 2.2, 0.5);
    const call = `gateway_call  ${TOOLS[active]?.toLowerCase() ?? ""}`;
    pill(g, f, call, narrow ? [f.w / 2, f.h - 16] : [hub[0], hub[1] - 34], { mono: true, size: 10 });
  }
  g.globalAlpha = 1;
}

const LANES = [
  { agent: "Release captain", steps: ["memory_index", "skill_read", "board_post", "board_ask", "memory_save"], start: 0.4, pace: 1.05, asks: 3 },
  { agent: "Code reviewer", steps: ["memory_index", "brain_search", "search_code", "board_post", "skill_learn"], start: 0.9, pace: 1.3, asks: -1 },
  { agent: "Incident responder", steps: ["board_inbox", "brain_search", "board_post", "work_update", "memory_save"], start: 1.6, pace: 1.15, asks: -1 },
];
const WAIT = 2.2;

function laneProgress(lane: (typeof LANES)[number], t: number): { at: number; waiting: boolean; ruled: boolean } {
  const run = Math.max(0, t - lane.start) / lane.pace;
  if (lane.asks < 0) return { at: Math.min(run, lane.steps.length - 1), waiting: false, ruled: false };
  if (run < lane.asks) return { at: run, waiting: false, ruled: false };
  if (run < lane.asks + WAIT / lane.pace) return { at: lane.asks, waiting: true, ruled: false };
  return { at: Math.min(run - WAIT / lane.pace, lane.steps.length - 1), waiting: false, ruled: true };
}

function agentsAtWork(g: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, t, hud } = f;
  const narrow = w < 560;
  backdrop(g, f, [w / 2, h * 0.45]);
  const x0 = narrow ? 26 : 176;
  const x1 = w - (narrow ? 26 : 44);
  const top = narrow ? 86 : 66;
  const gap = (h - top - (narrow ? 88 : 84)) / (LANES.length - 1);
  const inbox: Pt = [narrow ? w / 2 : x1 - 70, h - 30];
  let asking: Pt | null = null;
  let ruled = false;

  LANES.forEach((lane, li) => {
    const y = top + li * gap;
    const appear = span(t, li * 0.2, 0.5);
    g.globalAlpha = appear;
    const xs = lane.steps.map((_, i) => x0 + (i / (lane.steps.length - 1)) * (x1 - x0));
    text(g, f, lane.agent, narrow ? [x0, y - 24] : [x0 - 22, y], { align: narrow ? "left" : "right", size: 12, weight: 600 });
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.lineWidth = 1;
    g.strokeStyle = hud.edge;
    g.stroke();

    const p = laneProgress(lane, t);
    const whole = Math.floor(p.at);
    const cursorX = x0 + (p.at / (lane.steps.length - 1)) * (x1 - x0);
    const tint = (x: number): string => (p.waiting ? tone("decision", x) : teal(hud, x));
    if (t > lane.start) {
      g.globalCompositeOperation = "lighter";
      wire(g, [x0, y], [cursorX, y], teal(hud, 0.16), 5);
      wire(g, [x0, y], [cursorX, y], teal(hud, 0.85), 1.4);
      g.globalCompositeOperation = "source-over";
    }
    lane.steps.forEach((step, i) => {
      const done = t > lane.start && i < p.at + 0.001 && !(p.waiting && i === lane.asks);
      const here = t > lane.start && i === Math.round(p.at) && Math.abs(p.at - i) < 0.18;
      const ask = i === lane.asks && (p.waiting || p.ruled);
      const color = ask && p.waiting ? (x: number) => tone("decision", x) : (x: number) => teal(hud, x);
      dot(g, f, [xs[i] ?? x0, y], here ? 5.5 : 4, color, { lit: done || here ? 0.7 : 0, hollow: !done && !here && !ask });
      if (!narrow || here) {
        text(g, f, step, [xs[i] ?? x0, y + 17], { size: narrow ? 10 : 10.5, mono: true, color: here || ask ? hud.label : hud.labelDim });
      }
    });
    if (t > lane.start) {
      g.globalCompositeOperation = "lighter";
      glow(g, [cursorX, y], 5, tint, 1.3);
      g.globalCompositeOperation = "source-over";
    }
    if (p.waiting || (p.ruled && p.at - lane.asks < 0.6)) {
      asking = [xs[lane.asks] ?? x0, y];
      ruled = p.ruled;
      g.globalAlpha = appear;
      pill(g, f, p.waiting ? "Waiting on you" : "Ruling sent", [xs[lane.asks] ?? x0, y - 20], { size: 10.5, strong: true, color: p.waiting ? (x) => tone("decision", x) : (x) => `rgba(94,234,176,${x})` });
    }
    if (whole >= lane.steps.length - 1 && p.at >= lane.steps.length - 1) {
      g.globalAlpha = appear * span(t, lane.start + lane.steps.length * lane.pace, 0.4);
      text(g, f, "done", [x1, y - 16], { size: 10.5, color: hud.focus, align: "right" });
    }
  });

  g.globalAlpha = span(t, 0.8, 0.5);
  if (asking) {
    const from: Pt = asking;
    const control: Pt = [(from[0] + inbox[0]) / 2, inbox[1] - 6];
    g.setLineDash([3, 5]);
    wire(g, from, inbox, ruled ? teal(hud, 0.6) : tone("decision", 0.7), 1.2, 1, control);
    g.setLineDash([]);
    flow(g, ruled ? inbox : from, ruled ? from : inbox, t, ruled ? (x) => teal(hud, x) : (x) => tone("decision", x), { count: 2, speed: 0.9, control });
  }
  pill(g, f, asking && !ruled ? "Decisions  1 waiting on you" : "Decisions", inbox, { size: 11, strong: Boolean(asking && !ruled), color: asking && !ruled ? (x) => tone("decision", x) : undefined });
  g.globalAlpha = 1;
}

export const SCENES: Scene[] = [
  {
    id: "agents",
    label: "Agents",
    title: "One brain for every agent",
    text: "Connect Claude Code, Codex, Cursor, Grok or any MCP client once. They all read and grow the same memory, skills and rules.",
    dur: 8,
    still: 6.2,
    draw: agents,
  },
  {
    id: "sources",
    label: "Sources",
    title: "Knowledge flows in",
    text: "Index GitHub repositories and add your docs. Ask answers from them, and every answer cites exactly what it read.",
    dur: 9,
    still: 7.4,
    draw: sources,
  },
  {
    id: "build",
    label: "Auto-build",
    title: "The brain builds itself",
    text: "Auto-build runs the Librarian: it reads your sources and adds the processes, rules, roles, lessons and memory that are missing, never replacing what a person wrote. The brain grows, agents use it, and the lessons they learn feed the next build, every day.",
    dur: LEAD + LAP * 3,
    still: LEAD + LAP * 2 + LAP * 0.47,
    draw: build,
  },
  {
    id: "gateway",
    label: "Gateway",
    title: "One URL, every tool",
    text: "Agents reach the MCP servers you connect through one gateway. Pick from 137 in the directory. Tokens stay on the server, and every call is logged.",
    dur: 9,
    still: 7.3,
    draw: gateway,
  },
  {
    id: "run",
    label: "Run",
    title: "Agents at work, inside the platform",
    text: "Run agents from Company Brain with every tool a connected agent has. Each one reads memory, does the work you allowed, asks you before a call it should not make, and saves what it learned.",
    dur: 10.5,
    still: 5.4,
    draw: agentsAtWork,
  },
];

export function paint(g: CanvasRenderingContext2D, scene: Scene, f: Frame): void {
  g.save();
  g.clearRect(0, 0, f.w, f.h);
  scene.draw(g, f);
  const fade = fadeFor(f, scene.dur);
  if (fade < 1) {
    g.globalAlpha = 1 - fade;
    g.fillStyle = f.hud.bg;
    g.fillRect(0, 0, f.w, f.h);
  }
  g.restore();
}
