import { useEffect, useRef, useState, type JSX } from "react";
import { AlertBanner, Button, Caption, Card, EmptyState, Heading, Skeleton, Stack, StatusBadge, Tag, Text, TextArea, usePal } from "./ui";
import { THEME, get, post, reason, when } from "./shared";
import { Feedback } from "./learning";

interface RunStep {
  at: number;
  kind: "thought" | "call" | "result" | "blocked" | "final" | "error";
  text: string;
  tool?: string;
  ok?: boolean;
}

interface Run {
  id: string;
  agent: string;
  goal: string;
  status: "running" | "done" | "stopped" | "failed";
  steps: RunStep[];
  answer: string | null;
  allowActions: boolean;
  createdAt: number;
  updatedAt: number;
  calls?: number;
}

interface AgentOption {
  id: string;
  name: string;
  summary: string;
  suggestions: string[];
  builds: boolean;
}

interface RunsView {
  runs: Run[];
  agents: AgentOption[];
  autoBuild: { autoBuild: boolean; builtAt: number | null };
  canRun: boolean;
  maxSteps: number;
  perDay: number;
  now: number;
}

const POLL_MS = 1_500;
const STATUS_LABEL: Record<Run["status"], [string, string]> = {
  running: ["accent", "Running"],
  done: ["success", "Done"],
  stopped: ["warning", "Stopped"],
  failed: ["error", "Failed"],
};

function Timeline({ run }: { run: Run }): JSX.Element {
  const pal = usePal(THEME);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (run.status === "running") end.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [run.steps.length, run.status]);
  const toggle = (i: number) => setOpen((prev) => new Set(prev.has(i) ? [...prev].filter((x) => x !== i) : [...prev, i]));
  return (
    <ol aria-label="What the agent did" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {run.steps.map((s, i) => {
        const color = s.kind === "blocked" ? pal.warning : s.kind === "error" || (s.kind === "result" && s.ok === false) ? pal.danger : s.kind === "final" ? pal.accentText : pal.textSecondary;
        return (
          <li key={i} className="cb-run-step" style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12, alignItems: "start" }}>
            <Caption style={{ color, paddingTop: 2 }}>{s.kind === "call" ? "CALL" : s.kind === "result" ? (s.ok === false ? "FAILED" : "RESULT") : s.kind.toUpperCase()}</Caption>
            {s.kind === "result" ? (
              <div>
                {s.text.length > 90 ? (
                  <button type="button" onClick={() => toggle(i)} aria-expanded={open.has(i)} style={{ all: "unset", cursor: "pointer", color: pal.textSecondary, fontSize: 13 }}>
                    {`${s.tool} returned ${s.text.length} characters · ${open.has(i) ? "hide" : "show"}`}
                  </button>
                ) : null}
                {open.has(i) || s.text.length <= 90 ? (
                  <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, lineHeight: 1.5, color: pal.textSecondary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{s.text}</pre>
                ) : null}
              </div>
            ) : s.kind === "call" ? (
              <Text mono size="sm" theme={THEME} style={{ overflowWrap: "anywhere" }}>
                {`${s.tool}(${s.text === "{}" ? "" : s.text})`}
              </Text>
            ) : s.kind === "final" ? (
              <Card theme={THEME}>
                <Text theme={THEME} style={{ whiteSpace: "pre-wrap" }}>
                  {s.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "")}
                </Text>
              </Card>
            ) : (
              <Text secondary={s.kind === "thought"} size="sm" theme={THEME} style={{ fontStyle: s.kind === "thought" ? "italic" : undefined, color: s.kind === "thought" ? undefined : color }}>
                {s.kind === "blocked" && s.tool ? `${s.tool}: ${s.text}` : s.text}
              </Text>
            )}
          </li>
        );
      })}
      {run.status === "running" ? (
        <li style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12 }}>
          <Caption style={{ color: pal.accentText }}>WORKING</Caption>
          <span className="cb-run-dots" role="status" aria-label="The agent is working">
            <i />
            <i />
            <i />
          </span>
        </li>
      ) : null}
      <li ref={end} aria-hidden style={{ height: 0 }} />
    </ol>
  );
}

const STYLE = `
.cb-run-step { animation: cb-run-in 260ms cubic-bezier(0.23, 1, 0.32, 1) both; }
@keyframes cb-run-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.cb-run-dots { display: inline-flex; gap: 5px; padding-top: 6px; }
.cb-run-dots i { width: 6px; height: 6px; border-radius: 99px; background: #0fae93; animation: cb-run-dot 1s ease-in-out infinite; }
.cb-run-dots i:nth-child(2) { animation-delay: 0.15s; }
.cb-run-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes cb-run-dot { 0%, 100% { opacity: 0.25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
.cb-agent-pick { all: unset; box-sizing: border-box; cursor: pointer; display: block; padding: 14px 16px; border-radius: 16px; background: rgba(255,255,255,0.03); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); transition: box-shadow 160ms ease, transform 160ms ease; }
.cb-agent-pick:hover { box-shadow: inset 0 0 0 1px rgba(15,174,147,0.45); }
.cb-agent-pick:active { transform: scale(0.98); }
.cb-agent-pick[aria-checked="true"] { background: rgba(15,174,147,0.12); box-shadow: inset 0 0 0 1px rgba(15,174,147,0.7); }
.cb-agent-pick:focus-visible { outline: 2px solid #0fae93; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .cb-run-step, .cb-run-dots i { animation: none; } }
`;

