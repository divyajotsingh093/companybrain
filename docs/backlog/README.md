# Backlog sweep — 2026-09-13

Produced by a 16-agent workflow: five research streams (category and competitors, GBrain, the governance lane, knowledge-structure products, upstream qm), each run as learn → map onto this repo → independent adversarial critic, then one triage pass that deduplicated into [`harness.md`](./harness.md) and [`company-brain.md`](./company-brain.md). The critics killed 30 proposals; they are listed below so they are not re-proposed.

## Verification

Checked directly against source after the run:

- Upstream drift: `yc-software/qm` contains the fork commit `7f2c916`, with 323 commits since (HEAD `234022f`).
- Harness #2: `src/core/orchestrator.ts:998-1012` injects every enabled org service credential with `delivery: "env"` into `connectorEnv` whenever the audience is all-internal and the turn is not strict-read-only, with no per-actor grant check.
- Harness #5: `src/core/orchestrator.ts:910-916` loads each standing approval grant as `commandUses.set(grant.approvalKey ?? grant.command, Infinity)` — unlimited uses keyed by command, with no payload, account, or expiry binding.
- Harness #7: `src/triggers/run-trigger.ts:242` has the `pending_approval` branch the item replaces.
- GBrain retrieval receipts: `CHANGELOG.md:1059,1610` (51.3% hybrid regression) and `README.md:434-436` (93.40% / 95.53% after the fix; pure vector 93.8%).
- Gumloop Company Brain: gumloop.com/changelog, release 10.8.0 (Jul 8, 2026) "Gumloop Brain", later "Company Brain", with Salesforce, Gong, Gmail, Linear and Google Groups access-following.

Not independently re-verified (reported by the research and critic agents): harness #4's approval race (`DurableMap` does expose `take()`; the double-resolution path was not traced), Hyper's 1.1–1.6 release contents, the Clawvisor incident details, Onyx v4.7, Engram's Harvey study, Cerenovus positioning, and YC's Fall 2026 RFS.

## Notable developments since 2026-08-07

- Gumloop launched 'Gumloop Brain', which its changelog calls 'Company Brain' (Jul 8, 2026), adding Salesforce (Aug 25) plus Gmail and Linear (Sep 2). It is read-only, with per-document source ACLs snapshotted at sync. A funded competitor now owns the category name.
- Hyper shipped 1.1.0-1.6.0 (Aug 12-Sep 11): connector ACLs, approvals bound to connected accounts, approval-gated HubSpot/Attio writes, and automations with Draft/Automatic/Per-run modes. 'Governed action' alone is no longer a unique claim.
- Upstream qm (yc-software/qm, 323 commits since the fork point) added principal-intersection core search, admin MCP connectors, scope-aware memory providers with acting_user, isolated/open sharing posture, credential_exec, grant-gated env credentials, skill-share grant loading, and quarantine release approvals.
- GBrain reached v0.50.0.0 (29,862 stars): 0.48.3.0 fixed derived-artifact ACL leaks and disabled shared semantic caching; 0.50.0.0 added durable submission authority for queued work; its own evals exposed an unpublished hybrid-retrieval regression (51.3% vs pure vector 93.8% on LongMemEval-S strict recall_all@5), since fixed: 93.40% reranker-off and 95.53% on the release default, which GBrain itself calls roughly neutral against vector on that benchmark, and a shipped default at 80.64% vs 95.53%. It maintains an official qm integration guide. Read scoping is still source-granular.
- YC's /rfs now leads with Fall 2026, including 'Multiplayer AI', which names sales teams working a deal in shared agent sessions and matches qm's multiplayer sessions. Publication date not found.
- Onyx v4.7.0 (Sep 5) replaced Curator roles with additive group permissions, kept separate from document visibility.
- Clawvisor (the seed spelled it Clawwiser) found Redis BRPOP lost about half of approval decisions during deploys, and that Slack approvals were misattributed to the owner.
- Engram (raised $98M) published agent 'study' memory with Harvey (Aug 17), with no discussion of access control. Parametric memory is incompatible with per-document default-deny.
- Cerenovus (YC S26) markets quote-matched claims and deterministic arithmetic for cited operating briefs.

## Open questions for DJ

- Sync timing: merge yc-software/qm now, before Bold Signal lands on feat/web-ui-bold-signal? Both touch plugins/web-ui. And should existing non-layer divergence (adrs/, docs/analysis/, NOTICE) move under deploy/layers/<org>/ or be accepted as a documented exception to byte-identity?
- Where do governed-skill fields (autonomy, envelope, knowledgeAccess) live? Either upstream them as generic qm capabilities (every harness item marked upstreamable), or accept core divergence. The private-fork rule forbids editing core in place.
- Brain attach path: a core SearchBackend behind /v1/search, an MCP connector with a signed principal-set assertion, or a memory provider extended upstream with an audience argument? This decides harness #3 and company_brain #1.
- Permission predicate: RLS on a NOBYPASSRLS role, or a mandatory join? The spike left it open, and company_brain #2 only matters if the choice is RLS.
- First CRM for H0: HubSpot or Salesforce? It sets the ACL mirroring rules (Salesforce sharing and field-level security are much heavier) and the live re-verify source.
- Delegated (owner) knowledge mode for skills: allow it in H0 at all, or ship invoker-only?
- Distinct approver for money_moves actions such as discounts: who approves in the pilot org? A solo founder makes distinct_approver a self-approval override by default.
- Several harness items (atomic approval take, trigger fail-closed, action-scoped strict approvals from 791a9c5) may already be changed upstream. Should each be re-verified against post-sync code before it is built?

