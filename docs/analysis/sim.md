# Sim — competitor review

**Verdict: a direct competitor on permissioned search, not on governed skills. Take the run
mechanics, leave the canvas.**

Reviewed 2026-09-19 from [sim.ai](https://sim.ai), [docs.sim.ai](https://docs.sim.ai) and
[github.com/simstudioai/sim](https://github.com/simstudioai/sim). Nothing was run or signed into;
canvas UX is from the docs only.

## What it is

An open-source workspace to build, deploy and monitor agent workflows. Next.js on Bun, Postgres
with Drizzle, ReactFlow canvas, Socket.io, Trigger.dev for jobs, E2B for code. Self-hosts on
Docker Compose or Kubernetes (12GB+ RAM). About 29.7k stars and 3.8k forks; $7M Series A led by
Standard Capital with YC, Perplexity Fund and Paul Graham. Free, Pro $25/user, Max $100/user,
Enterprise custom.

- **Workflows** are a DAG of blocks (Agent, API, Function, Condition, Router, Loop, Parallel,
  Evaluator, Guardrails, Human in the Loop, nested Workflow, Pi coding agent) with schedule,
  webhook, RSS, table and workspace-event triggers. Agent blocks take MCP tools, custom tools and
  SKILL.md skills, loaded on demand and unversioned.
- **Exposure:** each deployed workflow is a REST API (sync, streaming, or async with a run id), a
  chat page, or MCP tools with paste-ready config for Claude Code, Codex, Cursor, Claude Desktop
  and VS Code. MCP auth is a workspace `X-API-Key` or public.
- **Search** is the part that matters to us: per-user OAuth, access checked against the source on
  every request, hourly permission sync, and an MCP server (`search`, `read_document`, `chat`).
  Its ordinary knowledge bases do not mirror source permissions; Search was built separately to
  fix that.
- **Runs:** a trace per run (each block's input, output, timing, cost, error), "View Snapshot"
  of the workflow exactly as it ran, live block states on the canvas, immutable numbered
  deployments with rollback by promotion, and an `agent-events-v1` SSE stream (`chunk`,
  `thinking`, `tool` start and end without arguments or results, `final`, `error`).
- **Human in the loop:** pauses with no timeout, notifies over Slack, email, Teams, SMS or webhook,
  resumes by run id, and the resume form's fields become inputs to later blocks.
- **AI builder:** edits workflows from natural language and applies them at once, with no diff.

## What we take

| # | From Sim | Lands as |
|---|---|---|
| 1 | Search is permission-aware MCP retrieval already shipping | ADR-0004 competitor table; company-brain #6 |
| 2 | Pause without timeout, resume by run id, form fields feed later steps | harness #7 |
| 3 | `agent-events-v1` event vocabulary, tool events without arguments | agent-board #11; board event feed |
| 4 | Per-step traces and a frozen snapshot of what ran, rollback by promotion | harness #9 and new #12 (pinned skill versions) |
| 5 | Live step state: queued, running, done, errored | agent-board #12 and #13 |
| 6 | Paste-ready setup per client | agent-board #5 (shipped, and we cover Grok, which Sim does not) |
| 7 | Restrictions enforced when a tool is reached, not when a workflow is saved | harness #6 test |
| 8 | Request access on denial | new company-brain #10 |

## What we do not take

- **The canvas and the integration-count race.** ADR-0004 makes governed skills, not flows, the
  unit of capability; agent-board rules out another forty-tool server.
- **AI edits applied without review.** Skill edits land as proposals (ADR-0002, harness #4 and #5).
- **Workspace API keys and external tools running as whoever configured them.** That is the
  permission-blind static credential harness #3 exists to remove.
- **Knowledge connectors that ignore source permissions.** The leak class of company-brain #4.

## Licence

The repository root is Apache 2.0 (Sim Studio, Inc.): reusable with attribution, NOTICE and a
change note. `apps/sim/ee/` is under the Sim Enterprise License: non-production use only, no
modification or derivatives, no redistribution. It covers SSO, access control, access requests,
audit logs, data drains, retention, SCIM, credential groups and whitelabeling. Sim's README says
`ee/` is imported throughout the codebase, so any non-ee file we lift must be checked for `ee/`
imports first. Do not adapt anything from `ee/`.

## Not verified

Integration count (docs and README disagree: 700+, 1,000+, "hundreds"); whether
`apps/sim/lib/search` imports from `ee/`; v0.8.47's "Sim MCP server offering full API access";
the live canvas UX.
