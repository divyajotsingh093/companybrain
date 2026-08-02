# ADR-0001 — Build the brain as a standalone service, not a qm fork

- **Status:** superseded by [ADR-0003](./0003-fork-qm.md)
- **Date:** 2026-08-02

> This ADR recommended against forking qm. The repository was forked from qm the same day. The
> reasoning below is preserved as written, including the LOC figure in _Context_, which counted
> only `src/` and missed roughly 43k lines of plugin and UI code — the omission that most directly
> undercut the recommendation. ADR-0003 records what changed.

## Context

Company Brain needs two things: a multiplayer agent harness, and an organizational knowledge
layer. [qm](https://github.com/divyajotsingh093/qm) already is the first — around 75,000 lines
across 342 TypeScript files, MIT licensed, with scopes, identity, per-person OAuth, a durable
sandbox, skills, crons, an ACL grant store, audit, and Slack and web surfaces. It has none of the
second: its memory is a 300-bullet markdown notebook per scope with substring search, and there
is no embedding or vector code anywhere in `src/`. Details in
[`docs/analysis/qm.md`](../docs/analysis/qm.md).

So the question isn't whether to use qm. It's how tightly to couple to it.

## Decision

Build the knowledge service as a standalone codebase in this repository, exposing HTTP and MCP,
and deploy it _into_ qm as a connector. Do not fork qm.

## Why

qm's substrates all sit behind interfaces selected in one file (`src/wiring.ts`, 1,427 lines),
which is what makes the fork tempting — adding a `KnowledgeService` there would be idiomatic and
small. But the retrieval problem is where all our risk and all our differentiation live, and it
benefits from being separable:

- **It has to be testable in isolation.** H1 is mostly evaluation: golden questions, ACL
  regression suites, ranking changes measured against a fixed corpus. Running that inside a
  75k-line harness, against live Slack and Drive, is materially harder than running it against a
  service with a mock source adapter.
- **MCP makes the same brain serve every surface.** qm, Claude Code, Cursor, and whatever people
  use next, with no per-surface work. This is Vortic's distribution insight applied internally:
  meet people in the tools they already have.
- **A fork is a permanent tax.** qm ships upstream changes; every merge is ours to resolve
  forever, in exchange for a coupling we haven't yet shown we need.
- **The boundary is a useful forcing function.** If the brain can only be reached through a
  narrow `search` / `fetch` interface, we can't quietly leak permission logic into the harness.

## Consequences

Accepted:

- Retrieval can't participate directly in constructing a turn — it's a tool the model chooses to
  call, not context injected before the model runs. If ranking depends on conversational state
  the tool call doesn't carry, quality suffers.
- One more network hop, one more deployable, one more set of credentials.
- The identity assertion crossing that boundary becomes security-critical. See
  [ADR-0002](./0002-permission-model.md) and the serving section of
  [`docs/architecture.md`](../docs/architecture.md).

Gained: independent testing and deployment, and no fork to maintain.

## Alternatives considered

**Private-clone fork of qm with a `KnowledgeService` substrate.** Deepest integration; retrieval
could shape the prompt directly. Rejected for now because the fork tax is permanent and the
integration depth is speculative. qm's README documents the plain-clone-not-GitHub-fork procedure
if we change our minds.

**qm deployment layer only** (`deploy/layers/<org>/`, sandbox tools and skills, no core changes).
Cleanest boundary of all, and effectively a weaker version of what we chose — the brain would
still be a separate service, just reachable only through the sandbox. Rejected because MCP gives
us the same isolation and also works outside qm.

**Greenfield, both halves.** Full control, and months spent rebuilding scopes, OAuth, sandboxing
and a Slack integration that already exist under a permissive licence. Rejected.

## Reversal path

If retrieval quality turns out to depend on turn context we can't get through a tool call, fork
qm by plain clone (never GitHub's fork button — it can't be made private), add `KnowledgeService`
alongside the existing substrates in `src/wiring.ts`, and keep this repository as the
implementation behind that interface. The service boundary we're building is the same shape as
the substrate interface would be, so most of the code survives the move. That's the point of
choosing this order.
