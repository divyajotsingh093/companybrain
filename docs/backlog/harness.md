# Harness backlog

Capabilities of the qm agent harness itself. Items marked upstreamable are generic harness work: under the private-fork rule in `AGENTS.md`, those belong upstream in `yc-software/qm` rather than as in-place core edits here. Ranked: needed by H0 first.

## 1. Sync the fork from yc-software/qm before H0.2 touches core

- **Effort:** L · **H0:** blocking · **Upstreamable:** no
- **Change:** Add the yc-software/qm upstream remote, run update-qm (merge, no rebase), update NOTICE to name yc-software/qm, create deploy/layers/<org>/, and check upgrade risks: the acl_grants trigger migration needs CREATE FUNCTION/TRIGGER privileges, and skill-share grants that are inert today go live on upgrade.
- **Why:** 323 upstream commits (+164k lines) touch orchestrator, ACL and security. Upstream already ships principal-intersection /v1/search, MCP connectors, memory providers, grant-gated env credentials, credential_exec and skill-share grant loading, which removes planned work, but only once merged. Merge cost grows every week.
- **Sources:** Upstream qm stream: fork drift (git rev-list 7f2c916..234022f = 323); Upstream qm stream: skill-share ACL grants b53bacb/48fc1e5 (folded in as upgrade risk); GBrain stream: upstream churn, which argues for a narrow seam
- **Repo paths:** `NOTICE`, `deploy/layers/README.md`, `src/acl/acl-store.ts`, `src/acl/postgres-grant-store.ts`, `src/core/orchestrator.ts`

## 2. Stop injecting env-delivered org credentials into every internal conversation

- **Effort:** S · **H0:** blocking · **Upstreamable:** no
- **Change:** Take upstream b702813, which gates env-delivery service credentials on service-cred ACL grants for every internal participant, and 3be0875, which adds credential_exec: argv-only, per-call vending, masked output, scratch box destroyed after the call. Until those land, never configure CRM tokens with delivery 'env'.
- **Why:** This is a live security gap. Env-delivered credentials are injected whenever allInternal && !strictReadOnly with no ACL check, while non-env credentials are grant-gated. H0.4 CRM write skills need the credential_exec shape.
- **Sources:** Upstream qm stream: commits b702813 and 3be0875
- **Repo paths:** `src/core/orchestrator.ts`, `src/security/secret-masking.ts`, `src/tools/primitives.ts`

## 3. Authenticated principal-set assertion on the brain attach path

- **Effort:** M · **H0:** blocking · **Upstreamable:** yes
- **Change:** Record the attach decision in docs/architecture.md and ADR-0004. Options are an MCP connector, a memory-provider route, or a core SearchBackend. The call path must carry a signed assertion of the full conversation principal set, not only the actor (for example via src/auth/source-auth-sign.ts). Add a test that sandbox env never contains the knowledge DATABASE_URL.
- **Why:** Upstream MCP connectors v1 call with the server's static credential ('per-user OAuth is left for a follow-up'), so a brain attached that way is permission-blind. The memory provider sends acting_user but no audience, so it leaks in channels. qm pins strictMcpConfig: true, and GBrain's own qm guide says never hand sandboxes DATABASE_URL.
- **Sources:** Upstream qm stream: MCP connectors v1 add5f87 (kept); memory provider router 2d32666 (killed as proposed, but used here as evidence); GBrain stream: docs/integrations/qm-harness.md (strictMcpConfig, DATABASE_URL)
- **Repo paths:** `docs/architecture.md`, `adrs/0004-skills-not-search.md`, `src/harness/claude-harness.ts`, `src/auth/source-auth-sign.ts`

## 4. Atomic approval resolution, distinct-approver policy, approver_id in audit

- **Effort:** M · **H0:** blocking · **Upstreamable:** yes
- **Change:** Resolve approvals with DurableMap.take() instead of get+delete, and fix every surface that uses the same pattern. Add an approver policy (requester_only | distinct_approver) with scoped approver/skill_owner roles, required under strict posture and for high-risk skills, plus an audited solo-admin override. Add an approver_id column to audit.
- **Why:** Blue-green multi-instance deploys plus double clicks can apply both approve and deny. Slack approvals are self-approval only, and audit cannot say who approved. Clawvisor lost about half of approval decisions and misattributed approvers under the same conditions.
- **Sources:** Governance stream: Clawvisor #677/#680 failure modes; Governance stream: Onyx v4.7 scoped Group Manager (approver-role part)
- **Repo paths:** `src/core/orchestrator.ts`, `src/persistence/durable-map.ts`, `src/slack/approvals.ts`, `src/admin/postgres-audit-log.ts`, `src/admin/admin-grant-store.ts`

## 5. Narrow standing approval grants

- **Effort:** L · **H0:** blocking · **Upstreamable:** yes
- **Change:** (a) Triggered turns ignore actor chat-level session/always grants. (b) Grants on mutating tools bind a canonical payload hash, so a grant covers only the approved payload. (c) CommandApprovalGrant carries connector accountId + credentialGeneration, bumped on reconnect and invalidated on mismatch; a reconnect to a different account is rejected. (d) A typed risk vector {reversible|irreversible, no_money|money_moves, one|many, once|recurring} on PendingApproval; session/always is refused unless reversible+no_money.
- **Why:** The grant loop copies every 'always' grant into commandUses keyed by approvalKey, with no triggered check, no args, no credential and no expiry. One 'always' on a CRM write therefore authorizes every future argument set, survives a HubSpot portal switch, and applies in unattended runs.
- **Sources:** Competitors stream: Hyper 1.4.0 account-bound approvals; Hyper 1.5.0 automations don't inherit chat grants; GBrain stream: submission-authority.ts payloadHash (narrowed by critic); Knowledge stream: Mainmind blast_radius (narrowed by critic; the Slack-cannot-rule part dropped)
- **Repo paths:** `src/types.ts`, `src/core/orchestrator.ts`, `src/core/orchestrator/turn-helpers.ts`, `src/core/approval-id.ts`, `src/credentials/connector-token.ts`

