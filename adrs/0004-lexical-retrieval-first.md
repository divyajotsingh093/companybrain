# ADR-0004 — Ship the permission predicate first, rank lexically, add vectors behind the same interface

- **Status:** accepted
- **Date:** 2026-08-03

## Context

The roadmap's H0 says "chunk, embed, index in Postgres + pgvector, with the ACL stored alongside
the chunk." The permission model in [ADR-0002](./0002-permission-model.md) is independent of how
candidates are ranked: it is a `WHERE` predicate that runs before ranking, whatever the ranker is.

Neither this development environment nor CI has pgvector. `pg_available_extensions` offers only
`pg_trgm` and `unaccent`, and the `core-postgres` job runs the stock `postgres:16` image. Adding
the extension means a custom image or a `pgvector/pgvector` base, which changes the CI contract
for every existing job in the repository.

## Decision

Build the permission-scoped knowledge store now with Postgres full-text search as the ranker —
`tsvector`, a GIN index, `websearch_to_tsquery` and `ts_rank`. Keep the ranker behind
`KnowledgeStore.search`, so introducing an embedding column and an ANN index changes the ranking
expression and nothing about access control.

## Why this order

The wedge is the predicate, not the ranker. Vector search is the commodity half of the
retrieval problem and the part with the most prior art; permission-scoped retrieval over an
organisation's real corpus is the part nobody hands us. Building the predicate first means the
security-critical layer gets written while it is the only thing being written, and it gets a test
suite of its own rather than sharing attention with recall tuning.

Lexical ranking is also honestly useful at H0 scale: one team, three sources. It is a poor
substitute for embeddings on paraphrase and synonym queries, and that is exactly the weakness H1's
golden-question eval set is designed to measure. Measuring it before fixing it is the right order.

## What this costs

- **Recall on paraphrased questions is weak.** "How do we handle a customer refund" will not match
  a document that only ever says "chargeback". This is the main reason to add vectors, and the
  reason not to claim H0 is finished on lexical search alone.
- **`ts_rank` is not comparable across queries.** Any future score threshold has to be
  calibrated per-ranker, and will need recalibrating when vectors land.
- **A second index to maintain.** Hybrid retrieval keeps both the GIN index and an ANN index.

## What this does not cost

Nothing in the access path. `accessPredicate` takes an `Asker` and produces SQL plus bound
parameters; the ranker chooses the candidate expression and the ordering. A vector query
substitutes its own `ORDER BY` and keeps the same `WHERE`.

## Reversing this

Move CI to a Postgres image with pgvector, add an `embedding vector(N)` column to
`knowledge_chunks` with an HNSW cosine index, and extend `search` to combine lexical and vector
candidates. The ACL tests in `test/knowledge-store.test.ts` should pass unmodified through that
change — if they need editing, the ranker has reached into the access path and the change is
wrong.
