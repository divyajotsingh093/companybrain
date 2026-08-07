# Bold Signal Web UI Redesign (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `plugins/web-ui` a distinct light/dark visual identity ("Bold Signal" — navy rail, orange gradient accent, findings-style answers) and fix the real defect that its app-level tokens have no dark-mode definitions.

**Architecture:** A token layer in `shell.css` defined under `:root` (light) and `.dark` (dark), with every Bold Signal value derived from the org-overridable `--brand-accent` so runtime branding still cascades. Three hero surfaces (sidebar, composer, chat thread) are hand-finished against those tokens; a new `src/finding.ts` module adds the optional eyebrow/headline/citation treatment to assistant turns without growing the already-1925-line `chat.ts`.

**Tech Stack:** Lit 3, Vite, plain CSS custom properties, `node --test` with `jsdom`, TypeScript.

---

## Two corrections to the spec

Both were found by reading the code after the spec was approved. Implement the plan, not the spec, where they disagree.

**1. `--brand-accent` is runtime-configurable, not a static design token.**
`injectBranding` (`plugins/chassis/src/branding.ts:62-78`) injects
`<style>:root{--brand-accent:…;--brand-mark:"…"}</style>` before `</head>` whenever the
org has branding set in core. That injected block comes *after* the stylesheet, so at
equal specificity it wins over both `:root` and `.dark` in `shell.css`.

Consequences, and they are not optional:
- Bold Signal's orange is the **default value** of `--brand-accent`, not a fixed constant.
- `--brand-accent` **must never be defined under `.dark`**. Doing so would let the theme
  override an org's configured brand colour in one theme but not the other.
- Every other accent token derives from `--brand-accent` via `color-mix()`, so a branded
  org gets its own colour flowing through the gradient, chips, and focus rings.
- `.brand-mark` must keep `content: var(--brand-mark)`.

**2. The "no colour literal outside the token blocks" rule is scoped, not global.**
`shell.css` already contains 78 hex literals in inherited upstream code. Removing them all
is a large refactor and is out of scope. The rule is enforced only over the selector blocks
phase 1 owns, and Task 2 encodes exactly that.

**3. `--surface-raised` and `--surface-border` are dropped.**
The spec listed them, but no phase 1 surface uses them and inventing a use to justify a
token is backwards. They belong to phase 2 if a phase 2 panel actually needs them.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugins/web-ui/src/shell.css` (modify) | Token layer + hero-surface rules |
| `plugins/web-ui/src/finding.ts` (create) | Eyebrow / headline / citation-chip templates |
| `plugins/web-ui/src/chat.ts` (modify, ~line 1038) | Mount finding templates in the assistant row |
| `plugins/web-ui/test/bold-signal-tokens.test.ts` (create) | Token pairing + scoped no-hex rule |
| `plugins/web-ui/test/finding.test.ts` (create) | Finding template behaviour, empty case first |

`finding.ts` is a new file rather than an addition to `chat.ts` because `chat.ts` is already
1925 lines; the finding treatment is a self-contained rendering concern with its own tests.

**Repo rule:** per `AGENTS.md`, new code carries **zero comments** — no explanatory
comments, docblocks, or TODOs. Existing comments in inherited CSS stay untouched.

All commands run from `plugins/web-ui` unless stated otherwise.

---

### Task 1: Bold Signal token layer

**Files:**
- Modify: `plugins/web-ui/src/shell.css:3-14`
- Test: `plugins/web-ui/test/bold-signal-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/bold-signal-tokens.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellCss = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");

// The helper below must anchor to the start of a line: shell.css contains longer
// selectors such as ".custom-chat-shell.dragging .composer-wrap {" that would otherwise
// match first. (This note is for the plan reader — do not copy it into the test file,
// which carries no comments per AGENTS.md.)

