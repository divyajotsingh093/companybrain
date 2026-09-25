import { ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { AlertBanner, Badge, Button, Caption, Card, EmptyState, Heading, Skeleton, Stack, StatusBadge, Tag, Text, tokens, usePal } from "./ui";
import { KindBadge } from "./kinds";
import { hudPalette } from "./graph-scene";
import { ApiError, EASE, THEME, clientName, get, injectCss, post, reason, useWidth, when } from "./shared";

export interface Proposal {
  id: string;
  kind: "skill" | "process" | "rule" | "role";
  name: string;
  reason: string;
  current: string | null;
  proposed: string;
  status: "queued" | "testing" | "waiting" | "applied" | "rejected" | "failed_gate" | "reverted" | "stale";
  gate: null | { goals: number; candidateWins: number; baselineWins: number; ties: number; verdict: "pass" | "fail" | "skipped"; note: string };
  needsApproval: boolean;
  source: string;
  createdAt: number;
  decidedAt: number | null;
}

export interface Week {
  week: string;
  done: number;
  failed: number;
  up: number;
  down: number;
}

export interface LearningView {
  enabled: boolean;
  graded: number;
  gateMin: number;
  weeks: Week[];
  lessons: Array<{ name: string; body: string; createdAt: number }>;
  proposals: Proposal[];
  reflections: Array<{ id: string; status: "running" | "done" | "stopped" | "failed"; answer: string | null; createdAt: number }>;
  canRun: boolean;
  now: number;
}

type Action = "accept" | "reject" | "revert" | "test";

const POLL_MS = 3_000;
const CONTEXT = 2;
const MAX_CELLS = 1_000_000;
const CLAMP = 240;

const STATUS: Record<Proposal["status"], [string, string]> = {
  queued: ["pending", "Waiting for its test"],
  testing: ["accent", "Testing now"],
  waiting: ["warning", "Needs you"],
  applied: ["success", "Applied"],
  rejected: ["default", "Rejected"],
  failed_gate: ["error", "Lost the test"],
  reverted: ["default", "Rolled back"],
  stale: ["warning", "Out of date"],
};

const RUN_STATUS: Record<LearningView["reflections"][number]["status"], [string, string]> = {
  running: ["accent", "Reflecting"],
  done: ["success", "Done"],
  stopped: ["warning", "Stopped"],
  failed: ["error", "Failed"],
};

const DONE: Record<Action, string> = {
  accept: "is live in the brain now.",
  reject: "was rejected.",
  revert: "was rolled back.",
  test: "is queued for another test.",
};

const REFLECT_ERROR: Record<string, string> = {
  busy: "The Reflector or another agent is already running. Wait for it to finish, then try again.",
  rate_limited: "The Reflector ran recently. Give it a little while before reflecting again.",
  no_model: "No model is configured, so the Reflector cannot run yet.",
};

export type DiffLine = { op: "same" | "add" | "del"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const middle: DiffLine[] = [];
  if (x.length * y.length > MAX_CELLS) {
    middle.push(...x.map((text) => ({ op: "del" as const, text })), ...y.map((text) => ({ op: "add" as const, text })));
  } else {
    const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        middle.push({ op: "same", text: x[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) middle.push({ op: "del", text: x[i++] });
      else middle.push({ op: "add", text: y[j++] });
    }
    while (i < x.length) middle.push({ op: "del", text: x[i++] });
    while (j < y.length) middle.push({ op: "add", text: y[j++] });
  }
  const same = (text: string): DiffLine => ({ op: "same", text });
  return [...a.slice(0, head).map(same), ...middle, ...a.slice(a.length - tail).map(same)];
}

type Row = DiffLine | { skip: number };

function collapse(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].op !== "same") {
      rows.push(lines[i++]);
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].op === "same") end++;
    const keepHead = i === 0 ? 0 : CONTEXT;
    const keepTail = end === lines.length ? 0 : CONTEXT;
    if (end - i > keepHead + keepTail + 1) {
      rows.push(...lines.slice(i, i + keepHead), { skip: end - i - keepHead - keepTail }, ...lines.slice(end - keepTail, end));
    } else rows.push(...lines.slice(i, end));
    i = end;
  }
  return rows;
}

function injectLearningStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-learning",
    `
    .cb-switch { position: relative; width: 46px; height: 28px; flex-shrink: 0; border: 0; border-radius: 999px; cursor: pointer; padding: 0;
      background: rgba(255,255,255,0.10); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16); transition: background-color 200ms ${EASE}, transform 140ms ${EASE}; }
    .cb-switch[aria-checked="true"] { background: rgba(94,234,176,0.30); box-shadow: inset 0 0 0 1px rgba(94,234,176,0.6); }
    .cb-switch:active:not(:disabled) { transform: scale(0.97); }
    .cb-switch:disabled { cursor: wait; opacity: 0.6; }
    .cb-switch-knob { position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 999px; background: ${pal.text};
      box-shadow: 0 2px 6px rgba(0,0,0,0.5); transition: transform 200ms ${EASE}; }
    .cb-switch[aria-checked="true"] .cb-switch-knob { transform: translateX(18px); background: ${pal.accent}; }
    .cb-meter { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
    .cb-meter > span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #0fae93, ${pal.accent}); transform-origin: left; transition: transform 320ms ${EASE}; }
    .cb-pulse { position: relative; display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #2dd4b4; flex-shrink: 0; }
    .cb-pulse::after { content: ""; position: absolute; inset: 0; border-radius: 999px; background: #2dd4b4; animation: cb-pulse 1.4s ${EASE} infinite; }
    @keyframes cb-pulse { from { opacity: 0.7; transform: scale(1); } to { opacity: 0; transform: scale(2.8); } }
    .cb-diff { margin: 0; border-radius: 14px; overflow: hidden; font: 400 12.5px/1.6 ${tokens.font.mono}; background: #0b0d0f; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
    .cb-diff-line { display: grid; grid-template-columns: 22px 1fr; padding: 0 12px 0 4px; white-space: pre-wrap; overflow-wrap: anywhere; color: ${pal.textSecondary}; }
    .cb-diff-line[data-op="add"] { background: rgba(94,234,176,0.10); color: #c9f7e3; box-shadow: inset 3px 0 0 rgba(94,234,176,0.7); }
    .cb-diff-line[data-op="del"] { background: rgba(249,139,139,0.10); color: #fbd0d0; box-shadow: inset 3px 0 0 rgba(249,139,139,0.7); }
    .cb-diff-line[data-op="del"] .cb-diff-text { text-decoration: line-through; text-decoration-color: rgba(249,139,139,0.45); }
    .cb-diff-sign { text-align: center; user-select: none; color: ${pal.textTertiary}; }
    .cb-diff-line[data-op="add"] .cb-diff-sign { color: ${pal.accent}; }
    .cb-diff-line[data-op="del"] .cb-diff-sign { color: ${pal.danger}; }
    .cb-diff-skip { padding: 3px 12px 3px 26px; color: ${pal.textTertiary}; background: rgba(255,255,255,0.03); font-size: 11.5px; }
    .cb-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .cb-disclose > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 10px; }
    .cb-disclose > summary::-webkit-details-marker { display: none; }
    .cb-disclose > summary::before { content: ""; width: 6px; height: 6px; flex-shrink: 0; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 160ms ${EASE}; color: ${pal.textTertiary}; }
    .cb-disclose[open] > summary::before { transform: rotate(45deg); }
    .cb-link { all: unset; cursor: pointer; font-size: 12.5px; color: ${pal.accentText}; border-radius: 6px; }
    .cb-link:focus-visible { outline: 2px solid ${pal.accent}; outline-offset: 2px; }
    .cb-hud { position: relative; border-radius: 22px; padding: 18px 18px 14px; overflow: hidden; }
    .cb-hud-corner { position: absolute; width: 14px; height: 14px; pointer-events: none; border: 0 solid #2dd4b4; opacity: 0.75; }
    .cb-readout { font: 500 10.5px/1.3 ${tokens.font.mono}; letter-spacing: 0.08em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
    .cb-vote { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cb-vote-btn { width: 32px; height: 32px; display: inline-grid; place-items: center; border: 0; border-radius: 999px; cursor: pointer; color: ${pal.textSecondary};
      background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
      transition: transform 140ms ${EASE}, color 160ms ${EASE}, background-color 160ms ${EASE}, box-shadow 160ms ${EASE}; }
    .cb-vote-btn:active { transform: scale(0.94); }
    .cb-vote-btn[data-tone="up"][aria-pressed="true"] { color: ${pal.accent}; background: ${pal.accentBg}; box-shadow: inset 0 0 0 1px rgba(94,234,176,0.55); }
    .cb-vote-btn[data-tone="down"][aria-pressed="true"] { color: ${pal.danger}; background: ${pal.dangerBg}; box-shadow: inset 0 0 0 1px rgba(249,139,139,0.55); }
    @media (hover: hover) and (pointer: fine) { .cb-vote-btn[aria-pressed="false"]:hover { color: ${pal.text}; background: rgba(255,255,255,0.09); } }
    .cb-vote-status { font-size: 12px; color: ${pal.textTertiary}; }
    .cb-vote-status[data-error="true"] { color: ${pal.danger}; }
    @media (prefers-reduced-motion: reduce) {
      .cb-pulse::after { animation: none; opacity: 0.35; transform: scale(1.8); }
      .cb-switch, .cb-switch-knob, .cb-meter > span, .cb-disclose > summary::before, .cb-vote-btn { transition: none; }
    }
  `,
  );
}

const votes = new Map<string, 1 | -1>();