## 6. Action envelope per skill invocation and per trigger

- **Effort:** L · **H0:** blocking · **Upstreamable:** yes
- **Change:** Add an envelope approval: {envelopeId, skillId, purpose, actions[{tool|approvalKey, mode: auto|per_run|draft}], expiresAt, state}, confirmed once at invocation or at trigger creation. authorizeToolCall allows auto, routes per_run to a per-call approval, turns draft into a proposed diff, and sends out-of-envelope calls to scope expansion. Preflight the skill's declared credentials against the invoking actor before the run. Stamp envelopeId on audit.
- **Why:** H0.4 needs governed execution without an approval per tool call, and without handing a skill everything the actor ever approved. Today grants are per-command with no purpose, action set or TTL, and requiredCapabilities are checked only at publish.
- **Sources:** Governance stream: Clawvisor task envelope (ARCHITECTURE.md); Competitors stream: Hyper 1.5.0 Draft/Automatic/Per-run action manifest; Knowledge stream: Mainmind run_start provider preflight (preflight part)
- **Repo paths:** `src/types.ts`, `src/core/orchestrator.ts`, `src/triggers/trigger-store.ts`, `src/skills/skill-store.ts`, `src/wiring.ts`

## 7. Park and resume approvals inside trigger and cron runs

- **Effort:** M · **H0:** supports · **Upstreamable:** yes
- **Change:** Replace the fail-closed pending_approval branch in run-trigger.ts with parking: persist the PendingApprovalRecord, record fire status 'parked', and deliver the card to the owner. Resume through a fresh resolve, using ToolLedger so completed calls are not re-run. Add consecutiveFailures to crons with a needs_attention state after 3.
- **Why:** Unattended Sales runs such as nightly CRM hygiene or pre-meeting briefs die on the first gated action today. Interactive approvals already work, so this blocks only unattended H0 runs.
- **Sources:** Competitors stream: Hyper 1.5.0 park/resume (#528, #531); Competitors stream: Glean per-request re-check (folded into resume-time resolve per critic)
- **Repo paths:** `src/triggers/run-trigger.ts`, `src/runs/tool-ledger.ts`, `src/cron/scheduler.ts`, `src/cron/cron-store.ts`

## 8. Revocation takes effect before capability-token expiry

- **Effort:** L · **H0:** supports · **Upstreamable:** yes
- **Change:** Keep the capability token as identity plus a grant epoch. The egress authz server, credential broker and knowledge adapter re-resolve credentials, members and memory scopes from the grant store per request, or reject a stale epoch.
- **Why:** CapabilityClaims embed credentials, members, egress policy and memory scopes for 60 minutes, and claimsFor only verifies the signature, so a revoked grant keeps working for up to an hour. Relevance overridden from blocking to supports: the brain's own predicate re-resolves per request (harness item 3), which bounds the knowledge-read exposure for H0.
- **Sources:** Knowledge stream: Mainmind per-operation recompile (narrowed by critic to revocation)
- **Repo paths:** `src/auth/capability-token.ts`, `src/egress-authz-main.ts`, `src/api/credential-broker.ts`, `src/acl/acl-store.ts`

## 9. Run receipt built only from observed records

- **Effort:** L · **H0:** supports · **Upstreamable:** yes
- **Change:** Assemble a per-run receipt from run activity, tool-ledger and approval records: declared intent, observed calls and results, changes, approvals, and an explicit 'unobserved' section (unlogged knowledge reads, calls outside the ledger or broker). Never fill it from agent narration. Keep RunStatus unchanged.
- **Why:** Adds new detail to the known provenance learning: provenance written from agent narration is untrustworthy, and gaps must be stated. This is the evidence record for governed CRM actions.
- **Sources:** Knowledge stream: Mainmind run_receipt (narrowed by critic)
- **Repo paths:** `src/runs/run-activity-store.ts`, `src/runs/tool-ledger.ts`, `src/runs/run-store.ts`

## 10. Tenant claims on connect and credential identity on audit

- **Effort:** M · **H0:** supports · **Upstreamable:** yes
- **Change:** Add a Salesforce org ID / Slack team ID allowlist checked on OAuth completion, alongside the existing Google hd check. Record credentialOwner (actor|scope|owner) and account id on credential.broker and tool_call audit rows.
- **Why:** ACL mirroring from a foreign tenant would poison the permission mirror, and governed CRM writes need a recorded answer to whose identity ran the call. Google hosted-domain enforcement already exists and is not rebuilt.
- **Sources:** Governance stream: Gumloop App Claims and credential ownership (narrowed by critic)
- **Repo paths:** `src/connectors/oauth.ts`, `src/api/credential-broker.ts`, `src/core/orchestrator.ts`

## 11. Skill knowledge identity mode: invoker by default

- **Effort:** S · **H0:** supports · **Upstreamable:** yes
- **Change:** Add knowledgeAccess: invoker (default) | owner to skill frontmatter, reusing the runAs vocabulary. Owner (delegated) skills need admin review and a visible badge in skill review.
- **Why:** Nothing today says whose permissions apply when a skill reads knowledge. Gumloop documents that attaching knowledge to an agent is a sharing decision that bypasses per-user source scope.
- **Sources:** Governance stream: Gumloop how-do-agents-use-brain.md
- **Repo paths:** `src/skills/frontmatter.ts`, `src/types.ts`, `src/api/app-skills.ts`