function block(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${esc}\\s*\\{`, "m").exec(shellCss);
  assert.ok(m, `no top-level "${selector} {" block in shell.css`);
  const end = shellCss.indexOf("}", m.index);
  return shellCss.slice(m.index, end);
}

const THEMED = [
  "--brand-rail",
  "--brand-rail-fg",
  "--brand-rail-muted",
  "--brand-rail-active-bg",
  "--brand-accent-text",
  "--canvas-wash",
  "--chip-outline-border",
  "--chip-outline-fg",
];

test("every themed Bold Signal token is defined in both :root and .dark", () => {
  const light = block(":root");
  const dark = block(".dark");
  const missingLight = THEMED.filter((t) => !light.includes(`${t}:`));
  const missingDark = THEMED.filter((t) => !dark.includes(`${t}:`));
  assert.deepEqual(missingLight, [], "themed tokens missing from :root");
  assert.deepEqual(missingDark, [], "themed tokens missing from .dark");
});

test("--brand-accent is never redefined under .dark", () => {
  const dark = block(".dark");
  assert.ok(
    !/--brand-accent\s*:/.test(dark),
    "--brand-accent is org-configurable via injectBranding and must not be theme-scoped",
  );
});

test("derived accent tokens are computed from --brand-accent", () => {
  const light = block(":root");
  for (const token of ["--brand-accent-hi", "--brand-gradient"]) {
    const decl = light.match(new RegExp(`${token}\\s*:([^;]+);`));
    assert.ok(decl, `${token} not defined in :root`);
    assert.match(decl[1], /var\(--brand-accent/, `${token} must derive from --brand-accent`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="Bold Signal|brand-accent|derived accent"`
Expected: FAIL — `no ".dark {" block in shell.css`

- [ ] **Step 3: Write the token layer**

Replace `src/shell.css:3-14` (the existing `:root` block) with:

```css
:root {
  --app-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --sidebar-w: 280px;
  --content-w: 820px;
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --chat-pad: 22px;
  --brand-accent: #f97316;
  --dev-accent: #8a5a00;
  --brand-mark: "A";
  --brand-accent-hi: color-mix(in srgb, var(--brand-accent) 76%, #ffffff);
  --brand-accent-fg: #ffffff;
  --brand-gradient: linear-gradient(135deg, var(--brand-accent), var(--brand-accent-hi));
  --brand-accent-text: color-mix(in srgb, var(--brand-accent) 80%, #000000);
  --brand-rail: #0f172a;
  --brand-rail-fg: #e2e8f0;
  --brand-rail-muted: #7c8ba1;
  --brand-rail-active-bg: #1e293b;
  --canvas-wash: radial-gradient(circle at 100% 0%, #fff7ed 0%, var(--background) 45%);
  --chip-outline-border: #fdba74;
  --chip-outline-fg: var(--brand-accent-text);
}

.dark {
  --brand-accent-hi: color-mix(in srgb, var(--brand-accent) 82%, #ffffff);
  --brand-accent-fg: #1a1205;
  --brand-accent-text: color-mix(in srgb, var(--brand-accent) 62%, #ffffff);
  --brand-rail: #080d18;
  --brand-rail-fg: #e2e8f0;
  --brand-rail-muted: #64748b;
  --brand-rail-active-bg: #1e293b;
  --canvas-wash: radial-gradient(circle at 100% 0%, #1c1410 0%, var(--background) 45%);
  --chip-outline-border: #7c2d12;
  --chip-outline-fg: var(--brand-accent-text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="Bold Signal|brand-accent|derived accent"`
Expected: PASS, 3 tests

- [ ] **Step 5: Run the existing css-vars test for regressions**

Run: `npm test -- --test-name-pattern="var\(\) in shell.css"`
Expected: PASS — no `var()` reference is left undefined

- [ ] **Step 6: Commit**

```bash
git add plugins/web-ui/src/shell.css plugins/web-ui/test/bold-signal-tokens.test.ts
git commit -m "Add Bold Signal light and dark token layer

shell.css previously defined its app tokens under :root only, so the
brand accent and rail colours were wrong in dark mode even though the
app ships a theme toggle. Derived accent tokens are computed from
--brand-accent so org branding injected at render time still cascades."
```

---

### Task 2: Navy sidebar rail

**Files:**
- Modify: `plugins/web-ui/src/shell.css:43` (`.sidebar`), `:147` (`.brand-mark`), `:164` (`.brand-name`)
- Test: `plugins/web-ui/test/bold-signal-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/bold-signal-tokens.test.ts`:

```ts
const OWNED = [".sidebar", ".brand-mark", ".composer-wrap", ".send-btn"];

test("phase 1 surfaces use tokens, never colour literals", () => {
  const offenders: string[] = [];
  for (const selector of OWNED) {
    const body = block(selector);
    for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) offenders.push(`${selector}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], "hard-coded colours in phase 1 surfaces");
});

