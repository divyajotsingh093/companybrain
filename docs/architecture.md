# Architecture

Target design for the knowledge service. This is a proposal to argue with, not a specification —
nothing here has been built. Decisions with real consequences are split out into
[`adrs/`](../adrs/).

## Shape

Company Brain is one service with two faces: an ingestion side that pulls from source systems on
a schedule, and a query side that answers questions for a specific person. Between them sits a
Postgres database where every chunk of text is stored next to the access rules of the system it
came from.

```
┌── ingest (scheduled) ───────────────────────────────────────┐
│  source adapter ──▶ normalize ──▶ chunk ──▶ embed ──▶ upsert │
│   content + ACL                                              │
└──────────────────────────────────────────────────────────────┘
                              │
                     Postgres + pgvector
              documents · chunks · document_acl
              principals · identities · groups
                              │
┌── query ─────────────────────────────────────────────────────┐
│  who is asking ──▶ resolve principal + groups                │
│                 ──▶ hybrid search, ACL predicate in the query│
│                 ──▶ rerank ──▶ re-verify top hits ──▶ cite   │
└──────────────────────────────────────────────────────────────┘
                              │
                  HTTP API  ·  MCP server
                              │
              qm (Slack, web)  ·  Claude Code  ·  Cursor
```

## Data model

The grain matters more than the column names. Documents and chunks are separate because
permissions, freshness and deletion apply to documents while retrieval applies to chunks.

```sql
-- who
principals    (id, display_name, primary_email, status, created_at)
identities    (principal_id, provider, external_id)     -- slack:U04X, google:a@co.com, github:alice
groups        (id, provider, external_id, name)         -- a Slack channel, a Google group, a GitHub team
group_members (group_id, principal_id)

-- what
sources    (id, kind, config, credential_ref, cursor, last_synced_at)
documents  (id, source_id, external_id, uri, title, mime, author_principal_id,
            source_created_at, source_updated_at, content_hash, deleted_at)
chunks     (id, document_id, ordinal, text, token_count,
            embedding vector(1536), tsv tsvector)

-- who may see what
document_acl (document_id, grantee_kind, grantee_id, permission)
              -- grantee_kind ∈ principal | group | domain | public
```

Indexes: HNSW with `vector_cosine_ops` on `chunks.embedding`, GIN on `chunks.tsv` for the lexical
half of hybrid search, and a covering index on `document_acl (document_id, grantee_kind,
grantee_id)` because it's in the hot path of every query.

`content_hash` drives incremental sync — unchanged documents skip embedding, which is where the
cost is. Deletions are tombstones (`deleted_at`), never row deletes, so a document that
disappears from Drive stops being retrievable without destroying the trace of why an old answer
cited it.

## The permission path

This is the part that must be right.

Access rules are captured **at ingest**, from the source system, at the same moment as the
content. They are resolved **at query time**, against the person asking, as a predicate inside
the retrieval SQL — not as a filter applied to results afterwards. The distinction is not
stylistic: post-filtering means the ranker has already seen forbidden documents, which shows up
as leaked titles, leaked counts, and answers whose shape betrays what was excluded.

A sketch of the predicate:

```sql
WHERE d.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM document_acl a
    WHERE a.document_id = d.id
      AND ( (a.grantee_kind = 'principal' AND a.grantee_id = $principal)
         OR (a.grantee_kind = 'group'     AND a.grantee_id = ANY($group_ids))
         OR (a.grantee_kind = 'domain'    AND a.grantee_id = $email_domain)
         OR  a.grantee_kind = 'public' )
  )
```

Two safeguards on top, because an index is a snapshot and permissions move:

1. **Re-verification of top hits.** Before the winning chunks reach the model, re-check the
   handful that survived against the source system where the API makes that cheap. Catches
   revocations between syncs.
2. **Default deny on unknown.** A document whose ACL we failed to capture is not retrievable by
   anyone. Ingestion failures must never fail open. This costs recall and it is not negotiable.

The full reasoning is in [ADR-0002](../adrs/0002-permission-model.md).

## Identity resolution

One person is a Slack user ID, a Google account and a GitHub login. Permission checks are
meaningless until those collapse to a single `principal`. Email is the usual join key, and it is
not sufficient — people have aliases, contractors have two accounts, and some Slack users have no
corporate email at all.

Unresolvable identities get their own principal with no group memberships, which means they see
only what's public. Wrong-but-safe, and visible in the admin surface so it can be fixed by hand.
This is dull, fiddly work and it is the first thing H0 builds, because everything downstream is
untrustworthy without it.

## Retrieval

Hybrid: vector similarity over `chunks.embedding` for meaning, plus full-text over `chunks.tsv`
for names, error codes, ticket IDs and other things embeddings handle badly. Fuse the two, rerank,
then take a small top-K — small on purpose, because the point of retrieval is to keep the context
window empty, not to fill it.

Answers carry citations to document URIs the asker can open. An answer with no citation is
reported as "I don't know", including the closest thing found. Confident and wrong is the failure
mode that kills adoption, and H1 measures it directly.

## Serving, and how it attaches to qm

The service exposes an HTTP API and an MCP server over the same core. The MCP surface is
deliberately small — `search` and `fetch` — following qm's own instinct that a fixed, narrow tool
surface beats an open-ended one.

qm connects to it as a connector, and the agent gets those two tools in every scope. Because the
interface is MCP, the same brain answers from Claude Code and Cursor without any additional work.

One hard requirement on that boundary: **the brain never accepts an asserted identity from an
unauthenticated caller.** The calling harness authenticates with a service credential and asserts
the acting principal, or it forwards a per-user token. A `search(query, as_user)` endpoint that
trusts `as_user` from anyone is the whole permission model undone by one HTTP call.

Since we're exposing MCP, design for a stateless core with no sticky sessions — the 2026-07-28
release candidate moves that way and deprecates Sampling, Roots and Logging.

## What we don't build

Scheduling, credential storage, OAuth refresh, the Slack front door, the sandbox, skills, audit
and the security classifier all exist in qm and are described in
[`docs/analysis/qm.md`](./analysis/qm.md). The brain assumes them rather than reimplementing them.

Source adapters lean on existing MCP servers for content wherever one exists. Permission capture
is ours regardless — no connector we've found exposes ACLs the way this design needs them, and
that gap is most of why this project exists.
