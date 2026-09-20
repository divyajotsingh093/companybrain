# Company Brain backlog

Product work specific to Company Brain: the knowledge substrate, ACL mirroring, governed-skills logic, and the Sales/CRM H0 workflow. Ranked: blocks H0, then enables H0, then later.

## 1. Retrieval predicate uses the audience intersection, not the asker

- **Effort:** M · **H0:** blocking · **Upstreamable:** no
- **Change:** Amend ADR-0002 step 3: in shared scopes the predicate requires every principal in the conversation to be entitled, expressed as one SQL predicate, not N per-principal top-k queries intersected afterwards. Fail closed (409 principal_set_unavailable) when the member list is missing. Register GBrain as a SearchBackend behind upstream /v1/search, and default to isolated sharing posture.
- **Why:** An answer posted in a Slack channel reaches everyone in it, so asker-only resolution discloses documents to members without access. Upstream's intersect-after-top-k collapses recall in large channels.
- **Sources:** Upstream qm stream: principal-aware core search 01c7274; Competitors stream: Dust monotone requirements (critic kept only the ADR-0002 audience finding); Upstream qm stream: sharing posture (killed; the isolated default folded in here)
- **Repo paths:** `adrs/0002-permission-model.md`, `docs/architecture.md`, `src/acl/acl-store.ts`

## 2. If RLS: non-bypass read role and a per-transaction principal set

- **Effort:** M · **H0:** blocking · **Upstreamable:** no
- **Change:** Decide RLS vs mandatory join in docs/analysis/gbrain.md. If RLS, run all retrieval on a NOBYPASSRLS role through a separate createPgPool pool, SET LOCAL the principal set per transaction, auto-enable RLS on new knowledge tables with an event trigger, and fail startup if any knowledge table lacks RLS or a policy.
- **Why:** GBrain's service role holds BYPASSRLS, so RLS policies on the adopted engine would silently constrain nothing. That is exactly the leak class ADR-0002 exists to prevent.
- **Sources:** GBrain stream: docs/guides/rls-and-you.md
- **Repo paths:** `docs/analysis/gbrain.md`, `src/persistence/pg-pool.ts`

## 3. Per-source ACL mapping table with fail-closed signal handling

- **Effort:** M · **H0:** blocking · **Upstreamable:** no
- **Change:** Add a mapping appendix to ADR-0002. Drive link-only sharing means deny. External-domain-only shares get no internal grantee. Google Groups resolve via directory sync on their own cadence, and unreadable groups mean deny. 'Shared with me' files without a readable permission list are denied. Slack private channels map to the member group, and DMs are never ingested. Private or confidential calendar events and Gmail map to the owner. CRM (Salesforce/HubSpot) mirrors a coarse grant set (owner, role hierarchy, sharing rules, org-wide defaults) and uses the live check only to narrow. Whole-source mode is a group grant, never public. A connection-visibility conjunct applies to personal-OAuth ingestion. Any source whose live verifier errors, or whose sync heartbeat or last_synced_at exceeds a freshness bound, drops out of results and is recorded in the trace.
- **Why:** ADR-0002 defines four grantee kinds but no flattening rules, and its drift bound ('sync frequency') assumes the sync worker keeps running. This is the concrete spec H0.2 mirroring needs.
- **Sources:** Governance stream: Gumloop Brain document access rules; Governance stream: Onyx sync_params/post_query_censoring (folded in); Competitors stream: Hyper 1.3.0/1.4.0 connection AND item rule; Upstream qm stream: egress-stamp reversal c0f8c97 (silence means deny)
- **Repo paths:** `adrs/0002-permission-model.md`, `docs/architecture.md`

## 4. Predicate covers every derived row and every existence-revealing read

- **Effort:** M · **H0:** blocking · **Upstreamable:** no
- **Change:** Every derived table (chunks, embeddings, typed links, facts/takes, salience and contradiction aggregates, synthesized-skill evidence) joins back to documents (deleted_at IS NULL) and document_acl at query time. No shared cache keyed without the principal set. Aggregates are computed per caller over permitted rows only. Browse trees, counts, graph neighbours, sync-issue lists, fetch-by-id, link unfurl and slug resolution all go through the same predicate. Add canary tests that nothing is reachable after revocation or tombstoning.
- **Why:** GBrain 0.48.3.0 found page ACLs did not cover derived layers and turned off shared semantic caching. Its sync converges only the import, so revocation waits for lagging sweeps. Gumloop shipped two browse-leak fixes in one week. Hyper enforces the rule on link resolution too. No acl_version seal: query-time joins make revocation a single update.
- **Sources:** GBrain stream: v0.48.3.0 safe-chunks.ts, commit ede85e2e; GBrain stream: sync.ts CONVERGENCE CONTRACT (killed as duplicate, folded in); Governance stream: Gumloop changelog 10.23.0/10.24.0; Competitors stream: Hyper 1.4.0 'A pasted link does not bypass connector privacy'
- **Repo paths:** `adrs/0002-permission-model.md`, `adrs/0004-skills-not-search.md`, `docs/architecture.md`

## 5. Capability grants never confer document visibility

- **Effort:** S · **H0:** supports · **Upstreamable:** no
- **Change:** State in ADR-0002 that no capability grant, org_admin included, confers document visibility. Add canaries: an admin sees documents only via document_acl, and a service or agent principal with no group gets zero search results.
- **Why:** Cheap invariant against the classic operator/skill-author over-share. AdminRole is a single org_admin, and nothing currently separates it from document access.
- **Sources:** Governance stream: Onyx v4.7 understanding_permissions.md
- **Repo paths:** `adrs/0002-permission-model.md`, `src/admin/admin-grant-store.ts`

## 6. Correct ADR-0004's competitive claims and require read-before-write CRM writes

