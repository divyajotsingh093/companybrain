import { Fragment, useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AlertBanner, Button, Caption, EASE_OUT, Heading, Skeleton, Stack, Text, tokens, usePal } from "./ui";
import { ASK_KINDS, KindBadge, KindChip, KindDot, kindColor, kindName } from "./kinds";
import { ApiError, EASE, ERROR_COPY, THEME, injectCss, post, reason, useReducedMotion, useWidth } from "./shared";

export interface AskSource {
  title: string;
  source: string;
  kind: string;
  snippet: string;
}

export interface Related {
  kind: string;
  name: string;
}

export interface Turn {
  question: string;
  answer: string;
  sources: AskSource[];
  related: Related[];
  kinds?: string[];
}

export interface AskScreenProps {
  thread: Turn[];
  setThread: (next: Turn[]) => void;
  canAsk: boolean;
  seed?: string;
  autoAsk?: boolean;
  onOpenGraph?: () => void;
  onOpenDecisions?: () => void;
}

interface Failure {
  question: string;
  kinds: string[];
  code: string;
  message: string;
}

interface Active {
  turn: number;
  source: number | null;
}

const WIDE = 720;
const HISTORY = 4;
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

interface Intent {
  title: string;
  detail: string;
  kinds: string[];
  starter: string;
}

const INTENTS: Intent[] = [
  { title: "Find a process", detail: "How a piece of work gets done, step by step.", kinds: ["process"], starter: "How do we " },
  { title: "Check what is allowed", detail: "Boundaries, policies and who has to approve.", kinds: ["rule"], starter: "Are we allowed to " },
  { title: "Find evidence", detail: "Recorded facts and the documents behind them.", kinds: ["record", "document"], starter: "What evidence do we have that " },
  { title: "Learn from past work", detail: "What went wrong before, and what to do instead.", kinds: ["lesson"], starter: "What did we learn when " },
  { title: "Find an owner", detail: "Who owns an area and what they decide.", kinds: ["role"], starter: "Who owns " },
];

const KEPT = "Nothing you typed was lost.";

const FAILURE_VIEW: Record<string, { variant: "danger" | "warning" | "default"; description: string; retry: boolean }> = {
  rate_limited: { variant: "warning", description: `Try again in a moment. ${KEPT}`, retry: true },
  daily_limit: { variant: "warning", description: `Questions open again within a day. ${KEPT}`, retry: false },
  model_failed: { variant: "danger", description: `Nothing was answered. ${KEPT}`, retry: true },
  no_model: { variant: "default", description: "Indexing still works and your sources are kept. Questions need a model configured on the server.", retry: false },
  sign_in: { variant: "warning", description: `Reload the page to sign in. ${KEPT}`, retry: false },
  bad_fields: { variant: "warning", description: "The server did not receive a question it could read.", retry: true },
  network: { variant: "danger", description: KEPT, retry: true },
};

const FAILURE_FALLBACK = { variant: "danger" as const, description: `Nothing was answered. ${KEPT}`, retry: true };

function splitSnippet(snippet: string, ink: string, wash: string): ReactNode[] {
  const out: ReactNode[] = [];
  let on = false;
  snippet.split(/([\uE000\uE001])/).forEach((part, i) => {
    if (part === MARK_OPEN) on = true;
    else if (part === MARK_CLOSE) on = false;
    else if (part && on)
      out.push(
        <mark key={i} style={{ background: wash, color: ink, borderRadius: 3, padding: "0 2px" }}>
          {part}
        </mark>,
      );
    else if (part) out.push(<Fragment key={i}>{part}</Fragment>);
  });
  return out;
}

function injectAskStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-ask-styles",
    `
    .cb-composer {
      display: flex; flex-direction: column; gap: 12px; padding: 18px 14px 12px 20px; margin: 6px;
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015)), #0a0a0c; border: 0; border-radius: 26px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 6px rgba(255,255,255,0.025), 0 0 0 7px rgba(255,255,255,0.05), 0 40px 80px -40px rgba(0,0,0,0.9);
      transition: box-shadow 320ms ${EASE_OUT};
    }
    .cb-composer:focus-within { box-shadow: inset 0 0 0 1px ${pal.accent}73, inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 6px ${pal.accent}0f, 0 0 0 7px ${pal.accent}33, 0 40px 80px -40px rgba(0,0,0,0.9); }
    .cb-composer textarea {
      width: 100%; box-sizing: border-box; resize: none; border: none; outline: none; background: transparent;
      color: ${pal.text}; font-family: ${tokens.font.sans}; padding: 2px 0; margin: 0;
    }
    .cb-composer textarea::placeholder { color: ${pal.textTertiary}; }
    .cb-composer textarea:focus-visible { outline: none; }
    .cb-send {
      width: 36px; height: 36px; flex-shrink: 0; border-radius: 999px; border: none; cursor: pointer;
      display: grid; place-items: center; background: ${pal.text}; color: ${pal.textInverse};
      transition: transform 140ms ${EASE}, background-color 160ms ${EASE}, color 160ms ${EASE};
    }
    .cb-send:disabled { background: ${pal.bgMuted}; color: ${pal.textTertiary}; cursor: default; }
    .cb-send:not(:disabled):active { transform: scale(0.94); }
    .cb-cite {
      display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px;
      margin: 0 2px; border-radius: 6px; border: 1px solid var(--kind-line); background: var(--kind-wash); color: var(--kind-ink);
      font: 500 10px/1 ${tokens.font.mono}; vertical-align: 2px; cursor: pointer;
      transition: transform 140ms ${EASE}, background-color 160ms ${EASE};
    }
    .cb-cite[data-on="true"] { background: var(--kind-line); color: ${pal.text}; }
    .cb-cite:active { transform: scale(0.94); }
    .cb-intent {
      display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 18px; cursor: pointer;
      border-radius: 22px; border: 0; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); color: ${pal.text};
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.06);
      font-family: ${tokens.font.sans};
      transition: transform 420ms ${EASE_OUT}, box-shadow 320ms ${EASE_OUT}, background-color 320ms ${EASE_OUT};
    }
    .cb-intent:active { transform: scale(0.98); }
    .cb-intent-title { display: flex; align-items: center; gap: 8px; font: 500 14px/1.3 ${tokens.font.sans}; }
    .cb-intent-detail { font: 400 13px/1.45 ${tokens.font.sans}; color: ${pal.textSecondary}; }
    .cb-intent-scope { font: 500 11px/1.3 ${tokens.font.sans}; color: var(--kind-ink); letter-spacing: 0.01em; }
    @media (hover: hover) and (pointer: fine) {
      .cb-intent:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px var(--kind-line), 0 24px 40px -28px var(--kind-line); background: var(--kind-wash); }
      .cb-send:not(:disabled):hover { background: ${pal.borderFocus}; }
    }
    .cb-source {
      display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 20px; border: 0;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); scroll-margin: 24px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05);
      transition: box-shadow 320ms ${EASE_OUT}, background-color 320ms ${EASE_OUT};
    }
    .cb-source[data-on="true"] { box-shadow: inset 0 0 0 1px var(--kind-line); background: var(--kind-wash); }
    @keyframes cb-turn-in { from { opacity: 0; transform: translateY(6px); } }
    .cb-turn-in { animation: cb-turn-in 260ms ${EASE} both; }
    @media (prefers-reduced-motion: reduce) {
      @keyframes cb-turn-fade { from { opacity: 0; } }
      .cb-turn-in { animation: cb-turn-fade 160ms ${EASE} both; }
      .cb-composer, .cb-send, .cb-cite, .cb-intent, .cb-source { transition: none; }
    }
  `,
  );
}

function kindVars(kind: string): Record<string, string> {
  const c = kindColor(kind);
  return { "--kind-ink": c.ink, "--kind-wash": c.wash, "--kind-line": c.line };
}

