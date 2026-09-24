import { ArrowUpRight, CheckCircle, Info, Sparkle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useId, type CSSProperties, type JSX, type KeyboardEvent, type ReactNode } from "react";

export const EASE_OUT = "cubic-bezier(0.32, 0.72, 0, 1)";

const PAL = {
  bg: "#08080a",
  bgElevated: "#141418",
  bgSubtle: "rgba(255,255,255,0.045)",
  bgMuted: "rgba(255,255,255,0.07)",
  bgHover: "rgba(255,255,255,0.08)",
  bgInput: "#101014",
  text: "#f4f4f6",
  textSecondary: "rgba(244,244,246,0.74)",
  textTertiary: "rgba(244,244,246,0.52)",
  textInverse: "#050505",
  border: "rgba(255,255,255,0.16)",
  borderSubtle: "rgba(255,255,255,0.10)",
  borderFocus: "rgba(94,234,176,0.55)",
  accent: "#5eeab0",
  accentText: "#8ff2c9",
  accentBg: "rgba(94,234,176,0.10)",
  success: "#5eeab0",
  successBg: "rgba(94,234,176,0.10)",
  warning: "#f5c451",
  warningBg: "rgba(245,196,81,0.10)",
  danger: "#f98b8b",
  dangerBg: "rgba(249,139,139,0.10)",
  shadowLg: "0 40px 80px -32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
};

export type Palette = typeof PAL;

export const usePal = (_theme?: unknown): Palette => PAL;

