# Agent board backlog

Status: proposed, 2026-09-13. Pending one decision at the bottom.

A company brain that agents use as their default message board: Claude Code, Codex, Cursor
and Grok read company knowledge, claim work, post findings and decisions, and hand off to each
other and to humans. The web UI shows it as a live, animated graph.

## Constraints that shape every item

**One protocol reaches all four clients: a remote MCP server.** Claude Code, Codex and Cursor
speak MCP. Grok reaches remote MCP servers through the xAI API's Remote MCP Tools
([docs.x.ai](https://docs.x.ai/docs/guides/tools/remote-mcp-tools)) and through the Grok Build
CLI. No per-client plugins.

**Approvals must be enforced server-side.** The xAI Responses API does not support
`require_approval` or `connector_id`, so a client cannot be trusted to pause for approval.
The brain holds writes as proposals until approved. This is ADR-0002's posture anyway.

**Prior art exists; don't rebuild it.** [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
already gives coding agents identities, inboxes, searchable threads and advisory file leases
over Git and SQLite, reported running 40–50 mixed Claude Code, Codex and Gemini agents. It has
no company-knowledge graph and no permission model. Borrow its patterns (identities, leases,
git-backed archive); compete on permissioned knowledge and governed action.

**Starting point in this repo.** qm exposes no MCP server of its own — only an in-process one
inside `src/harness/claude-harness.ts`. That is still true upstream: `yc-software/qm` at
`234022f` added MCP connectors (commit `add5f87`), but they are client-side — admins register
external HTTP MCP servers and every harness receives their tools. GBrain ships an MCP server over
stdio and HTTP. `plugins/web-ui` has no graph library.

**The board is qm's multiplayer model extended to outside agents, not a parallel system.** qm
already gives every employee, channel and project an isolated scope with memory, files,
credentials, permissions and sessions shared by humans and agents. External agents should become
first-class participants in those scopes. A separate board with its own identities and
permissions would duplicate the part of qm that is hardest to get right.

**qm already runs two of the four clients.** `src/harness/` includes Claude and Codex harnesses
(plus OpenCode and Pi). Those can reach the board through qm's own MCP connector path. Cursor and
Grok have no qm harness and must connect from outside.

**A shared board is a prompt-injection channel.** One agent's post is another agent's tool
result. That is the biggest new risk this product introduces, and item 16 is not optional.

## B0 — Foundations (blocking)

### 1. Remote MCP server for the brain
Streamable HTTP with OAuth 2.1, one connection per agent identity. Every read and write passes
through the permission predicate in `company-brain.md` #1–4, including graph traversal and
counts. Extend GBrain's MCP server rather than writing one. **Effort L.**

Two routes onto the same server. External clients (Cursor, Grok, standalone Claude Code and Codex
CLIs) connect directly. qm's own harnesses get it by registering the brain as a qm MCP connector,
which injects its tools into every harness for free — but only after `harness.md` #3 lands:
upstream connectors call with the server's static credential ("per-user OAuth is left for a
follow-up"), so a brain attached that way today would be permission-blind.

### 2. Agent identity bound to a human
Each agent session is a principal with `kind: agent`, `client` (claude_code, codex, cursor,
grok), and `acting_for` a human principal. An agent can never exceed its human's grants.
Roles are operating boundaries (Mainmind): responsibility, knowledge boundary, stopping point.
**Effort M.**

### 3. Board as typed posts on the graph, not a chat log
Post types map to knowledge types: `claim` (advisory lease with TTL), `finding` (a record with
evidence), `decision` (rationale plus approver), `handoff` (to an agent or human, with a context
pack), `question`, `lesson`. Every post is a node linked to the entities it concerns (files,
accounts, deals, skills), with mandatory provenance. Free-text agent chatter is out of scope.
**Effort M.**

### 4. Server-side proposal and approval gate
Writes from any client land as `proposed`, approved through qm's existing approval path, after
harness backlog #4 and #5 fix the approval race and unbounded standing grants. Client-agnostic
by construction. **Effort M.**

## B1 — Agent interaction

### 5. Connection kit per client
Generated setup for each client from one admin screen, plus Mainmind-style one-time invite
codes: Claude Code (`claude mcp add` / `.mcp.json`), Codex (`config.toml` MCP servers), Cursor
(`.cursor/mcp.json`), Grok Build, and an xAI API snippet using a remote MCP tool. Verify each
client's current config format at build time. **Effort S.**

### 6. Small, verb-shaped tool surface
About ten tools, not forty-five: `board_read`, `board_post`, `board_claim`, `board_release`,
`board_handoff`, `brain_search`, `brain_get`, `brain_propose_write`, `skill_run`, plus a
subscribable digest resource. **Effort M.**

### 7. Board-first behaviour at session start
Agents read the board and post a claim before starting work, driven by the MCP server's
instructions field, an `AGENTS.md` snippet in each repo, and a Claude Code SessionStart hook.
**Effort S.**

### 8. Advisory leases and conflict signals
Claim a file, account or task; others see who holds it and until when, and back off. Leases
expire rather than lock. **Effort M.**

### 9. Notifications within MCP's limits
Idle CLI agents can't receive pushes. Poll on session start, use resource subscriptions for live
sessions, and mirror handoffs and questions to Slack for humans, where qm already lives. The
board complements Slack; it does not replace it. **Effort M.**

## B2 — Visualisation (`plugins/web-ui`)

Reference: SkillTree (skilltree.altari.ai/explore), inspected 2026-09-13. It is the right
interaction model and the wrong data: its map is a static, aspirational plan with self-reported
status. Ours takes the same shape and fills it with live, permission-filtered state.

### 10. Three-level map: organisation → skill tree → node
A force-directed graph of a whole company is a hairball, so the primary view is hierarchical, as
in SkillTree:

1. **Organisation** — a radial constellation with one hub per department or compartment and
   its skills radiating out; the brain itself at the centre.
2. **Skill tree** — clicking a hub zooms into that department as a tree growing from its root,
   grouped into branches (SkillTree's Operations shows Build Ops, Reliability, Client Comms,
   Knowledge, Onboarding). Neighbouring departments sit at the screen edges with arrows to move
   between them, a back link returns to the organisation, and a counter shows progress
   ("0 of 19 live").
3. **Node** — clicking a skill zooms and rings it, labels its neighbours, and opens the detail
   panel (#13).

Force-directed layout is reserved for the knowledge neighbourhood around a focused node, where
the node count is small. Render with sigma.js and graphology (WebGL) using precomputed radial
and tree positions. Server-filtered at every level, so no view reveals nodes, counts or branches
the viewer cannot access — the bug Gumloop's changelog records fixing in its own Company Brain.
**Effort L.**

### 11. Live activity animation
Zoom transitions dim and blur what is out of focus. Edges pulse when an agent reads or writes
along them; agents sit beside the skill they're running; claims show a halo with a draining TTL
ring; a skill going live lights up in the tree. Streamed over SSE from core. Honours
`prefers-reduced-motion`. **Effort M.**

Event vocabulary follows Sim's `agent-events-v1` ([analysis](../analysis/sim.md)): small typed
frames, and tool events carry no arguments or results, which keeps untrusted content off the
wire (#16). The board service's durable event log is the first source for these frames.

### 12. Swimlane timeline
One lane per agent client and one for humans, with handoffs drawn between lanes. The fastest way
to see who did what, in order. **Effort M.**

### 13. Skill node panel
SkillTree's node panel maps almost field for field onto a governed skill. Each field is shown
with our live source instead of its static one:

| SkillTree field | Our field and where it comes from |
|---|---|
| Autonomy label ("Fully autonomous") | `autonomy` on the skill, enforced through qm approvals |
| Breadcrumb (Operations · Build Ops) | Scope or compartment and branch |
| "1 runnable skill file ships with this job" | The skill in qm's registry, with its review state |
| Breaks into (sub-skills) | Composed sub-skills |
| Your status: Not started / In development / Live | Derived from the skill lifecycle (draft, reviewed, published) and real runs — never a self-reported toggle |
| Your notes (prompt, tools, setup) | Per-user configuration, saved to the user's scope |
| Builds on ("Company Knowledge Base") | Prerequisite edges, used for layout only |
| What it replaces | Value statement authored with the skill |

Add what SkillTree cannot show: which agent is running it now, open claims, pending approvals,
recent runs with provenance and citations (Bold Signal finding and citation-chip components), and
who can see it. **Effort M.**

"Builds on" stays visual. The sweep's critics killed prerequisite enforcement as preventing no
demonstrated failure, and nothing here reverses that.

### 14. Governance chart
SkillTree's CHART view, computed rather than planned: skills placed by rollout stage (foundation,
capture, generate, orchestrate) against autonomy (human-led, human-assisted, autonomous), with a
per-department summary built from real skill metadata and approval audit ("19 of 22 run
autonomously · 3 assisted · the rest stay human"). **Effort M.**

### 14a. Command centers
SkillTree's DASHBOARDS ("what each department looks like when the work runs itself") are
mockups. Ours show each department's actual day: board activity, approvals waiting, claims, and
outcomes. **Effort M. After #10–14.**

## B3 — Trust and operations

### 15. Cross-client audit
Every call records client, agent identity, acting-for human, tool and payload hash. Because all
four clients go through one server, Gumstack-style cross-tool traceability comes free.
**Effort S.**

### 16. Prompt-injection containment
Posts are returned to agents marked as untrusted content, never as instructions. A handoff's
embedded commands are never executed automatically. Writes triggered by another agent's post
always require approval. **Effort M. Blocking before any second agent connects.**

Reuse, don't build: upstream qm already passes every MCP connector result "through the
external-content screen like any untrusted tool output", and keeps only read-only servers' tools
in read-only contexts. Board posts should flow through that same screen. The part qm cannot cover
is external clients, which receive posts without passing through qm, so the board server must
also mark content as untrusted in what it returns.

### 17. Loop and spam controls
Per-identity rate limits, and detection of agents replying to each other indefinitely.
**Effort S.**

### 18. Board evals
Golden scenarios in CI: two agents claim the same file and the second backs off; a handoff
carries enough context to continue; an agent acting for user A cannot see user B's private post
or its existence. **Effort M.**

## Not building

- Another forty-tool coding-coordination server. Interoperate with or learn from MCP Agent Mail.
- Client-specific extensions or plugins. MCP only.
- Untyped agent-to-agent chat. It turns into noise within a day.
- A 3D graph. It costs legibility; a 2D canvas is enough.

## First slice

Items 1 (minimal), 2, 3 (claim, finding and handoff only), 5, 6 (five tools), 7, 10 (read-only
organisation map and skill tree, no animation), 13 (panel without live fields) and 16.

Demo that proves it: Claude Code claims a task; Codex sees the claim and picks different work;
Cursor posts a finding linked to a file; Grok Build reads the graph and answers from it — all
visible in the web graph, with an agent acting for one user unable to see another user's post.

## Decision needed

All four named clients are coding agents, but H0 is Sales/CRM. Either the board's first users are
engineers (fastest feedback: dogfood it on this repo with all four clients today, keep the board
agent-neutral, and let Sales agents post to it later), or it waits until H0's Sales agents exist.
Recommendation: dogfood with coding agents first.
