import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Badge, Button, Caption, Card, CardHeader, Heading, IconButton, Skeleton, Stack, Text, TextInput, tokens, usePal } from "./ui";
import { GRAPH_KINDS, KindBadge, KindChip, KindDot, kindColor, kindName, kindPurpose } from "./kinds";
import { EASE, THEME, get, injectCss, reason, useReducedMotion, useWidth } from "./shared";

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

interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  purposes: Record<string, string>;
  now: number;
}

interface SimNode extends SimulationNodeDatum, GraphNode {
  r: number;
  degree: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  key: string;
  relation: string;
  from: string;
  to: string;
}

interface Neighbor {
  node: SimNode;
  relation: string;
  outgoing: boolean;
}

interface Model {
  nodes: SimNode[];
  links: SimLink[];
  byId: Map<string, SimNode>;
  around: Map<string, Neighbor[]>;
}

interface View {
  x: number;
  y: number;
  k: number;
}

type Gesture =
  | { mode: "pan"; pointer: number; startX: number; startY: number; view: View }
  | { mode: "node"; pointer: number; id: string; startX: number; startY: number; moved: boolean };

const WIDE = 600;
const PANEL = 300;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const LABEL_CHAR = 0.56;
const LABEL_GAP = 13;
const EDGE = 28;

const ARROW: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
const COARSE = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const HINT = COARSE ? "Drag to pan or move a node. Zoom with + and -." : `Drag to pan or move a node. Pinch or ${MOD} + scroll to zoom.`;
const NUDGE = `Hold ${MOD} while scrolling to zoom the graph`;

const RELATION: Record<string, [string, string]> = {
  links: ["Links to", "Linked from"],
  mentions: ["Mentions", "Mentioned by"],
  documents: ["In repository", "Document"],
  decided: ["Decided in", "Decision"],
};

const GAP_NOTE = "Entries point at these with [[Name]], but nobody has written them down yet.";

function radius(kind: string, degree: number): number {
  if (kind === "repo") return Math.min(24, 11 + Math.sqrt(degree) * 2.4);
  if (kind === "document") return 3.5;
  if (kind === "decision") return 6.5;
  if (kind === "missing") return Math.min(12, 5 + Math.sqrt(degree) * 1.6);
  return Math.min(16, 5.5 + Math.sqrt(degree) * 2);
}

function buildModel(view: GraphView): Model {
  const byId = new Map<string, SimNode>();
  for (const n of view.nodes) byId.set(n.id, { ...n, r: 0, degree: 0 });
  const around = new Map<string, Neighbor[]>();
  const links: SimLink[] = [];
  view.edges.forEach((e, i) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || a === b) return;
    a.degree += 1;
    b.degree += 1;
    links.push({ key: `${i}`, source: a.id, target: b.id, from: a.id, to: b.id, relation: e.relation });
    around.set(a.id, [...(around.get(a.id) ?? []), { node: b, relation: e.relation, outgoing: true }]);
    around.set(b.id, [...(around.get(b.id) ?? []), { node: a, relation: e.relation, outgoing: false }]);
  });
  const rank = (n: SimNode): number => (n.kind === "repo" ? 0 : waiting(n) ? 1 : n.kind === "document" ? 4 : n.kind === "missing" ? 3 : 2);
  const nodes = [...byId.values()].sort((a, b) => rank(a) - rank(b) || b.degree - a.degree);
  for (const n of nodes) n.r = radius(n.kind, n.degree);
  return { nodes, links, byId, around };
}

function waiting(node: GraphNode): boolean {
  return node.kind === "decision" && node.detail === "Waiting on you";
}

function question(node: GraphNode): string {
  if (node.kind === "missing") return `What do we know about ${node.label}? Nobody has written it down yet.`;
  if (node.kind === "decision") return `What was decided about "${node.label}", and why?`;
  if (node.kind === "repo") return `What should I know about the ${node.label} repository?`;
  return `What should I know about ${node.label}?`;
}