function Composer({
  draft,
  setDraft,
  kinds,
  setKinds,
  busy,
  hero,
  inputRef,
  onSubmit,
}: {
  draft: string;
  setDraft: (next: string) => void;
  kinds: string[];
  setKinds: (next: string[]) => void;
  busy: boolean;
  hero: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
}): JSX.Element {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [draft, inputRef]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onSubmit();
  };

  const toggle = (kind: string): void => setKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  const ready = draft.trim().length > 0 && !busy;

  return (
    <div className="cb-composer">
      <textarea
        ref={inputRef}
        value={draft}
        rows={hero ? 3 : 2}
        aria-label="Your question"
        placeholder={hero ? "Ask anything your company has written down" : "Ask a follow-up"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        style={{ ...(hero ? tokens.type.lg : tokens.type.md), lineHeight: 1.55 }}
      />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div role="group" aria-label="Search only in these kinds" style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
          {ASK_KINDS.map((k) => (
            <KindChip key={k} kind={k} label={kindName(k, true)} on={kinds.includes(k)} onClick={() => toggle(k)} />
          ))}
        </div>
        <button type="button" className="cb-send" aria-label={busy ? "Answering" : "Send question"} disabled={!ready} onClick={onSubmit}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 12V2M2.5 6.5L7 2l4.5 4.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Answer({ text, sources, activeSource, onCite }: { text: string; sources: AskSource[]; activeSource: number | null; onCite: (index: number) => void }): JSX.Element {
  const pal = usePal(THEME);
  const parts: ReactNode[] = [];
  let read = 0;
  for (const match of text.matchAll(CITATION)) {
    const at = match.index ?? 0;
    const numbers = (match[1] ?? "").split(",").map((n) => Number(n.trim()));
    if (!numbers.every((n) => n >= 1 && n <= sources.length)) continue;
    if (at > read) parts.push(text.slice(read, at));
    for (const n of numbers) {
      const s = sources[n - 1];
      if (!s) continue;
      parts.push(
        <button
          key={`${at}-${n}`}
          type="button"
          className="cb-cite"
          data-on={activeSource === n - 1}
          aria-label={`Source ${n}: ${s.title}`}
          title={s.title}
          onClick={() => onCite(n - 1)}
          style={kindVars(s.kind)}
        >
          {n}
        </button>,
      );
    }
    read = at + match[0].length;
  }
  if (read < text.length) parts.push(text.slice(read));

  return (
    <div style={{ ...tokens.type.md, lineHeight: 1.75, color: pal.text, fontFamily: tokens.font.sans, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "68ch" }}>
      {parts}
    </div>
  );
}

function SourceCard({ source, index, id, on }: { source: AskSource; index: number; id: string; on: boolean }): JSX.Element {
  const pal = usePal(THEME);
  const c = kindColor(source.kind);
  return (
    <div id={id} className="cb-source" data-on={on} style={kindVars(source.kind)}>
      <Stack direction="row" gap={8} align="center">
        <span style={{ ...tokens.type.xs, fontFamily: tokens.font.mono, color: c.ink, minWidth: 14 }}>{index + 1}</span>
        <KindBadge kind={source.kind} />
      </Stack>
      <Stack gap={2}>
        <Text theme={THEME} weight="medium" style={{ overflowWrap: "anywhere" }}>
          {source.title}
        </Text>
        <Text theme={THEME} mono secondary style={{ ...tokens.type.xs, overflowWrap: "anywhere" }}>
          {source.source}
        </Text>
      </Stack>
      {source.snippet ? (
        <p style={{ margin: 0, ...tokens.type.sm, lineHeight: 1.6, color: pal.textSecondary, fontFamily: tokens.font.sans, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {splitSnippet(source.snippet, pal.text, c.fill)}
        </p>
      ) : null}
    </div>
  );
}

function Sources({ turn, index, active }: { turn: Turn; index: number; active: number | null }): JSX.Element {
  if (!turn.sources.length) {
    return (
      <Text secondary theme={THEME} style={tokens.type.sm}>
        This answer did not draw on any source.
      </Text>
    );
  }
  return (
    <Stack gap={8}>
      {turn.sources.map((s, i) => (
        <SourceCard key={`${s.source}-${i}`} source={s} index={i} id={`cb-source-${index}-${i}`} on={active === i} />
      ))}
    </Stack>
  );
}

export function AskScreen({ thread, setThread, canAsk, seed, autoAsk, onOpenGraph, onOpenDecisions }: AskScreenProps): JSX.Element {
  const pal = usePal(THEME);
  injectAskStyles(pal);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const wide = width >= WIDE;

  const [draft, setDraft] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [pending, setPending] = useState<{ question: string; kinds: string[] } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [active, setActive] = useState<Active>({ turn: Math.max(0, thread.length - 1), source: null });
  const [copied, setCopied] = useState<{ turn: number; ok: boolean } | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);

  const askedSeed = useRef<string | null>(null);

  useEffect(() => {
    if (!seed) return;
    if (autoAsk && canAsk) {
      if (askedSeed.current === seed) return;
      askedSeed.current = seed;
      void ask(seed, [], true);
      return;
    }
    setDraft(seed);
    inputRef.current?.focus();
  }, [seed, autoAsk, canAsk]);

  useEffect(() => {
    if (active.source === null) return;
    document.getElementById(`cb-source-${active.turn}-${active.source}`)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  useEffect(() => {
    if (pending) pendingRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [pending, reduced]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const ask = async (text: string, scope: string[], typed = false): Promise<void> => {
    const question = text.trim();
    if (!question || pending) return;
    const base = thread;
    setPending({ question, kinds: scope });
    setFailure(null);
    if (typed) setDraft("");
    try {
      const result = await post<{ answer: string; sources?: AskSource[]; related?: Related[] }>("/api/app/ask", {
        question,
        kinds: scope.length ? scope : undefined,
        history: base.slice(-HISTORY).map((t) => ({ question: t.question, answer: t.answer })),
      });
      const turn: Turn = { question, answer: result.answer, sources: result.sources ?? [], related: result.related ?? [], ...(scope.length ? { kinds: scope } : {}) };
      setThread([...base, turn]);
      setActive({ turn: base.length, source: null });
      setFresh(base.length);
    } catch (err) {
      setFailure({ question, kinds: scope, code: err instanceof ApiError ? err.code : "network", message: reason(err) });
      if (typed) setDraft((current) => current || question);
    } finally {
      setPending(null);
    }
  };

  const submit = (): void => void ask(draft, kinds, true);

  const reset = (): void => {
    setThread([]);
    setFailure(null);
    setActive({ turn: 0, source: null });
    setFresh(null);
    setDraft("");
    inputRef.current?.focus();
  };

  const copy = async (turn: Turn, index: number): Promise<void> => {
    const cited = turn.sources.map((s, i) => `[${i + 1}] ${s.title} - ${s.source}`).join("\n");
    try {
      await navigator.clipboard.writeText(cited ? `${turn.answer}\n\nSources\n${cited}` : turn.answer);
      setCopied({ turn: index, ok: true });
    } catch {
      setCopied({ turn: index, ok: false });
    }
  };

  const cite = (turn: number, source: number): void => setActive({ turn, source });

  const begin = (intent: Intent): void => {
    setKinds(intent.kinds);
    setDraft(intent.starter);
    setFailure(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const intentCard = (key: string, kind: string, title: string, detail: string, scope: string, onClick: () => void): JSX.Element => (
    <button key={key} type="button" className="cb-intent" onClick={onClick} style={kindVars(kind)}>
      <span className="cb-intent-title">
        <KindDot kind={kind} />
        {title}
      </span>
      <span className="cb-intent-detail">{detail}</span>
      <span className="cb-intent-scope">{scope}</span>
    </button>
  );

  const shownTurn = Math.min(active.turn, thread.length - 1);
  const started = thread.length > 0 || pending !== null;

  const composer = (
    <Composer draft={draft} setDraft={setDraft} kinds={kinds} setKinds={setKinds} busy={pending !== null} hero={!started} inputRef={inputRef} onSubmit={submit} />
  );

  const failureShape = failure ? FAILURE_VIEW[failure.code] ?? FAILURE_FALLBACK : null;
  const failureView =
    failure && failureShape ? (
      <Stack gap={10}>
        <Text secondary theme={THEME} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {failure.question}
        </Text>
        <AlertBanner variant={failureShape.variant} title={ERROR_COPY[failure.code] ?? failure.message} description={failureShape.description} theme={THEME} />
        <Stack direction="row" gap={8}>
          {failureShape.retry ? (
            <Button variant="secondary" size="sm" theme={THEME} onClick={() => void ask(failure.question, failure.kinds)}>
              Try again
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" theme={THEME} onClick={() => setFailure(null)}>
            Dismiss
          </Button>
        </Stack>
      </Stack>
    ) : null;

  const conversation = (
    <Stack gap={36} style={{ flex: 1, minWidth: 0 }}>
      {thread.map((turn, i) => {
        const current = wide && i === shownTurn;
        return (
          <article key={i} className={fresh === i ? "cb-turn-in" : undefined} aria-label={`Question ${i + 1}`}>
            <Stack gap={14}>
              <Stack gap={4}>
                <Text theme={THEME} size="lg" weight="semibold" as="h3" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {turn.question}
                </Text>
                {turn.kinds?.length ? <Caption theme={THEME}>Searched only in {turn.kinds.map((k) => kindName(k, true).toLowerCase()).join(", ")}</Caption> : null}
              </Stack>

              <Answer text={turn.answer} sources={turn.sources} activeSource={active.turn === i ? active.source : null} onCite={(s) => cite(i, s)} />

              <Stack direction="row" gap={6} align="center" wrap>
                <Button variant="ghost" size="sm" theme={THEME} onClick={() => void copy(turn, i)}>
                  {copied?.turn === i ? (copied.ok ? "Copied" : "Could not copy") : "Copy answer"}
                </Button>
                {wide && turn.sources.length && !current ? (
                  <Button variant="ghost" size="sm" theme={THEME} onClick={() => setActive({ turn: i, source: null })}>
                    Show its {turn.sources.length === 1 ? "source" : `${turn.sources.length} sources`}
                  </Button>
                ) : null}
              </Stack>

              {turn.related.length ? (
                <Stack gap={8}>
                  <Caption theme={THEME}>CONNECTED, NOT CITED</Caption>
                  <Stack direction="row" gap={6} wrap>
                    {turn.related.map((r) => (
                      <KindChip
                        key={`${r.kind}-${r.name}`}
                        kind={r.kind}
                        label={r.name}
                        title={`Ask about ${r.name}`}
                        onClick={() => void ask(`What should I know about ${r.name}?`, kinds)}
                      />
                    ))}
                  </Stack>
                </Stack>
              ) : null}

              {wide ? null : (
                <Stack gap={8}>
                  <Caption theme={THEME}>{turn.sources.length ? `SOURCES ${turn.sources.length}` : "SOURCES"}</Caption>
                  <Sources turn={turn} index={i} active={active.turn === i ? active.source : null} />
                </Stack>
              )}
            </Stack>
          </article>
        );
      })}

      {pending ? (
        <div ref={pendingRef} aria-live="polite" aria-busy>
          <Stack gap={14}>
            <Text theme={THEME} size="lg" weight="semibold" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {pending.question}
            </Text>
            <Stack gap={10} style={{ maxWidth: "68ch" }}>
              <Skeleton theme={THEME} />
              <Skeleton theme={THEME} />
              <Skeleton theme={THEME} width="62%" />
            </Stack>
            <Caption theme={THEME}>Reading what your company has written down</Caption>
          </Stack>
        </div>
      ) : null}

      {failureView}

      {composer}
    </Stack>
  );

  const panelTurn = thread[shownTurn];
  const panel = (
    <aside
      aria-label="Sources"
      style={{
        width: 300,
        flexShrink: 0,
        position: "sticky",
        top: 24,
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
        paddingRight: 4,
      }}
    >
      <Stack gap={12}>
        <Stack gap={2}>
          <Caption theme={THEME}>{panelTurn?.sources.length ? `SOURCES ${panelTurn.sources.length}` : "SOURCES"}</Caption>
          {panelTurn ? (
            <Text secondary theme={THEME} truncate style={tokens.type.sm} as="div">
              {panelTurn.question}
            </Text>
          ) : null}
        </Stack>
        {pending && shownTurn < 0 ? (
          <Stack gap={8}>
            <Skeleton theme={THEME} height={96} />
            <Skeleton theme={THEME} height={96} />
          </Stack>
        ) : panelTurn ? (
          <Sources turn={panelTurn} index={shownTurn} active={active.turn === shownTurn ? active.source : null} />
        ) : null}
      </Stack>
    </aside>
  );

  return (
    <div ref={rootRef}>
      <Stack gap={24}>
        <Stack direction="row" justify="space-between" align="flex-end" gap={12} wrap>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Heading level={4} theme={THEME}>
              Ask
            </Heading>
            <Text secondary theme={THEME}>
              Answers come from what your company has written down and indexed. Every answer names what it read.
            </Text>
          </Stack>
          <Stack direction="row" gap={6}>
            {onOpenGraph ? (
              <Button variant="secondary" size="sm" arrow theme={THEME} onClick={onOpenGraph}>
                Open the graph
              </Button>
            ) : null}
            {thread.length ? (
              <Button variant="secondary" size="sm" theme={THEME} disabled={pending !== null} onClick={reset}>
                New conversation
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {canAsk ? null : (
          <AlertBanner
            variant="default"
            title="Answering is not configured yet"
            description="Indexing still works and your sources are kept. Questions need a model configured on the server before they can be answered."
            theme={THEME}
          />
        )}

        {started ? (
          wide ? (
            <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
              {conversation}
              {panel}
            </div>
          ) : (
            conversation
          )
        ) : (
          <Stack gap={20} style={{ maxWidth: 720 }}>
            {composer}
            {failureView}
            <Caption theme={THEME}>Enter sends, Shift and Enter adds a line. Pick kinds to narrow where answers come from, or leave them all off to search everything.</Caption>
            <Stack gap={8}>
              <Caption theme={THEME}>START FROM WHAT YOU NEED</Caption>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {INTENTS.map((intent) =>
                  intentCard(
                    intent.title,
                    intent.kinds[0] ?? "document",
                    intent.title,
                    intent.detail,
                    `Searches ${intent.kinds.map((k) => kindName(k, true).toLowerCase()).join(" and ")}`,
                    () => begin(intent),
                  ),
                )}
                {onOpenDecisions
                  ? intentCard("decisions", "decision", "Review past decisions", "The calls your agents stopped and asked you to make.", "Opens Decisions", onOpenDecisions)
                  : null}
              </div>
            </Stack>
          </Stack>
        )}
      </Stack>
    </div>
  );
}
