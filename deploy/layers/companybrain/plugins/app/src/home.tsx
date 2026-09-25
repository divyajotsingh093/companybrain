import { ArrowUp, Brain, Check, ChatCircleText, Graph, Lightning, PlugsConnected, Robot, Signpost, Stack as StackIcon, Tray, Wrench } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { AlertBanner, Button, EASE_OUT, Heading, Stack, Text, usePal } from "./ui";
import { get, injectCss, post, reason } from "./shared";

export type Destination = "ask" | "graph" | "work" | "sources" | "memory" | "skill" | "agents" | "gateway" | "decisions";

type Mode = { id: "ask" | "work" | "memory"; label: string; placeholder: string; send: string };

const MODES: Mode[] = [
  { id: "ask", label: "Ask the brain", placeholder: "Ask anything your company has written down", send: "Ask" },
  { id: "work", label: "Request work", placeholder: "Describe work for an agent to pick up", send: "Draft request" },
  { id: "memory", label: "Remember this", placeholder: "Something your agents should always know", send: "Save to memory" },
];

export interface HomeFacts {
  login: string;
  first: string;
  kit: string;
  asked: boolean;
  knowledge: boolean;
  rules: number;
  starterAgents: number;
  agents: number;
  sources: number;
  memories: number;
  taught: boolean;
  skills: number;
  reviews: number;
  decisions: number;
}

injectCss(
  "cb-home",
  `
  .cb-home-box { display: flex; flex-direction: column; gap: 14px; padding: 22px 16px 14px 24px; border-radius: 30px;
    background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02)), #111115;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 7px rgba(255,255,255,0.04), 0 0 0 8px rgba(255,255,255,0.11), 0 50px 100px -50px rgba(94,234,176,0.3);
    transition: box-shadow 360ms ${EASE_OUT}; }
  .cb-home-box:focus-within { box-shadow: inset 0 0 0 1px rgba(94,234,176,0.45), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 7px rgba(94,234,176,0.06), 0 0 0 8px rgba(94,234,176,0.2), 0 50px 100px -50px rgba(94,234,176,0.35); }
  .cb-home-box textarea { width: 100%; resize: none; border: 0; outline: none; background: transparent; color: #ededef;
    font: 400 19px/1.5 'Geist', ui-sans-serif, sans-serif; letter-spacing: -0.01em; min-height: 58px; }
  .cb-home-box textarea::placeholder { color: rgba(237,237,239,0.36); }
  .cb-home-send { width: 40px; height: 40px; border: 0; border-radius: 999px; display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
    background: #ededef; color: #050505; transition: transform 260ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}; }
  .cb-home-send:disabled { background: rgba(255,255,255,0.08); color: rgba(237,237,239,0.36); cursor: default; }
  .cb-home-send:active:not(:disabled) { transform: scale(0.94); }
  .cb-home-links { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 900px) { .cb-home-links { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .cb-home-link { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 22px;
    background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)), #101014; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.11), inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 30px -20px rgba(0,0,0,0.9);
    transition: transform 420ms ${EASE_OUT}, box-shadow 320ms ${EASE_OUT}; }
  .cb-home-link:focus-visible { outline: 2px solid #5eeab0; outline-offset: 3px; }
  .cb-home-link:active { transform: scale(0.98); }
  @media (hover: hover) and (pointer: fine) { .cb-home-link:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px rgba(94,234,176,0.3), 0 24px 40px -28px rgba(94,234,176,0.4); } }
  .cb-step { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 18px; cursor: pointer; transition: background-color 260ms ${EASE_OUT}; }
  .cb-step:focus-visible { outline: 2px solid #5eeab0; outline-offset: 2px; }
  @media (hover: hover) and (pointer: fine) { .cb-step:hover { background: rgba(255,255,255,0.03); } }
  @media (prefers-reduced-motion: reduce) { .cb-home-box, .cb-home-send, .cb-home-link, .cb-step { transition: none; } }
  `,
);

