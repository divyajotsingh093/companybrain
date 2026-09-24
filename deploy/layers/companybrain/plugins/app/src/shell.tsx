import {
  Archive,
  Brain,
  ChatCircleText,
  FlowArrow,
  Graph,
  House,
  IdentificationBadge,
  Kanban,
  Lightbulb,
  PlugsConnected,
  Robot,
  Scales,
  Signpost,
  SquaresFour,
  Stack as StackIcon,
  Tray,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { EASE_OUT, Logo, usePal } from "./ui";

export type NavGroup<S extends string> = { group: string | null; items: S[] };

const ICONS: Record<string, typeof Brain> = {
  home: House,
  ask: ChatCircleText,
  graph: Graph,
  overview: SquaresFour,
  work: Tray,
  project: Kanban,
  sources: StackIcon,
  memory: Brain,
  record: Archive,
  lesson: Lightbulb,
  process: FlowArrow,
  rule: Scales,
  role: IdentificationBadge,
  skill: Wrench,
  agents: Robot,
  gateway: PlugsConnected,
  decisions: Signpost,
};

const SHELL_CSS = `
.cb-island { position: sticky; top: 24px; width: 244px; flex-shrink: 0; padding: 5px; border-radius: 30px;
  background: rgba(255,255,255,0.05); box-shadow: 0 0 0 1px rgba(255,255,255,0.12), 0 30px 60px -30px rgba(0,0,0,0.9); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  max-height: calc(100dvh - 48px); display: flex; }
.cb-island-core { flex: 1; display: flex; flex-direction: column; gap: 18px; padding: 18px 12px 12px; border-radius: 25px; overflow-y: auto;
  background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02)), rgba(16,16,20,0.86); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.09), inset 0 1px 0 rgba(255,255,255,0.14); }
.cb-nav-item { position: relative; display: flex; align-items: center; gap: 11px; width: 100%; height: 36px; padding: 0 12px; border: 0; border-radius: 12px; cursor: pointer;
  background: transparent; color: rgba(244,244,246,0.74); font-family: inherit; font-size: 13.5px; font-weight: 480; text-align: left;
  transition: background-color 260ms ${EASE_OUT}, color 260ms ${EASE_OUT}, transform 260ms ${EASE_OUT}; }
.cb-nav-item:active { transform: scale(0.98); }
.cb-nav-item[aria-current="page"] { background: rgba(255,255,255,0.10); color: #f4f4f6; font-weight: 580; box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,255,255,0.13); }
.cb-nav-item[aria-current="page"]::before { content: ""; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: #5eeab0; box-shadow: 0 0 12px #5eeab0; }
.cb-nav-item[aria-current="page"] .cb-nav-icon { color: #5eeab0; }
@media (hover: hover) and (pointer: fine) { .cb-nav-item:hover:not([aria-current="page"]) { background: rgba(255,255,255,0.06); color: #f4f4f6; } }
.cb-nav-count { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; display: inline-grid; place-items: center;
  font-size: 11px; font-variant-numeric: tabular-nums; color: #050505; background: #5eeab0; box-shadow: 0 0 14px -2px rgba(94,234,176,0.6); }
.cb-nav-group { padding: 0 12px 6px; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(244,244,246,0.50); font-weight: 600; }

.cb-bar { position: sticky; top: 12px; z-index: 20; margin: 12px 12px 0; display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 14px;
  border-radius: 999px; background: rgba(18,18,22,0.82); box-shadow: 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.10), 0 16px 40px -20px rgba(0,0,0,0.9);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
.cb-burger { position: relative; width: 40px; height: 40px; border: 0; border-radius: 999px; background: rgba(255,255,255,0.07); cursor: pointer; margin-left: auto; }
.cb-burger span { position: absolute; left: 13px; width: 14px; height: 1.5px; border-radius: 2px; background: #ededef; transition: transform 420ms ${EASE_OUT}, top 420ms ${EASE_OUT}; }
.cb-burger span:nth-child(1) { top: 16px; }
.cb-burger span:nth-child(2) { top: 22px; }
.cb-burger[aria-expanded="true"] span:nth-child(1) { top: 19px; transform: rotate(45deg); }
.cb-burger[aria-expanded="true"] span:nth-child(2) { top: 19px; transform: rotate(-45deg); }
.cb-sheet { position: fixed; inset: 0; z-index: 10; padding: 92px 20px 32px; overflow-y: auto; background: rgba(5,5,5,0.84);
  backdrop-filter: blur(32px); -webkit-backdrop-filter: blur(32px); opacity: 0; pointer-events: none; transition: opacity 420ms ${EASE_OUT}; }
.cb-sheet[data-open="true"] { opacity: 1; pointer-events: auto; }
.cb-sheet .cb-nav-item { height: 48px; font-size: 17px; opacity: 0; transform: translateY(18px); transition: opacity 520ms ${EASE_OUT}, transform 520ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}; }
.cb-sheet[data-open="true"] .cb-nav-item { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .cb-nav-item, .cb-burger span, .cb-sheet, .cb-sheet .cb-nav-item { transition: none; }
}
`;

let injected = false;
function injectShell(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.id = "cb-shell";
  el.textContent = SHELL_CSS;
  document.head.appendChild(el);
}

function NavItems<S extends string>({
  groups,
  screen,
  labels,
  counts,
  onSelect,
  stagger,
}: {
  groups: Array<NavGroup<S>>;
  screen: S;
  labels: Record<S, string>;
  counts: Partial<Record<S, number>>;
  onSelect: (s: S) => void;
  stagger?: boolean;
}): JSX.Element {
  let index = 0;
  return (
    <nav aria-label="Sections" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map((g) => (
        <div key={g.group ?? "start"} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {g.group ? <span className="cb-nav-group">{g.group}</span> : null}
          {g.items.map((id) => {
            const Icon = ICONS[id] ?? Brain;
            const delay = stagger ? `${80 + index++ * 28}ms` : undefined;
            return (
              <button key={id} className="cb-nav-item" aria-current={screen === id ? "page" : undefined} onClick={() => onSelect(id)} style={delay ? { transitionDelay: delay } : undefined}>
                <Icon className="cb-nav-icon" size={18} weight="light" />
                {labels[id]}
                {counts[id] ? <span className="cb-nav-count">{counts[id]}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Shell<S extends string>({
  groups,
  screen,
  labels,
  counts,
  onSelect,
  login,
  narrow,
  eyebrow,
  children,
}: {
  groups: Array<NavGroup<S>>;
  screen: S;
  labels: Record<S, string>;
  counts: Partial<Record<S, number>>;
  onSelect: (s: S) => void;
  login: string;
  narrow: boolean;
  eyebrow: string | null;
  children: ReactNode;
}): JSX.Element {
  injectShell();
  const pal = usePal();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!narrow) setOpen(false);
  }, [narrow]);

  const pick = (s: S): void => {
    setOpen(false);
    onSelect(s);
  };

  const wordmark = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Logo size={26} />
      <span style={{ fontSize: 15.5, fontWeight: 650, letterSpacing: "-0.025em", color: pal.text }}>Company Brain</span>
    </span>
  );

  const main = (
    <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
      {eyebrow ? (
        <span className="cb-eyebrow">
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: pal.accent, boxShadow: `0 0 12px ${pal.accent}` }} />
          {eyebrow}
        </span>
      ) : null}
      {children}
    </main>
  );

  if (narrow) {
    return (
      <div style={{ position: "relative", zIndex: 2, minHeight: "100dvh" }}>
        <header className="cb-bar">
          {wordmark}
          <button className="cb-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span />
            <span />
          </button>
        </header>
        <div className="cb-sheet" data-open={open} aria-hidden={!open} inert={!open}>
          <NavItems groups={groups} screen={screen} labels={labels} counts={counts} onSelect={pick} stagger />
        </div>
        <div style={{ padding: "28px 16px 96px" }}>{main}</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", zIndex: 2, display: "flex", gap: 40, alignItems: "flex-start", maxWidth: 1320, margin: "0 auto", padding: "24px 32px 120px" }}>
      <aside className="cb-island">
        <div className="cb-island-core">
          <div style={{ padding: "0 8px" }}>{wordmark}</div>
          <NavItems groups={groups} screen={screen} labels={labels} counts={counts} onSelect={onSelect} />
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 16, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.11)" }}>
            <span aria-hidden style={{ width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 500, color: pal.textInverse, background: pal.text }}>
              {login.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, color: pal.textSecondary, overflow: "hidden", textOverflow: "ellipsis" }}>{login}</span>
          </div>
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 12, maxWidth: 1040 }}>{main}</div>
    </div>
  );
}
