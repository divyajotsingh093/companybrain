# GBrain — substrate evaluation (H0.1 spike)

**Verdict: adopt the substrate, replace the permission layer.**

Evaluated at `github.com/garrytan/gbrain`, MIT, shallow clone on 2026-08-07. TypeScript on
Bun, PGLite or Postgres+pgvector, markdown-in-git synced to Postgres, ships as an MCP
server. ~27.9k stars, 4.1k forks. 2,211 TypeScript files.

The spike had one kill criterion: **can GBrain's per-login scoping be driven by qm's ACL
grant store as the authority?** The answer is no, and the reason matters more than the
answer.

## What GBrain's permission model actually is

Two mechanisms, both coarser than [ADR-0002](../../adrs/0002-permission-model.md) requires.

**1. Scopes are capabilities, not data.** `src/core/scope.ts` defines six OAuth scopes —
`read`, `write`, `admin`, `sources_admin`, `users_admin`, `agent` — in an implication
hierarchy. These say what a caller may *do*, never which rows it may see.

**2. Data scoping is source-granular.** A *source* is a whole git repo mounted at a path.
A credential carries a set of source ids. From GBrain's own company-brain tutorial:

> Read scoping stays source-granular in both models — within a shared source, everyone
> entitled to the source can read every folder.

The tutorial's Model B offers `--bound-slug-prefixes` for **write** scoping inside a shared
source. There is no read equivalent. Per-person privacy inside a source is a directory
naming convention that the agent is trusted to respect.

## Why that fails ADR-0002

ADR-0002 requires permissions captured at ingest **from the source system's native ACLs**,
enforced as a query predicate, default-deny on unknown ACL, re-verified before the model
sees anything.

GBrain's unit of permission is a git repo. Google Drive's is a file; Slack's is a channel.
Sync a Drive folder into a GBrain source and every principal entitled to that source reads
every file in it, whatever the original Drive ACL said. The mapping from credential to
source list is hand-maintained configuration, not mirrored state — so it cannot drift-check,
because there is nothing upstream to compare against.

This is the gap the outside critique of the category already identified: per-user access
control over facts exists, enterprise RBAC at the semantic level does not.

## The stronger finding: enforcement mechanism, not just granularity

Scoping is a **parameter threaded through every read method** on the engine interface —
`findTrajectory`, `listPages`, `resolveSlugs`, `getAllSlugs`, cross-source enumeration —
each taking `sourceId` (scalar) or `sourceIds` (federated array), with a `sourceScopeOpts(ctx)`
helper callers are expected to spread.

The tutorial claims isolation is "database-enforced". The code shows it is
application-enforced by convention: correctness depends on every read path remembering to
pass the scope. GBrain has already shipped at least one leak from exactly that failure mode,
documented in its own source at `src/core/engine.ts`:

> v0.41.13 (#1436): Pre-fix the resolver was unscoped, so MCP `get_page` with `fuzzy: true`
> would return candidates from sources the caller couldn't actually access. Source-bleed via
> fuzzy resolution was the bug class infiniteGameExp reported as #1436.

That is a permission leak through a read path that forgot the parameter. The architecture
makes every new read path a new opportunity for the same bug. ADR-0002 rejects post-filters
for this reason; a threaded parameter is weaker still, because a post-filter at least runs.

There is also an orthogonal `visibility = 'world' | private` axis gated by a `remote` flag
for untrusted callers — a third mechanism, again independent of any upstream ACL.

## What to take

Genuinely valuable and expensive to rebuild:

- Markdown-in-git → Postgres sync, parallel per-source with locking
- **Zero-LLM typed link extraction** — pattern matching on wikilinks into typed edges
  (`attended`, `works_at`), so graph construction costs nothing per page and is deterministic
- Hybrid retrieval — vector + BM25 + reranking, with graph traversal and gap analysis
- MCP server, stdio and HTTP
- The evals harness (BrainBench), including its result that graph-augmented retrieval beats
  vector-only RAG — which is evidence against the pgvector-only design in
  [`docs/architecture.md`](../architecture.md)
- Postgres schema for pages, chunks, embeddings, links

## What to replace

- Per-document ACL capture at ingest, mirrored from Drive file ACLs and Slack channel
  membership rather than hand-configured
- A **database-enforced** predicate — Postgres RLS or a mandatory join on a grants table —
  so a read path that forgets to scope returns nothing instead of everything. This is the
  direct fix for the #1436 bug class and the thing that makes the claim defensible.
- qm's ACL grant store as the single authority for both knowledge and action
- Default-deny on unknown ACL; re-verification of top hits before they reach the model

## Recommendation

Fork rather than depend. The permission layer is not a plugin point — scoping is threaded
through the engine interface, so replacing it means changing that interface. A dependency
would be fighting upstream on every release.

The seam is favourable: every read already carries a scoping dimension, so the work is
narrowing an existing predicate rather than introducing one. Estimate is days, not the six
weeks H0 would have spent building a graph engine, hybrid search, sync pipeline and MCP
server from nothing.

This also sharpens the wedge. The category's open-source leader enforces isolation with a
convention its own changelog records leaking. Doing that properly — mirrored ACLs,
database-enforced, drift-checked — is a defensible claim rather than a marketing one, and
[ADR-0004](../../adrs/0004-skills-not-search.md) already puts governed action on top of it.

## Caveats

Not benchmarked against real data — this is a code and documentation read, not a load test.
Retrieval quality claims come from GBrain's own evals and have not been independently
reproduced. Its self-description is "Postgres-native **personal** knowledge brain"; the
multi-user path is recent, and the tutorial dates single-user assumptions in
`docs/GBRAIN_V0.md` ("v0 is single-user"). Treat multi-tenant maturity as unproven.
