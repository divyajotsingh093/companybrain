# Web UI visual redesign — "Bold Signal", phase 1

Status: approved, not yet implemented
Date: 2026-08-07
Surface: `plugins/web-ui`

## Problem

The web UI is functional but visually templated. It renders on the stock
`@earendil-works/pi-web-ui` Tailwind/shadcn token set with a generic indigo accent
(`--brand-accent: #4f46e5`, `plugins/web-ui/src/shell.css:11`) and the default system
sans. Nothing about it reads as this product.

There is a second, concrete defect underneath the aesthetic one. The base library ships
light tokens on `:root` and dark tokens on `.dark`, and the app already mounts a
`<theme-toggle>` (`plugins/web-ui/src/shell.ts:475`). But `shell.css` defines its own
app-level tokens only under `:root` and has **no `.dark` overrides at all**. In dark mode
the base semantics flip while the brand tokens do not, so the app's own accent, rail, and
surface colours are wrong in one of the two themes it already ships.

## Decision

Adopt a visual direction called **Bold Signal**: a navy sidebar rail against a bright
canvas, an orange gradient accent replacing the generic indigo, and assistant answers
presented as headline findings rather than undifferentiated chat bubbles.

Delivered in two phases. **Phase 1 (this spec)** builds the full light/dark token system
and hand-finishes the three highest-visibility surfaces. **Phase 2 (separate spec)**
hand-finishes the remaining panels.

Phase 1 was chosen over a single full-coverage pass so there is something usable and
coherent to live with quickly. The token-first ordering is what makes that safe: deferred
panels inherit the new palette automatically rather than sitting in stale indigo, so the
intermediate state is consistent, not half-redesigned.

## Token architecture

All new tokens live in `plugins/web-ui/src/shell.css`, defined twice — once under `:root`
for light, once under `.dark` for dark. The existing `:root` block at `shell.css:3` is
extended; the `@import` of the base library at `shell.css:1` stays first.

**The governing rule: no colour literal may appear outside the token blocks.** Every rule
elsewhere in `shell.css`, and every component style, references a `var()`. This is the
mechanism that makes phase 2 cheap — deferred panels pick up the new look without being
touched.

Three token groups:

| Group | Tokens |
|---|---|
| Brand | `--brand-rail`, `--brand-rail-fg`, `--brand-rail-muted`, `--brand-rail-active-bg`, `--brand-accent`, `--brand-accent-hi`, `--brand-accent-fg`, `--brand-accent-text`, `--brand-gradient` |
| Canvas | `--canvas-wash`, `--surface-raised`, `--surface-border` |
| Chips | `--chip-outline-border`, `--chip-outline-fg` |

The filled chip has no tokens of its own — it reuses `--brand-gradient` for its background
and `--brand-accent-fg` for its text, because a filled chip and the send button are the
same treatment and should not be able to drift apart.

Proposed values — light:

```
--brand-rail:            #0f172a;
--brand-rail-fg:         #e2e8f0;
--brand-rail-muted:      #475569;
--brand-rail-active-bg:  #1e293b;
--brand-accent:          #f97316;
--brand-accent-hi:       #fb923c;
--brand-accent-fg:       #ffffff;
--brand-accent-text:     #c2410c;
--brand-gradient:        linear-gradient(135deg, #f97316, #fb923c);
--canvas-wash:           radial-gradient(circle at 100% 0%, #fff7ed 0%, #ffffff 45%);
--surface-raised:        #f8fafc;
--surface-border:        #e2e8f0;
--chip-outline-border:   #fdba74;
--chip-outline-fg:       #c2410c;
```

Dark:

```
--brand-rail:            #080d18;
--brand-rail-fg:         #e2e8f0;
--brand-rail-muted:      #64748b;
--brand-rail-active-bg:  #1e293b;
--brand-accent:          #f97316;
--brand-accent-hi:       #fb923c;
--brand-accent-fg:       #0f172a;
--brand-accent-text:     #fdba74;
--brand-gradient:        linear-gradient(135deg, #f97316, #fb923c);
--canvas-wash:           radial-gradient(circle at 100% 0%, #1c1410 0%, #101216 45%);
--surface-raised:        #171a20;
--surface-border:        #262b33;
--chip-outline-border:   #7c2d12;
--chip-outline-fg:       #fdba74;
```

Two things to note about the dark variant. First, `--brand-accent` stays the same for
*fills* while `--brand-accent-text` shifts much lighter — saturated orange text on a
near-black background does not reach readable contrast, so fills and text must not share a
token. Second, Bold Signal's identity is a dark rail against a bright canvas, which cannot
survive literally into dark mode; the dark variant preserves the *relationship* instead by
making the rail deeper than the canvas rather than lighter.

The base library's `--background` is a neutral near-black in dark mode. Phase 1 overrides
it to the navy-tinted `--canvas-wash` above so the rail and canvas belong to one palette
rather than reading as a blue panel pasted onto a grey app.

## Visual language

- **Rail** — `--brand-rail` background. Brand mark is a rounded square filled with
  `--brand-gradient`. The active nav item gets a `--brand-rail-active-bg` pill with an
  accent-coloured icon; inactive items sit at `--brand-rail-muted`. The collapsed rail
  keeps the navy treatment so the silhouette survives collapse.
- **Accent** — `--brand-gradient` for the brand mark, primary citation chip, and send
  button. Flat `--brand-accent` for focus rings and small indicators. Used sparingly:
  accent is a signal, not a theme.