export const tokens = {
  radius: { xs: 6, sm: 10, md: 16, lg: 22, xl: 28, pill: 999 },
  type: {
    xs: { fontSize: 11, lineHeight: 1.45 },
    sm: { fontSize: 12.5, lineHeight: 1.55 },
    base: { fontSize: 13.5, lineHeight: 1.6 },
    md: { fontSize: 14.5, lineHeight: 1.6 },
    lg: { fontSize: 17, lineHeight: 1.45 },
    xl: { fontSize: 21, lineHeight: 1.3 },
  },
  font: {
    sans: "'Geist', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 650 },
};

const CSS = `
.cb-root { font-family: ${tokens.font.sans}; color: ${PAL.text}; -webkit-font-smoothing: antialiased; }
.cb-root *, .cb-root *::before, .cb-root *::after { box-sizing: border-box; }
.cb-backdrop { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
  background:
    radial-gradient(70rem 34rem at 55% -14%, rgba(94,234,176,0.20), transparent 62%),
    radial-gradient(42rem 30rem at 4% 30%, rgba(56,189,248,0.07), transparent 65%),
    radial-gradient(46rem 34rem at 100% 105%, rgba(129,140,248,0.10), transparent 65%),
    linear-gradient(180deg, #0b0c0e 0%, ${PAL.bg} 55%); }
.cb-backdrop::before { content: ""; position: absolute; inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.13) 1px, transparent 1.3px); background-size: 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 25%, transparent 78%); mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 25%, transparent 78%); }
.cb-backdrop::after { content: ""; position: absolute; left: 10%; right: 10%; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(143,242,201,0.55), transparent); }
.cb-grain { position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.05; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }

.cb-bezel { position: relative; padding: 6px; border-radius: 28px; background: rgba(255,255,255,0.04);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.11), 0 30px 60px -36px rgba(0,0,0,0.9); }
.cb-core { position: relative; border-radius: 22px; background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)), ${PAL.bgInput};
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 8px rgba(0,0,0,0.35); overflow: hidden; }
.cb-reveal { animation: cb-reveal 640ms ${EASE_OUT} both; }
@keyframes cb-reveal { from { opacity: 0; transform: translateY(14px); filter: blur(6px); } }

.cb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; border: 0; cursor: pointer; white-space: nowrap;
  font-family: ${tokens.font.sans}; font-weight: 550; letter-spacing: -0.005em; border-radius: 999px; text-decoration: none;
  transition: transform 260ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}, color 260ms ${EASE_OUT}, box-shadow 260ms ${EASE_OUT}; }
.cb-btn:active:not(:disabled) { transform: scale(0.98); }
.cb-btn:disabled { cursor: not-allowed; opacity: 0.38; }
.cb-btn[data-size="sm"] { height: 32px; padding: 0 14px; font-size: 12.5px; }
.cb-btn[data-size="md"] { height: 42px; padding: 0 20px; font-size: 13.5px; }
.cb-btn[data-arrow="true"][data-size="md"] { padding-right: 5px; }
.cb-btn[data-arrow="true"][data-size="sm"] { padding-right: 3px; }
.cb-btn[data-variant="primary"] { background: ${PAL.text}; color: ${PAL.textInverse}; box-shadow: inset 0 -1px 0 rgba(0,0,0,0.12), 0 10px 30px -12px rgba(237,237,239,0.35); }
.cb-btn[data-variant="secondary"] { background: rgba(255,255,255,0.08); color: ${PAL.text}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 rgba(255,255,255,0.10); }
.cb-btn[data-variant="ghost"] { background: transparent; color: ${PAL.textSecondary}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.cb-btn[data-variant="danger"] { background: ${PAL.dangerBg}; color: ${PAL.danger}; box-shadow: inset 0 0 0 1px rgba(249,139,139,0.18); }
@media (hover: hover) and (pointer: fine) {
  .cb-btn[data-variant="primary"]:hover:not(:disabled) { background: #ffffff; }
  .cb-btn[data-variant="secondary"]:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
  .cb-btn[data-variant="ghost"]:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: ${PAL.text}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); }
  .cb-btn[data-variant="danger"]:hover:not(:disabled) { background: rgba(249,139,139,0.16); }
  .cb-btn:hover:not(:disabled) .cb-btn-orb { transform: translate(2px, -1px) scale(1.05); }
}
.cb-btn-orb { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(0,0,0,0.08);
  transition: transform 320ms ${EASE_OUT}; }
.cb-btn[data-variant="secondary"] .cb-btn-orb, .cb-btn[data-variant="ghost"] .cb-btn-orb { background: rgba(255,255,255,0.08); }
.cb-btn[data-size="md"] .cb-btn-orb { width: 32px; height: 32px; }
.cb-btn[data-size="sm"] .cb-btn-orb { width: 26px; height: 26px; }

.cb-icon-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 0; cursor: pointer; color: ${PAL.textSecondary};
  background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); transition: transform 260ms ${EASE_OUT}, color 260ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}; }
.cb-icon-btn:active { transform: scale(0.95); }
@media (hover: hover) and (pointer: fine) { .cb-icon-btn:hover { color: ${PAL.text}; background: rgba(255,255,255,0.09); } }

.cb-row { display: flex; align-items: center; gap: 16px; padding: 15px 20px; position: relative; transition: background-color 240ms ${EASE_OUT}; }
.cb-row[data-divider="true"]::after { content: ""; position: absolute; left: 20px; right: 20px; bottom: 0; height: 1px; background: rgba(255,255,255,0.09); }
.cb-row[data-clickable="true"] { cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .cb-row[data-clickable="true"]:hover { background: rgba(255,255,255,0.045); } }

.cb-field { display: block; padding: 3px; border-radius: 17px; background: rgba(255,255,255,0.045); box-shadow: 0 0 0 1px rgba(255,255,255,0.13);
  transition: box-shadow 260ms ${EASE_OUT}, background-color 260ms ${EASE_OUT}; }
.cb-field:focus-within { box-shadow: 0 0 0 1px ${PAL.borderFocus}, 0 0 0 5px rgba(94,234,176,0.08); }
.cb-field[data-error="true"] { box-shadow: 0 0 0 1px rgba(249,139,139,0.5); }
.cb-input { display: block; width: 100%; border: 0; outline: none; border-radius: 14px; background: ${PAL.bgInput}; color: ${PAL.text};
  font-family: ${tokens.font.sans}; font-size: 13.5px; line-height: 1.55; padding: 11px 15px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 2px rgba(0,0,0,0.4); resize: vertical; }
.cb-input[data-size="sm"] { padding: 7px 12px; font-size: 12.5px; }
.cb-input::placeholder { color: ${PAL.textTertiary}; }
.cb-input:disabled { opacity: 0.5; cursor: not-allowed; }
select.cb-input { appearance: none; padding-right: 36px; cursor: pointer;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M3 4.5l3 3 3-3' fill='none' stroke='%23a1a1aa' stroke-width='1.2' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat; background-position: right 14px center; }

.cb-eyebrow { display: inline-flex; align-items: center; gap: 6px; width: max-content; border-radius: 999px; padding: 4px 11px;
  font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; color: ${PAL.text};
  background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); }
.cb-skel { background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 100%);
  background-size: 200% 100%; animation: cb-shimmer 1.6s ${EASE_OUT} infinite; }
@keyframes cb-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@media (prefers-reduced-motion: reduce) {
  .cb-reveal, .cb-skel { animation: none; }
  .cb-btn, .cb-btn-orb, .cb-row, .cb-field, .cb-icon-btn { transition: none; }
}
`;

let injected = false;

export function injectUiStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.id = "cb-ui";
  el.textContent = CSS;
  document.head.appendChild(el);
}