export function Feedback({ id, subject, prompt }: { id: string; subject: "answer" | "run"; prompt?: string }): JSX.Element {
  const pal = usePal(THEME);
  injectLearningStyles(pal);
  const [vote, setVote] = useState<1 | -1 | null>(() => votes.get(id) ?? null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const sending = useRef(false);

  const rate = async (score: 1 | -1): Promise<void> => {
    if (sending.current || score === vote) return;
    const before = vote;
    sending.current = true;
    setVote(score);
    setStatus(null);
    try {
      await post("/api/app/feedback", { id, score });
      votes.set(id, score);
      setStatus({ error: false, text: score === 1 ? "Marked helpful." : "Marked not helpful." });
    } catch (err) {
      setVote(before);
      setStatus({ error: true, text: `Your rating was not saved. ${err instanceof ApiError && err.code === "rate_limited" ? "Try again in a moment." : reason(err)}` });
    } finally {
      sending.current = false;
    }
  };

  const label = prompt ?? `Rate this ${subject}`;
  return (
    <div role="group" aria-label={label} className="cb-vote">
      {prompt ? <Caption theme={THEME}>{prompt}</Caption> : null}
      <button type="button" className="cb-vote-btn" data-tone="up" aria-pressed={vote === 1} aria-label={`This ${subject} was helpful`} title="Helpful" onClick={() => void rate(1)}>
        <ThumbsUp size={16} weight={vote === 1 ? "fill" : "light"} aria-hidden />
      </button>
      <button type="button" className="cb-vote-btn" data-tone="down" aria-pressed={vote === -1} aria-label={`This ${subject} was not helpful`} title="Not helpful" onClick={() => void rate(-1)}>
        <ThumbsDown size={16} weight={vote === -1 ? "fill" : "light"} aria-hidden />
      </button>
      <span className="cb-vote-status" role="status" aria-live="polite" data-error={status?.error ? "true" : "false"}>
        {status?.text ?? ""}
      </span>
    </div>
  );
}

const weekLabel = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const rateOf = (w: Week): number | null => (w.done + w.failed ? w.done / (w.done + w.failed) : null);
const pct = (r: number): string => `${Math.round(r * 100)}%`;

function summarize(weeks: Week[]): string {
  const rated = weeks.filter((w) => rateOf(w) !== null);
  const up = weeks.reduce((n, w) => n + w.up, 0);
  const down = weeks.reduce((n, w) => n + w.down, 0);
  const votesText = up + down ? ` People gave ${up} thumbs up and ${down} down.` : " Nobody has rated an answer or run yet.";
  if (!rated.length) return `No outcomes were reported in the last ${weeks.length} weeks.${votesText}`;
  const first = rated[0];
  const last = rated[rated.length - 1];
  const a = rateOf(first) ?? 0;
  const b = rateOf(last) ?? 0;
  const done = weeks.reduce((n, w) => n + w.done, 0);
  const failed = weeks.reduce((n, w) => n + w.failed, 0);
  const trend =
    first === last ? "" : Math.round(a * 100) === Math.round(b * 100) ? `, level with the week of ${weekLabel(first.week)}` : `, ${b > a ? "up" : "down"} from ${pct(a)} in the week of ${weekLabel(first.week)}`;
  const gaps = weeks.length - rated.length;
  return `Success rate was ${pct(b)} in the week of ${weekLabel(last.week)}${trend}. Across ${weeks.length} weeks, ${done} outcomes succeeded and ${failed} failed${gaps ? `, and ${gaps} ${gaps === 1 ? "week had" : "weeks had"} none` : ""}.${votesText}`;
}

function Trend({ weeks }: { weeks: Week[] }): JSX.Element {
  const pal = usePal(THEME);
  const hud = hudPalette(pal);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref) || 640;
  const titleId = useId();
  const descId = useId();
  const summary = useMemo(() => summarize(weeks), [weeks]);

  const left = 38;
  const right = 10;
  const plotTop = 16;
  const plotH = 120;
  const barTop = plotTop + plotH + 22;
  const barH = 40;
  const mid = barTop + barH / 2;
  const height = barTop + barH + 26;
  const col = (width - left - right) / Math.max(weeks.length, 1);
  const cx = (i: number): number => left + col * (i + 0.5);
  const cy = (r: number): number => plotTop + (1 - r) * plotH;
  const maxVote = Math.max(1, ...weeks.map((w) => Math.max(w.up, w.down)));
  const barW = Math.min(14, col / 4);
  const every = col < 44 ? 2 : 1;

  const segments: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  weeks.forEach((w, i) => {
    const r = rateOf(w);
    if (r === null) {
      if (run.length) segments.push(run);
      run = [];
    } else run.push([cx(i), cy(r)]);
  });
  if (run.length) segments.push(run);
  const line = (pts: Array<[number, number]>): string => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = (pts: Array<[number, number]>): string => `${line(pts)} L${pts[pts.length - 1][0].toFixed(1)} ${plotTop + plotH} L${pts[0][0].toFixed(1)} ${plotTop + plotH} Z`;
  const lastRated = weeks.reduce((at, w, i) => (rateOf(w) !== null ? i : at), -1);
  const gradId = `${titleId}-fill`;

  const corner = (pos: Record<string, number>, sides: string): JSX.Element => (
    <span aria-hidden className="cb-hud-corner" style={{ ...pos, borderTopWidth: sides.includes("t") ? 1.5 : 0, borderBottomWidth: sides.includes("b") ? 1.5 : 0, borderLeftWidth: sides.includes("l") ? 1.5 : 0, borderRightWidth: sides.includes("r") ? 1.5 : 0 }} />
  );

  return (
    <div className="cb-hud" style={{ background: `radial-gradient(60rem 18rem at 50% -20%, ${hud.glow}, transparent 70%), ${hud.bg}`, boxShadow: `inset 0 0 0 1px ${hud.line}` }}>
      {corner({ top: 8, left: 8 }, "tl")}
      {corner({ top: 8, right: 8 }, "tr")}
      {corner({ bottom: 8, left: 8 }, "bl")}
      {corner({ bottom: 8, right: 8 }, "br")}
      <Stack gap={12}>
        <Stack direction="row" justify="space-between" align="center" gap={10} wrap>
          <span className="cb-readout" style={{ color: hud.teal }}>
            {`Success rate · last ${weeks.length} weeks`}
          </span>
          <Stack direction="row" gap={14} wrap>
            <span className="cb-readout" style={{ color: hud.labelDim, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 14, height: 2, background: hud.teal, borderRadius: 2 }} />
              Success
            </span>
            <span className="cb-readout" style={{ color: hud.labelDim, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 8, height: 8, background: pal.accent, opacity: 0.8, borderRadius: 2 }} />
              Thumbs up
            </span>
            <span className="cb-readout" style={{ color: hud.labelDim, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden style={{ width: 8, height: 8, background: pal.danger, opacity: 0.8, borderRadius: 2 }} />
              Thumbs down
            </span>
          </Stack>
        </Stack>
        <div ref={ref} style={{ width: "100%" }}>
          <svg width={width} height={height} role="img" aria-labelledby={`${titleId} ${descId}`} style={{ display: "block", overflow: "visible" }}>
            <title id={titleId}>Success rate and ratings by week</title>
            <desc id={descId}>{summary}</desc>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={hud.teal} stopOpacity="0.28" />
                <stop offset="100%" stopColor={hud.teal} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((r) => (
              <g key={r}>
                <line x1={left} x2={width - right} y1={cy(r)} y2={cy(r)} stroke={r === 0 ? hud.gridMajor : hud.grid} strokeDasharray={r === 0 ? undefined : "2 4"} />
                <text x={left - 8} y={cy(r) + 3.5} textAnchor="end" fill={hud.labelDim} style={{ font: `500 10px ${tokens.font.mono}` }}>
                  {pct(r)}
                </text>
              </g>
            ))}
            <line x1={left} x2={width - right} y1={mid} y2={mid} stroke={hud.gridMajor} />
            {weeks.map((w, i) => {
              const upH = (w.up / maxVote) * (barH / 2);
              const downH = (w.down / maxVote) * (barH / 2);
              return (
                <g key={w.week}>
                  {w.up ? <rect x={cx(i) - barW - 1} y={mid - upH} width={barW} height={upH} rx={2} fill={pal.accent} opacity={0.75} /> : null}
                  {w.down ? <rect x={cx(i) + 1} y={mid} width={barW} height={downH} rx={2} fill={pal.danger} opacity={0.75} /> : null}
                  {rateOf(w) === null ? <circle cx={cx(i)} cy={plotTop + plotH} r={2} fill="none" stroke={hud.labelDim} strokeOpacity={0.5} /> : null}
                  {i % every === (weeks.length - 1) % every ? (
                    <text x={cx(i)} y={height - 6} textAnchor="middle" fill={i === weeks.length - 1 ? hud.label : hud.labelDim} style={{ font: `500 10px ${tokens.font.mono}` }}>
                      {weekLabel(w.week)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {segments.map((pts, i) => (
              <g key={i}>
                {pts.length > 1 ? <path d={area(pts)} fill={`url(#${gradId})`} /> : null}
                {pts.length > 1 ? <path d={line(pts)} fill="none" stroke={hud.teal} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${hud.tealSoft})` }} /> : null}
                {pts.map(([x, y]) => (
                  <circle key={x} cx={x} cy={y} r={3.2} fill={hud.bg} stroke={hud.teal} strokeWidth={1.8} />
                ))}
              </g>
            ))}
            {lastRated >= 0 ? (
              <text x={Math.min(cx(lastRated), width - right - 14)} y={cy(rateOf(weeks[lastRated]) ?? 0) - 10} textAnchor="middle" fill={hud.label} style={{ font: `600 11px ${tokens.font.mono}` }}>
                {pct(rateOf(weeks[lastRated]) ?? 0)}
              </text>
            ) : null}
          </svg>
        </div>
        <Text theme={THEME} size="sm" style={{ color: hud.labelDim }} as="p">
          {summary}
        </Text>
        <table className="cb-sr">
          <caption>Outcomes and ratings per week</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Success rate</th>
              <th scope="col">Succeeded</th>
              <th scope="col">Failed</th>
              <th scope="col">Thumbs up</th>
              <th scope="col">Thumbs down</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const r = rateOf(w);
              return (
                <tr key={w.week}>
                  <th scope="row">{weekLabel(w.week)}</th>
                  <td>{r === null ? "No outcomes" : pct(r)}</td>
                  <td>{w.done}</td>
                  <td>{w.failed}</td>
                  <td>{w.up}</td>
                  <td>{w.down}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Stack>
    </div>
  );
}

function Diff({ current, proposed }: { current: string | null; proposed: string }): JSX.Element {
  const lines = useMemo(() => diffLines(current ?? "", proposed), [current, proposed]);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (all ? lines : collapse(lines)), [all, lines]);
  const added = lines.filter((l) => l.op === "add").length;
  const removed = lines.filter((l) => l.op === "del").length;
  const hidden = rows.some((r) => "skip" in r);
  return (
    <Stack gap={8}>
      <Stack direction="row" justify="space-between" align="center" gap={10} wrap>
        <Caption theme={THEME}>{current === null ? `New entry, ${added} ${added === 1 ? "line" : "lines"}` : added + removed ? `${added} ${added === 1 ? "line" : "lines"} added, ${removed} removed` : "No change to the text"}</Caption>
        {hidden || all ? (
          <button type="button" className="cb-link" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show only the changes" : `Show all ${lines.length} lines`}
          </button>
        ) : null}
      </Stack>
      <div className="cb-diff" role="group" aria-label={current === null ? "The new entry" : "Changes from the current version"}>
        {rows.map((r, i) =>
          "skip" in r ? (
            <div key={i} className="cb-diff-skip">{`${r.skip} unchanged ${r.skip === 1 ? "line" : "lines"}`}</div>
          ) : (
            <div key={i} className="cb-diff-line" data-op={r.op}>
              <span className="cb-diff-sign" aria-hidden>
                {r.op === "add" ? "+" : r.op === "del" ? "-" : " "}
              </span>
              <span className="cb-diff-text">
                {r.op === "add" ? <span className="cb-sr">Added: </span> : r.op === "del" ? <span className="cb-sr">Removed: </span> : null}
                {r.text || " "}
              </span>
            </div>
          ),
        )}
      </div>
    </Stack>
  );
}

function Gate({ gate }: { gate: Proposal["gate"] }): JSX.Element {
  const pal = usePal(THEME);
  if (!gate) return <Caption theme={THEME}>Not tested yet.</Caption>;
  if (gate.verdict === "skipped") return <Caption theme={THEME}>{gate.note ? `Not tested: ${gate.note}` : "Not tested."}</Caption>;
  const total = Math.max(1, gate.candidateWins + gate.baselineWins + gate.ties);
  const pass = gate.verdict === "pass";
  const segment = (n: number, color: string): JSX.Element | null => (n ? <span style={{ flex: n / total, background: color }} /> : null);
  return (
    <Stack gap={8} style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(45,212,180,0.04)", boxShadow: "inset 0 0 0 1px rgba(45,212,180,0.16)" }}>
      <Stack direction="row" justify="space-between" align="center" gap={8} wrap>
        <span className="cb-readout" style={{ color: "#2dd4b4" }}>{`Replayed on ${gate.goals} past ${gate.goals === 1 ? "goal" : "goals"}`}</span>
        <StatusBadge status={pass ? "success" : "error"}>{pass ? "Beat the current version" : "Lost to the current version"}</StatusBadge>
      </Stack>
      <div aria-hidden style={{ display: "flex", gap: 2, height: 6, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
        {segment(gate.candidateWins, pal.accent)}
        {segment(gate.ties, "rgba(255,255,255,0.28)")}
        {segment(gate.baselineWins, pal.danger)}
      </div>
      <Text theme={THEME} size="sm" secondary>
        {`New version won ${gate.candidateWins}, current version won ${gate.baselineWins}, ${gate.ties} ${gate.ties === 1 ? "tie" : "ties"}.`}
        {gate.note ? ` ${gate.note}` : ""}
      </Text>
    </Stack>
  );
}

interface Choice {
  action: Action;
  label: string;
  variant: "primary" | "secondary" | "ghost" | "danger";
  confirm?: string;
}

function ProposalCard({ p, now, choices, open, busy, problem, onAct }: { p: Proposal; now: number; choices: Choice[]; open: boolean; busy: boolean; problem: string | null; onAct: (action: Action) => void }): JSX.Element {
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [status, label] = STATUS[p.status];
  const live = p.status === "queued" || p.status === "testing";
  const meta = [`Proposed by ${clientName(p.source)}`, when(p.createdAt, now), p.decidedAt ? `decided ${when(p.decidedAt, now)}` : null].filter(Boolean).join(" · ");
  const diff = <Diff current={p.current} proposed={p.proposed} />;
  return (
    <Card theme={THEME} padding={18}>
      <Stack gap={12}>
        <Stack direction="row" justify="space-between" align="flex-start" gap={10} wrap>
          <Stack gap={6} style={{ minWidth: 0, flex: "1 1 220px" }}>
            <Stack direction="row" gap={8} align="center" wrap>
              <KindBadge kind={p.kind} />
              {p.current === null ? <Tag>New</Tag> : <Tag>Edit</Tag>}
              {p.needsApproval ? <Tag>Needs your approval</Tag> : null}
            </Stack>
            <Text theme={THEME} weight="semibold" size="md" as="h3" style={{ overflowWrap: "anywhere" }}>
              {p.name}
            </Text>
          </Stack>
          <Stack direction="row" gap={8} align="center">
            {live ? <span className="cb-pulse" aria-hidden /> : null}
            <StatusBadge status={status}>{label}</StatusBadge>
          </Stack>
        </Stack>
        <Text theme={THEME} secondary style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {p.reason}
        </Text>
        <Caption theme={THEME}>{meta}</Caption>
        {p.status === "stale" ? <Caption theme={THEME}>The entry changed after this was proposed, so it was not applied.</Caption> : null}
        {live ? null : <Gate gate={p.gate} />}
        {open ? (
          diff
        ) : (
          <details className="cb-disclose">
            <summary>
              <Text theme={THEME} size="sm" style={{ color: "inherit" }}>
                Show the change
              </Text>
            </summary>
            <div style={{ paddingTop: 10 }}>{diff}</div>
          </details>
        )}
        {problem ? <AlertBanner variant="danger" title={problem} theme={THEME} /> : null}
        {choices.length ? (
          confirming ? (
            <Stack direction="row" gap={8} align="center" wrap>
              <Text theme={THEME} size="sm" secondary>
                {confirming.confirm}
              </Text>
              <Button variant="ghost" size="sm" theme={THEME} onClick={() => setConfirming(null)}>
                Keep it
              </Button>
              <Button
                variant={confirming.action === "accept" ? "primary" : "danger"}
                size="sm"
                disabled={busy}
                theme={THEME}
                onClick={() => {
                  onAct(confirming.action);
                  setConfirming(null);
                }}
              >
                {confirming.label}
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" gap={8} align="center" wrap>
              {choices.map((c) => (
                <Button key={c.action} variant={c.variant} size="sm" disabled={busy} theme={THEME} onClick={() => (c.confirm ? setConfirming(c) : onAct(c.action))}>
                  {busy ? "Working" : c.label}
                </Button>
              ))}
            </Stack>
          )
        ) : null}
      </Stack>
    </Card>
  );
}

function Clamped({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP;
  return (
    <Stack gap={4}>
      <Text theme={THEME} size="sm" secondary style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {long && !open ? `${text.slice(0, CLAMP).trimEnd()}...` : text}
      </Text>
      {long ? (
        <div>
          <button type="button" className="cb-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Show less" : "Show all"}
          </button>
        </div>
      ) : null}
    </Stack>
  );
}

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section aria-label={title}>
      <Stack gap={10}>
        <Stack gap={2}>
          <Stack direction="row" gap={8} align="center">
            <Heading level={5} theme={THEME}>
              {title}
            </Heading>
            {count ? <Badge>{count}</Badge> : null}
          </Stack>
          {hint ? (
            <Text theme={THEME} size="sm" secondary>
              {hint}
            </Text>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </section>
  );
}

export function LearningScreen(): JSX.Element {
  const pal = usePal(THEME);
  injectLearningStyles(pal);
  const switchLabel = useId();
  const switchHint = useId();
  const [view, setView] = useState<LearningView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");

  const load = (): void => {
    void get<LearningView>("/api/app/learning").then(
      (next) => {
        setView(next);
        setLoadError(null);
      },
      (err: unknown) => setLoadError(reason(err)),
    );
  };

  useEffect(load, []);

  const live = Boolean(view && (view.proposals.some((p) => p.status === "queued" || p.status === "testing") || view.reflections.some((r) => r.status === "running")));

  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [live, view]);

  if (loadError && !view) {
    return (
      <Stack gap={12}>
        <AlertBanner variant="danger" title="What the brain learned could not be loaded" description={`${loadError}.`} theme={THEME} />
        <div>
          <Button variant="secondary" size="sm" theme={THEME} onClick={load}>
            Try again
          </Button>
        </div>
      </Stack>
    );
  }

  if (!view) {
    return (
      <div aria-busy="true" aria-label="Loading what the brain learned">
        <Stack gap={16}>
          <Skeleton theme={THEME} height={64} />
          <Skeleton theme={THEME} height={140} />
          <Skeleton theme={THEME} height={260} />
          <Skeleton theme={THEME} height={180} />
        </Stack>
      </div>
    );
  }

  const setEnabled = async (on: boolean): Promise<void> => {
    setSaving(true);
    setProblem(null);
    try {
      const next = await post<{ enabled: boolean }>("/api/app/learning", { enabled: on });
      setView((prev) => (prev ? { ...prev, enabled: next.enabled } : prev));
    } catch (err) {
      setProblem(reason(err));
    } finally {
      setSaving(false);
    }
  };

  const reflect = async (): Promise<void> => {
    setReflecting(true);
    setProblem(null);
    try {
      await post<{ enabled: boolean; runId?: string }>("/api/app/learning", { reflectNow: true });
      setAnnounce("The Reflector started.");
      load();
    } catch (err) {
      setProblem((err instanceof ApiError && REFLECT_ERROR[err.code]) || reason(err));
    } finally {
      setReflecting(false);
    }
  };

  const act = async (p: Proposal, action: Action): Promise<void> => {
    setActing(p.id);
    setFailures(({ [p.id]: _, ...rest }) => rest);
    try {
      const { proposal } = await post<{ proposal: Proposal }>(`/api/app/proposals/${encodeURIComponent(p.id)}`, { action });
      setView((prev) => (prev ? { ...prev, proposals: prev.proposals.map((x) => (x.id === proposal.id ? proposal : x)) } : prev));
      setAnnounce(`${p.name} ${DONE[action]}`);
    } catch (err) {
      const stale = err instanceof ApiError && (err.code === "wrong_state" || err.code === "changed_since");
      setFailures((prev) => ({ ...prev, [p.id]: reason(err) }));
      if (stale) load();
    } finally {
      setActing(null);
    }
  };

  const by = (...statuses: Array<Proposal["status"]>): Proposal[] => view.proposals.filter((p) => statuses.includes(p.status));
  const waiting = by("waiting");
  const queue = by("queued", "testing");
  const applied = by("applied");
  const dropped = by("failed_gate", "rejected", "reverted", "stale");
  const running = view.reflections.some((r) => r.status === "running");
  const reached = view.graded >= view.gateMin;
  const nothing = !view.proposals.length && !view.lessons.length && !view.reflections.length;
  const hasOutcomes = view.weeks.some((w) => w.done + w.failed + w.up + w.down > 0);

  const card = (p: Proposal, choices: Choice[], open = false): JSX.Element => (
    <ProposalCard key={p.id} p={p} now={view.now} choices={choices} open={open} busy={acting === p.id} problem={failures[p.id] ?? null} onAct={(a) => void act(p, a)} />
  );

  const droppedChoices = (p: Proposal): Choice[] => [
    ...(p.status === "failed_gate" || p.status === "stale"
      ? [{ action: "accept" as const, label: "Accept anyway", variant: "secondary" as const, confirm: p.status === "stale" ? "This replaces the newer version of the entry." : "This lost to the current version in the test." }]
      : []),
    ...(p.status === "failed_gate" ? [{ action: "test" as const, label: "Test again", variant: "ghost" as const }] : []),
  ];

  return (
    <Stack gap={32}>
      <Stack gap={6}>
        <Heading level={4} theme={THEME}>
          What it learned
        </Heading>
        <Text secondary theme={THEME} style={{ maxWidth: "72ch" }}>
          Agents and runs report how they went, and people rate answers and runs. Every night the Reflector reads what happened, writes lessons and proposes changes to skills and playbooks. A change is kept only if it beats the current version when replayed against past goals. Changes to anything a person wrote wait for your approval, and everything can be rolled back.
        </Text>
      </Stack>

      {!view.canRun ? <AlertBanner variant="warning" title="No model is configured, so the Reflector cannot run yet." theme={THEME} /> : null}
      {view.enabled ? null : (
        <AlertBanner variant="warning" title="Self-improvement is off" description="The Reflector will not run, and no change will be tested or applied. What is already live stays until you roll it back." theme={THEME} />
      )}

      <Card theme={THEME}>
        <Stack gap={20}>
          <Stack direction="row" justify="space-between" align="center" gap={16} wrap>
            <Stack direction="row" gap={14} align="center" style={{ flex: "1 1 260px" }}>
              <button
                type="button"
                role="switch"
                className="cb-switch"
                aria-checked={view.enabled}
                aria-labelledby={switchLabel}
                aria-describedby={switchHint}
                disabled={saving}
                onClick={() => void setEnabled(!view.enabled)}
              >
                <span className="cb-switch-knob" />
              </button>
              <Stack gap={2}>
                <Text theme={THEME} weight="semibold">
                  <span id={switchLabel}>Self-improvement</span>
                  <span aria-hidden style={{ marginLeft: 8, fontWeight: 500, color: view.enabled ? pal.accentText : pal.textTertiary }}>
                    {view.enabled ? "On" : "Off"}
                  </span>
                </Text>
                <Text theme={THEME} size="sm" secondary>
                  <span id={switchHint}>Turn this off to stop all reflecting, testing and applying at once.</span>
                </Text>
              </Stack>
            </Stack>
            <Button variant="primary" arrow disabled={!view.canRun || !view.enabled || running || reflecting} theme={THEME} onClick={() => void reflect()}>
              {reflecting ? "Starting" : running ? "Reflecting" : "Reflect now"}
            </Button>
          </Stack>

          <Stack gap={8}>
            <Stack direction="row" justify="space-between" align="baseline" gap={8} wrap>
              <Text theme={THEME} weight="medium" size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                <span id={`${switchLabel}-graded`}>Graded outcomes</span>
                {reached ? `: ${view.graded}` : `: ${view.graded} of ${view.gateMin} needed`}
              </Text>
              {reached ? <StatusBadge status="success">Testing on its own</StatusBadge> : null}
            </Stack>
            <div className="cb-meter" role="progressbar" aria-labelledby={`${switchLabel}-graded`} aria-valuemin={0} aria-valuemax={view.gateMin} aria-valuenow={Math.min(view.graded, view.gateMin)}>
              <span style={{ transform: `scaleX(${view.gateMin ? Math.min(1, view.graded / view.gateMin) : 1})` }} />
            </div>
            <Text theme={THEME} size="sm" secondary>
              {reached
                ? "There is enough history to test changes. A change that beats the current version is applied on its own, unless it edits something a person wrote."
                : `Until ${view.gateMin} outcomes are graded there is not enough history to test against, so every change waits for a person to approve it.`}
            </Text>
          </Stack>
        </Stack>
      </Card>

      {problem ? <AlertBanner variant="danger" title={problem} theme={THEME} /> : null}
      {loadError ? <AlertBanner variant="warning" title="Could not refresh just now" description={`${loadError}. Showing what was loaded last.`} theme={THEME} /> : null}
      <span className="cb-sr" role="status" aria-live="polite">
        {announce}
      </span>

      {hasOutcomes ? (
        <Trend weeks={view.weeks} />
      ) : (
        <Card theme={THEME}>
          <Text theme={THEME} size="sm" secondary>
            {`No outcomes or ratings in the last ${view.weeks.length || 8} weeks yet. The chart fills in as agents finish runs and people rate them.`}
          </Text>
        </Card>
      )}

      {nothing ? (
        <Card theme={THEME}>
          <EmptyState
            title="Nothing learned yet"
            description="This fills in as agents finish runs and people rate answers in Ask and runs in Run agents with a thumbs up or down. Each night the Reflector reads those outcomes, writes lessons here and proposes changes for you to review. Press Reflect now to run it yourself."
            theme={THEME}
          />
        </Card>
      ) : (
        <>
          <Section title="Waiting on you" count={waiting.length} hint={waiting.length ? "Read the change, check how it did in the test, then accept or reject it." : undefined}>
            {waiting.length ? (
              <Stack gap={12}>
                {waiting.map((p) =>
                  card(
                    p,
                    [
                      { action: "accept", label: "Accept", variant: "primary" },
                      { action: "reject", label: "Reject", variant: "ghost", confirm: "Reject this change?" },
                    ],
                    true,
                  ),
                )}
              </Stack>
            ) : (
              <Card theme={THEME}>
                <Text theme={THEME} size="sm" secondary>
                  Nothing is waiting on you.
                </Text>
              </Card>
            )}
          </Section>

          {queue.length ? (
            <Section title="Being tested" count={queue.length} hint="Each change is replayed against past goals and compared with the current version. This updates on its own.">
              <Stack gap={12}>{queue.map((p) => card(p, []))}</Stack>
            </Section>
          ) : null}

          {applied.length ? (
            <Section title="Applied" count={applied.length} hint="These are live in the brain. Roll one back to restore the version before it.">
              <Stack gap={12}>{applied.map((p) => card(p, [{ action: "revert", label: "Revert", variant: "ghost", confirm: "Roll this back to the previous version?" }]))}</Stack>
            </Section>
          ) : null}

          {dropped.length ? (
            <Section title="Tested and dropped" count={dropped.length} hint="Changes that lost the test, were rejected, rolled back, or went out of date.">
              <Stack gap={12}>{dropped.map((p) => card(p, droppedChoices(p)))}</Stack>
            </Section>
          ) : null}

          {view.lessons.length ? (
            <Section title="Recent lessons" count={view.lessons.length}>
              <Card theme={THEME} padding={0}>
                {view.lessons.map((l, i) => (
                  <details key={`${l.name}-${l.createdAt}`} className="cb-disclose" style={{ padding: "14px 18px", borderBottom: i < view.lessons.length - 1 ? "1px solid rgba(255,255,255,0.07)" : undefined }}>
                    <summary>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <Text theme={THEME} weight="medium" style={{ overflowWrap: "anywhere" }}>
                          {l.name}
                        </Text>
                        <Caption theme={THEME}>{when(l.createdAt, view.now)}</Caption>
                      </span>
                    </summary>
                    <Text theme={THEME} size="sm" secondary as="p" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "10px 0 2px 14px" }}>
                      {l.body}
                    </Text>
                  </details>
                ))}
              </Card>
            </Section>
          ) : null}

          {view.reflections.length ? (
            <Section title="Recent reflections">
              <Card theme={THEME} padding={0}>
                {view.reflections.map((r, i) => (
                  <div key={r.id} style={{ padding: "14px 18px", borderBottom: i < view.reflections.length - 1 ? "1px solid rgba(255,255,255,0.07)" : undefined }}>
                    <Stack gap={8}>
                      <Stack direction="row" justify="space-between" align="center" gap={10} wrap>
                        <Stack direction="row" gap={8} align="center">
                          {r.status === "running" ? <span className="cb-pulse" aria-hidden /> : null}
                          <StatusBadge status={RUN_STATUS[r.status][0]}>{RUN_STATUS[r.status][1]}</StatusBadge>
                        </Stack>
                        <Caption theme={THEME}>{when(r.createdAt, view.now)}</Caption>
                      </Stack>
                      {r.answer ? (
                        <Clamped text={r.answer} />
                      ) : (
                        <Text theme={THEME} size="sm" secondary>
                          {r.status === "running" ? "Reading what happened since the last reflection." : r.status === "done" ? "It finished without a summary." : "It did not finish, so nothing was written."}
                        </Text>
                      )}
                    </Stack>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Stack>
  );
}