test("the sidebar renders the navy rail", () => {
  assert.match(block(".sidebar"), /background:\s*var\(--brand-rail\)/);
});

test("the brand mark uses the accent gradient and keeps the configurable mark", () => {
  assert.match(block(".brand-mark"), /background:\s*var\(--brand-gradient\)/);
  assert.match(shellCss, /\.brand-mark::before\s*\{\s*content:\s*var\(--brand-mark\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="navy rail|brand mark|colour literals"`
Expected: FAIL — `.sidebar` still uses `color-mix(... var(--secondary) ...)`

- [ ] **Step 3: Restyle the sidebar**

In `src/shell.css`, change the `background` declaration inside `.sidebar` (line ~52) from
`background: color-mix(in srgb, var(--secondary) 42%, var(--background));` to:

```css
  background: var(--brand-rail);
  color: var(--brand-rail-fg);
```

Leave every other `.sidebar` declaration — width, padding, `transition`, and the
collapse arithmetic — exactly as-is.

In `.brand-mark` (line ~147) change `background: var(--brand-accent);` to
`background: var(--brand-gradient);` and change `color: white;` to
`color: var(--brand-accent-fg);`. Leave `.brand-mark::before` untouched.

In `.brand-name` (line ~164) change `color: var(--foreground);` to
`color: var(--brand-rail-fg);`.

Append these rules immediately after the `.brand-name` block:

```css
.sidebar .list-item {
  color: var(--brand-rail-muted);
  border-radius: var(--radius-sm);
}
.sidebar .list-item:hover {
  color: var(--brand-rail-fg);
  background: color-mix(in srgb, var(--brand-rail-active-bg) 60%, transparent);
}
.sidebar .list-item.active {
  color: var(--brand-rail-fg);
  background: var(--brand-rail-active-bg);
}
.sidebar .list-item.active svg {
  color: var(--brand-accent);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="navy rail|brand mark|colour literals"`
Expected: PASS, 3 tests

- [ ] **Step 5: Confirm the active-item class name is real**

Run: `grep -nE "list-item|class=\"[^\"]*active" src/sessions.ts src/list-page.ts | head -20`
Expected: at least one hit showing `list-item` and an `active` modifier. **If the class
names differ, update the four rules added in Step 3 to the real names and re-run Step 4.**
Do not leave rules targeting classes that are never rendered.

- [ ] **Step 6: Commit**

```bash
git add plugins/web-ui/src/shell.css plugins/web-ui/test/bold-signal-tokens.test.ts
git commit -m "Restyle the sidebar as the Bold Signal navy rail"
```

---

### Task 3: Composer accent and canvas wash

**Files:**
- Modify: `plugins/web-ui/src/shell.css:2016` (`.composer-wrap`), `:2380` (`.send-btn`), `:1088` (`.message-row` area)
- Test: `plugins/web-ui/test/bold-signal-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/bold-signal-tokens.test.ts`:

```ts
test("the composer uses the shared radius and an accent focus ring", () => {
  assert.match(block(".composer-wrap"), /border-radius:\s*var\(--radius-md\)/);
  assert.match(shellCss, /\.composer-wrap:focus-within\s*\{[^}]*var\(--brand-accent\)/);
});

test("the send button uses the accent gradient", () => {
  assert.match(block(".send-btn"), /background:\s*var\(--brand-gradient\)/);
});

test("the canvas wash is applied, not merely defined", () => {
  assert.match(shellCss, /background(?:-image)?:\s*var\(--canvas-wash\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="composer uses|send button"`
Expected: FAIL — `.composer-wrap` is `border-radius: 24px`

- [ ] **Step 3: Restyle the composer**

In `.composer-wrap` (line ~2016) change `border-radius: 24px;` to
`border-radius: var(--radius-md);`. Leave the width, padding, border, and box-shadow
declarations unchanged.

Add immediately after the `.composer-wrap` block:

```css
.composer-wrap:focus-within {
  border-color: var(--brand-accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--brand-accent) 18%, transparent),
    0 12px 28px color-mix(in srgb, var(--foreground) 7%, transparent);
}
```

In `.send-btn` (line ~2380) change `background: var(--foreground);` to
`background: var(--brand-gradient);` and `color: var(--background);` to
`color: var(--brand-accent-fg);`.

In `.send-btn:focus-visible` (line ~2396) change the outline colour from
`color-mix(in srgb, var(--foreground) 35%, transparent)` to
`color-mix(in srgb, var(--brand-accent) 60%, transparent)`.

- [ ] **Step 4: Apply the canvas wash to the thread pane**

Find the scrolling thread container that holds `.message-row` (search
`grep -n "message-list\|chat-scroll\|thread" src/shell.css | head`). Add
`background: var(--canvas-wash);` to that container's rule.

If no single container rule exists, add the wash to `.custom-chat-shell` instead. The
requirement is that the warm top-right gradient appears behind the thread and nowhere
else — it must not tint the sidebar.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="composer uses|send button|canvas wash|colour literals"`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add plugins/web-ui/src/shell.css plugins/web-ui/test/bold-signal-tokens.test.ts
git commit -m "Give the composer the Bold Signal accent treatment and wash the thread canvas"
```

---

### Task 4: Finding templates

**Files:**
- Create: `plugins/web-ui/src/finding.ts`
- Test: `plugins/web-ui/test/finding.test.ts`

The empty case is the case that actually ships — nothing populates a finding until the H0
retrieval layer exists — so it is tested first and most thoroughly.

- [ ] **Step 1: Write the failing test**

Create `test/finding.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { render } from "lit";

const dom = new JSDOM("<!doctype html><body></body>");
globalThis.document = dom.window.document as unknown as Document;
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { findingHeader, findingCitations } = await import("../src/finding.ts");

function draw(tpl: unknown): HTMLElement {
  const host = dom.window.document.createElement("div");
  render(tpl as never, host);
  return host;
}

test("an absent finding renders nothing at all", () => {
  assert.equal(draw(findingHeader(undefined)).textContent?.trim(), "");
  assert.equal(draw(findingCitations(undefined)).textContent?.trim(), "");
});

test("an empty finding object renders no containers", () => {
  const host = draw(findingHeader({}));
  assert.equal(host.querySelector(".finding-head"), null);
});

test("a finding with only citations renders no header", () => {
  const host = draw(findingHeader({ citations: [{ label: "Zendesk #4471" }] }));
  assert.equal(host.querySelector(".finding-head"), null);
});

test("eyebrow and headline render independently", () => {
  const onlyEyebrow = draw(findingHeader({ eyebrow: "ACME" }));
  assert.equal(onlyEyebrow.querySelector(".finding-eyebrow")?.textContent, "ACME");
  assert.equal(onlyEyebrow.querySelector(".finding-headline"), null);

  const onlyHeadline = draw(findingHeader({ headline: "High risk" }));
  assert.equal(onlyHeadline.querySelector(".finding-headline")?.textContent, "High risk");
  assert.equal(onlyHeadline.querySelector(".finding-eyebrow"), null);
});

test("citations render as chips, first filled and the rest outlined", () => {
  const host = draw(
    findingCitations({ citations: [{ label: "Zendesk #4471" }, { label: "#incidents" }] }),
  );
  const chips = [...host.querySelectorAll(".finding-chip")];
  assert.equal(chips.length, 2);
  assert.ok(chips[0].classList.contains("filled"));
  assert.ok(chips[1].classList.contains("outlined"));
});

test("a citation with an href renders a link, one without renders a span", () => {
  const host = draw(
    findingCitations({ citations: [{ label: "A", href: "https://example.com" }, { label: "B" }] }),
  );
  const chips = [...host.querySelectorAll(".finding-chip")];
  assert.equal(chips[0].tagName, "A");
  assert.equal(chips[0].getAttribute("href"), "https://example.com");
  assert.equal(chips[1].tagName, "SPAN");
});

test("an empty citations array renders no chip row", () => {
  assert.equal(draw(findingCitations({ citations: [] })).querySelector(".finding-chips"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/finding.test.ts`
Expected: FAIL — cannot resolve `../src/finding.ts`

- [ ] **Step 3: Write the implementation**

Create `src/finding.ts`:

```ts
import { html, nothing, type TemplateResult } from "lit";

export interface Citation {
  label: string;
  href?: string;
}

export interface Finding {
  eyebrow?: string;
  headline?: string;
  citations?: Citation[];
}

export function findingHeader(finding: Finding | undefined): TemplateResult | typeof nothing {
  const eyebrow = finding?.eyebrow?.trim();
  const headline = finding?.headline?.trim();
  if (!eyebrow && !headline) return nothing;
  return html`
    <div class="finding-head">
      ${eyebrow ? html`<div class="finding-eyebrow">${eyebrow}</div>` : nothing}
      ${headline ? html`<div class="finding-headline">${headline}</div>` : nothing}
    </div>
  `;
}

export function findingCitations(finding: Finding | undefined): TemplateResult | typeof nothing {
  const citations = finding?.citations?.filter((c) => c.label.trim()) ?? [];
  if (!citations.length) return nothing;
  return html`
    <div class="finding-chips">
      ${citations.map((c, i) =>
        c.href
          ? html`<a
              class="finding-chip ${i === 0 ? "filled" : "outlined"}"
              href=${c.href}
              target="_blank"
              rel="noreferrer noopener"
              >${c.label}</a
            >`
          : html`<span class="finding-chip ${i === 0 ? "filled" : "outlined"}">${c.label}</span>`,
      )}
    </div>
  `;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/finding.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Add the chip and headline styles**

Append to the end of `src/shell.css`:

```css
.finding-head {
  margin-bottom: 10px;
}
.finding-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--brand-accent-text);
  margin-bottom: 4px;
}
.finding-headline {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--foreground);
}
.finding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.finding-chip {
  font-size: 11px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 999px;
  text-decoration: none;
}
.finding-chip.filled {
  background: var(--brand-gradient);
  color: var(--brand-accent-fg);
}
.finding-chip.outlined {
  border: 1px solid var(--chip-outline-border);
  color: var(--chip-outline-fg);
}
```

Chip text is 11px rather than the 9px in the mockup because 9px cannot meet the 4.5:1
contrast requirement at the small-text threshold. Task 6 may adjust the fill.

- [ ] **Step 6: Run typecheck and the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass

- [ ] **Step 7: Commit**

```bash
git add plugins/web-ui/src/finding.ts plugins/web-ui/src/shell.css plugins/web-ui/test/finding.test.ts
git commit -m "Add finding eyebrow, headline, and citation chip templates

Every part is optional and absent by default; nothing populates a
finding until the retrieval layer lands, so the no-finding path is the
one that ships today and renders exactly as before."
```

---

### Task 5: Mount findings in the assistant row

**Files:**
- Modify: `plugins/web-ui/src/chat.ts:1025-1049`
- Test: `plugins/web-ui/test/finding.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/finding.test.ts`:

```ts
test("chat.ts mounts both finding templates inside the assistant body", async () => {
  const { readFileSync } = await import("node:fs");
  const chat = readFileSync(new URL("../src/chat.ts", import.meta.url), "utf8");
  assert.match(chat, /import \{[^}]*findingHeader[^}]*\} from "\.\/finding"/);
  const body = chat.slice(chat.indexOf('<div class="assistant-body">'));
  const head = body.indexOf("findingHeader(");
  const chips = body.indexOf("findingCitations(");
  assert.ok(head !== -1, "findingHeader not rendered in the assistant body");
  assert.ok(chips !== -1, "findingCitations not rendered in the assistant body");
  assert.ok(head < chips, "the header must render above the citation chips");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="mounts both finding templates"`
Expected: FAIL — `findingHeader not rendered in the assistant body`

- [ ] **Step 3: Wire the templates in**

Add to the imports at the top of `src/chat.ts`:

```ts
import { findingCitations, findingHeader, type Finding } from "./finding";
```

In the `role === "assistant"` branch, add this line immediately after the
`const deliveredFiles = …` line (~1031):

```ts
    const finding = (msg as { finding?: Finding }).finding;
```

Then replace the `<div class="assistant-body">` contents (lines ~1040-1046) with:

```ts
        <div class="assistant-body">
          ${findingHeader(finding)}
          ${showWork ? workBlock(work, isStreaming) : nothing} ${assistantContent(msg, isStreaming, showWork)}
          ${findingCitations(finding)}
          ${assistantFileList(deliveredFiles)}
          ${msg.stopReason === "error" && msg.errorMessage ? html`<div class="composer-error inline">${msg.errorMessage}</div>` : nothing}
          ${msg.stopReason === "aborted" ? html`<div class="stopped-note">${icon(Ban, 13)}<span>Stopped</span></div>` : nothing}
          ${isStreaming ? nothing : messageMeta(msg, index)}
        </div>
```

Leave the `hasVisibleContent` guard above it unchanged. A finding never makes an otherwise
empty message render, because a finding cannot exist without message content.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/finding.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Run typecheck and the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass

- [ ] **Step 6: Commit**

```bash
git add plugins/web-ui/src/chat.ts plugins/web-ui/test/finding.test.ts
git commit -m "Render finding header and citations in the assistant row"
```

---

### Task 6: Measure and fix contrast

The spec states these values are starting points, not verified results. This task measures
them and adjusts. Do not skip it — the white-on-orange pairing is expected to fail.

**Files:**
- Modify: `plugins/web-ui/src/shell.css` (token values only)

- [ ] **Step 1: Write the contrast checker**

Create `/private/tmp/claude-501/-Users-dj-company-brain/b667f4c8-0cd5-4ba0-abef-72c384fb191f/scratchpad/contrast.mjs`:

```js
const lum = (hex) => {
  const n = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
for (const [name, fg, bg, min] of [
  ["chip filled text on accent", "#ffffff", "#f97316", 4.5],
  ["accent text on white canvas", "#c2410c", "#ffffff", 4.5],
  ["rail muted on rail", "#7c8ba1", "#0f172a", 4.5],
  ["rail fg on rail", "#e2e8f0", "#0f172a", 4.5],
  ["chip outline text on white", "#c2410c", "#ffffff", 4.5],
]) {
  const r = ratio(fg, bg);
  console.log(`${r >= min ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  (need ${min})  ${name}`);
}
```

- [ ] **Step 2: Run it**

Run: `node /private/tmp/claude-501/-Users-dj-company-brain/b667f4c8-0cd5-4ba0-abef-72c384fb191f/scratchpad/contrast.mjs`
Expected: `chip filled text on accent` **FAILS** at roughly 2.9:1.

- [ ] **Step 3: Fix every failing pairing**

For each FAIL, darken the background or lighten the foreground token in `shell.css` and
re-run until all pass. For the expected chip failure, change the light-theme
`--brand-accent-fg` from `#ffffff` to a dark value that passes against the accent, for
example:

```css
  --brand-accent-fg: #2a1206;
```

Re-run the checker with the new value substituted. Repeat until every line reads PASS.

Note the derived tokens use `color-mix()`, which the checker cannot evaluate. For those,
compute the resolved colour in the browser first:

```js
getComputedStyle(document.documentElement).getPropertyValue("--brand-accent-text")
```

Run that in the browser console at http://localhost:8129, convert the result to hex, and
feed it to the checker.

- [ ] **Step 4: Re-run the token tests**

Run: `npm test -- test/bold-signal-tokens.test.ts`
Expected: PASS — token changes must not break the pairing or no-literal rules

- [ ] **Step 5: Commit**

```bash
git add plugins/web-ui/src/shell.css
git commit -m "Adjust Bold Signal tokens to meet WCAG AA contrast"
```

---

### Task 7: Verify in the running instance

Static tests cannot catch a broken layout. This task is the real acceptance gate.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Confirm the stack is up**

Run: `for p in 8081 8097 8113 8129; do printf "%s: " "$p"; curl -s -o /dev/null -w "%{http_code}\n" -m 3 "http://localhost:$p/"; done`
Expected: `8081: 401`, and `200` for 8097, 8113, 8129.

If they are down, re-run the manual boot:
`bash /private/tmp/claude-501/-Users-dj-company-brain/b667f4c8-0cd5-4ba0-abef-72c384fb191f/scratchpad/boot-noslack.sh`

- [ ] **Step 2: Rebuild the web UI**

Run: `npm run build`
Expected: vite build completes with no errors.

- [ ] **Step 3: Check the inherited panels before judging the hero surfaces**

Open http://localhost:8129 and visit, in the sidebar, each of: files, memory, connectors,
skills, crons, sessions. Confirm none has unreadable text, an invisible control, or a
colour that clashes with the navy rail.

**This is the step that catches the main risk of the whole plan** — a token change reaches
every panel, including the ones phase 1 does not redesign. Any breakage here is a phase 1
bug, not a phase 2 deferral.

- [ ] **Step 4: Screenshot the hero surfaces in light mode**

Capture the sidebar, an assistant turn, and the focused composer at http://localhost:8129.

- [ ] **Step 5: Screenshot the same three in dark mode**

Toggle the theme with the existing `<theme-toggle>` control, then capture the same three.
Confirm the rail is deeper than the canvas and that accent text is legible.

- [ ] **Step 6: Verify the populated finding state**

Temporarily change the `const finding = …` line in `chat.ts` (~1032) to a literal:

```ts
    const finding: Finding | undefined = { eyebrow: "ACME · RENEWAL RISK", headline: "High risk — usage down 40%", citations: [{ label: "Zendesk #4471" }, { label: "#incidents" }] };
```

Reload, screenshot the assistant row in both themes, then **revert the line** to:

```ts
    const finding = (msg as { finding?: Finding }).finding;
```

- [ ] **Step 7: Confirm the revert landed**

Run: `grep -n "const finding" src/chat.ts`
Expected: exactly one line, reading `const finding = (msg as { finding?: Finding }).finding;`
No literal fixture may remain.

- [ ] **Step 8: Full gate**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass

- [ ] **Step 9: Commit any fixes**

```bash
git add -A plugins/web-ui
git commit -m "Fix Bold Signal issues found in live verification"
```

If nothing needed fixing, skip this step rather than making an empty commit.

---

## Done when

- `:root` and `.dark` both define every themed token; `--brand-accent` appears in neither
  `.dark` nor any hard-coded hex in a phase 1 surface.
- Sidebar, composer, and assistant rows match Bold Signal in both themes.
- The no-finding path renders exactly as it did before, with no reserved space.
- Every contrast pairing measures at or above target.
- Deferred panels are visually intact.
- `npm run typecheck` and `npm test` pass.

Out of scope, tracked for phase 2: hand-finishing files, memory, connectors, skills, crons,
sessions list, deploy views, and dialogs. `plugins/admin` is out of scope for both phases.
