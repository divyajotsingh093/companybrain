# Company Brain product UI overhaul — stages 1-3

**Status:** approved 2026-09-20. Supersedes the phase-1 half of
[`2026-08-07-web-ui-bold-signal-design.md`](2026-08-07-web-ui-bold-signal-design.md), which stays
the reference for the Bold Signal visual direction and the finding component.

Direction **A — Bold Signal**: navy rail, bright canvas, one warm accent for decisions
([moodboards](https://claude.ai/artifact/XiTCji1S5UnyfdUHN1h7ra)). Stages 4 and 5 (Brain map,
Agents board inside the app, admin folded into the shell) get their own spec.

## The problem

Five front ends, each styled separately: the Lit web app (`plugins/web-ui`, one 6,706-line
stylesheet), a 14,144-line admin page with no dark mode, the portal's card pages, the magic-link
sign-in pages, and the board service. A new user is dropped into an empty chat where an onboarding
skill types at them; there is no first-run setup, no invite, and no screen that says what needs
them. Triggers, monitors and sandboxes have no UI at all.

## What we are copying, and from where

From Merge (docs.merge.dev, help.merge.dev): typed issues that resolve themselves, and connection repair that
keeps the same connection. From Runlayer (docs.runlayer.com): request-then-approve as the default path for members,
and activity split from audit. From [Sim](../analysis/sim.md): per-run traces. Sources and the
full list are in the research note for this spec's stage 2 and 3 items.

## Stage 1 — Design system and app shell

**Tokens** (`src/shell.css`, top block only). Three groups, defined in `:root` and overridden in
`.dark`, except `--brand-accent`, which stays org-configurable and is never defined in `.dark`:

- *Brand*: existing `--brand-accent*`, `--brand-rail*`, `--canvas-wash`, `--chip-outline-*`.
- *Surface*: `--surface-1/2/3`, `--surface-border`, `--surface-shadow`.
- *State*: `--state-ok`, `--state-warn`, `--state-danger`, `--state-info`, each with a `-wash`
  companion for backgrounds. State colour is never the accent: the accent means "a decision is
  yours", state means "this is how it is going".
- *Type*: `--text-xs` 12px through `--text-2xl` 28px, `--font-mono` for ids, times and counts.

No colour literal outside that block in any selector stages 1-3 touch. `test/bold-signal-tokens.test.ts`
is extended to assert each new token exists in both blocks, and that `--brand-accent` does not
appear in `.dark`.

**Navigation.** The single "Browse" group becomes a role-aware map, with the view list in
`shell-state.ts` extended for `home`:

| Group | Rows |
|---|---|
| (top) | Home |
| Work | Ask (today's Chats), Projects, Files |
| Build | Skills, Automations (today's Crons), Apps |
| (footer) | Settings (Keychain, Memory), Admin when the principal has it |

Each row keeps its current view id so deep links and `isView` stay valid; `chats` renders under the
label "Ask", `crons` under "Automations". Adding a row is data, not markup: one `NAV` array of
`{view, icon, label, group}`.

**Components** (`src/ui/`, one file each, each usable before its screen exists):
`page-header.ts` (title, description, actions), `card.ts`, `chip.ts` (tone: neutral | ok | warn |
danger | info | accent), `empty-state.ts` (icon, headline, one sentence, one action), `inbox-item.ts`
(type chip, title, time, primary action), `checklist.ts` (step, state, action).

## Stage 2 — Onboarding and Home

**Home** (`src/home.ts`, new view, the default landing view).

1. **Needs you.** Typed items, every one auto-resolving: it disappears when the condition clears,
   never when it is dismissed. Types in this stage: `approval_pending` (a run waiting on this
   principal), `connector_broken` (a connector that needs re-authorising), `automation_failing`
   (a cron whose last run failed), `setup_incomplete` (admins only, until setup is done).
   Each item names the object, says what happens next, and carries one action.
   Server aggregate: `GET /api/home` fans out to the routes that already exist (sessions and their
   approvals for the 20 most recent, crons, keychain overview) and returns one typed list; the
   fan-out is bounded and cached for 10 seconds per principal.
2. **Setup checklist** (admins, until complete): model provider, Slack, first source connected,
   first teammate invited. Each step links to where it is done and reports its own state from the
   same aggregate. It disappears when every step is done.
3. **Recent activity**: the last runs and board events, each with time, actor and outcome.

**Onboarding.** The chat-skill onboarding stays for conversational setup; what it cannot do is
carried by screens:

- *Member first run*: a welcome panel on Home — what the brain can see for you, connect your
  accounts, three suggested first questions. It clears once the member has asked anything.
- *Invites*: `POST /api/invites` (admin only) creates a signed, expiring invite link, listed and
  revocable. Accepting one signs the member in and lands them on Home. Invited addresses join the
  allowed-principals list; no invite widens anyone's grants, and nothing is granted by accepting.

**Empty and error states.** Every list screen gets an empty state with one action, and every
failure says what broke and what to do, from a fixed message list.

## Stage 3 — Existing screens on the new system

Ask (chats and the composer), Projects, Files, Skills, Automations, Keychain, Memory, Apps: the
same header, card, chip, table and empty-state components; no bespoke colours; dark mode correct
on each. Two behaviour changes carried from the research:

- **Keychain repairs in place.** A broken connector keeps its identity and its grants; the action
  is "Re-authorise", never "remove and add again". Its state (`ok`, `expired`, `revoked`,
  `unreachable`) is a chip on the card and the source of the `connector_broken` inbox item.
- **Automations show their last run**: state chip, when, and the failure reason when it failed.

Admin, portal and sign-in pages are stage 5 and stay as they are.

## Testing

Every stage ends with a functional pass on a local instance (core with `HARNESS=mock` plus the
web UI's dev sign-in), driven through the browser: sign in, walk the stage's flows, screenshot
each screen at 1440px and 375px, and check the console for errors. Unit tests follow the
plugin's existing style (`node --test` with jsdom, plus source and CSS assertions):

- Stage 1: token presence in both themes, nav map renders every row once, each component renders
  its states.
- Stage 2: the aggregate returns each item type, items clear when their condition clears, the
  checklist completes, invites are signed, expiring, revocable and grant nothing.
- Stage 3: each screen's empty state renders, connector states map to the right chip, no new
  colour literals.

## Constraints

- **Core code.** `plugins/web-ui` is upstream qm. This work is fork-only and re-merged on every
  `update-qm`; anything generic (the token layer, the components) is offered upstream with the
  `upstream-pr` skill. Nothing organisation-specific goes in: no Company Brain copy, no board URLs.
- **Permissions.** No screen may show what the principal cannot already read. Home's aggregate
  reuses the existing per-principal routes and adds no new authority.
- **Durability.** Invites and their state live in Postgres, never in process memory.
- **No new dependency** unless a stage's plan names it and says why.