interface Suggestion {
  key: string;
  kind: string;
  title: string;
  reason: string;
  learned: string | null;
  action: { type: "open" | "reindex" | "learn"; screen?: string; seed?: string; label: string };
}

function Suggestions({ onGo }: { onGo: (d: Destination, text?: string) => void }): JSX.Element | null {
  const pal = usePal();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [choices, setChoices] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (): void => {
    void get<{ suggestions: Suggestion[]; choices: number }>("/api/app/suggestions").then(
      (r) => {
        setItems(r.suggestions.slice(0, 3));
        setChoices(r.choices);
      },
      () => setItems([]),
    );
  };

  useEffect(load, []);

  const choose = async (s: Suggestion, verdict: "accepted" | "snoozed" | "dismissed"): Promise<void> => {
    setBusy(s.key);
    setNotice(null);
    try {
      await post("/api/app/suggestions", { key: s.key, verdict });
      if (verdict === "accepted" && s.action.type === "open" && s.action.screen) {
        onGo(s.action.screen as Destination, s.action.seed);
        return;
      }
      if (verdict === "accepted") setNotice({ ok: true, text: s.action.type === "reindex" ? "Refreshed." : "Added to the skill." });
      load();
    } catch (err) {
      setNotice({ ok: false, text: reason(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!items?.length) return notice ? <AlertBanner variant={notice.ok ? "success" : "danger"} title={notice.text} /> : null;

  return (
    <Stack gap={12}>
      <Stack direction="row" justify="space-between" align="center" gap={12} wrap>
        <span className="cb-eyebrow">
          <Lightning size={11} weight="fill" color={pal.accent} />
          Suggested for you
        </span>
        <Text secondary size="sm" style={{ color: pal.textTertiary }}>
          {choices ? choices === 1 ? "Learned from 1 choice so far" : `Learned from ${choices} choices so far` : "Gets sharper with every choice you make"}
        </Text>
      </Stack>
      {notice ? <AlertBanner variant={notice.ok ? "success" : "danger"} title={notice.text} /> : null}
      <div className="cb-bezel">
        <div className="cb-core" style={{ padding: 0 }}>
          {items.map((s, i) => (
            <div key={s.key} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "16px 20px", borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.09)" : "none" }}>
              <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: pal.text, overflowWrap: "anywhere" }}>{s.title}</span>
                <span style={{ fontSize: 12.5, color: pal.textSecondary, lineHeight: 1.5 }}>{s.reason}</span>
                {s.learned ? <span style={{ fontSize: 11.5, color: pal.accentText }}>{s.learned}</span> : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button variant="ghost" size="sm" disabled={busy === s.key} onClick={() => void choose(s, "dismissed")}>
                  Don't suggest this
                </Button>
                <Button variant="ghost" size="sm" disabled={busy === s.key} onClick={() => void choose(s, "snoozed")}>
                  Not now
                </Button>
                <Button variant="primary" size="sm" arrow disabled={busy === s.key} onClick={() => void choose(s, "accepted")}>
                  {busy === s.key ? "Working" : s.action.label}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Stack>
  );
}

const FIRST_QUESTION = "What should our agents never do without asking a person first?";

const tryAsking = (kit: string): string[] => [
  FIRST_QUESTION,
  "How do I connect Claude Code to Company Brain?",
  kit === "operations" ? "How do we run weekly planning?" : "How do we ship a change safely?",
];

function Journey({ facts, gateways, onGo }: { facts: HomeFacts; gateways: number | null; onGo: (d: Destination, text?: string) => void }): JSX.Element | null {
  const pal = usePal();
  const count = (n: number, one: string, many: string): string => (n ? `${n} ${n === 1 ? one : many}` : "");
  const kit = [count(facts.skills, "skill", "skills"), count(facts.rules, "rule", "rules"), count(facts.starterAgents, "starter agent", "starter agents")].filter(Boolean).join(", ");
  const steps: Array<{ title: string; detail: string; done: boolean; go?: Destination; seed?: string; optional?: boolean }> = [
    { title: "Sign in with GitHub", detail: `Signed in as ${facts.login}. Access follows your repository permissions.`, done: true },
    { title: "Load a starter kit", detail: kit ? `${kit} ready to use and edit.` : "Pick a starter kit on your profile page to load skills, rules and agents.", done: Boolean(kit) },
    { title: "Ask your first question", detail: "Ask something the starter kit covers and see the answer cite its sources.", done: facts.asked, go: "ask", seed: FIRST_QUESTION },
    { title: "Add your own knowledge", detail: "Index a repository or add a file your team keeps re-explaining, so answers are about your company, not just the starter kit.", done: facts.knowledge, go: "sources" },
    { title: "Teach it about you", detail: "Save something your agents and answers should always know with Remember this above, or let a connected agent add memories as it works.", done: facts.taught, go: "memory" },
    { title: "Connect an agent", detail: "Company Brain works on its own. Connect Claude Code, Codex or Cursor when you want your agents to read and grow the same brain; a starter skill fills in as it attaches.", done: facts.agents > 0, go: "agents", optional: true },
    { title: "Connect a tool", detail: "Add another MCP server, like your tracker or docs, and agents reach it through Company Brain.", done: (gateways ?? 0) > 0, go: "gateway", optional: true },
  ];
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  if (done === required.length) return null;
  const next = steps.find((s) => !s.done && !s.optional);

  return (
    <div className="cb-bezel">
      <div className="cb-core" style={{ padding: 22 }}>
        <Stack gap={16}>
          <Stack direction="row" justify="space-between" align="center" gap={12} wrap>
            <Stack gap={4}>
              <Heading level={5}>Get set up</Heading>
              <Text secondary size="sm">{`${done} of ${required.length} done${next ? `. Next: ${next.title.toLowerCase()}.` : "."}`}</Text>
            </Stack>
            <div aria-hidden style={{ display: "flex", gap: 4, width: 160 }}>
              {required.map((s) => (
                <span key={s.title} style={{ flex: 1, height: 4, borderRadius: 999, background: s.done ? pal.accent : "rgba(255,255,255,0.08)", boxShadow: s.done ? `0 0 10px ${pal.accent}66` : "none" }} />
              ))}
            </div>
          </Stack>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {steps.map((s, i) => {
              const current = s === next;
              const body = (
                <>
                  <span
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      flexShrink: 0,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      color: s.done ? pal.textInverse : current ? pal.accent : pal.textTertiary,
                      background: s.done ? pal.accent : "rgba(255,255,255,0.04)",
                      boxShadow: current ? `inset 0 0 0 1px ${pal.accent}` : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                    }}
                  >
                    {s.done ? <Check size={14} weight="bold" /> : i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: s.done ? pal.textSecondary : pal.text, textDecoration: s.done ? "line-through" : "none", textDecorationColor: "rgba(237,237,239,0.3)" }}>
                      {s.title}
                      {s.optional ? <span style={{ color: pal.textTertiary, fontWeight: 400 }}> · optional</span> : null}
                    </span>
                    {!s.done ? <span style={{ fontSize: 12.5, color: pal.textSecondary, lineHeight: 1.5 }}>{s.detail}</span> : null}
                  </span>
                  {!s.done && s.go ? <span style={{ fontSize: 12.5, color: current ? pal.accent : pal.textTertiary, whiteSpace: "nowrap" }}>{current ? "Start →" : "Open →"}</span> : null}
                </>
              );
              return (
                <li key={s.title}>
                  {s.go && !s.done ? (
                    <button className="cb-step" style={{ width: "100%" }} onClick={() => onGo(s.go as Destination, s.seed)}>
                      {body}
                    </button>
                  ) : (
                    <div className="cb-step" style={{ cursor: "default" }}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Stack>
      </div>
    </div>
  );
}

export function HomeScreen({ facts, onGo }: { facts: HomeFacts; onGo: (d: Destination, text?: string) => void }): JSX.Element {
  const pal = usePal();
  const [mode, setMode] = useState<Mode>(MODES[0] as Mode);
  const [text, setText] = useState("");
  const [gateways, setGateways] = useState<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
    void get<{ servers: unknown[] }>("/api/app/gateway").then(
      (g) => setGateways(g.servers.length),
      () => setGateways(null),
    );
  }, []);

  const submit = (): void => {
    const value = text.trim();
    if (value) onGo(mode.id, value);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const links: Array<{ id: Destination; label: string; detail: string; Icon: typeof Brain; count?: number }> = [
    { id: "ask", label: "Ask", detail: "Answers with sources", Icon: ChatCircleText },
    { id: "graph", label: "Graph", detail: "How it all connects", Icon: Graph },
    { id: "memory", label: "Memory", detail: "What agents know about you", Icon: Brain, count: facts.memories },
    { id: "skill", label: "Skills", detail: "How work gets done", Icon: Wrench, count: facts.skills },
    { id: "work", label: "Requests", detail: facts.reviews ? "Waiting on your review" : "Work for agents", Icon: Tray, count: facts.reviews },
    { id: "decisions", label: "Decisions", detail: facts.decisions ? "Calls waiting on you" : "Rulings you made", Icon: Signpost, count: facts.decisions },
    { id: "sources", label: "Sources", detail: "Repositories and files", Icon: StackIcon, count: facts.sources },
    { id: "gateway", label: "Gateway", detail: "Other MCP servers", Icon: PlugsConnected, count: gateways ?? undefined },
  ];

  return (
    <Stack gap={36} style={{ maxWidth: 860 }}>
      <Stack gap={20}>
        <Heading level={2}>{facts.first ? `What do you want to do, ${facts.first}?` : "What do you want to do?"}</Heading>
        <div className="cb-home-box">
          <textarea ref={box} aria-label={mode.label} rows={2} value={text} placeholder={mode.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div role="radiogroup" aria-label="What to do with it" style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
              {MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={mode.id === m.id} className="cb-btn" data-variant={mode.id === m.id ? "secondary" : "ghost"} data-size="sm" onClick={() => setMode(m)}>
                  {m.label}
                </button>
              ))}
            </div>
            <button className="cb-home-send" aria-label={mode.send} title={mode.send} disabled={!text.trim()} onClick={submit}>
              <ArrowUp size={16} weight="bold" />
            </button>
          </div>
        </div>
        {facts.asked ? (
          <Text secondary size="sm" style={{ color: pal.textTertiary }}>
            Enter to {mode.send.toLowerCase()}, Shift and Enter for a new line.
          </Text>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Text secondary size="sm" style={{ color: pal.textTertiary }}>
              Try asking
            </Text>
            {tryAsking(facts.kit).map((q) => (
              <button key={q} className="cb-btn" data-variant="ghost" data-size="sm" style={{ whiteSpace: "normal", textAlign: "left", height: "auto", minHeight: 32, maxWidth: "100%" }} onClick={() => onGo("ask", q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </Stack>

      <Suggestions onGo={onGo} />

      <Journey facts={facts} gateways={gateways} onGo={onGo} />

      <Stack gap={12}>
        <span className="cb-eyebrow">Jump to</span>
        <div className="cb-home-links">
          {links.map(({ id, label, detail, Icon, count }) => (
            <button key={id} className="cb-home-link" onClick={() => onGo(id)}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Icon size={20} weight="light" color={pal.accent} />
                {count ? <span style={{ fontSize: 12, color: pal.textSecondary, fontVariantNumeric: "tabular-nums" }}>{count}</span> : null}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: pal.text }}>{label}</span>
                <span style={{ fontSize: 12.5, color: pal.textSecondary }}>{detail}</span>
              </span>
            </button>
          ))}
        </div>
      </Stack>

      {facts.agents === 0 ? null : (
        <Text secondary size="sm" style={{ color: pal.textTertiary }}>
          <Robot size={14} weight="light" style={{ verticalAlign: "-2px", marginRight: 6 }} />
          {`${facts.agents} ${facts.agents === 1 ? "agent is" : "agents are"} connected. They read your memory at the start of every session.`}
        </Text>
      )}
    </Stack>
  );
}