injectUiStyles();

type Common = { theme?: unknown; style?: CSSProperties; children?: ReactNode };

export function Stack({
  children,
  gap = 0,
  direction = "column",
  align,
  justify,
  wrap,
  style,
}: Common & { gap?: number; direction?: "row" | "column"; align?: CSSProperties["alignItems"]; justify?: CSSProperties["justifyContent"]; wrap?: boolean }): JSX.Element {
  return <div style={{ display: "flex", flexDirection: direction, gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? "wrap" : undefined, minWidth: 0, ...style }}>{children}</div>;
}

const HEADING: Record<number, CSSProperties> = {
  1: { fontSize: "clamp(34px, 5vw, 52px)", lineHeight: 1.04, letterSpacing: "-0.04em" },
  2: { fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.08, letterSpacing: "-0.035em" },
  3: { fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.025em" },
  4: { fontSize: "clamp(22px, 3vw, 28px)", lineHeight: 1.15, letterSpacing: "-0.03em" },
  5: { fontSize: 16, lineHeight: 1.35, letterSpacing: "-0.01em" },
  6: { fontSize: 14, lineHeight: 1.4 },
};

export function Heading({ children, level = 1, style }: Common & { level?: 1 | 2 | 3 | 4 | 5 | 6 }): JSX.Element {
  const Tag = `h${level}` as "h1";
  return <Tag style={{ margin: 0, fontWeight: level <= 2 ? 650 : 600, color: PAL.text, textWrap: "balance", ...HEADING[level], ...style } as CSSProperties}>{children}</Tag>;
}

const TEXT_SIZE: Record<string, CSSProperties> = { sm: tokens.type.sm, base: tokens.type.base, md: tokens.type.md, lg: tokens.type.lg };

export function Text({
  children,
  secondary,
  mono,
  size = "base",
  weight = "regular",
  as = "span",
  truncate,
  style,
}: Common & { secondary?: boolean; mono?: boolean; size?: "sm" | "base" | "md" | "lg"; weight?: "regular" | "medium" | "semibold"; as?: "span" | "div" | "p" | "h3"; truncate?: boolean }): JSX.Element {
  const Tag = as;
  return (
    <Tag
      style={{
        margin: 0,
        color: secondary ? PAL.textSecondary : PAL.text,
        fontFamily: mono ? tokens.font.mono : tokens.font.sans,
        fontWeight: tokens.weight[weight],
        ...TEXT_SIZE[size],
        ...(truncate ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" } : null),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export function Caption({ children, style }: Common): JSX.Element {
  const shout = typeof children === "string" && children === children.toUpperCase() && /[A-Z]/.test(children);
  const look: CSSProperties = shout ? { fontSize: 10.5, letterSpacing: "0.16em", fontWeight: 600 } : { fontSize: 12, letterSpacing: "0.005em" };
  return <span style={{ color: PAL.textTertiary, lineHeight: 1.55, ...look, ...style }}>{children}</span>;
}

export function Eyebrow({ children, dot }: { children: ReactNode; dot?: string }): JSX.Element {
  return (
    <span className="cb-eyebrow">
      {dot ? <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: dot, boxShadow: `0 0 12px ${dot}` }} /> : null}
      {children}
    </span>
  );
}

export function Card({ children, padding = 22, style, reveal = false }: Common & { padding?: number; solid?: boolean; reveal?: boolean }): JSX.Element {
  return (
    <div className={reveal ? "cb-bezel cb-reveal" : "cb-bezel"}>
      <div className="cb-core" style={{ padding, ...style }}>
        {children}
      </div>
    </div>
  );
}

export function CardHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode; theme?: unknown }): JSX.Element {
  return (
    <Stack gap={6}>
      <Heading level={5}>{title}</Heading>
      {subtitle ? <Text secondary>{subtitle}</Text> : null}
    </Stack>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled,
  onClick,
  fullWidth,
  arrow,
  style,
}: Common & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; disabled?: boolean; onClick?: () => void; fullWidth?: boolean; arrow?: boolean }): JSX.Element {
  return (
    <button
      className="cb-btn"
      data-variant={variant}
      data-size={size}
      data-arrow={arrow ? "true" : "false"}
      disabled={disabled}
      onClick={onClick}
      style={{ width: fullWidth ? "100%" : undefined, ...style }}
    >
      {children}
      {arrow ? (
        <span className="cb-btn-orb" aria-hidden>
          <ArrowUpRight size={size === "sm" ? 12 : 14} weight="light" />
        </span>
      ) : null}
    </button>
  );
}