let styled = false;
function useStyles(): void {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const el = document.createElement("style");
  el.textContent = STYLE;
  document.head.appendChild(el);
}

export function RunScreen({ mode }: { mode: "run" | "build" }): JSX.Element {
  useStyles();
  const pal = usePal(THEME);
  const [view, setView] = useState<RunsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agent, setAgent] = useState<string>(mode === "build" ? "librarian" : "assistant");
  const [goal, setGoal] = useState("");
  const [allowChanges, setAllowChanges] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<Run | null>(null);

  const load = (): void => {
    void get<RunsView>(mode === "build" ? "/api/app/runs?agent=librarian" : "/api/app/runs").then(
      (next) => {
        setView(next);
        setLoadError(null);
      },
      (err: unknown) => setLoadError(reason(err)),
    );
  };
  useEffect(load, []);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      void get<{ run: Run }>(`/api/app/runs/${encodeURIComponent(selected)}`).then(
        ({ run }) => {
          if (stop) return;
          setLive(run);
          if (run.status === "running") timer = setTimeout(tick, POLL_MS);
          else load();
        },
        () => {
          if (!stop) timer = setTimeout(tick, POLL_MS * 2);
        },
      );
    };
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [selected]);

  if (loadError) return <AlertBanner variant="danger" title="Runs could not be loaded" description={`${loadError}. Reload to try again.`} theme={THEME} />;
  if (!view) return <Skeleton height={320} theme={THEME} />;

  const choice = view.agents.find((a) => a.id === agent) ?? view.agents[0];
  const runs = view.runs;
  const nameOf = (id: string) => view.agents.find((a) => a.id === id)?.name ?? id;

  const start = async (body: { path: string; payload: unknown }): Promise<void> => {
    setStarting(true);
    setProblem(null);
    try {
      const started = await post<{ id: string }>(body.path, body.payload);
      setSelected(started.id);
      setLive(null);
      setGoal("");
      load();
    } catch (err) {
      setProblem(reason(err));
    } finally {
      setStarting(false);
    }
  };

  const setAuto = async (on: boolean): Promise<void> => {
    try {
      const next = await post<{ autoBuild: RunsView["autoBuild"] }>("/api/app/build", { autoBuild: on });
      setView((prev) => (prev ? { ...prev, autoBuild: next.autoBuild } : prev));
    } catch (err) {
      setProblem(reason(err));
    }
  };

  const shown = live && live.id === selected ? live : runs.find((r) => r.id === selected) ?? null;

  return (
    <Stack gap={28}>
      <Stack gap={4}>
        <Heading level={4} theme={THEME}>
          {mode === "build" ? "Auto-build" : "Run agents"}
        </Heading>
        <Text secondary theme={THEME}>
          {mode === "build"
            ? "The Librarian reads what you have indexed and written down, then adds the processes, rules, roles, lessons and skills that are missing. It only adds entries: it never replaces what a person wrote."
            : `Run an agent right here, on your brain. It gets every Company Brain tool a connected agent gets: search, memory, skills, boards, decisions and your connected servers. Each run takes up to ${view.maxSteps} steps, and you can watch every one.`}
        </Text>
      </Stack>

      {!view.canRun ? <AlertBanner variant="warning" title="No model is configured, so agents cannot run yet." theme={THEME} /> : null}

      {mode === "build" ? (
        <Card theme={THEME}>
          <Stack gap={14}>
            <Stack direction="row" justify="space-between" align="center" gap={12} style={{ flexWrap: "wrap" }}>
              <Stack gap={2}>
                <Text theme={THEME} weight="semibold">
                  Build every day
                </Text>
                <Text secondary size="sm" theme={THEME}>
                  {view.autoBuild.builtAt ? `Last built ${when(view.autoBuild.builtAt, view.now)}.` : "Not built on a schedule yet."} Builds about once a day while this is on.
                </Text>
              </Stack>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", color: pal.text, fontSize: 14 }}>
                <input id="auto-build" type="checkbox" checked={view.autoBuild.autoBuild} onChange={(e) => void setAuto(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#0fae93" }} />
                {view.autoBuild.autoBuild ? "On" : "Off"}
              </label>
            </Stack>
            <div>
              <Button variant="primary" arrow disabled={!view.canRun || starting} onClick={() => void start({ path: "/api/app/build", payload: { now: true } })} theme={THEME}>
                {starting ? "Starting" : "Build my brain now"}
              </Button>
            </div>
          </Stack>
        </Card>
      ) : (
        <Card theme={THEME}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (goal.trim() && choice) void start({ path: "/api/app/runs", payload: { agent: choice.id, goal: goal.trim(), allowChanges } });
            }}
          >
            <Stack gap={16}>
              <div role="radiogroup" aria-label="Choose an agent" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))" }}>
                {view.agents.map((a) => (
                  <button key={a.id} type="button" role="radio" className="cb-agent-pick" aria-checked={a.id === choice?.id} onClick={() => setAgent(a.id)}>
                    <Stack gap={4}>
                      <Stack direction="row" gap={6} align="center">
                        <Text theme={THEME} weight="semibold">
                          {a.name}
                        </Text>
                        {a.builds ? <Tag>Builds the brain</Tag> : null}
                      </Stack>
                      <Text secondary size="sm" theme={THEME}>
                        {a.summary}
                      </Text>
                    </Stack>
                  </button>
                ))}
              </div>
              <TextArea label={`What should ${choice?.name ?? "the agent"} do?`} value={goal} rows={3} placeholder="Describe the goal in a sentence or two." onChange={(next: string) => setGoal(next)} theme={THEME} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(choice?.suggestions ?? []).map((sug) => (
                  <button key={sug} type="button" onClick={() => setGoal(sug)} style={{ all: "unset", cursor: "pointer", fontSize: 12.5, padding: "5px 11px", borderRadius: 999, color: pal.textSecondary, background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)" }}>
                    {sug}
                  </button>
                ))}
              </div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", color: pal.textSecondary, fontSize: 13.5 }}>
                <input id="allow-changes" type="checkbox" checked={allowChanges} onChange={(e) => setAllowChanges(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "#0fae93" }} />
                Allow changes. Off by default: the agent can read everything and add new entries to your brain, but cannot edit or delete entries, post or close work, ask for decisions, or call your connected servers.
              </label>
              <Stack direction="row" justify="space-between" align="center" gap={12} style={{ flexWrap: "wrap" }}>
                <Caption theme={THEME}>{`Up to ${view.perDay} runs a day`}</Caption>
                <Button variant="primary" arrow disabled={!view.canRun || starting || !goal.trim()} theme={THEME}>
                  {starting ? "Starting" : `Run ${choice?.name ?? "agent"}`}
                </Button>
              </Stack>
            </Stack>
          </form>
        </Card>
      )}

      {problem ? <AlertBanner variant="danger" title={problem} theme={THEME} /> : null}

      {shown ? (
        <Card theme={THEME}>
          <Stack gap={14}>
            <Stack direction="row" justify="space-between" align="center" gap={10} style={{ flexWrap: "wrap" }}>
              <Stack gap={2}>
                <Text theme={THEME} weight="semibold">
                  {nameOf(shown.agent)}
                </Text>
                <Text secondary size="sm" theme={THEME}>
                  {shown.goal}
                </Text>
              </Stack>
              <StatusBadge status={STATUS_LABEL[shown.status][0]}>{STATUS_LABEL[shown.status][1]}</StatusBadge>
            </Stack>
            <Timeline run={shown} />
            {shown.status === "running" ? null : <Feedback key={shown.id} id={shown.id} subject="run" prompt="Did this run do what you asked?" />}
          </Stack>
        </Card>
      ) : null}

      <Stack gap={10}>
        <Heading level={5} theme={THEME}>
          {mode === "build" ? "Past builds" : "Recent runs"}
        </Heading>
        {runs.length ? (
          <Card theme={THEME} padding={0}>
            {runs.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                aria-current={r.id === selected}
                style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", width: "100%", display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: i < runs.length - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined, background: r.id === selected ? "rgba(15,174,147,0.08)" : undefined }}
              >
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text theme={THEME} weight="medium" truncate>
                    {r.goal}
                  </Text>
                  <Text secondary size="sm" theme={THEME}>
                    {`${nameOf(r.agent)} · ${r.calls ?? 0} tool calls · ${when(r.createdAt, view.now)}`}
                  </Text>
                </Stack>
                <StatusBadge status={STATUS_LABEL[r.status][0]}>{STATUS_LABEL[r.status][1]}</StatusBadge>
              </button>
            ))}
          </Card>
        ) : (
          <EmptyState title={mode === "build" ? "No builds yet" : "No runs yet"} description={mode === "build" ? "Build your brain now, or turn on daily builds." : "Pick an agent, give it a goal, and watch it work."} theme={THEME} />
        )}
      </Stack>
    </Stack>
  );
}
