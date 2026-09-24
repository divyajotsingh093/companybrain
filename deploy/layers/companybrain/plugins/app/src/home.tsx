import { ArrowUp, Brain, Check, ChatCircleText, Graph, PlugsConnected, Robot, Signpost, Stack as StackIcon, Tray, Wrench } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { EASE_OUT, Heading, Stack, Text, usePal } from "./ui";
import { get, injectCss } from "./shared";

export type Destination = "ask" | "graph" | "work" | "sources" | "memory" | "skill" | "agents" | "gateway" | "decisions";

type Mode = { id: "ask" | "work" | "memory"; label: string; placeholder: string; send: string };

const MODES: Mode[] = [
  { id: "ask", label: "Ask the brain", placeholder: "Ask anything your company has written down", send: "Ask" },
  { id: "work", label: "Request work", placeholder: "Describe work for an agent to pick up", send: "Draft request" },
  { id: "memory", label: "Remember this", placeholder: "Something your agents should always know", send: "Save to memory" },
];

export interface HomeFacts {
  login: string;
  agents: number;
  sources: number;
  memories: number;
  learnedByAgents: boolean;
  skills: number;
  reviews: number;
  decisions: number;
}

injectCss(
  "cb-home",
  `
  .cb-home-box { display: flex; flex-direction: column; gap: 14px; padding: 22px 16px 14px 24px; border-radius: 30px;
    background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.015)), #0a0a0c;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 7px rgba(255,255,255,0.025), 0 0 0 8px rgba(255,255,255,0.05), 0 50px 100px -50px rgba(94,234,176,0.25);
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
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05);
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

function Journey({ facts, gateways, onGo }: { facts: HomeFacts; gateways: number | null; onGo: (d: Destination) => void }): JSX.Element | null {
  const pal = usePal();
  const steps: Array<{ title: string; detail: string; done: boolean; go?: Destination; optional?: boolean }> = [
    { title: "Sign in with GitHub", detail: `Signed in as ${facts.login}. Access follows your repository permissions.`, done: true },
    { title: "Connect an agent", detail: "Create a token and add the MCP server to Claude Code, Codex or Cursor. Your memory and a starter skill fill in as it attaches.", done: facts.agents > 0, go: "agents" },
    { title: "Give it knowledge", detail: "Index a repository or add files, so answers have something to draw on.", done: facts.sources > 0, go: "sources" },
    { title: "Connect a tool", detail: "Add another MCP server, like your tracker or docs, and agents reach it through Company Brain.", done: (gateways ?? 0) > 0, go: "gateway", optional: true },
    { title: "Let your agents learn", detail: "As agents work they save memories and add to skills. The first one shows up here.", done: facts.learnedByAgents, go: "memory" },
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
                    <button className="cb-step" style={{ width: "100%" }} onClick={() => onGo(s.go as Destination)}>
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
        <Heading level={2}>What do you want to do?</Heading>
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
        <Text secondary size="sm" style={{ color: pal.textTertiary }}>
          Enter to {mode.send.toLowerCase()}, Shift and Enter for a new line.
        </Text>
      </Stack>

      <Journey facts={facts} gateways={gateways} onGo={(d) => onGo(d)} />

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
                <span style={{ fontSize: 14, fontWeight: 500, color: pal.text }}>{label}</span>
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