export function IconButton({ label, icon, size = 32, onClick }: { label: string; icon: ReactNode; size?: number; onClick?: () => void; variant?: string; theme?: unknown }): JSX.Element {
  return (
    <button className="cb-icon-btn" aria-label={label} title={label} onClick={onClick} style={{ width: size, height: size }}>
      {icon}
    </button>
  );
}

export function ListItem({
  title,
  subtitle,
  right,
  divider,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  divider?: boolean;
  onClick?: () => void;
  theme?: unknown;
}): JSX.Element {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      className="cb-row"
      data-divider={divider ? "true" : "false"}
      data-clickable={onClick ? "true" : "false"}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKey}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 580, color: PAL.text, letterSpacing: "-0.005em", overflowWrap: "anywhere" }}>{title}</span>
        {subtitle ? <span style={{ fontSize: 12.5, color: PAL.textSecondary, lineHeight: 1.5, overflowWrap: "anywhere" }}>{subtitle}</span> : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}

const TONE: Record<string, { color: string; bg: string; Icon: typeof Info }> = {
  default: { color: PAL.textSecondary, bg: "rgba(255,255,255,0.04)", Icon: Info },
  success: { color: PAL.success, bg: PAL.successBg, Icon: CheckCircle },
  warning: { color: PAL.warning, bg: PAL.warningBg, Icon: WarningCircle },
  danger: { color: PAL.danger, bg: PAL.dangerBg, Icon: XCircle },
};

export function AlertBanner({ title, description, variant = "default" }: { title: ReactNode; description?: ReactNode; variant?: "default" | "success" | "warning" | "danger"; theme?: unknown }): JSX.Element {
  const tone = TONE[variant] ?? TONE.default;
  return (
    <div role={variant === "danger" ? "alert" : "status"} className="cb-reveal" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", borderRadius: 18, background: tone.bg, boxShadow: `inset 0 0 0 1px ${tone.color}26` }}>
      <tone.Icon size={18} weight="light" color={tone.color} style={{ flexShrink: 0, marginTop: 1 }} />
      <Stack gap={3}>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: PAL.text }}>{title}</span>
        {description ? <span style={{ fontSize: 12.5, color: PAL.textSecondary, lineHeight: 1.55 }}>{description}</span> : null}
      </Stack>
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; theme?: unknown }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "44px 24px" }}>
      <span aria-hidden style={{ width: 48, height: 48, borderRadius: 999, display: "grid", placeItems: "center", color: PAL.accent, background: PAL.accentBg, boxShadow: "inset 0 0 0 1px rgba(94,234,176,0.18), 0 0 32px -8px rgba(94,234,176,0.35)" }}>
        {icon ?? <Sparkle size={20} weight="light" />}
      </span>
      <Stack gap={5} align="center">
        <span style={{ fontSize: 15, fontWeight: 500, color: PAL.text }}>{title}</span>
        {description ? <span style={{ fontSize: 13, color: PAL.textSecondary, maxWidth: 400, lineHeight: 1.55 }}>{description}</span> : null}
      </Stack>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 72, rounded }: { width?: number | string; height?: number | string; rounded?: boolean; theme?: unknown }): JSX.Element {
  return <div className="cb-skel" aria-hidden style={{ width, height, borderRadius: rounded ? 999 : 20 }} />;
}

