# ADR-0004 — Company Brain is governed skills, not search

- **Status:** proposed
- **Date:** 2026-08-07
- **Amends:** [ADR-0002](./0002-permission-model.md) (the model stands; its target widens), [`ROADMAP.md`](../ROADMAP.md) H0–H3

## Context

Four pieces of evidence, all post-dating the fork at `7f2c916`.

**1. YC formalised "Company Brain" as a category, and defined it as the opposite of our H0.**

Tom Blomfield's Summer 2026 Request for Startups asks for a system that pulls knowledge out of
every fragmented source, structures it, keeps it current, and turns it into an *executable skills
file for AI* — a living map of how a company actually works. The RFS is explicit about what it is
not: **not a company-wide search tool, and not a chatbot over documents.**

`ROADMAP.md` H0 is: ingest Drive/Slack/GitHub with native ACLs, chunk into Postgres+pgvector,
expose a retrieval API and an MCP `search`/`fetch` server, and return cited answers in Slack. That
is a company-wide search tool with a chatbot over it. We are six weeks from building the
explicitly disavowed artifact.

**2. The category is contested, including by open source from YC's own CEO.**

| Builder | What it is | Position |
|---|---|---|
| **GBrain** (Garry Tan, YC CEO) | MIT, TypeScript/Bun, Postgres+pgvector, markdown-in-git synced to Postgres, ships as an MCP server, **zero LLM calls** for graph extraction (pattern matching on wikilinks into typed edges), per-login scoped access with OAuth 2.1 | ~27.9k stars, 4.1k forks; production instance holds 146k pages, 24.5k people, 66 cron jobs; its BrainBench evals report graph-augmented retrieval beating vector-only RAG |
| **Hyper** (YC Spring 2026) | Self-maintaining knowledge graph over Notion, email, Slack, GitHub, Cursor and Claude Code sessions; infuses context into existing AI tools per chat turn | 2 people; $1k MRR and 50+ teams within 12 days of launch; paid pilots with Razorpay and Snorkel AI |
| **Memory Store** (YC S26) | "One memory for your team's agents" over meetings, Claude sessions, Slack | Founders previously built Julep AI |
| **Cerenovus / Savant** | Markdown knowledge graphs of workflows; undocumented procedures captured as agent skills | Pilots |
| **Sim** (YC, Apache 2.0 core) | Visual agent-workflow builder whose separate Search product checks source access per request, with per-user OAuth and an MCP server ([analysis](../docs/analysis/sim.md)) | ~29.7k stars; $7M Series A; permission-aware MCP retrieval is already shipping, so our edge is governed skills, approvals and multiplayer scope, not search |

Above them sit the scaled incumbents already surveyed: Glean (~$300M ARR), Dust ($40M Series B),
Engram ($98M Series A).

**3. A convergent architecture has emerged.** Independently, Karpathy, Tan, DoorDash and Ramp
arrived at the same five layers: a central plain-text store, a routing/resolver layer, **skills as
the unit of capability**, write-back discipline so answers become filed knowledge, and
context–compute separation so the substrate survives model swaps.

**4. Every builder hits the same wall.** The gaps reported across all of them are consistent:
enterprise permissions at the semantic level, staleness tracking, auditability and determinism,
and — named explicitly — human approval workflows, which remain "not yet a clean workflow."

## The observation that decides this

**We forked the wall everyone else hit.**

qm already ships per-scope sandboxes, an ACL grant store, an audit trail, a security-posture model,
an audited egress proxy, human approvals wired through the orchestrator, a skill registry with
authoring and review surfaces, crons, and Slack, web and admin surfaces.

Every one of those is on the "unsolved" list for Hyper, GBrain, Memory Store and the rest. And the
part we planned to spend H0 building — the knowledge substrate — is the part GBrain published under
MIT, in our language, on our database, behind our intended MCP boundary, with retrieval evals
showing it beats the vector-only approach `docs/architecture.md` specifies.

We planned to build the commodity half from scratch and skip the half we already own.

Note the contrast with the Onyx evaluation, which was rejected because its permission-sync
connectors sit under an Enterprise licence. GBrain's per-login scoping is inside the MIT grant.
The blocker that killed Onyx does not apply here.

## Decision

