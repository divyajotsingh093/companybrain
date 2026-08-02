# qm — what it gives us, and what it doesn't

Source: [`divyajotsingh093/qm`](https://github.com/divyajotsingh093/qm) at `7f2c916`, read in full
on 2026-08-02. MIT licensed. Roughly 75,000 lines across 342 TypeScript files under `src/`.

qm describes itself as "a multiplayer agent harness for work. In Slack and on the web." That's
accurate and it undersells the engineering. It is the closest thing to a solved version of the
half of Company Brain we would otherwise have to build.

## The shape of it

The core runs TypeScript directly on Node with Fastify for HTTP. Every substrate — harness,
session store, sandbox, memory, ACL, credentials, files — sits behind an interface, and the
implementations are selected in a single 1,427-line wiring file, `src/wiring.ts`. In-memory,
Postgres, S3 and AWS variants sit side by side there. This is what makes qm extensible without
forking it, and it's the seam we'd use if we ever needed to go deeper than a tool call.

The agent gets a small fixed tool surface (`src/tools/primitives.ts`, ~1,070 lines) rather than an
open-ended plugin API. One of those tools is `execute`, which runs commands in the scope's own
durable sandbox — the scope's computer, where installed tools stay installed. Sandbox backends
are AWS microVMs, a local implementation and Sprites, behind `sandbox-router.ts`.

Model and harness choice is genuinely pluggable: `src/harness/` carries Claude Code, Codex,
OpenCode and Pi implementations plus a mock, behind `harness-router.ts`, with context compaction
and a replay facility for tests.

## The parts we want

**Scopes.** `src/types.ts` defines five scope kinds — `personal`, `channel`, `team`, `org`,
`group`. Everything else in the system is scoped by one of these: memory, files, credentials,
permissions, crons, sandboxes. This is the multiplayer primitive, and it's the right one. A
company brain needs exactly this distinction between what I know, what my team knows, and what
the company knows.

**Identity and credentials.** `src/identity/`, `src/credentials/` and `src/connectors/` handle
per-person OAuth, a connector token store, a service credential store, device-flow login, browser
sessions and consent links. For our purposes this matters enormously: to ingest a person's Drive
with their permissions intact, you need their credentials, refreshed, per-person, audited. qm has
that machinery already.

**The ACL grant store.** `src/acl/acl-store.ts` models access as grants —
`{ ownerScopeId, ref, granteeScopeId, permission }` — with audience-based lookup
(`handlesForAudience`) and compare-and-swap replacement. `src/reach/reach.ts` decides who the
agent may contact. Note the boundary carefully: this governs *qm's own* resources — skills,
files, shared handles. It does not model Google Drive's sharing lists or Confluence space
permissions. We need that second thing, and it's ours to build.

**Skills.** `src/skills/` is more developed than the name suggests: a skill store, pack store,
bundle store, a sync engine, a git pack fetcher, frontmatter parsing, collision handling and
materialization. `skills-seed/` ships eighteen working examples, including `memory`,
`google-workspace`, `google-drive-sheets`, `github-gitlab`, `email-voice-profile` and
`morning-digest`. Skills are scope-owned, shareable by grant, promotable org-wide by an admin,
and importable from git. For H2 — procedures written over the brain — this is done work.

**Security posture.** `src/security/security-posture.ts` defines three postures: `dangerous`,
`auto`, `strict`, ordered so narrower scopes can only tighten. `auto` runs a classifier over
provenance-labelled external data before it reaches the model, and the classifier prompt is
notably well thought through — it distinguishes business data from exfiltration, and treats
tool output as data rather than instruction. There's also secret masking and a predeclared
command policy (`src/policy/command-policy.ts`) that applies in every posture. When our brain
starts returning content pulled from email and shared documents, we inherit a real prompt
injection problem, and this is a serious answer to it.

**Background work.** `src/cron/`, `src/triggers/`, `src/monitors/`, `src/wake/` and `src/tasks/`
give us scheduled and event-driven runs. Incremental re-ingestion and H2's digests both land on
this rather than on something new.

**Surfaces.** `plugins/` carries the web UI, admin panel, portal, auth, onboarding and a chassis
as optional plugins over the core HTTP API; Slack is a separate in-process plugin under
`src/slack/` that the core starts and supervises. We get a Slack front door without building one.

**Lexical search over Slack, already.** `src/surface-cache/surface-cache.ts` (529 lines) caches
channel messages in a `channel_messages` table with a generated `tsv tsvector` column, a GIN
index on it, and a `search()` that ranks with `plainto_tsquery` and `ts_rank`, scoped by
`org_id`. This is a genuine full-text index over one source, and it's a useful precedent — the
lexical half of the hybrid retrieval in [`docs/architecture.md`](../architecture.md) looks very
much like this, applied to every source instead of one.

## The part that isn't there

qm has no organizational knowledge layer, and it isn't pretending to. Its memory is a notebook:

- `src/memory/memory-service.ts` stores one markdown file per scope, `memory/MEMORY.md`.
- `MAX_FACTS = 300`. Older bullets are dropped when the cap is exceeded.
- `RECALL_MAX_CHARS = 6_000`, and recall takes the *tail* of the file.
- `query()` is `queryBullets()`: lowercase the query, split on whitespace, and keep bullet lines
  containing every term as a literal substring. No ranking, no synonyms, no embeddings.

There are no embeddings and no vector similarity anywhere in qm. Grepping `src/` for `embedding`,
`pgvector` or `cosine` returns nothing; the only `vector` hits are the `tsvector` column noted
above and the phrase "token-leak vector" in a README. Semantic retrieval simply isn't part of the
system.

There are four capture strategies in `src/memory/strategies/` (`per-turn`, `scratch-promote`,
`consolidation`, `agent-only`), and the design has genuinely good ideas in it. The best is
`ccCaptureToPersonal`: a fact learned in a channel gets copied into the participant's personal
memory, tagged with where it came from and rewritten so the provenance survives
(`[claimed source: ...]`). That instinct — never let a fact travel without its origin — is
exactly right, and we should carry it into the corpus.

But 300 bullets of agent-written prose is not a company's knowledge. It's what the agent
remembered about you. Pointing it at a hundred thousand documents does not work, and no amount
of tuning the notebook gets there. The index, the chunking, the permission model, the freshness
handling and the evaluation are all missing, and they are the product.

## What we take

Reuse without modification: scopes, identity, credentials and connector OAuth, the sandbox,
skills, security postures and the classifier, crons and triggers, the Slack and web surfaces,
audit.

Build ourselves: ingestion, chunking, embedding, the index, source-system ACL capture and
resolution, retrieval ranking, citation handling, freshness, and retrieval evaluation.

Borrow as a pattern rather than as code: the substrate-behind-an-interface discipline in
`src/wiring.ts`, and the provenance-preserving instinct in `ccCaptureToPersonal`.

The consequence is [ADR-0001](../../adrs/0001-build-strategy.md) — we build the brain as a
separate service and deploy it into qm, rather than forking a mature 75k-line codebase to add
one subsystem.