## Killed

- **Monotone access-requirement ratchet on sessions (Dust)** — qm already resolves grants for the whole audience each turn, and redacting history cannot retract messages already posted in Slack. The surviving finding (asker vs audience) became company_brain #1.
- **Nightly skill-improvement suggestions (Dust)** — Overlaps known synthesis and write-back learnings, the tuning constants are unvalidated, the workflow predates 2026-08-07, and it is L effort for later.
- **Human-discoverable vs agent-self-activate skill tiers (Dust)** — The draft/reviewed/published lifecycle already keeps unreviewed skills from agents, and there is no demonstrated Sales need.
- **Schema-typed notes materialized view; reject weight memory (Engram)** — The ROADMAP anti-roadmap already rules out fine-tuning, and a deal_facts view is a speculative second substrate.
- **YC RFS pricing-exceptions skill and Multiplayer AI positioning** — Positioning and backlog selection already covered by the sales job map, with no CRM connector to build on. Recorded as a notable development.
- **Per-tool-call grant re-check and scope-conformance classifier (Glean)** — Grants re-resolve per turn, the resume case is folded into harness #7, and the alignment-model claim is marketing copy.
- **Sync converges only the import (GBrain)** — Duplicate of company_brain #4, folded in as rationale.
- **Open-loop engine (GBrain)** — Needs Gmail/Calendar ingestion and mail ACL mirroring that H0 does not plan. The 'refuse when stale' idea is covered by company_brain #3.
- **Memory write-back contract with TTL/holder in the notebook grammar (GBrain)** — The PROVENANCE rule already excludes assistant inferences, the takes model comes with GBrain, and the notebook is not the H0.5 target.
- **Split skill signature so body-only edits skip review (GBrain skillify)** — Would weaken the existing re-sign-and-reset-to-draft governance. Routing and MECE checks are premature before H0.3.
- **Grant revisions, previews and named profiles (GBrain 0.49)** — CAS replaceGrantsIfCurrent and admin grant diffs already exist, and the rest has no demand.
- **GBrain seed facts refresh** — No decision consequence; the churn point is folded into company_brain #8.
- **One search primitive on every surface plus ingest cost approval (Gumloop)** — Restates ADR-0002 and ROADMAP, and source-cost approval has no H0 demand.
- **Before/after CEL-style tool rules with backtest (Gumloop App Rules)** — L effort, only supports H0, not new; the envelope covers the governed-skill need.
- **Chain-fact target guard (Clawvisor)** — No write tools yet, legitimate Sales targets come from user input, and the eval numbers depend on an LLM verifier that was dropped.
- **Onyx hybrid ACL model as a separate item** — Duplicate. The group-sync cadence and drop-source-on-verifier-error rules were folded into company_brain #3, and the post-query-primary framing contradicts ADR-0002.
- **Versioned ingest/query/push hooks (Onyx)** — No ingest pipeline exists, relevance is later, and it is future-proofing.
- **Proxied/hosted MCP inventory (Gumstack)** — L effort, later relevance, vague, and the egress proxy and broker already cover it.
- **Write classes ledger/ruled/conserved (Mainmind)** — Drive and Slack-mirrored documents have no frontmatter or commits, and it depends on a sync hook that does not exist. Revisit when H0.5 is specified.
- **Notes quarantine and Lessons queue (Mainmind)** — Premature; nothing to quarantine yet. Keep one H0.5 constraint: unreviewed feedback is never retrievable.
- **Sealed credentials and short-lived token minting (Mainmind)** — The keychain already keeps refreshTokenEnc out of sandbox env and refreshes server-side. Only a minor rotation gap remains.
- **SkillTree prerequisite DAG and replaces/human_edge fields** — Backlog metadata, not enforcement, and a publish-time dependency check prevents no demonstrated failure.
- **Skill trigger precision/hijack tests (waku)** — waku's failures come from its keyword matcher; qm routing is model-driven.
- **Asymmetric gate scoring, conformance suites and spawn-point lint (waku)** — ADR-0002 already requires the WHERE predicate, fail-closed behavior and a canary suite that blocks on a single leak.
- **Boot entry point with commit-pinned projection (Mainmind)** — ACLs come from Drive and Slack, not git, so the proposed rebuild test is contradictory. Resume is UX with no demand.
- **Sharing posture as a standalone item (upstream qm)** — The isolated default is folded into company_brain #1. Open posture relies on model discretion, which contradicts ADR-0002.
- **Memory provider router as the brain route (upstream qm)** — Sends acting_user without the audience, so it leaks in channels. Used only as evidence in harness #3.
- **Quarantine once-only release (upstream qm)** — Arrives with the sync (harness #1); the provenance part is already known.
- **Configurable Auto flagger replay (upstream qm)** — No Auto-on-CRM deployment or flag-rate data yet, and the proposed layer-file mechanics were wrong.
- **Cron unattended grants as the autonomy mechanism (upstream qm)** — Limited to admin-read on org-admin personal crons; generalizing it is L and restates the autonomy tri-state.