- **Effort:** S · **H0:** supports · **Upstreamable:** no
- **Change:** Fix the Hyper row and remove the claim that approvals, audit and ACLs are 'on the unsolved list for Hyper'. Restate the differentiators as per-principal grants, multiplayer sessions, sandboxed execution and reviewable signed skills. Mark the Glean ~$300M ARR figure unverified. CRM write tools carry the record's updatedAt/version and refuse on mismatch.
- **Why:** An ADR that is not yet accepted contains a claim that is now false. Hyper 1.2-1.6 ships account-bound approvals, connector ACLs and gated automations with optimistic-concurrency writes.
- **Sources:** Competitors stream: Hyper changelog RSS 1.2.0-1.6.0; Competitors stream: Glean/Dust (ARR figure absent from glean.com)
- **Repo paths:** `adrs/0004-skills-not-search.md`

## 7. Autonomy field required; synthesized skills start human_led

- **Effort:** S · **H0:** supports · **Upstreamable:** no
- **Change:** When the known autonomy tri-state lands, make it required with no permissive default. Missing or unknown values are malformed or forced to human_led, H0.3-synthesized skills are always created human_led, and skill-conformance tests enforce presence.
- **Why:** SkillTree's constructor defaults level to 'autonomous', so labels drifted from the stated human-in-loop policy (ICP Definition is marked autonomous but 'never fully delegated').
- **Sources:** Knowledge stream: skilltree.altari.ai map.html `level || 'autonomous'`
- **Repo paths:** `src/skills/normalize.ts`, `test/skill-conformance.test.ts`

## 8. Pin retrieval knobs and run a Sales/CRM golden receipt on every GBrain merge

- **Effort:** M · **H0:** supports · **Upstreamable:** no
- **Change:** Pin search.mode, reranker, autocut (off), expansion (off), relational pin and metadata boost gate in fork config. Pull 30-50 Sales/CRM golden questions forward from H1 and run them before and after each upstream GBrain merge. Note the 51.3% and 80.64% regressions in gbrain.md caveats.
- **Why:** GBrain's shipped hybrid and reranker defaults were badly wrong for weeks by its own receipts, the H0.1 adoption rests on unreproduced quality claims, and upstream moves about 200 commits a month.
- **Sources:** GBrain stream: CHANGELOG 0.48.0.0 and 0.48.4.0; GBrain stream: seed refresh v0.50.0.0 (folded in)
- **Repo paths:** `docs/analysis/gbrain.md`, `ROADMAP.md`

## 9. Write-back rejects unquoted facts; revenue numbers come from code

- **Effort:** M · **H0:** supports · **Upstreamable:** no
- **Change:** H0.5 write-back requires {sourceDocId, quote} on every fact and rejects it unless the quote is an exact substring of the stored source chunk. Pipeline, ARR and discount figures are computed in SQL or code tools and never taken from model text.
- **Why:** Two cheap, enforceable mechanics that add to the known provenance and write-back learnings. The clean-context verifier, bitemporal facts and entity resolution were dropped as unproven or already on the roadmap.
- **Sources:** Competitors stream: Cerenovus llms-full.txt (narrowed by critic)
- **Repo paths:** `adrs/0004-skills-not-search.md`, `docs/architecture.md`

## 10. Denied reads offer an access request, never a silent miss

- **Effort:** M · **H0:** supports · **Upstreamable:** no
- **Change:** When the retrieval predicate (#1) withholds a source the asker would need, the answer says that something was withheld without revealing what, and offers an access request routed to the source's approver through the existing approval path. Approval grants source access; it never grants document visibility directly (#5).
- **Why:** Sim ships access requests alongside permission-aware Search. Without it, a governed brain looks worse than an ungoverned one: answers silently miss. Build it ourselves; Sim's implementation is in its restrictively licensed `ee/` directory.
- **Sources:** Competitors stream: Sim v0.8.40-47 access requests ([analysis](../analysis/sim.md))
- **Repo paths:** `src/acl/acl-store.ts`, `docs/architecture.md`

## 11. Skill edits land as deltas against named sections

- **Effort:** S · **H0:** supports · **Upstreamable:** no
- **Change:** A proposed skill edit is a structured delta against named sections, applied by deterministic merge logic, never a model-authored rewrite of the whole file. The review surface shows the diff; a proposal over a threshold of changed lines is refused rather than shown.
- **Why:** ACE's central result is that whole-context rewriting collapses through a telephone game, while localized edits merged deterministically preserve knowledge. It is also what makes harness #13 reviewable at all: a reviewer diffs three lines, not three pages.
- **Sources:** [analysis](../analysis/self-learning-harness.md): ACE (arXiv:2510.04618)
- **Repo paths:** `src/skills/skill-store.ts`, `src/skills/normalize.ts`

## 12. Board findings distil per skill, scoped by the skill's ACL

- **Effort:** M · **H0:** supports · **Upstreamable:** no
- **Change:** Recurring findings on the agent board distil into reusable items ({title, description, content}) attached to a skill, not to a user and never to a shared pool. Distilled items are derived rows and join back to the ACL at query time like any other (#4). Both wins and failures are distilled, because failure-derived items are what improve behaviour most.
- **Why:** The board already carries claims, findings, handoffs and events across four agent clients — a reasoning corpus we have and competitors do not. The pressure to pool it across principals must be refused: a distilled item derived from one principal's documents launders their content through paraphrase, so document-id canaries would not catch the leak.
- **Sources:** [analysis](../analysis/self-learning-harness.md): ReasoningBank (arXiv:2509.25140), safety risks in self-evolving agents (2604.16968)
- **Repo paths:** `deploy/layers/companybrain/plugins/board/src/store.ts`, `src/acl/acl-store.ts`