function Field({ label, caption, error, children }: { label?: ReactNode; caption?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode }): JSX.Element {
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
      {label ? (
        <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 500, color: PAL.textSecondary, paddingLeft: 4 }}>
          {label}
        </label>
      ) : null}
      <span className="cb-field" data-error={error ? "true" : "false"}>
        {children(id)}
      </span>
      {error ? <span style={{ fontSize: 12, color: PAL.danger, paddingLeft: 4 }}>{error}</span> : caption ? <span style={{ fontSize: 12, color: PAL.textTertiary, paddingLeft: 4 }}>{caption}</span> : null}
    </div>
  );
}

type FieldProps = { value: string; onChange: (next: string) => void; placeholder?: string; disabled?: boolean; label?: ReactNode; caption?: ReactNode; error?: ReactNode; theme?: unknown };

export function TextInput({ value, onChange, placeholder, disabled, label, caption, error, type = "text", size = "md" }: FieldProps & { type?: string; size?: "sm" | "md" }): JSX.Element {
  return (
    <Field label={label} caption={caption} error={error}>
      {(id) => <input id={id} className="cb-input" data-size={size} type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function TextArea({ value, onChange, placeholder, disabled, label, caption, error, rows = 4 }: FieldProps & { rows?: number }): JSX.Element {
  return (
    <Field label={label} caption={caption} error={error}>
      {(id) => <textarea id={id} className="cb-input" rows={rows} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function Select({ value, onChange, options, placeholder, disabled, label, style }: FieldProps & { options: Array<string | { value: string; label: string }>; style?: CSSProperties }): JSX.Element {
  return (
    <div style={style}>
      <Field label={label}>
        {(id) => (
          <select id={id} className="cb-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((o) => {
              const opt = typeof o === "string" ? { value: o, label: o } : o;
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              );
            })}
          </select>
        )}
      </Field>
    </div>
  );
}

const STATUS: Record<string, string> = { success: PAL.success, online: PAL.success, error: PAL.danger, warning: PAL.warning, pending: PAL.warning, accent: PAL.accent, default: PAL.textTertiary, offline: PAL.textTertiary };

export function StatusBadge({ status = "default", children }: { status?: string; children: ReactNode; theme?: unknown }): JSX.Element {
  const color = STATUS[status] ?? STATUS.default;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 11px 4px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, color: PAL.text, background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: color, boxShadow: `0 0 10px ${color}` }} />
      {children}
    </span>
  );
}

export function Badge({ children, variant = "default", style }: Common & { variant?: "default" | "warning" }): JSX.Element {
  const warn = variant === "warning";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: warn ? PAL.warning : PAL.textSecondary, background: warn ? PAL.warningBg : "rgba(255,255,255,0.06)", ...style }}>
      {children}
    </span>
  );
}

export function Tag({ children, style }: Common): JSX.Element {
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, color: PAL.textSecondary, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)", ...style }}>{children}</span>;
}

export function Logo({ size = 28 }: { size?: number }): JSX.Element {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Company Brain" style={{ flexShrink: 0, display: "block" }}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a6fad8" />
          <stop offset="0.55" stopColor="#4fdfa8" />
          <stop offset="1" stopColor="#149b73" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${id}-fill)`} />
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${id}-shine)`} />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="none" stroke="#ffffff" strokeOpacity="0.35" />
      <g stroke="#04261b" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M9.5 12.5 16 8.5 22.5 12.5 19.5 20.5 12.5 20.5Z" />
        <path d="M9.5 12.5 16 15.5 22.5 12.5M16 8.5V15.5M12.5 20.5 16 15.5 19.5 20.5" />
      </g>
      <g fill="#04261b">
        <circle cx="9.5" cy="12.5" r="2.3" />
        <circle cx="16" cy="8.5" r="2.3" />
        <circle cx="22.5" cy="12.5" r="2.3" />
        <circle cx="12.5" cy="20.5" r="2.3" />
        <circle cx="19.5" cy="20.5" r="2.3" />
      </g>
      <circle cx="16" cy="15.5" r="3" fill="#ffffff" stroke="#04261b" strokeWidth="1.7" />
    </svg>
  );
}
