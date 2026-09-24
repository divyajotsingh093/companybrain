import type { CSSProperties, JSX } from "react";
import { tokens, usePal } from "./ui";
import { EASE, THEME, injectCss } from "./shared";

export const ONTOLOGY = ["project", "memory", "skill", "process", "rule", "lesson", "record", "role"] as const;

export const ASK_KINDS = ["document", ...ONTOLOGY] as const;

export const GRAPH_KINDS = [...ONTOLOGY, "decision", "repo", "document", "missing"] as const;

const HUE: Record<string, number> = {
  rule: 18,
  decision: 48,
  lesson: 82,
  role: 118,
  skill: 152,
  process: 192,
  project: 232,
  memory: 276,
  record: 322,
};

const NEUTRAL: Record<string, { lightness: number; chroma: number; hue: number }> = {
  repo: { lightness: 0.92, chroma: 0.01, hue: 250 },
  document: { lightness: 0.72, chroma: 0.02, hue: 250 },
  missing: { lightness: 0.8, chroma: 0, hue: 0 },
};

const LIGHTNESS = 0.8;
const CHROMA = 0.105;

export interface KindColor {
  ink: string;
  fill: string;
  wash: string;
  line: string;
}

const cache = new Map<string, KindColor>();

export function kindColor(kind: string): KindColor {
  const known = cache.get(kind);
  if (known) return known;
  const tone = NEUTRAL[kind] ?? (HUE[kind] === undefined ? NEUTRAL.document : { lightness: LIGHTNESS, chroma: CHROMA, hue: HUE[kind] ?? 0 });
  const at = (alpha: number): string => `oklch(${tone.lightness} ${tone.chroma} ${tone.hue} / ${alpha})`;
  const color = { ink: at(1), fill: at(0.2), wash: at(0.1), line: at(0.42) };
  cache.set(kind, color);
  return color;
}

const SINGULAR: Record<string, string> = {
  project: "Project",
  memory: "Memory",
  skill: "Skill",
  process: "Process",
  rule: "Rule",
  lesson: "Lesson",
  record: "Record",
  role: "Role",
  repo: "Repository",
  document: "Document",
  decision: "Decision",
  missing: "Gap",
};

const PLURAL: Record<string, string> = {
  project: "Projects",
  memory: "Memory",
  skill: "Skills",
  process: "Processes",
  rule: "Rules",
  lesson: "Lessons",
  record: "Records",
  role: "Roles",
  repo: "Repositories",
  document: "Documents",
  decision: "Decisions",
  missing: "Gaps",
};

const NOTE: Record<string, string> = {
  repo: "A repository your agents work in. Entries link to it by writing owner/name.",
  document: "A file indexed from a repository, which answers can quote.",
  decision: "A call an agent stopped and asked you to make.",
  missing: "Referenced with [[Name]] somewhere, but nobody has written it down yet.",
};

export function kindName(kind: string, plural = false): string {
  return (plural ? PLURAL : SINGULAR)[kind] ?? kind;
}

export function kindPurpose(kind: string, purposes: Record<string, string> = {}): string {
  return purposes[kind] ?? NOTE[kind] ?? "";
}

function injectKindStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-kind-styles",
    `
    .cb-kind-chip {
      display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 11px;
      border-radius: 999px; border: 1px solid ${pal.borderSubtle}; background: transparent;
      color: ${pal.textSecondary}; font: 500 12px/1 ${tokens.font.sans}; letter-spacing: 0.01em;
      cursor: pointer; white-space: nowrap; max-width: 100%;
      transition: transform 140ms ${EASE}, background-color 160ms ${EASE}, border-color 160ms ${EASE}, color 160ms ${EASE};
    }
    .cb-kind-chip[data-on="true"] { border-color: var(--kind-line); background: var(--kind-wash); color: ${pal.text}; }
    .cb-kind-chip:active { transform: scale(0.97); }
    @media (hover: hover) and (pointer: fine) {
      .cb-kind-chip:hover { border-color: var(--kind-line); color: ${pal.text}; }
    }
    .cb-kind-chip .cb-kind-count { color: ${pal.textTertiary}; font-variant-numeric: tabular-nums; font-family: ${tokens.font.mono}; font-size: 11px; }
    .cb-kind-chip .cb-kind-text { overflow: hidden; text-overflow: ellipsis; }
    @media (prefers-reduced-motion: reduce) { .cb-kind-chip { transition: none; } }
  `,
  );
}

export function KindDot({ kind, size = 8, hollow = false }: { kind: string; size?: number; hollow?: boolean }): JSX.Element {
  const c = kindColor(kind);
  const dashed = kind === "missing";
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        boxSizing: "border-box",
        background: hollow || dashed ? "transparent" : c.ink,
        border: `1.5px ${dashed ? "dashed" : "solid"} ${c.ink}`,
        display: "inline-block",
      }}
    />
  );
}

export function KindBadge({ kind }: { kind: string }): JSX.Element {
  const c = kindColor(kind);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...tokens.type.xs,
        fontFamily: tokens.font.sans,
        fontWeight: tokens.weight.medium,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        color: c.ink,
        background: c.wash,
        border: `1px solid ${c.line}`,
        padding: "2px 8px",
        borderRadius: tokens.radius.sm,
        whiteSpace: "nowrap",
      }}
    >
      <KindDot kind={kind} size={6} />
      {kindName(kind)}
    </span>
  );
}

export function KindChip({
  kind,
  label,
  count,
  on,
  onClick,
  title,
}: {
  kind: string;
  label: string;
  count?: number;
  on?: boolean;
  onClick: () => void;
  title?: string;
}): JSX.Element {
  const pal = usePal(THEME);
  injectKindStyles(pal);
  const c = kindColor(kind);
  const vars = { "--kind-line": c.line, "--kind-wash": c.wash } as CSSProperties;
  return (
    <button type="button" className="cb-kind-chip" data-on={on === true} aria-pressed={on} title={title} onClick={onClick} style={vars}>
      <KindDot kind={kind} hollow={on === false} />
      <span className="cb-kind-text">{label}</span>
      {count === undefined ? null : <span className="cb-kind-count">{count}</span>}
    </button>
  );
}
