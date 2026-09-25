import { ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { LESSONS, type Lesson, type Reply } from "./learn-lessons";
import { Tour } from "./learn-tour";
import { EASE, injectCss, useReducedMotion } from "./shared";
import { Button, Heading, IconButton, Logo, Stack, Text, tokens, usePal } from "./ui";

const STORE = "cb-learn-done";

function readDone(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDone(done: Set<string>): void {
  try {
    window.localStorage.setItem(STORE, JSON.stringify([...done]));
  } catch {
    return;
  }
}

injectCss(
  "cb-learn",
  `
  .cb-learn-guide { container-type: inline-size; }
  .cb-learn-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .cb-learn-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
  .cb-learn-lessons { list-style: none; margin: 0; padding: 10px; display: flex; gap: 6px; overflow-x: auto; scroll-snap-type: x proximity; border-bottom: 1px solid rgba(255,255,255,0.08); scrollbar-width: none; }
  .cb-learn-lessons::-webkit-scrollbar { display: none; }
  .cb-learn-lessons li { scroll-snap-align: start; flex-shrink: 0; }
  .cb-learn-lesson { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 14px; width: 100%;
    transition: background-color 200ms ${EASE}, transform 160ms ${EASE}; }
  .cb-learn-lesson:active { transform: scale(0.98); }
  .cb-learn-lesson:focus-visible { outline: 2px solid #5eeab0; outline-offset: -2px; }
  .cb-learn-lesson[aria-current="true"] { background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); }
  @media (hover: hover) and (pointer: fine) { .cb-learn-lesson:hover { background: rgba(255,255,255,0.045); } }
  .cb-learn-lesson-summary { display: none; }
  .cb-learn-mark { width: 26px; height: 26px; border-radius: 999px; flex-shrink: 0; display: grid; place-items: center; font-size: 11.5px; font-variant-numeric: tabular-nums; }
  @container (min-width: 760px) {
    .cb-learn-grid { grid-template-columns: 280px minmax(0, 1fr); }
    .cb-learn-lessons { flex-direction: column; overflow: visible; border-bottom: 0; border-right: 1px solid rgba(255,255,255,0.08); padding: 12px; gap: 2px; }
    .cb-learn-lesson { align-items: flex-start; padding: 10px 12px 10px 10px; }
    .cb-learn-lesson[aria-current="true"] .cb-learn-lesson-summary { display: block; }
  }
  .cb-learn-chat { display: flex; flex-direction: column; min-width: 0; min-height: 440px; }
  .cb-learn-log { flex: 1; overflow-y: auto; max-height: 460px; padding: 20px 20px 8px; display: flex; flex-direction: column; gap: 8px; overscroll-behavior: contain; }
  .cb-learn-row { display: flex; gap: 10px; align-items: flex-end; }
  .cb-learn-row[data-from="you"] { justify-content: flex-end; }
  .cb-learn-avatar { width: 24px; flex-shrink: 0; }
  .cb-learn-bubble { max-width: min(560px, 86%); padding: 10px 14px; font-size: 13.5px; line-height: 1.6; color: #f4f4f6; overflow-wrap: anywhere;
    animation: cb-learn-in 240ms ${EASE} both; }
  .cb-learn-row[data-from="guide"] .cb-learn-bubble { border-radius: 18px 18px 18px 6px; background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.09); transform-origin: left bottom; }
  .cb-learn-row[data-from="you"] .cb-learn-bubble { border-radius: 18px 18px 6px 18px; background: rgba(94,234,176,0.12); box-shadow: inset 0 0 0 1px rgba(94,234,176,0.24); color: #d9fbec; transform-origin: right bottom; }
  .cb-learn-code { font-family: ${tokens.font.mono}; font-size: 12px; padding: 1px 6px; border-radius: 6px; background: rgba(45,212,180,0.1); color: #8ff2c9; white-space: nowrap; }
  .cb-learn-typing { display: inline-flex; gap: 4px; padding: 14px 16px; }
  .cb-learn-typing span { width: 6px; height: 6px; border-radius: 999px; background: rgba(244,244,246,0.6); animation: cb-learn-dot 900ms ${EASE} infinite; }
  .cb-learn-typing span:nth-child(2) { animation-delay: 120ms; }
  .cb-learn-typing span:nth-child(3) { animation-delay: 240ms; }
  .cb-learn-foot { padding: 12px 20px 18px; min-height: 64px; display: flex; flex-direction: column; gap: 10px; }
  .cb-learn-replies { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
  .cb-learn-reply { all: unset; box-sizing: border-box; cursor: pointer; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 500; line-height: 1.4; color: #8ff2c9;
    background: rgba(94,234,176,0.06); box-shadow: inset 0 0 0 1px rgba(94,234,176,0.3); animation: cb-learn-in 220ms ${EASE} both; transition: background-color 200ms ${EASE}, transform 160ms ${EASE}; }
  .cb-learn-reply:active { transform: scale(0.97); }
  .cb-learn-reply:focus-visible { outline: 2px solid #5eeab0; outline-offset: 2px; }
  @media (hover: hover) and (pointer: fine) { .cb-learn-reply:hover { background: rgba(94,234,176,0.14); } }
  .cb-learn-replies > :nth-child(2) { animation-delay: 50ms; }
  .cb-learn-replies > :nth-child(3) { animation-delay: 100ms; }
  @keyframes cb-learn-in { from { opacity: 0; transform: translateY(6px) scale(0.97); } }
  @keyframes cb-learn-dot { 0%, 100% { opacity: 0.35; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
  @media (prefers-reduced-motion: reduce) {
    .cb-learn-bubble, .cb-learn-reply { animation: none; }
    .cb-learn-typing span { animation: none; opacity: 0.6; }
    .cb-learn-lesson, .cb-learn-reply { transition: none; }
  }
  `,
);

const CODE = /(\[\[[^\]\n]+\]\]|\b[a-z]+(?:_[a-z]+)+\b)/g;

function rich(line: string): ReactNode[] {
  return line.split(CODE).map((part, i) =>
    i % 2 ? (
      <code key={i} className="cb-learn-code">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

interface Said {
  id: number;
  from: "guide" | "you";
  text: string;
}

function Guide({ onNavigate }: { onNavigate: (screen: string) => void }): JSX.Element {
  const pal = usePal();
  const reduced = useReducedMotion();
  const quick = useRef(reduced);
  quick.current = reduced;
  const [done, setDone] = useState<Set<string>>(readDone);
  const [lessonId, setLessonId] = useState<string>(() => LESSONS.find((l) => !readDone().has(l.id))?.id ?? LESSONS[0]?.id ?? "start");
  const [beatId, setBeatId] = useState("start");
  const [turn, setTurn] = useState(0);
  const [log, setLog] = useState<Said[]>([]);
  const [typing, setTyping] = useState(true);
  const said = useRef(0);
  const foot = useRef<HTMLDivElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    const first = foot.current?.querySelector("button");
    if (first) {
      first.focus();
      refocus.current = false;
    }
  });
  const scroller = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLOListElement>(null);

  const lesson: Lesson = LESSONS.find((l) => l.id === lessonId) ?? (LESSONS[0] as Lesson);
  const beat = lesson.beats[beatId] ?? lesson.beats.start;
  const position = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[position + 1];

  useEffect(() => {
    const timers: number[] = [];
    setTyping(true);
    let at = quick.current ? 0 : 280;
    beat.say.forEach((line, i) => {
      at += quick.current ? 0 : Math.min(900, 260 + line.length * 6);
      timers.push(
        window.setTimeout(() => {
          said.current += 1;
          setLog((prev) => [...prev, { id: said.current, from: "guide", text: line }]);
          if (i < beat.say.length - 1) return;
          setTyping(false);
          if (beat.go)
            setDone((prev) => {
              if (prev.has(lesson.id)) return prev;
              const next = new Set(prev).add(lesson.id);
              writeDone(next);
              return next;
            });
        }, at),
      );
      at += quick.current ? 0 : 180;
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [lesson, beat, turn]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: quick.current ? "auto" : "smooth" });
  }, [log, typing]);

  useEffect(() => {
    const list = rail.current;
    const item = list?.querySelector('[aria-current="true"]');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const left = list.scrollLeft + item.getBoundingClientRect().left - list.getBoundingClientRect().left - 10;
    list.scrollTo({ left, behavior: quick.current ? "auto" : "smooth" });
  }, [lessonId]);

  const open = (id: string): void => {
    setLessonId(id);
    setBeatId("start");
    setLog([]);
    setTurn((n) => n + 1);
  };

  const choose = (reply: Reply): void => {
    said.current += 1;
    setLog((prev) => [...prev, { id: said.current, from: "you", text: reply.label }]);
    setTyping(true);
    setBeatId(reply.next);
    setTurn((n) => n + 1);
  };

  const reset = (): void => {
    const empty = new Set<string>();
    writeDone(empty);
    setDone(empty);
    open(LESSONS[0]?.id ?? "start");
  };

  const finished = done.has(lesson.id) && !typing && Boolean(beat.go);

  return (
    <Stack gap={14}>
      <Stack direction="row" justify="space-between" align="flex-end" gap={12} wrap>
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Heading level={5}>Guided lessons</Heading>
          <Text secondary size="sm">
            {done.size === LESSONS.length ? "All lessons done. Replay any of them whenever you like." : `${done.size} of ${LESSONS.length} done. Each one takes about a minute and ends where you do it.`}
          </Text>
        </Stack>
        <Stack direction="row" gap={12} align="center">
          <div aria-hidden style={{ display: "flex", gap: 3, width: 150 }}>
            {LESSONS.map((l) => (
              <span key={l.id} style={{ flex: 1, height: 4, borderRadius: 999, background: done.has(l.id) ? pal.accent : "rgba(255,255,255,0.08)", boxShadow: done.has(l.id) ? `0 0 10px ${pal.accent}66` : "none" }} />
            ))}
          </div>
          {done.size ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              Start over
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <div className="cb-bezel cb-learn-guide">
        <div className="cb-core" style={{ padding: 0 }}>
          <div className="cb-learn-grid">
            <ol ref={rail} className="cb-learn-lessons" aria-label="Lessons">
              {LESSONS.map((l, i) => {
                const current = l.id === lesson.id;
                const complete = done.has(l.id);
                return (
                  <li key={l.id}>
                    <button className="cb-learn-lesson" aria-current={current} onClick={() => open(l.id)}>
                      <span
                        className="cb-learn-mark"
                        aria-hidden
                        style={{
                          color: complete ? pal.textInverse : current ? pal.accent : pal.textTertiary,
                          background: complete ? pal.accent : "rgba(255,255,255,0.04)",
                          boxShadow: current && !complete ? `inset 0 0 0 1px ${pal.accent}` : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                        }}
                      >
                        {complete ? <Check size={13} weight="bold" /> : i + 1}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 550, color: current ? pal.text : pal.textSecondary, whiteSpace: "nowrap" }}>
                          {l.title}
                          {complete ? <span className="cb-learn-sr">, done</span> : null}
                        </span>
                        <span className="cb-learn-lesson-summary" style={{ fontSize: 12, lineHeight: 1.45, color: pal.textTertiary }}>
                          {l.summary}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="cb-learn-chat">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.16em", fontWeight: 600, color: pal.textTertiary }}>{`LESSON ${position + 1} OF ${LESSONS.length}`}</span>
                  <Text weight="semibold" size="md">
                    {lesson.title}
                  </Text>
                </Stack>
                <IconButton label="Replay this lesson" size={32} icon={<ArrowCounterClockwise size={14} weight="bold" />} onClick={() => open(lesson.id)} />
              </div>

              <div ref={scroller} className="cb-learn-log" role="log" aria-live="polite" aria-label={`${lesson.title} conversation`}>
                {log.map((m, i) => {
                  const lead = m.from === "guide" && log[i - 1]?.from !== "guide";
                  return (
                    <div key={m.id} className="cb-learn-row" data-from={m.from} style={lead && i ? { marginTop: 8 } : undefined}>
                      {m.from === "guide" ? <span className="cb-learn-avatar">{log[i + 1]?.from === "guide" || (typing && i === log.length - 1) ? null : <Logo size={24} />}</span> : null}
                      <div className="cb-learn-bubble">
                        {m.from === "you" ? <span className="cb-learn-sr">You: </span> : null}
                        {rich(m.text)}
                      </div>
                    </div>
                  );
                })}
                {typing ? (
                  <div className="cb-learn-row" data-from="guide">
                    <span className="cb-learn-avatar">
                      <Logo size={24} />
                    </span>
                    <div className="cb-learn-bubble cb-learn-typing" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="cb-learn-foot" ref={foot}>
                {!typing && beat.replies?.length ? (
                  <div className="cb-learn-replies" role="group" aria-label="Your reply">
                    {beat.replies.map((r) => (
                      <button
                        key={r.label}
                        className="cb-learn-reply"
                        onClick={() => {
                          refocus.current = true;
                          choose(r);
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {finished && beat.go ? (
                  <Stack direction="row" gap={8} align="center" justify="space-between" wrap>
                    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: pal.accentText }}>
                      <Check size={13} weight="bold" />
                      Lesson complete
                    </span>
                    <Stack direction="row" gap={8} align="center" wrap>
                      {nextLesson ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            refocus.current = true;
                            open(nextLesson.id);
                          }}
                        >
                          Next lesson
                        </Button>
                      ) : null}
                      <Button variant="primary" size="sm" arrow onClick={() => onNavigate(beat.go?.screen ?? "home")}>
                        {`Do it now in ${beat.go.label}`}
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Stack>
  );
}

export function LearnScreen({ onNavigate }: { onNavigate: (screen: string) => void }): JSX.Element {
  return (
    <Stack gap={36} style={{ maxWidth: 1080 }}>
      <Stack gap={4}>
        <Heading level={4}>Learn</Heading>
        <Text secondary>See what Company Brain can do, then learn it one short conversation at a time. Every lesson ends on the screen where you do it.</Text>
      </Stack>
      <Tour />
      <Guide onNavigate={onNavigate} />
    </Stack>
  );
}