- **Canvas** — `--canvas-wash` applied to the thread pane, warm in the top-right corner,
  resolving to flat background by ~45%.
- **Type** — the existing system sans stack (`--app-font`) is unchanged. Two new styles
  are added: an *eyebrow* (uppercase, ~10px, `0.05em` tracking, `--brand-accent-text`,
  600 weight) and a *finding headline* (~15px, 600 weight, `1.4` leading,
  `--foreground`).
- **Chips** — two variants. Filled uses `--brand-gradient` with `--chip-fill-fg`;
  outlined uses a `--chip-outline-border` hairline with `--chip-outline-fg` text. Both
  fully rounded, ~9px text.
- **Radii** — the existing `--radius-sm/md/lg` scale (8/10/16px) is kept. The composer
  moves from its current radius to `--radius-md`.

## Hero surfaces (phase 1 scope)

**Sidebar** — `plugins/web-ui/src/shell.ts`, `.sidebar` rules in `shell.css:43`+.
Navy rail, gradient brand mark, active-item pill, muted inactive items. The existing
collapse-to-rail behaviour and its width arithmetic are preserved exactly; only colour and
the active-state treatment change.

**Chat thread** — `plugins/web-ui/src/chat.ts`, `plugins/web-ui/src/timeline.ts`.
Assistant turns gain an optional three-part structure above and below the message body:

```
[eyebrow]           ACME · RENEWAL RISK
[finding headline]  High risk — usage down 40%
[body]              ...existing rendered markdown, unchanged...
[chip row]          (Zendesk #4471) (#incidents)
```

Each of the three added parts is independently optional. When a turn carries no finding
and no citations — which is every turn until the H0 retrieval layer exists — the component
renders exactly the current plain-markdown output with no empty containers, no reserved
space, and no layout shift.

**Composer** — `plugins/web-ui/src/composer.ts`. `--radius-md` corners, accent focus
ring, gradient send button. The existing model/effort/harness pickers keep their current
behaviour and layout.

## The finding-headline component

Built in phase 1 despite having no data source yet. The knowledge layer that will populate
it is H0 on the roadmap and does not exist; this is a deliberate decision to realise the
visual identity now and have the surface ready when retrieval lands.

Two constraints follow from that, and they are the whole risk of building it early:

1. **The empty case is the real case.** Until H0, every turn renders through the fallback
   path. The fallback is therefore the primary path and must be verified first — the
   populated variant is the special case.
2. **No speculative data contract.** The component takes an optional
   `{ eyebrow?, headline?, citations?: Array<{ label, href? }> }` and nothing more. It does
   not anticipate a retrieval response shape, confidence scores, staleness, or conflict
   surfacing. Those belong to H1 and inventing their contract now would be guessing.

A dev-only fixture is out of scope; the populated state is verified by temporarily passing
literal props during implementation, not by shipping demo data.

## Explicitly deferred to phase 2

`files`, `memory`, `connectors`, `skills`, `crons`, the sessions list, deploy views, and
dialogs. These inherit the new tokens and must be visually checked for regressions, but
receive no hand-finishing in phase 1. The admin surface (`plugins/admin`) is a separate
zero-dependency server-rendered app and is entirely out of scope for both phases.

## Accessibility

Contrast targets: **4.5:1** for body text, **3:1** for large text and UI boundaries
(WCAG AA). The pairings that need measuring, because they are the ones most likely to
fail, are:

- `--brand-accent-fg` on `--brand-accent` — white on orange-500 is around 3:1 and will
  likely fail for the small chip text; expect to darken the fill or drop chip text to a
  large-text size, and treat this as the most probable adjustment of the set
- `--brand-accent-text` on canvas, both themes
- `--brand-rail-muted` on `--brand-rail`
- `--chip-outline-fg` on canvas

These targets are stated as acceptance criteria, not as verified results. The proposed hex
values above are considered starting points and must be measured during implementation and
adjusted if they fall short.

Focus rings must remain visible in both themes; the accent ring is checked against the
rail as well as the canvas, since focusable items exist in both.

## Verification

Verified against the running local instance, not by inspection:

1. Token layer lands first. Confirm the deferred panels (files, memory, connectors,
   skills, crons) still render sanely in both themes before any hero component is touched.
2. Each hero surface screenshotted in light **and** dark via the existing
   `<theme-toggle>`.
3. Chat thread verified in the empty case first (no finding, no citations — the state that
   actually ships), then with literal props for the populated case.
4. Contrast pairings above measured, values adjusted if any miss target.
5. `npm run typecheck` and `npm run lint` in `plugins/web-ui` pass.

## Risks

`shell.css` is 6,682 lines and its rules are shared across every panel, including the ones
phase 1 is not redesigning. A token change is therefore not a local change — it reaches
everything. This is the reason for the ordering in Verification step 1: prove the
inherited surfaces survive the token swap before adding any new component styling on top.

The second risk is scope creep from the deferred list. Panels will look unfinished next to
the hand-finished hero surfaces, and the temptation will be to fix them inline. They are
phase 2 and get their own spec.

## Implementation note

Per `AGENTS.md`, new code in this repository carries **zero comments** — no explanatory
comments, docblocks, or TODOs. Rationale belongs in commit messages and in this document.
Existing comments in inherited upstream `shell.css` are left alone; nothing new is added.
