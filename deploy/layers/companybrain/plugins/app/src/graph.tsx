import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from "d3-force";
import { Badge, Button, Caption, Card, CardHeader, Heading, IconButton, Skeleton, Stack, Text, tokens, usePal } from "./ui";
import { GRAPH_KINDS, KindBadge, KindChip, KindDot, kindName, kindPurpose } from "./kinds";
import { EASE, THEME, get, injectCss, reason, useReducedMotion, useWidth } from "./shared";
import {
  LABEL_CHAR,
  LABEL_GAP,
  bounds,
  buildModel,
  clusters,
  hudPalette,
  paint,
  toward,
  waiting,
  type GraphView,
  type Hud,
  type Model,
  type SimLink,
  type SimNode,
  type View,
} from "./graph-scene";

type Gesture =
  | { mode: "pan"; pointer: number; startX: number; startY: number; view: View }
  | { mode: "node"; pointer: number; id: string; startX: number; startY: number; moved: boolean }
  | { mode: "pinch"; dist: number; midX: number; midY: number; view: View };

interface Flight {
  from: View;
  to: View;
  start: number;
  dur: number;
}

interface Scene {
  nodes: SimNode[];
  links: SimLink[];
  spotlight: Set<string> | null;
  focusId: string | null;
  focusKind: string | null;
  selected: string | null;
  hover: string | null;
  cursor: string | null;
  matches: Set<string>;
  placed: Set<string>;
}

const WIDE = 600;
const PANEL = 300;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const EDGE = 28;
const IDLE = 3000;

const ARROW: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
const COARSE = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const HINT = COARSE ? "Drag to pan or move a node. Pinch to zoom." : `Drag to pan or move a node. Pinch or ${MOD} + scroll to zoom.`;
const NUDGE = `Hold ${MOD} while scrolling to zoom the graph`;

const RELATION: Record<string, [string, string]> = {
  links: ["Links to", "Linked from"],
  mentions: ["Mentions", "Mentioned by"],
  documents: ["In repository", "Document"],
  decided: ["Decided in", "Decision"],
};

const GAP_NOTE = "Entries point at these with [[Name]], but nobody has written them down yet.";

const CLUSTERED = new Set<string>(GRAPH_KINDS.filter((k) => !["repo", "document", "decision", "missing"].includes(k)));