function bounds(nodes: SimNode[]): [number, number, number, number] | null {
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

function toward(model: Model, hidden: Set<string>, id: string, [ux, uy]: [number, number]): string | null {
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

function short(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}...` : label;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function injectGraphStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-graph-styles",
    `
    .cb-graph-canvas { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
    .cb-graph-canvas[data-panning="true"] { cursor: grabbing; }
    .cb-graph-node { cursor: pointer; transition: opacity 160ms ${EASE}; }
    .cb-graph-node[data-dim="true"] { opacity: 0.14; }
    svg .cb-graph-node:focus, svg .cb-graph-node:focus-visible { outline: none !important; }
    .cb-graph-node .cb-graph-focus { opacity: 0; }
    .cb-graph-node:focus-visible .cb-graph-focus { opacity: 1; }
    .cb-graph-edge { transition: opacity 160ms ${EASE}; }
    .cb-graph-edge[data-dim="true"] { opacity: 0.05; }
    @keyframes cb-graph-bloom { from { opacity: 0; transform: scale(0.96); } }
    .cb-graph-bloom { transform-box: view-box; transform-origin: 50% 50%; animation: cb-graph-bloom 280ms ${EASE} both; }
    .cb-graph-row {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px;
      border: none; border-radius: 10px; background: transparent; color: ${pal.text}; cursor: pointer;
      font: 400 13px/1.4 ${tokens.font.sans}; transition: background-color 150ms ${EASE}, transform 140ms ${EASE};
    }
    .cb-graph-row:active { transform: scale(0.98); }
    .cb-graph-row:focus-visible, .cb-graph-gaps:focus-visible { outline: 2px solid ${pal.accent}; outline-offset: 2px; }
    .cb-graph-hint {
      position: absolute; left: 12px; bottom: 12px; max-width: calc(100% - 24px); box-sizing: border-box; pointer-events: none;
      padding: 5px 10px; border-radius: 999px; border: 1px solid ${pal.borderSubtle}; background: ${pal.bgElevated};
      color: ${pal.textTertiary}; font: 400 12px/1.4 ${tokens.font.sans};
      transition: border-color 160ms ${EASE}, color 160ms ${EASE};
    }
    .cb-graph-hint[data-nudge="true"] { border-color: ${pal.accent}; color: ${pal.text}; }
    @media (hover: hover) and (pointer: fine) { .cb-graph-row:hover { background: ${pal.bgHover}; } }
    .cb-graph-gaps {
      display: inline-flex; align-items: baseline; gap: 8px; border: 1px solid ${pal.border}; background: ${pal.bgSubtle};
      border-radius: 12px; padding: 8px 14px; cursor: pointer; color: ${pal.text}; font-family: ${tokens.font.sans};
      transition: border-color 160ms ${EASE}, background-color 160ms ${EASE}, transform 140ms ${EASE};
    }
    .cb-graph-gaps[aria-pressed="true"] { border-color: ${pal.accent}; background: ${pal.accentBg}; }
    .cb-graph-gaps:active { transform: scale(0.97); }
    @media (hover: hover) and (pointer: fine) { .cb-graph-gaps:hover { border-color: ${pal.accent}; } }
    @media (prefers-reduced-motion: reduce) {
      .cb-graph-bloom { animation: none; }
      .cb-graph-node, .cb-graph-edge, .cb-graph-row, .cb-graph-gaps, .cb-graph-hint { transition: none; }
    }
  `,
  );
}

const CANVAS_HEIGHT = "clamp(420px, calc(100dvh - 330px), 820px)";

function Loading({ header }: { header: JSX.Element }): JSX.Element {
  const pal = usePal(THEME);
  return (
    <Stack gap={18}>
      {header}
      <Stack direction="row" gap={10} wrap>
        <Skeleton theme={THEME} width={230} height={42} />
        <Skeleton theme={THEME} width={220} height={42} />
      </Stack>
      <div style={{ maxWidth: 420 }}>
        <Skeleton theme={THEME} width="100%" height={32} />
      </div>
      <div style={{ height: CANVAS_HEIGHT, borderRadius: tokens.radius.lg, border: `1px solid ${pal.borderSubtle}`, background: pal.bgSubtle, padding: 20, boxSizing: "border-box" }}>
        <Stack gap={12}>
          <Skeleton theme={THEME} width={180} />
          <Skeleton theme={THEME} width={120} />
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
  onSelect,
  onAsk,
  onClose,
}: {
  node: SimNode;
  model: Model;
  purposes: Record<string, string>;
  onSelect: (id: string) => void;
  onAsk: (question: string) => void;
  onClose: () => void;
}): JSX.Element {
  const pal = usePal(THEME);
  const neighbors = [...(model.around.get(node.id) ?? [])].sort(
    (a, b) => Number(a.node.kind === "document") - Number(b.node.kind === "document") || a.node.label.localeCompare(b.node.label),
  );
  const ruled = node.kind === "decision" && node.detail?.startsWith("Ruled: ");

  return (
    <Stack gap={16} style={{ padding: 18 }}>
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
        <Heading level={4} theme={THEME} style={{ overflowWrap: "anywhere" }}>
          {node.label}
        </Heading>
        <Text secondary theme={THEME} style={tokens.type.sm}>
          {kindPurpose(node.kind, purposes)}
        </Text>
      </Stack>

      {waiting(node) ? (
        <Badge variant="warning" theme={THEME} style={{ alignSelf: "flex-start" }}>
          Waiting on you
        </Badge>
      ) : ruled ? (
        <Stack gap={4}>
          <Caption theme={THEME}>RULED</Caption>
          <Text theme={THEME} style={{ ...tokens.type.sm, overflowWrap: "anywhere" }}>
            {node.detail?.slice("Ruled: ".length)}
          </Text>
        </Stack>
      ) : node.kind === "missing" ? (
        <Text theme={THEME} style={{ ...tokens.type.sm, color: pal.textSecondary }}>
          Write an entry named exactly {node.label} and every link to it connects.
        </Text>
      ) : node.detail ? (
        <Text theme={THEME} mono={node.kind === "document"} style={{ ...tokens.type.sm, color: pal.textSecondary, overflowWrap: "anywhere" }}>
          {node.detail}
        </Text>
      ) : null}

      <Button variant="primary" size="sm" theme={THEME} onClick={() => onAsk(question(node))} style={{ alignSelf: "flex-start" }}>
        Ask about this
      </Button>

      <Stack gap={6}>
        <Caption theme={THEME}>{neighbors.length ? `CONNECTIONS ${neighbors.length}` : "NO CONNECTIONS"}</Caption>
        <Stack gap={0} style={{ margin: "0 -10px" }}>
          {neighbors.map((n, i) => (
            <button key={`${n.node.id}-${i}`} type="button" className="cb-graph-row" onClick={() => onSelect(n.node.id)}>
              <KindDot kind={n.node.kind} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{n.node.label}</span>
              <span style={{ ...tokens.type.xs, color: pal.textTertiary, whiteSpace: "nowrap" }}>{(RELATION[n.relation] ?? [n.relation, n.relation])[n.outgoing ? 0 : 1]}</span>
            </button>
          ))}
        </Stack>
      </Stack>
    </Stack>
  );
}

export function GraphScreen({ onAsk }: { onAsk: (question: string) => void }): JSX.Element {
  const pal = usePal(THEME);
  injectGraphStyles(pal);
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
  const reduced = useReducedMotion();
  const model = useMemo(() => buildModel(data), [data]);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const wide = width >= WIDE;
  const panelWidth = Math.min(PANEL, Math.round(width * 0.42));
  const panelRef = useRef<HTMLDivElement>(null);
  const nudgeTimer = useRef<number | undefined>(undefined);
  const [nudge, setNudge] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const gesture = useRef<Gesture | null>(null);
  const settled = useRef<Model | null>(null);
  const target = useRef<[number, number, number, number] | null>(null);
  const touched = useRef(false);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
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
    const v = view.current;
    viewRef.current?.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
    for (const n of model.nodes) nodeEls.current.get(n.id)?.setAttribute("transform", `translate(${n.x ?? 0},${n.y ?? 0})`);
    for (const l of model.links) {
      const el = edgeEls.current.get(l.key);
      const a = l.source as SimNode;
      const b = l.target as SimNode;
      if (!el || typeof a !== "object" || typeof b !== "object") continue;
      el.setAttribute("x1", `${a.x ?? 0}`);
      el.setAttribute("y1", `${a.y ?? 0}`);
      el.setAttribute("x2", `${b.x ?? 0}`);
      el.setAttribute("y2", `${b.y ?? 0}`);
    }
  }, [model]);

  const setView = useCallback(
    (next: View): void => {
      view.current = next;
      setScale(Math.round(next.k * 20) / 20);
      draw();
    },
    [draw],
  );

  const box = (): { w: number; h: number } => {
    const r = svgRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 800, h: r?.height ?? 560 };
  };

  const fit = useCallback((): void => {
    const b = target.current ?? bounds(model.nodes.filter((n) => !hidden.has(n.kind)));
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    const { w, h } = box();
    const room = wide && selected ? w - panelWidth - 24 : w;
    const k = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((room - 64) / Math.max(1, x1 - x0), (h - 64) / Math.max(1, y1 - y0))));
    setView({ k, x: room / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k });
  }, [model, hidden, wide, selected, panelWidth, setView]);

  useEffect(() => {
    if (!touched.current) fit();
  }, [width]);

  useLayoutEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>(model.nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(model.links)
          .id((d) => d.id)
          .distance((l) => (l.source as SimNode).r + (l.target as SimNode).r + (l.relation === "documents" ? 10 : 34))
          .strength((l) => (l.relation === "documents" ? 0.9 : 0.45)),
      )
      .force(
        "charge",
        forceManyBody<SimNode>()
          .strength((d) => (d.kind === "document" ? -16 : -55 - d.r * 5))
          .distanceMax(420),
      )
      .force("collide", forceCollide<SimNode>((d) => d.r + 3))
      .force("x", forceX<SimNode>(0).strength(0.05))
      .force("y", forceY<SimNode>(0).strength(0.05))
      .alphaDecay(0.045)
      .alphaMin(0.004)
      .stop();
    simRef.current = sim;
    const animate = !reduced && settled.current !== model;
    const settle = (): void => {
      while (sim.alpha() > sim.alphaMin()) sim.tick();
    };
    if (animate) {
      for (let i = 0; i < 40; i += 1) sim.tick();
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

  useLayoutEffect(() => draw());

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        setNudge(true);
        window.clearTimeout(nudgeTimer.current);
        nudgeTimer.current = window.setTimeout(() => setNudge(false), 1600);
        return;
      }
      e.preventDefault();
      touched.current = true;
      setNudge(false);
      const v = view.current;
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const delta = Math.max(-40, Math.min(40, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * Math.exp(-delta * 0.01)));
      setView({ k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
      window.clearTimeout(nudgeTimer.current);
    };
  }, [setView]);

  useEffect(() => {
    if (selected && !wide) panelRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [selected, wide, reduced]);

  const zoomBy = (factor: number): void => {
    touched.current = true;
    const v = view.current;
    const { w, h } = box();
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
    setView({ k, x: w / 2 - ((w / 2 - v.x) * k) / v.k, y: h / 2 - ((h / 2 - v.y) * k) / v.k });
  };

  const center = (id: string, room: number, k: number): void => {
    const n = model.byId.get(id);
    if (!n) return;
    touched.current = true;
    setView({ k, x: room / 2 - (n.x ?? 0) * k, y: box().h / 2 - (n.y ?? 0) * k });
  };

  const reveal = (id: string): void => {
    const n = model.byId.get(id);
    if (!n) return;
    const { w, h } = box();
    const v = view.current;
    const room = wide && selected ? w - panelWidth - 24 : w;
    const sx = (n.x ?? 0) * v.k + v.x;
    const sy = (n.y ?? 0) * v.k + v.y;
    if (sx < EDGE || sx > room - EDGE || sy < EDGE || sy > h - EDGE) center(id, room, v.k);
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
    if (move !== "stay" || covered) center(id, room, Math.max(view.current.k, 1));
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

  const local = (e: PointerEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = view.current;
    return { x: (e.clientX - (rect?.left ?? 0) - v.x) / v.k, y: (e.clientY - (rect?.top ?? 0) - v.y) / v.k };
  };

  const onCanvasDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (gesture.current || e.button !== 0) return;
    gesture.current = { mode: "pan", pointer: e.pointerId, startX: e.clientX, startY: e.clientY, view: { ...view.current } };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const onNodeDown = (e: PointerEvent<SVGGElement>, id: string): void => {
    e.stopPropagation();
    if (gesture.current || e.button !== 0) return;
    gesture.current = { mode: "node", pointer: e.pointerId, id, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    if (g.mode === "pan") {
      touched.current = true;
      setView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY });
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) return;
    const n = model.byId.get(g.id);
    if (!n) return;
    const p = local(e);
    if (!g.moved) {
      g.moved = true;
      touched.current = true;
      setHover(null);
      if (!reduced) simRef.current?.alphaTarget(0.12).restart();
    }
    n.fx = p.x;
    n.fy = p.y;
    if (reduced) {
      n.x = p.x;
      n.y = p.y;
      draw();
    }
  };

  const onUp = (e: PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (g.mode === "node") {
      if (g.moved) simRef.current?.alphaTarget(0);
      else select(g.id);
    } else if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) setSelected(null);
  };

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, id: string): void => {
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const next = visible[visible.findIndex((v) => v.id === id) + (e.shiftKey ? -1 : 1)];
      if (!next) return;
      e.preventDefault();
      nodeEls.current.get(next.id)?.focus({ preventScroll: true });
      return;
    }
    const dir = ARROW[e.key];
    if (dir) {
      e.preventDefault();
      const next = toward(model, hidden, id, dir);
      if (next) nodeEls.current.get(next)?.focus({ preventScroll: true });
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select(id);
  };

  const onCanvasKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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

  const onFindKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" && query) {
      e.stopPropagation();
      setQuery("");
      return;
    }
    if (e.key !== "Enter" || !matches.length) return;
    e.preventDefault();
    const target = matches[hit % matches.length];
    if (target) select(target.id, "center");
    setHit(hit + 1);
  };

  const nextWaiting = (): void => {
    const target = pending[waitHit % pending.length];
    if (target) select(target.id, "center");
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
    const boxes: Array<[number, number, number, number]> = [];
    const out = new Set<string>();
    for (const n of visible.filter(wanted).sort((x, y) => priority(y) - priority(x))) {
      const size = n.kind === "repo" ? 12 : 11;
      const chars = forced(n) ? n.label.length : Math.min(n.label.length, 26);
      const w = (chars * size * LABEL_CHAR) / scale;
      const h = (size + 3) / scale;
      const x0 = (n.x ?? 0) - w / 2;
      const y0 = (n.y ?? 0) + n.r + (LABEL_GAP - size) / scale;
      const hit = boxes.some(([bx0, by0, bx1, by1]) => x0 < bx1 && x0 + w > bx0 && y0 < by1 && y0 + h > by0);
      if (hit && !forced(n)) continue;
      boxes.push([x0, y0, x0 + w, y0 + h]);
      out.add(n.id);
    }
    return out;
  }, [visible, selected, hover, matchSet, spotlight, scale, layoutVersion]);

  const edgeLit = (l: SimLink): boolean => {
    if (!spotlight) return false;
    if (focusId) return l.from === focusId || l.to === focusId;
    return spotlight.has(l.from) && spotlight.has(l.to);
  };

  const chosen = selected ? model.byId.get(selected) ?? null : null;
  const hiddenAll = visible.length === 0;

  const findCaption = query.trim()
    ? matches.length
      ? `${plural(matches.length, "match", "matches")}. Enter jumps to ${matches.length > 1 ? "the next" : "it"}.`
      : "Nothing visible has that name."
    : "Find a node by name.";

  const panel = chosen ? (
    <div
      ref={panelRef}
      role="region"
      aria-label={`Details for ${chosen.label}`}
      style={
        wide
          ? {
              position: "absolute",
              top: 12,
              right: 12,
              bottom: 12,
              width: panelWidth,
              overflowY: "auto",
              overscrollBehavior: "contain",
              background: pal.bgElevated,
              border: `1px solid ${pal.border}`,
              borderRadius: tokens.radius.md,
              boxShadow: `0 12px 32px ${pal.shadowLg}`,
            }
          : {
              maxHeight: "min(70dvh, 560px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
              background: pal.bgElevated,
              border: `1px solid ${pal.border}`,
              borderRadius: tokens.radius.md,
            }
      }
    >
      <Detail node={chosen} model={model} purposes={data.purposes} onSelect={(id) => select(id, "focus")} onAsk={onAsk} onClose={close} />
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
        <Stack direction="row" justify="space-between" align="flex-end" gap={16} wrap>
          {header}
          <Caption theme={THEME} style={{ fontVariantNumeric: "tabular-nums" }}>
            {plural(model.nodes.length, "node", "nodes")} · {plural(model.links.length, "connection", "connections")}
          </Caption>
        </Stack>

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

        <div onKeyDown={onFindKey} style={{ maxWidth: 420 }}>
          <TextInput value={query} placeholder="Find a node" size="sm" caption={findCaption} onChange={(next: string) => { setQuery(next); setHit(0); }} theme={THEME} />
        </div>

        <Stack gap={12}>
          <div
            style={{
              position: "relative",
              height: CANVAS_HEIGHT,
              borderRadius: tokens.radius.lg,
              border: `1px solid ${pal.borderSubtle}`,
              background: pal.bgSubtle,
              overflow: "clip",
            }}
          >
            <svg
              ref={svgRef}
              className="cb-graph-canvas"
              data-panning={panning}
              width="100%"
              height="100%"
              role="group"
              aria-label="Knowledge graph. Tab through nodes, arrow keys move to a connected node, Enter opens one, Escape closes it, plus and minus zoom."
              onPointerDown={onCanvasDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onCanvasKey}
            >
              <g className="cb-graph-bloom">
                <g ref={viewRef}>
                  <g>
                    {shownLinks.map((l) => {
                      const lit = edgeLit(l);
                      const source = model.byId.get(l.from);
                      return (
                        <line
                          key={l.key}
                          ref={(el) => {
                            if (el) edgeEls.current.set(l.key, el);
                          }}
                          className="cb-graph-edge"
                          data-dim={spotlight !== null && !lit}
                          stroke={lit ? kindColor(model.byId.get(focusId ?? "")?.kind ?? source?.kind ?? "").line : pal.border}
                          strokeWidth={lit ? 1.4 : l.relation === "documents" ? 0.6 : 1}
                          strokeOpacity={lit ? 1 : l.relation === "documents" ? 0.5 : 0.8}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  </g>
                  <g>
                    {visible.map((n) => {
                      const c = kindColor(n.kind);
                      const isSelected = selected === n.id;
                      const isMatch = matchSet.has(n.id);
                      const lit = spotlight?.has(n.id) ?? false;
                      const labelled = placed.has(n.id);
                      const full = isSelected || hover === n.id;
                      const size = n.kind === "repo" ? 12 : 11;
                      return (
                        <g
                          key={n.id}
                          ref={(el) => {
                            if (el) nodeEls.current.set(n.id, el);
                          }}
                          className="cb-graph-node"
                          data-dim={spotlight !== null && !lit}
                          role="button"
                          tabIndex={0}
                          aria-label={`${n.label}, ${kindName(n.kind).toLowerCase()}${waiting(n) ? ", waiting on you" : ""}, ${plural(n.degree, "connection", "connections")}`}
                          aria-pressed={isSelected}
                          onPointerDown={(e) => onNodeDown(e, n.id)}
                          onPointerEnter={() => {
                            if (!gesture.current) setHover(n.id);
                          }}
                          onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                          onKeyDown={(e) => onNodeKey(e, n.id)}
                          onFocus={(e) => {
                            if (!e.currentTarget.matches(":focus-visible")) return;
                            setHover(n.id);
                            reveal(n.id);
                          }}
                          onBlur={() => setHover((h) => (h === n.id ? null : h))}
                        >
                          <circle r={Math.max(n.r + 3, 9)} fill="transparent" />
                          <circle className="cb-graph-focus" r={n.r + 6} fill="none" stroke={pal.accent} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                          {waiting(n) ? <circle r={n.r + 4} fill="none" stroke={pal.warning} strokeWidth={1.5} style={{ filter: `drop-shadow(0 0 4px ${pal.warning})` }} /> : null}
                          {isSelected || isMatch ? (
                            <circle
                              r={n.r + 3.5}
                              fill="none"
                              stroke={isSelected ? c.ink : pal.accent}
                              strokeWidth={1.5}
                              style={isSelected ? { filter: `drop-shadow(0 0 6px ${c.ink})` } : undefined}
                            />
                          ) : null}
                          <circle
                            r={n.r}
                            fill={n.kind === "missing" ? "transparent" : c.fill}
                            stroke={c.ink}
                            strokeWidth={n.kind === "repo" ? 1.6 : 1.2}
                            strokeDasharray={n.kind === "missing" ? "3 2.5" : undefined}
                          />
                          {labelled ? (
                            <text
                              y={n.r + LABEL_GAP / scale}
                              textAnchor="middle"
                              style={{
                                fontFamily: tokens.font.sans,
                                fontSize: size / scale,
                                fontWeight: n.kind === "repo" || isSelected ? tokens.weight.medium : tokens.weight.regular,
                                fill: lit || isSelected || n.kind === "repo" ? pal.text : pal.textSecondary,
                                paintOrder: "stroke",
                                stroke: pal.bgSubtle,
                                strokeWidth: 3 / scale,
                                strokeLinejoin: "round",
                                pointerEvents: "none",
                              }}
                            >
                              {full ? n.label : short(n.label)}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </g>
                </g>
              </g>
            </svg>

            <Stack direction="row" gap={4} style={{ position: "absolute", top: 12, left: 12 }}>
              <IconButton
                label="Zoom in"
                size={30}
                variant="secondary"
                theme={THEME}
                onClick={() => zoomBy(1.3)}
                icon={
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                }
              />
              <IconButton
                label="Zoom out"
                size={30}
                variant="secondary"
                theme={THEME}
                onClick={() => zoomBy(1 / 1.3)}
                icon={
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                }
              />
              <IconButton
                label="Fit the graph to the view"
                size={30}
                variant="secondary"
                theme={THEME}
                onClick={fit}
                icon={
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
            </Stack>

            {hiddenAll ? (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                <Text secondary theme={THEME}>
                  Every kind is hidden. Turn one back on below.
                </Text>
              </div>
            ) : null}

            <div className="cb-graph-hint" data-nudge={nudge} aria-hidden>
              {nudge ? NUDGE : HINT}
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
