# Company Brain

Everyone in the organisation shares one agent, and that agent knows what the company knows —
without ever showing anyone a document they aren't allowed to see.

This repository holds the thesis, architecture and roadmap for that initiative, and — as of the
fork described in [`NOTICE`](./NOTICE) — the codebase we're building it on.

## The problem

Ask any company where a decision was made, why a customer churned, or what the current position
on some policy is, and the answer exists — spread across Drive, Slack, GitHub, Jira and a few
people's heads. Search finds documents when you already know what they're called. It doesn't
answer questions.

Agents should fix this, and mostly haven't, for two reasons that pull in opposite directions:

1. **Personal agents don't scale to a company.** Give each employee their own assistant and you
   get fifty disconnected assistants, fifty sets of credentials, and no shared understanding.
2. **Company-wide agents leak.** The moment one index serves everyone, someone's compensation
   review shows up in someone else's answer. Most "AI search over your company" products treat
   permissions as a filter bolted on afterwards. It isn't; it's the schema.

## What we found

We studied two existing codebases before starting. Full write-ups in
[`docs/analysis/`](./docs/analysis/).

[**qm**](https://github.com/divyajotsingh093/qm) is a multiplayer agent harness — roughly 117k
lines of application code: 74.8k in `src/`, 21.6k of plugin source, plus a 14k-line admin console
and a 6.7k-line stylesheet. Personal and shared scopes, Slack and web surfaces, a durable sandbox
per scope, skills, connectors, crons, an ACL grant store, an audit trail, and a security posture
model. 3,712 tests, green. It is the first half of the problem, largely solved, under MIT — and
it is now the base of this repository.

[**Vortic ContextLayer**](https://github.com/divyajotsingh093/vortic-contextlayer) is a
model-agnostic backend for MCP apps. Its real contribution to us is method rather than code: a
retrieval discipline (embed the intent, fetch top-K, keep the rest out of the model's context)
and a roadmap format we've copied wholesale.

The gap is the thing worth building. qm's memory is a single markdown file per scope —
`memory/MEMORY.md`, capped at 300 bullet facts, with `query()` implemented as literal substring
matching over bullet lines. It does have real full-text search, but over one source only: cached
Slack messages, via a `tsvector` column and a GIN index in `src/surface-cache/surface-cache.ts`.
There are no embeddings anywhere in it. A notebook plus a Slack index is not a company's
knowledge. Vortic, meanwhile, *does* run pgvector with HNSW cosine indexes — over
`mcp_tools.embedding`, to choose which tools to show the model. Right technique, different target.

Neither project has an organizational knowledge layer. That's our half.

## What we're building

A permission-aware knowledge service: ingest an organisation's real sources, keep each chunk
bound to the permissions of the system it came from, and answer questions with citations —
resolving permissions against the person asking, on every query.

We build it inside the forked harness rather than beside it. [ADR-0001](./adrs/0001-build-strategy.md)
argued the opposite — a standalone service over MCP — and is now superseded; it undercounted what
qm already ships, in particular a working web UI. Keeping the knowledge layer addressable over MCP
remains the goal, so it can also serve Claude Code and Cursor.

```
sources ──▶ ingest ──▶ chunk + embed ──▶ index (chunk + ACL together)
 Drive                                        │
 Slack                                        ▼
 GitHub          ask ──▶ resolve asker's identity ──▶ retrieve ──▶ cited answer
                                                     (filtered by ACL)
```

The one rule everything else bends around: **a chunk is only retrievable by someone the source
system would show it to.** Not filtered after ranking — excluded before it. See
[ADR-0002](./adrs/0002-permission-model.md).

## What we inherited

The core runs TypeScript directly on Node and uses Fastify for HTTP. The web UI, the admin panel
and the public portal are optional plugins over the core's HTTP API;
Slack is an optional in-process plugin that core starts
and supervises through a direct service client. The Slack plugin uses Bolt; the web UI builds with
Vite and renders with Lit, over a hand-written admin console that ships as a single HTML file.

None of this is the knowledge layer. It is the surface, identity, credential and scheduling
machinery that layer would otherwise need built from nothing —
[`docs/analysis/qm.md`](./docs/analysis/qm.md) breaks down what transfers and what doesn't. The
part we actually have to build, permission-scoped retrieval, is greenfield: qm carries no
embeddings, and its ACL grants are authored rather than mirrored from source systems.

## Repository map

| Path | What's in it |
|---|---|
| [`ROADMAP.md`](./ROADMAP.md) | Horizons H0–H3, principles, and the anti-roadmap |
| [`docs/architecture.md`](./docs/architecture.md) | Target architecture and how it attaches to qm |
| [`docs/analysis/qm.md`](./docs/analysis/qm.md) | What qm gives us, what it doesn't |
| [`docs/analysis/vortic-contextlayer.md`](./docs/analysis/vortic-contextlayer.md) | What to copy from Vortic, and what to leave |
| [`adrs/`](./adrs/) | Decisions, with their consequences and reversal paths |
| [`NOTICE`](./NOTICE) | What was inherited from qm, at which commit, and what wasn't |
| [`README.qm.md`](./README.qm.md) | qm's own README, preserved as it was upstream |
| `src/`, `plugins/`, `cli/`, `test/` | Inherited from qm; see `NOTICE` |

## Status

Forked, green, and not yet started on the actual product. The roadmap's H0 target is one team
asking questions in Slack and getting cited answers drawn only from what they can already read.

Running the tests needs Node ≥24 (the code runs TypeScript directly, no build) and a Postgres for
the full suite — without `DATABASE_URL` the Postgres-backed tests report as skipped rather than
failed, so CI without a database checks less than it appears to.

```
npm install
npm test                    # add --experimental-strip-types on Node 22
```

Three choices in these documents remain assumptions rather than settled decisions: docs before
code; internal dogfooding first with the repo public and MIT; Drive, Slack and GitHub as the first
three sources. A fourth — standalone service versus fork — was settled by forking.