function question(node: SimNode): string {
  if (node.kind === "missing") return `What do we know about ${node.label}? Nobody has written it down yet.`;
  if (node.kind === "decision") return `What was decided about "${node.label}", and why?`;
  if (node.kind === "repo") return `What should I know about the ${node.label} repository?`;
  return `What should I know about ${node.label}?`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(n: SimNode): string {
  return `${kindName(n.kind).toUpperCase()} · ${plural(n.degree, "LINK", "LINKS")}`;
}

function injectGraphStyles(pal: Record<string, string>, hud: Hud): void {
  injectCss(
    "cb-graph-styles",
    `
    .cb-graph-stage { position: relative; height: ${CANVAS_HEIGHT}; border-radius: ${tokens.radius.lg}px; overflow: clip; isolation: isolate;
      background: ${hud.bg}; box-shadow: inset 0 0 0 1px ${hud.line}, 0 30px 60px -40px ${hud.dark ? "rgba(0,0,0,0.9)" : "rgba(12,60,54,0.35)"}; }
    .cb-graph-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
    .cb-graph-canvas[data-over="true"] { cursor: pointer; }
    .cb-graph-canvas[data-panning="true"] { cursor: grabbing; }
    @keyframes cb-graph-bloom { from { opacity: 0; transform: scale(0.97); } }
    .cb-graph-bloom { animation: cb-graph-bloom 420ms ${EASE} both; }
    .cb-graph-scan { position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, ${hud.vignette}),
        repeating-linear-gradient(180deg, transparent 0 2px, ${hud.dark ? "rgba(45,212,180,0.012)" : "rgba(12,110,96,0.01)"} 2px 3px); }
    .cb-graph-bracket { position: absolute; width: 16px; height: 16px; pointer-events: none; border: 0 solid ${hud.teal}; opacity: 0.8; }
    .cb-graph-bracket[data-at="tl"] { top: 6px; left: 6px; border-top-width: 1.5px; border-left-width: 1.5px; border-top-left-radius: 6px; }
    .cb-graph-bracket[data-at="tr"] { top: 6px; right: 6px; border-top-width: 1.5px; border-right-width: 1.5px; border-top-right-radius: 6px; }
    .cb-graph-bracket[data-at="bl"] { bottom: 6px; left: 6px; border-bottom-width: 1.5px; border-left-width: 1.5px; border-bottom-left-radius: 6px; }
    .cb-graph-bracket[data-at="br"] { bottom: 6px; right: 6px; border-bottom-width: 1.5px; border-right-width: 1.5px; border-bottom-right-radius: 6px; }
    .cb-graph-top, .cb-graph-bottom { position: absolute; left: 14px; display: flex; gap: 8px; pointer-events: none; min-width: 0; }
    .cb-graph-top { top: 14px; align-items: flex-start; justify-content: space-between; }
    .cb-graph-bottom { bottom: 14px; flex-direction: column; align-items: flex-start; gap: 6px; }
    .cb-graph-top > *, .cb-graph-bottom > * { pointer-events: auto; }
    .cb-graph-glass { background: ${hud.panel}; box-shadow: inset 0 0 0 1px ${hud.line}; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
    .cb-graph-cmd { position: relative; flex: 1 1 auto; max-width: 380px; min-width: 0; }
    .cb-graph-cmd-field { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px 0 12px; border-radius: 10px;
      transition: box-shadow 160ms ${EASE}; }
    .cb-graph-cmd-field:focus-within { box-shadow: inset 0 0 0 1px ${hud.teal}, 0 0 0 4px ${hud.dark ? "rgba(45,212,180,0.12)" : "rgba(15,174,147,0.14)"}; }
    .cb-graph-cmd-prompt { font: 600 13px/1 ${tokens.font.mono}; color: ${hud.teal}; }
    .cb-graph-cmd input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: ${hud.label};
      font: 400 13px/1 ${tokens.font.sans}; caret-color: ${hud.teal}; }
    .cb-graph-cmd input::placeholder { color: ${hud.labelDim}; }
    .cb-graph-cmd input:focus-visible { outline: none; }
    .cb-graph-kbd { font: 500 10.5px/1 ${tokens.font.mono}; color: ${hud.labelDim}; padding: 3px 6px; border-radius: 5px; box-shadow: inset 0 0 0 1px ${hud.line}; }
    .cb-graph-list { position: absolute; top: 42px; left: 0; right: 0; margin: 0; padding: 4px; list-style: none; border-radius: 10px; max-height: 280px; overflow-y: auto; }
    .cb-graph-option { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 7px; cursor: pointer; color: ${hud.label};
      font: 400 13px/1.35 ${tokens.font.sans}; }
    .cb-graph-option[aria-selected="true"] { background: ${hud.dark ? "rgba(45,212,180,0.12)" : "rgba(15,174,147,0.12)"}; box-shadow: inset 2px 0 0 ${hud.teal}; }
    .cb-graph-option-kind { margin-left: auto; font: 500 10px/1 ${tokens.font.mono}; letter-spacing: 0.08em; text-transform: uppercase; color: ${hud.labelDim}; white-space: nowrap; }
    .cb-graph-empty { padding: 9px 10px; color: ${hud.labelDim}; font: 400 12.5px/1.4 ${tokens.font.sans}; }
    .cb-graph-tools { display: flex; gap: 4px; flex: none; }
    .cb-graph-tool { width: 34px; height: 34px; display: inline-grid; place-items: center; border: 0; border-radius: 9px; cursor: pointer; color: ${hud.label};
      transition: transform 140ms ${EASE}, box-shadow 160ms ${EASE}; }
    .cb-graph-tool:active { transform: scale(0.95); }
    @media (hover: hover) and (pointer: fine) { .cb-graph-tool:hover { box-shadow: inset 0 0 0 1px ${hud.teal}; } .cb-graph-option:hover { background: ${hud.dark ? "rgba(255,255,255,0.06)" : "rgba(12,31,28,0.05)"}; } }
    .cb-graph-readout { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 6px 10px; border-radius: 8px; max-width: 100%;
      font: 500 10.5px/1.3 ${tokens.font.mono}; letter-spacing: 0.08em; text-transform: uppercase; color: ${hud.labelDim}; font-variant-numeric: tabular-nums; }
    .cb-graph-readout b { font-weight: 600; color: ${hud.teal}; margin-left: 5px; }
    .cb-graph-hint { max-width: 100%; box-sizing: border-box; pointer-events: none; padding: 5px 10px; border-radius: 8px;
      color: ${hud.labelDim}; font: 400 12px/1.4 ${tokens.font.sans}; overflow-wrap: anywhere; transition: box-shadow 160ms ${EASE}, color 160ms ${EASE}; }
    .cb-graph-hint[data-nudge="true"] { box-shadow: inset 0 0 0 1px ${hud.teal}; color: ${hud.label}; }
    .cb-graph-hint[data-target="true"] { color: ${hud.label}; }
    .cb-graph-hint .cb-graph-cmd-prompt { margin-right: 6px; }
    .cb-graph-panel { background: ${hud.panel}; box-shadow: inset 0 0 0 1px ${hud.line}, 0 24px 48px -24px ${hud.dark ? "rgba(0,0,0,0.8)" : "rgba(12,60,54,0.3)"};
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border-radius: ${tokens.radius.md}px; overflow-y: auto; overscroll-behavior: contain; }
    @keyframes cb-graph-panel-in { from { opacity: 0; transform: translateX(10px); } }
    .cb-graph-panel[data-wide="true"] { animation: cb-graph-panel-in 220ms ${EASE} both; }
    .cb-graph-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; list-style: none; }
    .cb-graph-row {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px;
      border: none; border-radius: 10px; background: transparent; color: ${hud.label}; cursor: pointer;
      font: 400 13px/1.4 ${tokens.font.sans}; transition: background-color 150ms ${EASE}, transform 140ms ${EASE};
    }
    .cb-graph-row:active { transform: scale(0.98); }
    .cb-graph-row:focus-visible, .cb-graph-gaps:focus-visible, .cb-graph-tool:focus-visible { outline: 2px solid ${hud.focus}; outline-offset: 2px; }
    @media (hover: hover) and (pointer: fine) { .cb-graph-row:hover { background: ${hud.dark ? "rgba(255,255,255,0.06)" : "rgba(12,31,28,0.05)"}; } }
    .cb-graph-gaps {
      display: inline-flex; align-items: baseline; gap: 8px; border: 1px solid ${pal.border}; background: ${pal.bgSubtle};
      border-radius: 12px; padding: 8px 14px; cursor: pointer; color: ${pal.text}; font-family: ${tokens.font.sans};
      transition: border-color 160ms ${EASE}, background-color 160ms ${EASE}, transform 140ms ${EASE};
    }
    .cb-graph-gaps[aria-pressed="true"] { border-color: ${pal.accent}; background: ${pal.accentBg}; }
    .cb-graph-gaps:active { transform: scale(0.97); }
    @media (hover: hover) and (pointer: fine) { .cb-graph-gaps:hover { border-color: ${pal.accent}; } }
    @media (pointer: coarse) { .cb-graph-kbd { display: none; } }
    @media (prefers-reduced-motion: reduce) {
      .cb-graph-bloom, .cb-graph-panel[data-wide="true"] { animation: none; }
      .cb-graph-row, .cb-graph-gaps, .cb-graph-hint, .cb-graph-tool, .cb-graph-cmd-field { transition: none; }
    }
  `,
  );
}

const CANVAS_HEIGHT = "clamp(440px, calc(100dvh - 300px), 840px)";

function Loading({ header }: { header: JSX.Element }): JSX.Element {
  const hud = hudPalette(usePal(THEME));
  return (
    <Stack gap={18}>
      {header}
      <Stack direction="row" gap={10} wrap>
        <Skeleton theme={THEME} width={230} height={42} />
        <Skeleton theme={THEME} width={220} height={42} />
      </Stack>
      <div style={{ height: CANVAS_HEIGHT, borderRadius: tokens.radius.lg, boxShadow: `inset 0 0 0 1px ${hud.line}`, background: hud.bg, padding: 20, boxSizing: "border-box" }}>
        <Stack gap={12}>
          <Skeleton theme={THEME} width={260} height={36} />
          <Skeleton theme={THEME} width={120} height={20} />
        </Stack>
      </div>
      <Stack direction="row" gap={8} wrap>
        {[96, 80, 110, 88, 72].map((w) => (
          <Skeleton key={w} theme={THEME} width={w} height={28} rounded />
        ))}
      </Stack>
    </Stack>
  );
}

function Empty(): JSX.Element {
  const pal = usePal(THEME);
  const code = { fontFamily: tokens.font.mono, ...tokens.type.sm, color: pal.text, background: pal.bgMuted, borderRadius: tokens.radius.xs, padding: "2px 6px", whiteSpace: "nowrap" as const, flexShrink: 0 };
  return (
    <Card theme={THEME} padding={32}>
      <Stack gap={20} style={{ maxWidth: 520 }}>
        <Stack gap={6}>
          <Heading level={4} theme={THEME}>
            Nothing is connected yet
          </Heading>
          <Text secondary theme={THEME}>
            The graph grows from what agents and people write down. Every link in an entry becomes an edge here.
          </Text>
        </Stack>
        <Stack gap={12}>
          <Stack direction="row" gap={12} align="baseline">
            <span style={code}>[[Another entry]]</span>
            <Text secondary theme={THEME} style={tokens.type.sm}>
              links one entry to another. If that entry does not exist yet, it shows up as a gap.
            </Text>
          </Stack>
          <Stack direction="row" gap={12} align="baseline">
            <span style={code}>owner/name</span>
            <Text secondary theme={THEME} style={tokens.type.sm}>
              links an entry to a repository. Indexed documents and decisions gather around it.
            </Text>
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}

function Detail({
  node,
  model,
  purposes,
  hud,
  onSelect,
  onAsk,
  onClose,
}: {
  node: SimNode;
  model: Model;
  purposes: Record<string, string>;
  hud: Hud;
  onSelect: (id: string) => void;
  onAsk: (question: string) => void;
  onClose: () => void;
}): JSX.Element {
  const neighbors = [...(model.around.get(node.id) ?? [])].sort(
    (a, b) => Number(a.node.kind === "document") - Number(b.node.kind === "document") || a.node.label.localeCompare(b.node.label),
  );
  const ruled = node.kind === "decision" && node.detail?.startsWith("Ruled: ");
  const secondary = { ...tokens.type.sm, color: hud.labelDim, overflowWrap: "anywhere" as const };

  return (
    <Stack gap={16} style={{ padding: 18, color: hud.label }}>
      <Stack direction="row" justify="space-between" align="flex-start" gap={8}>
        <KindBadge kind={node.kind} />
        <IconButton
          label="Close details"
          size={28}
          theme={THEME}
          onClick={onClose}
          icon={
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          }
        />
      </Stack>
      <Stack gap={6}>
        <Heading level={4} theme={THEME} style={{ overflowWrap: "anywhere", color: hud.label }}>
          {node.label}
        </Heading>
        <Text theme={THEME} style={secondary}>
          {kindPurpose(node.kind, purposes)}
        </Text>
      </Stack>

      {waiting(node) ? (
        <Badge variant="warning" theme={THEME} style={{ alignSelf: "flex-start" }}>
          Waiting on you
        </Badge>
      ) : ruled ? (
        <Stack gap={4}>
          <Caption theme={THEME} style={{ color: hud.labelDim }}>
            RULED
          </Caption>
          <Text theme={THEME} style={{ ...tokens.type.sm, color: hud.label, overflowWrap: "anywhere" }}>
            {node.detail?.slice("Ruled: ".length)}
          </Text>
        </Stack>
      ) : node.kind === "missing" ? (
        <Text theme={THEME} style={secondary}>
          Write an entry named exactly {node.label} and every link to it connects.
        </Text>
      ) : node.detail ? (
        <Text theme={THEME} mono={node.kind === "document"} style={secondary}>
          {node.detail}
        </Text>
      ) : null}

      <Button variant="primary" size="sm" theme={THEME} onClick={() => onAsk(question(node))} style={{ alignSelf: "flex-start" }}>
        Ask about this
      </Button>

      <Stack gap={6}>
        <span style={{ font: `500 10.5px/1.3 ${tokens.font.mono}`, letterSpacing: "0.08em", color: hud.teal }}>{neighbors.length ? `CONNECTIONS ${neighbors.length}` : "NO CONNECTIONS"}</span>
        <Stack gap={0} style={{ margin: "0 -10px" }}>
          {neighbors.map((n, i) => (
            <button key={`${n.node.id}-${i}`} type="button" className="cb-graph-row" onClick={() => onSelect(n.node.id)}>
              <KindDot kind={n.node.kind} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{n.node.label}</span>
              <span style={{ ...tokens.type.xs, color: hud.labelDim, whiteSpace: "nowrap" }}>{(RELATION[n.relation] ?? [n.relation, n.relation])[n.outgoing ? 0 : 1]}</span>
            </button>
          ))}
        </Stack>
      </Stack>
    </Stack>
  );
}

export function GraphScreen({ onAsk }: { onAsk: (question: string) => void }): JSX.Element {
  const [data, setData] = useState<GraphView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback((): void => {
    setFailed(null);
    setData(null);
    void get<GraphView>("/api/app/graph").then(setData, (err: unknown) => setFailed(reason(err)));
  }, []);

  useEffect(load, [load]);

  const header = (
    <Stack gap={2}>
      <Heading level={4} theme={THEME}>
        Graph
      </Heading>
      <Text secondary theme={THEME}>
        How everything your company has written down connects.
      </Text>
    </Stack>
  );

  if (failed) {
    return (
      <Stack gap={20}>
        {header}
        <Card theme={THEME}>
          <CardHeader title="The graph could not be loaded" subtitle={`${failed}. Nothing was changed.`} theme={THEME} />
          <Button variant="secondary" size="sm" theme={THEME} onClick={load}>
            Try again
          </Button>
        </Card>
      </Stack>
    );
  }
  if (!data) return <Loading header={header} />;
  if (!data.nodes.length) {
    return (
      <Stack gap={20}>
        {header}
        <Empty />
      </Stack>
    );
  }
  return <Explorer data={data} header={header} onAsk={onAsk} />;
}

function Explorer({ data, header, onAsk }: { data: GraphView; header: JSX.Element; onAsk: (question: string) => void }): JSX.Element {
  const pal = usePal(THEME);
  const hud = useMemo(() => hudPalette(pal), [pal]);
  injectGraphStyles(pal, hud);
  const reduced = useReducedMotion();
  const model = useMemo(() => buildModel(data), [data]);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const wide = width >= WIDE;
  const panelWidth = Math.min(PANEL, Math.round(width * 0.42));
  const panelRef = useRef<HTMLDivElement>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const [nudge, setNudge] = useState(false);
  const listId = useId();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const nodeEls = useRef(new Map<string, HTMLButtonElement>());
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const flight = useRef<Flight | null>(null);
  const fade = useRef(new Map<string, number>());
  const dirty = useRef(true);
  const onscreen = useRef(true);
  const scene = useRef<Scene | null>(null);
  const settled = useRef<Model | null>(null);
  const target = useRef<[number, number, number, number] | null>(null);
  const touched = useRef(false);
  const fitRef = useRef<() => void>(() => undefined);
  const wake = useRef<() => void>(() => undefined);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [typing, setTyping] = useState(false);
  const [gaps, setGaps] = useState(false);
  const [scale, setScale] = useState(1);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [panning, setPanning] = useState(false);
  const [waitHit, setWaitHit] = useState(0);

  const visible = useMemo(() => model.nodes.filter((n) => !hidden.has(n.kind)), [model, hidden]);
  const shownLinks = useMemo(
    () => model.links.filter((l) => !hidden.has(model.byId.get(l.from)?.kind ?? "") && !hidden.has(model.byId.get(l.to)?.kind ?? "")),
    [model, hidden],
  );
  const islands = useMemo(() => clusters(visible, shownLinks), [visible, shownLinks]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of model.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [model]);
  const missing = useMemo(() => model.nodes.filter((n) => n.kind === "missing").sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)), [model]);
  const pending = useMemo(() => model.nodes.filter(waiting), [model]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return visible
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || b.degree - a.degree);
  }, [visible, query]);

  const draw = useCallback((): void => {
    dirty.current = true;
    wake.current();
  }, []);

  const setView = useCallback(
    (next: View): void => {
      view.current = next;
      setScale(Math.round(next.k * 20) / 20);
      draw();
    },
    [draw],
  );

  const box = (): { w: number; h: number } => {
    const r = stageRef.current?.getBoundingClientRect();
    return { w: r?.width || 800, h: r?.height || 560 };
  };

  const flyTo = (to: View): void => {
    if (reduced) {
      flight.current = null;
      setView(to);
      return;
    }
    flight.current = { from: { ...view.current }, to, start: performance.now(), dur: 720 };
    draw();
  };

  const fit = (animate = false): void => {
    const b = target.current ?? bounds(model.nodes.filter((n) => !hidden.has(n.kind)));
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    const { w, h } = box();
    const room = wide && selected ? w - panelWidth - 24 : w;
    const k = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((room - 72) / Math.max(1, x1 - x0), (h - 120) / Math.max(1, y1 - y0))));
    const next = { k, x: room / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    if (animate) flyTo(next);
    else setView(next);
  };
  fitRef.current = fit;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const measure = (): void => {
      const r = stage.getBoundingClientRect();
      size.current = { w: r.width, h: r.height, dpr: Math.min(2, window.devicePixelRatio || 1) };
      if (!touched.current) fitRef.current();
      draw();
    };
    let media: MediaQueryList | null = null;
    const onDensity = (): void => {
      measure();
      watch();
    };
    const watch = (): void => {
      media?.removeEventListener("change", onDensity);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener("change", onDensity);
    };
    measure();
    watch();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const seen = new IntersectionObserver(([entry]) => {
      onscreen.current = entry?.isIntersecting ?? true;
      draw();
    });
    seen.observe(stage);
    return () => {
      observer.disconnect();
      seen.disconnect();
      media?.removeEventListener("change", onDensity);
    };
  }, []);

  useLayoutEffect(() => {
    const kinds = [...new Set(model.nodes.map((n) => n.kind))].filter((k) => CLUSTERED.has(k));
    const spread = 70 + Math.sqrt(model.nodes.length) * 16;
    const anchor = new Map(kinds.map((k, i) => [k, [Math.cos((i / kinds.length) * Math.PI * 2) * spread, Math.sin((i / kinds.length) * Math.PI * 2) * spread] as const]));
    const pull = kinds.length > 1 ? 0.07 : 0.05;
    const sim = forceSimulation<SimNode, SimLink>(model.nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(model.links)
          .id((d) => d.id)
          .distance((l) => (l.source as SimNode).r + (l.target as SimNode).r + (l.relation === "documents" ? 10 : 36))
          .strength((l) => (l.relation === "documents" ? 0.9 : 0.4)),
      )
      .force(
        "charge",
        forceManyBody<SimNode>()
          .strength((d) => (d.kind === "document" ? -16 : -60 - d.r * 5))
          .distanceMax(440),
      )
      .force("collide", forceCollide<SimNode>((d) => d.r + 4))
      .force("x", forceX<SimNode>((d) => anchor.get(d.kind)?.[0] ?? 0).strength((d) => (anchor.has(d.kind) ? pull : 0.05)))
      .force("y", forceY<SimNode>((d) => anchor.get(d.kind)?.[1] ?? 0).strength((d) => (anchor.has(d.kind) ? pull : 0.05)))
      .alphaDecay(0.04)
      .alphaMin(0.004)
      .stop();
    simRef.current = sim;
    const animate = !reduced && settled.current !== model;
    const settle = (): void => {
      while (sim.alpha() > sim.alphaMin()) sim.tick();
    };
    if (animate) {
      for (let i = 0; i < 30; i += 1) sim.tick();
      const start = model.nodes.map((n) => [n.x, n.y, n.vx, n.vy] as const);
      const alpha = sim.alpha();
      settle();
      target.current = bounds(model.nodes);
      fit();
      model.nodes.forEach((n, i) => {
        [n.x, n.y, n.vx, n.vy] = start[i] ?? [n.x, n.y, n.vx, n.vy];
      });
      sim.alpha(alpha);
    } else {
      settle();
      fit();
      setLayoutVersion((v) => v + 1);
    }
    sim.on("tick", draw).on("end", () => {
      settled.current = model;
      target.current = null;
      setLayoutVersion((v) => v + 1);
    });
    if (animate) sim.restart();
    return () => {
      sim.on("tick", null);
      sim.stop();
    };
  }, [model]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const motion = !reduced;
    const t0 = performance.now();
    let last = t0;
    let calm = t0;
    let raf = 0;
    const frame = (now: number): void => {
      raf = 0;
      const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
      last = now;
      const fl = flight.current;
      if (fl) {
        const t = Math.min(1, Math.max(0, (now - fl.start) / fl.dur));
        const e = 1 - Math.pow(1 - t, 4);
        const { w, h } = size.current;
        const c0x = (w / 2 - fl.from.x) / fl.from.k;
        const c0y = (h / 2 - fl.from.y) / fl.from.k;
        const c1x = (w / 2 - fl.to.x) / fl.to.k;
        const c1y = (h / 2 - fl.to.y) / fl.to.k;
        const travel = Math.hypot(c1x - c0x, c1y - c0y) * Math.min(fl.from.k, fl.to.k);
        const dip = Math.min(0.45, travel / Math.max(1, w * 1.4));
        const k = Math.exp(Math.log(fl.from.k) + (Math.log(fl.to.k) - Math.log(fl.from.k)) * e) * (1 - dip * Math.sin(Math.PI * e));
        const cx = c0x + (c1x - c0x) * e;
        const cy = c0y + (c1y - c0y) * e;
        if (t >= 1) {
          flight.current = null;
          setView(fl.to);
        } else setView({ k, x: w / 2 - cx * k, y: h / 2 - cy * k });
      }
      const s = scene.current;
      let easing = false;
      for (const n of s?.nodes ?? []) {
        const goal = s?.spotlight && !s.spotlight.has(n.id) ? hud.dim : 1;
        const was = fade.current.get(n.id) ?? 1;
        let next = motion ? was + (goal - was) * Math.min(1, dt * 12) : goal;
        if (Math.abs(next - goal) < 0.004) next = goal;
        else easing = true;
        fade.current.set(n.id, next);
      }
      const busy = flight.current !== null || easing || gesture.current !== null || (motion && s !== null && (s.selected !== null || s.hover !== null));
      const changed = dirty.current;
      if (busy || changed) calm = now;
      dirty.current = false;
      const { w, h, dpr } = size.current;
      if (s && onscreen.current && w && h && (motion || changed || easing)) {
        const bw = Math.max(1, Math.round(w * dpr));
        const bh = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        paint(ctx, { w, h, dpr, view: view.current, time: (now - t0) / 1000, motion, hud, fade: fade.current, byId: model.byId, describe, ...s });
      }
      if (busy || dirty.current || (motion && now - calm < IDLE)) raf = requestAnimationFrame(frame);
    };
    wake.current = (): void => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wake.current();
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      wake.current = () => undefined;
    };
  }, [model, reduced, hud, setView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        setNudge(true);
        window.clearTimeout(nudgeTimer.current);
        nudgeTimer.current = window.setTimeout(() => setNudge(false), 1600);
        return;
      }
      e.preventDefault();
      touched.current = true;
      flight.current = null;
      setNudge(false);
      const v = view.current;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const delta = Math.max(-40, Math.min(40, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-delta * 0.01)));
      setView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      window.clearTimeout(nudgeTimer.current);
    };
  }, [setView]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (selected && !wide) panelRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [selected, wide, reduced]);

  const zoomBy = (factor: number): void => {
    touched.current = true;
    flight.current = null;
    const v = view.current;
    const { w, h } = box();
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
    setView({ k, x: w / 2 - ((w / 2 - v.x) * k) / v.k, y: h / 2 - ((h / 2 - v.y) * k) / v.k });
  };

  const center = (id: string, room: number, k: number, animate: boolean): void => {
    const n = model.byId.get(id);
    if (!n) return;
    touched.current = true;
    const next = { k, x: room / 2 - (n.x ?? 0) * k, y: box().h / 2 - (n.y ?? 0) * k };
    if (animate) flyTo(next);
    else {
      flight.current = null;
      setView(next);
    }
  };

  const reveal = (id: string): void => {
    const n = model.byId.get(id);
    if (!n) return;
    const { w, h } = box();
    const v = view.current;
    const room = wide && selected ? w - panelWidth - 24 : w;
    const sx = (n.x ?? 0) * v.k + v.x;
    const sy = (n.y ?? 0) * v.k + v.y;
    if (sx < EDGE || sx > room - EDGE || sy < EDGE + 50 || sy > h - EDGE - 50) center(id, room, v.k, false);
  };

  const select = (id: string, move: "stay" | "center" | "focus" = "stay"): void => {
    const n = model.byId.get(id);
    if (!n) return;
    if (hidden.has(n.kind)) {
      const next = new Set(hidden);
      next.delete(n.kind);
      setHidden(next);
    }
    setSelected(id);
    const room = wide ? box().w - panelWidth - 24 : box().w;
    const covered = wide && (n.x ?? 0) * view.current.k + view.current.x > room - EDGE;
    if (move !== "stay" || covered) center(id, room, Math.max(view.current.k, move === "stay" ? 1 : 1.35), true);
    if (move === "focus") requestAnimationFrame(() => nodeEls.current.get(id)?.focus({ preventScroll: true }));
  };

  const toggleKind = (kind: string): void => {
    const next = new Set(hidden);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setHidden(next);
    if (selected && next.has(model.byId.get(selected)?.kind ?? "")) setSelected(null);
    if (kind === "missing" && next.has(kind)) setGaps(false);
  };

  const local = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const hitAt = (clientX: number, clientY: number): SimNode | null => {
    const v = view.current;
    const p = local(clientX, clientY);
    const x = (p.x - v.x) / v.k;
    const y = (p.y - v.y) / v.k;
    const slop = (COARSE ? 12 : 5) / v.k;
    let best: SimNode | null = null;
    let gap = Infinity;
    for (const n of scene.current?.nodes ?? []) {
      const d = Math.hypot((n.x ?? 0) - x, (n.y ?? 0) - y) - n.r;
      if (d < slop && d < gap) {
        gap = d;
        best = n;
      }
    }
    return best;
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    flight.current = null;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 2 && g?.mode !== "node") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current = { mode: "pinch", dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midX: mid.x, midY: mid.y, view: { ...view.current } };
      setPanning(true);
      return;
    }
    if (g) return;
    const n = hitAt(e.clientX, e.clientY);
    if (n) gesture.current = { mode: "node", pointer: e.pointerId, id: n.id, startX: e.clientX, startY: e.clientY, moved: false };
    else {
      gesture.current = { mode: "pan", pointer: e.pointerId, startX: e.clientX, startY: e.clientY, view: { ...view.current } };
      setPanning(true);
    }
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse") setHover(hitAt(e.clientX, e.clientY)?.id ?? null);
      return;
    }
    if (g.mode === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      touched.current = true;
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const wx = (g.midX - g.view.x) / g.view.k;
      const wy = (g.midY - g.view.y) / g.view.k;
      setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
      return;
    }
    if (g.pointer !== e.pointerId) return;
    if (g.mode === "pan") {
      touched.current = true;
      setView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY });
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) return;
    const n = model.byId.get(g.id);
    if (!n) return;
    const v = view.current;
    const p = local(e.clientX, e.clientY);
    const x = (p.x - v.x) / v.k;
    const y = (p.y - v.y) / v.k;
    if (!g.moved) {
      g.moved = true;
      touched.current = true;
      setHover(null);
      if (!reduced) simRef.current?.alphaTarget(0.12).restart();
    }
    n.fx = x;
    n.fy = y;
    if (reduced) {
      n.x = x;
      n.y = y;
      draw();
    }
  };

  const release = (e: PointerEvent<HTMLCanvasElement>, commit: boolean): void => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "pinch") {
      if (pointers.current.size < 2) {
        gesture.current = null;
        setPanning(false);
      }
      return;
    }
    if (g.pointer !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (g.mode === "node" && g.moved) simRef.current?.alphaTarget(0);
    if (!commit) return;
    if (g.mode === "node") {
      if (!g.moved) select(g.id);
    } else if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) setSelected(null);
  };

  const onNodeKey = (e: KeyboardEvent<HTMLButtonElement>, id: string): void => {
    const dir = ARROW[e.key];
    if (!dir) return;
    e.preventDefault();
    const next = toward(model, hidden, id, dir);
    if (next) nodeEls.current.get(next)?.focus({ preventScroll: true });
  };

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target === inputRef.current) return;
    const factor = e.key === "+" || e.key === "=" ? 1.3 : e.key === "-" || e.key === "_" ? 1 / 1.3 : 0;
    if (!factor) return;
    e.preventDefault();
    zoomBy(factor);
  };

  const close = (): void => {
    const id = selected;
    setSelected(null);
    if (id && panelRef.current?.contains(document.activeElement)) nodeEls.current.get(id)?.focus({ preventScroll: true });
  };

  const go = (index: number): void => {
    const m = matches[index % matches.length];
    if (!m) return;
    select(m.id, "center");
    setActive((index + 1) % matches.length);
  };

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (query) setQuery("");
      else inputRef.current?.blur();
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((active + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    go(active);
  };

  const nextWaiting = (): void => {
    const next = pending[waitHit % pending.length];
    if (next) select(next.id, "center");
    setWaitHit(waitHit + 1);
  };

  const matchSet = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);
  const spotlight = useMemo((): Set<string> | null => {
    const around = (id: string): Set<string> => new Set([id, ...(model.around.get(id) ?? []).map((n) => n.node.id)]);
    if (hover) return around(hover);
    if (query.trim()) return matchSet;
    if (gaps) return new Set(missing.flatMap((m) => [m.id, ...(model.around.get(m.id) ?? []).map((n) => n.node.id)]));
    if (selected) return around(selected);
    return null;
  }, [hover, query, matchSet, gaps, missing, selected, model]);
  const focusId = hover ?? (query.trim() || gaps ? null : selected);
  const placed = useMemo((): Set<string> => {
    const forced = (n: SimNode): boolean => n.id === selected || n.id === hover || matchSet.has(n.id);
    const wanted = (n: SimNode): boolean => forced(n) || n.kind !== "document" || (spotlight?.has(n.id) ?? false);
    const priority = (n: SimNode): number =>
      (n.id === selected ? 4e6 : 0) +
      (n.id === hover ? 3e6 : 0) +
      (matchSet.has(n.id) ? 2e6 : 0) +
      (spotlight?.has(n.id) ? 1e6 : 0) +
      (n.kind === "repo" ? 5e5 : 0) +
      (n.kind === "decision" || n.kind === "missing" ? 1e5 : 0) +
      n.degree;
    const boxes: Array<[number, number, number, number]> = visible
      .filter((n) => spotlight?.has(n.id) ?? true)
      .map((n) => [(n.x ?? 0) - n.r, (n.y ?? 0) - n.r, (n.x ?? 0) + n.r, (n.y ?? 0) + n.r]);
    const out = new Set<string>();
    for (const n of visible.filter(wanted).sort((x, y) => priority(y) - priority(x))) {
      const size = n.kind === "repo" ? 12.5 : 11.5;
      const chars = forced(n) ? n.label.length : Math.min(n.label.length, 26);
      const w = (chars * size * LABEL_CHAR) / scale;
      const h = (size + 3) / scale;
      const x0 = (n.x ?? 0) - w / 2;
      const y0 = (n.y ?? 0) + n.r + (LABEL_GAP - size) / scale;
      const hit = boxes.some(([bx0, by0, bx1, by1]) => x0 < bx1 && x0 + w > bx0 && y0 < by1 && y0 + h > by0);
      if (hit && !forced(n) && n.kind !== "repo") continue;
      boxes.push([x0, y0, x0 + w, y0 + h]);
      out.add(n.id);
    }
    return out;
  }, [visible, selected, hover, matchSet, spotlight, scale, layoutVersion]);

  useLayoutEffect(() => {
    scene.current = {
      nodes: visible,
      links: shownLinks,
      spotlight,
      focusId,
      focusKind: focusId ? (model.byId.get(focusId)?.kind ?? null) : null,
      selected,
      hover,
      cursor,
      matches: matchSet,
      placed,
    };
    draw();
  });

  const chosen = selected ? (model.byId.get(selected) ?? null) : null;
  const hiddenAll = visible.length === 0;
  const aimed = model.byId.get(cursor ?? hover ?? "");
  const room = wide && chosen ? panelWidth + 26 : 14;
  const open = typing && query.trim() !== "";
  const listed = open && matches.length > 0;
  const current = matches.length ? active % matches.length : -1;

  useEffect(() => {
    if (listed && current >= 0) document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [listed, current, listId]);

  const findCaption = query.trim()
    ? matches.length
      ? `${plural(matches.length, "match", "matches")}. Enter flies to ${matches.length > 1 ? "the highlighted one, again for the next" : "it"}.`
      : "Nothing visible has that name."
    : "";

  const tool = (label: string, onClick: () => void, path: string): JSX.Element => (
    <button type="button" className="cb-graph-tool cb-graph-glass" aria-label={label} title={label} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  const panel = chosen ? (
    <div
      ref={panelRef}
      role="region"
      aria-label={`Details for ${chosen.label}`}
      className="cb-graph-panel"
      data-wide={wide}
      style={wide ? { position: "absolute", top: 12, right: 12, bottom: 12, width: panelWidth, zIndex: 2 } : { maxHeight: "min(70dvh, 560px)" }}
    >
      <Detail node={chosen} model={model} purposes={data.purposes} hud={hud} onSelect={(id) => select(id, "focus")} onAsk={onAsk} onClose={close} />
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) close();
      }}
    >
      <Stack gap={18}>
        {header}

        {missing.length || pending.length ? (
          <Stack direction="row" gap={10} wrap align="stretch">
            {missing.length ? (
              <button
                type="button"
                className="cb-graph-gaps"
                aria-pressed={gaps}
                onClick={() => {
                  const next = !gaps;
                  setGaps(next);
                  if (next && hidden.has("missing")) toggleKind("missing");
                }}
              >
                <span style={{ ...tokens.type.xl, fontWeight: tokens.weight.semibold, fontVariantNumeric: "tabular-nums" }}>{missing.length}</span>
                <span style={{ ...tokens.type.sm, fontWeight: tokens.weight.medium }}>{missing.length === 1 ? "gap in what is written down" : "gaps in what is written down"}</span>
                <span style={{ ...tokens.type.sm, color: pal.accentText }}>{gaps ? "Hide" : "Show"}</span>
              </button>
            ) : null}
            {pending.length ? (
              <button type="button" className="cb-graph-gaps" onClick={nextWaiting}>
                <span style={{ ...tokens.type.xl, fontWeight: tokens.weight.semibold, color: pal.warning, fontVariantNumeric: "tabular-nums" }}>{pending.length}</span>
                <span style={{ ...tokens.type.sm, fontWeight: tokens.weight.medium }}>{pending.length === 1 ? "decision waiting on you" : "decisions waiting on you"}</span>
                <span style={{ ...tokens.type.sm, color: pal.accentText }}>{pending.length > 1 && waitHit ? "Next" : "Find"}</span>
              </button>
            ) : null}
          </Stack>
        ) : null}

        {gaps && missing.length ? (
          <Stack gap={8}>
            <Text secondary theme={THEME} style={tokens.type.sm}>
              {GAP_NOTE} Pick one to see who references it.
            </Text>
            <Stack direction="row" gap={6} wrap style={{ maxHeight: 132, overflowY: "auto" }}>
              {missing.map((m) => (
                <KindChip key={m.id} kind="missing" label={m.label} count={m.degree} on={selected === m.id} onClick={() => select(m.id, "center")} title={m.label} />
              ))}
            </Stack>
          </Stack>
        ) : null}

        <Stack gap={12}>
          <div
            ref={stageRef}
            className="cb-graph-stage"
            role="group"
            aria-label="Knowledge graph. Tab through nodes, arrow keys move to a connected node, Enter opens one, Escape closes it, plus and minus zoom, slash searches."
            onKeyDown={onStageKey}
          >
            <canvas
              ref={canvasRef}
              className="cb-graph-canvas cb-graph-bloom"
              data-panning={panning}
              data-over={hover !== null}
              aria-hidden
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={(e) => release(e, true)}
              onPointerCancel={(e) => release(e, false)}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse" && !gesture.current) setHover(null);
              }}
            />
            <div className="cb-graph-scan" aria-hidden />
            {(["tl", "tr", "bl", "br"] as const).map((at) => (
              <span key={at} className="cb-graph-bracket" data-at={at} aria-hidden />
            ))}

            <div className="cb-graph-top" style={{ right: room }}>
              <div className="cb-graph-cmd">
                <div className="cb-graph-cmd-field cb-graph-glass">
                  <span className="cb-graph-cmd-prompt" aria-hidden>
                    ›
                  </span>
                  <input
                    ref={inputRef}
                    role="combobox"
                    aria-label="Find a node and fly to it"
                    aria-expanded={listed}
                    aria-controls={listed ? listId : undefined}
                    aria-autocomplete="list"
                    aria-activedescendant={listed && current >= 0 ? `${listId}-${current}` : undefined}
                    placeholder="Find a node"
                    value={query}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onFocus={() => setTyping(true)}
                    onBlur={() => setTyping(false)}
                    onKeyDown={onFindKey}
                  />
                  <kbd className="cb-graph-kbd" aria-hidden>
                    /
                  </kbd>
                </div>
                {listed ? (
                  <ul id={listId} role="listbox" aria-label="Matching nodes" className="cb-graph-list cb-graph-glass">
                    {matches.map((m, i) => (
                      <li
                        key={m.id}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === current}
                        className="cb-graph-option"
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => go(i)}
                      >
                        <KindDot kind={m.kind} />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                        <span className="cb-graph-option-kind">{kindName(m.kind)}</span>
                      </li>
                    ))}
                  </ul>
                ) : open ? (
                  <div className="cb-graph-list cb-graph-glass cb-graph-empty">Nothing visible has that name.</div>
                ) : null}
                <span className="cb-graph-sr" aria-live="polite">
                  {findCaption}
                </span>
              </div>
              <div className="cb-graph-tools">
                {tool("Zoom in", () => zoomBy(1.3), "M6 1v10M1 6h10")}
                {tool("Zoom out", () => zoomBy(1 / 1.3), "M1 6h10")}
                {tool("Fit the graph to the view", () => fit(true), "M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8")}
              </div>
            </div>

            <ul className="cb-graph-sr" aria-label="Nodes in the graph">
              {visible.map((n) => (
                <li key={n.id}>
                  <button
                    ref={(el) => {
                      if (el) nodeEls.current.set(n.id, el);
                      else nodeEls.current.delete(n.id);
                    }}
                    type="button"
                    aria-label={`${n.label}, ${kindName(n.kind).toLowerCase()}${waiting(n) ? ", waiting on you" : ""}, ${plural(n.degree, "connection", "connections")}`}
                    aria-pressed={selected === n.id}
                    onClick={() => select(n.id)}
                    onKeyDown={(e) => onNodeKey(e, n.id)}
                    onFocus={(e) => {
                      if (!e.currentTarget.matches(":focus-visible")) return;
                      setCursor(n.id);
                      setHover(n.id);
                      reveal(n.id);
                    }}
                    onBlur={() => {
                      setCursor((c) => (c === n.id ? null : c));
                      setHover((h) => (h === n.id ? null : h));
                    }}
                  />
                </li>
              ))}
            </ul>

            {hiddenAll ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", padding: 24, textAlign: "center" }}>
                <span style={{ color: hud.labelDim, ...tokens.type.base }}>Every kind is hidden. Turn one back on below.</span>
              </div>
            ) : null}

            <div className="cb-graph-bottom" style={{ right: room }}>
              <div className="cb-graph-readout cb-graph-glass">
                <span>
                  Nodes<b>{visible.length}</b>
                </span>
                <span>
                  Links<b>{shownLinks.length}</b>
                </span>
                <span>
                  Clusters<b>{islands}</b>
                </span>
                <span>
                  Zoom<b>{scale.toFixed(2)}×</b>
                </span>
              </div>
              <div className="cb-graph-hint cb-graph-glass" data-nudge={nudge} data-target={!nudge && aimed !== undefined} aria-hidden>
                {nudge ? (
                  NUDGE
                ) : aimed ? (
                  <>
                    <span className="cb-graph-cmd-prompt">›</span>
                    {aimed.label} · {kindName(aimed.kind)} · {plural(aimed.degree, "link", "links")}
                  </>
                ) : (
                  HINT
                )}
              </div>
            </div>

            {wide ? panel : null}
          </div>

          {wide ? null : panel}
        </Stack>

        <Stack gap={10}>
          <Caption theme={THEME}>KINDS, PICK ONE TO HIDE OR SHOW IT</Caption>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "12px 16px" }}>
            {GRAPH_KINDS.filter((k) => counts.has(k)).map((k) => (
              <Stack key={k} gap={4} style={{ minWidth: 0 }}>
                <div>
                  <KindChip kind={k} label={kindName(k, true)} count={counts.get(k)} on={!hidden.has(k)} onClick={() => toggleKind(k)} />
                </div>
                <Text secondary theme={THEME} style={{ ...tokens.type.xs, lineHeight: 1.5 }}>
                  {kindPurpose(k, data.purposes)}
                </Text>
              </Stack>
            ))}
          </div>
        </Stack>
      </Stack>
    </div>
  );
}