**1. The output artifact is a skill, not an answer.** Company Brain produces executable,
permission-scoped, approval-gated skills that do work — and files what it learns back. Cited
answers remain a surface, not the product.

**2. Do not build the retrieval substrate from scratch.** Evaluate GBrain as the knowledge
substrate before writing a chunker or an embedder. This is a spike with a kill criterion, not a
commitment (see H0.1).

**3. ADR-0002 stands; its target widens.** The rule — capture permissions at ingest, enforce as a
predicate rather than a post-filter, default-deny unknown ACLs, re-verify before the model sees
anything — is unchanged and remains correct. What it governs grows from *which chunks may reach
the model* to *which knowledge may reach the model, and which actions this principal may take with
it.* Retrieval permissions and action permissions become one model, because they are one question.

**4. The differentiator is governed action.** Not better retrieval. Retrieval is now commodity
and open source; governed action is the wall.

## Revised roadmap

### H0 — The governed skills loop (~6 weeks, replaces the search H0)

The loop, end to end, for **one** workflow: collect context → decide → act → file the decision.

- **H0.1 GBrain substrate spike (1 week, kill criterion).** Run GBrain against real data. Drive
  its MCP server from qm as a connector. Answer one question: *can its per-login scoping be driven
  by qm's ACL grant store as the authority, rather than its own login model?* If yes, adopt. If no,
  fork it and replace its auth layer — still cheaper than building a substrate. If its graph
  extraction proves unusable on our sources, fall back to `docs/architecture.md` as written. Do not
  proceed past this week without an answer.
- **H0.2 Permission bridge.** qm's grant store becomes the single authority for both knowledge and
  action. ADR-0002's predicate rule applied to graph traversal, not just chunk filtering — an edge
  the principal may not traverse must not be traversable, not merely hidden after the fact.
  This is the load-bearing piece and the thing no competitor has.
- **H0.3 Skill synthesis.** A recurring answered question becomes a proposed skill: parameterised,
  reviewable, version-controlled, stored in the existing skill registry. This is the RFS's
  "executable skills file," and qm already has the registry, the editor and the review surface.
- **H0.4 Approval-gated execution.** Wire skill execution through qm's existing approval and
  sandbox path. The named unsolved problem across the field, already built here.
- **H0.5 Write-back.** Turn outcomes back into filed knowledge so the loop compounds.

### H1 — The trust surface

The colrows critique of this whole field is that everyone solves ~40% and none address
determinism, lineage or auditability. That critique is H1's specification.

- Staleness and permission-drift detection (already H1; now the headline, not a line item).
- Provenance rendered in the UI: what knowledge was used, why, how fresh, who approved. The
  finding-headline and citation-chip components specced in the Bold Signal redesign are exactly
  this surface — built for it before we knew it was the wedge.
- Conflict surfacing and calibrated abstention.
- Deterministic definitions: a metric means one thing, versioned, not re-inferred per query.
- An eval harness in CI, BrainBench-style, over golden questions **and** golden actions.

### H2 — Skills as the product

Ramp's pattern: the skills are the product of enablement, not a byproduct. A shared, governed skill
library with discoverability (the resolver layer), usage telemetry, and org-scoped sharing through
the existing grant store.

### H3 — Organisational memory

Entity resolution, decision memory, cross-source graph, enterprise governance. Unchanged from the
current roadmap.

### Anti-roadmap additions

The existing anti-roadmap stands. Add: **do not build a knowledge graph or retrieval substrate
from scratch** — the same reasoning that ruled out building another agent harness now rules out
building another memory layer. GBrain is MIT and 27.9k stars ahead of us.

## Consequences

The `docs/architecture.md` ingest→chunk→embed→pgvector pipeline is suspended pending the H0.1
spike, not deleted. If the spike fails, it is the fallback and the roadmap reverts to search-first.

This trades a defensible-sounding six weeks of building for one week of integration risk. That is
the right trade only because the six weeks were building a commodity into a market with an
MIT-licensed leader and three funded startups.

The positioning changes from "permission-aware search over company knowledge" — which Glean and
Onyx both already claim — to "the governed layer where company knowledge becomes work that is
allowed to happen." That claim is currently unmade, and we hold most of the parts.
