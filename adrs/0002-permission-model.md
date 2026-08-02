# ADR-0002 — Capture permissions at ingest, enforce them inside the query

- **Status:** proposed
- **Date:** 2026-08-02

## Context

A company brain serves one index to everyone in the organisation. Compensation reviews,
termination discussions, unannounced acquisitions, customer contracts and security incidents all
live in the same Drive and the same Slack as the onboarding docs. One wrong answer of this kind
ends the project — not because of the technical failure, but because trust doesn't come back.

Every source system already has an access model, and they don't agree with each other. Drive has
per-file sharing lists plus domain-wide and public links. Slack has channel membership, private
channels and DMs. GitHub has repo visibility and team permissions. Confluence has space and page
restrictions. None of them is expressible in the others' terms.

qm's `src/acl/acl-store.ts` models grants over *qm's own* resources — skills, files, shared
handles. It does not mirror source-system permissions, and shouldn't. That mirror is ours.

## Decision

**Capture access rules at ingest time, store them next to the content, and enforce them as a
predicate inside the retrieval query — never as a filter over results.**

Concretely:

1. Every source adapter returns access rules alongside content, in the same fetch. Not a separate
   later pass, which can be skipped, fail silently, or race a re-share.
2. Rules normalize into `document_acl (document_id, grantee_kind, grantee_id, permission)` where
   `grantee_kind` is one of `principal`, `group`, `domain`, `public`. Source-specific concepts
   flatten into those four.
3. Retrieval resolves the asker to a `principal` plus their group memberships, and the permission
   test goes into the `WHERE` clause of the search query itself.
4. The top surviving hits are re-verified against the source system before reaching the model,
   wherever that API call is cheap.
5. **Default deny.** A document whose ACL we couldn't capture is retrievable by nobody. Ingestion
   failures fail closed.

## Why not filter afterwards

Post-filtering is the obvious implementation and it leaks in ways that are easy to miss:

- The ranker has already scored forbidden documents, so relevance normalization, result counts
  and score distributions all carry information about content the asker can't see.
- "I found 12 results, showing 3" tells you nine documents exist about your query.
- Any code path that forgets the filter — a new endpoint, a debug tool, an eval harness, a
  reranker that fetches its own candidates — leaks everything. Putting the predicate in the query
  means forgetting it produces zero results, not too many.

The failure modes are asymmetric. Over-filtering annoys someone; under-filtering ends the
project.

## Consequences

Accepted:

- **Recall suffers, deliberately.** Documents with unparseable permissions are invisible until the
  adapter improves. Expect complaints that the brain "can't find" things, and treat each one as an
  adapter bug rather than a reason to relax the rule.
- **Ingestion is slower and more complex** than content-only pulls, and most off-the-shelf MCP
  connectors don't return ACLs at all — meaning we write more of the adapter layer ourselves. This
  is a large share of the total build cost and it's the reason the project is worth doing.
- **Identity resolution becomes a hard dependency.** Permission checks are meaningless until Slack,
  Google and GitHub identities collapse to one principal. It's the first thing H0 builds.
- **Permission drift is real between syncs.** Mitigated by re-verification of top hits, bounded by
  sync frequency, and never fully solved. The residual window should be documented, not hidden.
- **The query is more expensive.** A covering index on `document_acl (document_id, grantee_kind,
  grantee_id)` is not optional.

## Alternatives considered

**Query-time checks against the source API only, with no stored ACL.** Always current, no drift.
Rejected: you can't put a per-document API call inside a ranking query over a large corpus, and
rate limits make it impossible at any real size.

**Index per person.** Perfect isolation, trivially correct. Rejected: storage and embedding cost
multiply by headcount, and shared documents get embedded once per reader.

**Ingest only what's already company-public.** Safe and genuinely tempting as a way to ship H0
sooner. Rejected: it answers only the questions people can already answer themselves, which is
not a product. The hard corpus is the valuable corpus.

**Post-filter, with the intention of tightening later.** Rejected, and named in the roadmap's
anti-roadmap. There is no version of this we ship "just internally for now" — the internal corpus
is exactly the sensitive one.

## How we'll know it works

A permanent regression suite of canary documents, each with a named test principal who must never
retrieve it, run on every deploy, blocking release on a single failure. Plus the H0 acceptance
test: two colleagues with different access ask the same question and both get correct answers
that differ in exactly the way their permissions differ.
