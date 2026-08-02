# Vortic ContextLayer — what to copy, what to leave

Source: [`divyajotsingh093/vortic-contextlayer`](https://github.com/divyajotsingh093/vortic-contextlayer)
at `9e92a08`, read on 2026-08-02. Next.js 16 App Router, React 19, Vercel AI SDK v6, OpenRouter
for model access, Supabase (Postgres + pgvector + Auth + RLS + Vault), MCP over the official SDK.

Vortic sells "the model-agnostic backend for conversation-over-MCP apps": point a chat box at a
_box_ of MCP servers, declare high-level **actions** (a name plus an input/output contract), and
the model decides how while ContextLayer does the wiring — calls, context, sessions, secrets,
traces.

It is a different product from Company Brain. Its value to us is mostly method, and the method is
unusually good. Six dated documents in `plans/` record how the positioning was reasoned out, and
they're worth reading directly.

## The schema, briefly

`supabase/migrations/0001_init.sql` defines `orgs`, `org_members`, `mcp_servers`, `mcp_tools`,
`boxes`, `box_servers`, `actions`, `context_store`, `runs`, `run_steps`, `api_keys`, `eval_cases`,
`eval_results`. Row-level security is on for every table, scoped through a `current_org_ids()`
function.

Two columns carry embeddings, and which two is the whole point:

- `mcp_tools.embedding vector(1536)`, with `create index on mcp_tools using hnsw (embedding
vector_cosine_ops)` — used to embed the user's intent and retrieve the top-K _tools_, so a
  thousand tool definitions never enter the model's context.
- `context_store.embedding vector(1536)` — per-box knowledge, but shaped as a keyed KV store
  (`unique (box_id, key)`), not a chunked document corpus.

So Vortic has the retrieval machinery we need, applied to a different object. Nothing here is a
document index with source permissions attached. We'd be writing that either way.

## What we're taking

**The roadmap format.** `plans/2026-06-29-roadmap-v2.md` is the strongest artifact in either
repository: a vision paragraph, a list of principles earned from a specific build sprint, then
horizons H0–H3 where each carries both a duration and a one-line theme ("survive Hacker News",
"credible for teams", "platform", "category-defining"), then an explicit anti-roadmap, then a
single "immediate next". Our [`ROADMAP.md`](../../ROADMAP.md) copies this structure directly.

**"Buy the commodity, build the wedge."** From `plans/2026-06-26-feature-roadmap.md`: name the
things every competitor has and integrate them (SSO via WorkOS, billing via Stripe, compliance
via Vanta), then name the one thing to build deeply. For Vortic that was MCP-native governance.
For us it's permission-aware organizational retrieval. Everything else — Postgres, pgvector,
embedding models, OAuth, the harness — is bought or borrowed.

**Retrieval as a context-budget discipline.** Vortic's first stated principle is "smart by default
beats a toggle": the gateway is `discover + execute`, and it never dumps a thousand tools into
context. The same logic governs documents more strongly. A brain that stuffs twenty documents
into every prompt is a slow, expensive search box that also hallucinates.

**Evaluation as schema, not a script.** `eval_cases` and `eval_results` are tables, and the
roadmap keeps returning to "eval-in-CI with golden-trace regression gates and a calibrated
LLM-judge". Their honest note — only about half of teams have real evals — is the reason H1 of
our roadmap is mostly evaluation. Retrieval quality decays silently.

**`runs` / `run_steps` as the trace model.** Every run and step recorded, doubling as
observability, audit and eval corpus. We want exactly this shape for retrieval traces: what was
retrieved, what the permission filter removed, what reached the prompt.

**Ports and adapters so the core is testable offline.** `plans/2026-06-24-ai-first-frontend-onboarding-v1.md`
introduces `McpPort`, `LlmPort`, `RunStore` and a `MockMcp` adapter specifically so the planner
can be tested without live MCP servers. The parallel for us is direct and important: retrieval
must be testable against a fixed corpus with no live Drive or Slack, or the eval suite in H1 is
unbuildable.

**Structured output with a strict schema and a repair step**, always previewing before creating.
Listed there as a mitigation against unreliable scaffolding on a weak model. Good discipline for
anything we extract from documents — decisions, entities, dates.

**Plans that carry risks and rejected alternatives.** Each Vortic plan ends with named risks and
their mitigations, plus the approaches considered and dropped and why. Our ADRs follow that.

**"The chat is an entry, not the product."** Written as a mitigation against building a thin
wrapper on the model. Our version: the corpus and the permission model are the product; Slack is
a door.

## What we're leaving

**The growth machinery.** The public directory, 156 indexed server pages, `llms.txt`, blog, SEO
and AEO surfaces, the no-login playground, the template gallery, shareable public links and embed
widgets. All of it is a top-of-funnel answer to a distribution problem an internal company brain
doesn't have. If Company Brain ever goes external, come back to `plans/2026-06-25-master-plan-features-ux-onboarding.md`,
which is a good playbook — just not one we need now.

**The vocabulary.** "Boxes", "neurons", "flock". Invented terms cost every new reader something
and buy nothing here. We say sources, chunks and permissions.

**The connector breadth race.** Vortic tracks 156 connectable remote MCP servers against a
universe of roughly 190 and treats the count as a competitive metric. We need three sources that
work, with their permissions intact, which is a harder and narrower problem.

**Out-planning the model.** Their anti-roadmap says intent, plan and tool choice belong to the
model. We agree, with one carve-out: which chunks a person is allowed to see is never the model's
decision. That's enforced in code, before ranking.

**The `context_store` shape.** Per-box keyed KV with one embedding per row is the wrong grain for
a corpus. We need document-level records, chunk-level rows, and the source system's access rules
stored next to them — see [`docs/architecture.md`](../architecture.md).

## The one caveat worth recording

Vortic's plans note that the MCP 2026-07-28 release candidate moves to a stateless core and
deprecates Sampling, Roots and Logging. Since we're exposing the brain over MCP, we should design
for no sticky sessions and avoid depending on those three.
