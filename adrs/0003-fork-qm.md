# ADR-0003 — Fork qm and build Company Brain inside it

- **Status:** accepted
- **Date:** 2026-08-02
- **Supersedes:** [ADR-0001](./0001-build-strategy.md)

## Context

ADR-0001 recommended building the knowledge layer as a standalone service that qm would call over
MCP, rather than forking qm. That recommendation rested on a survey of qm that counted only its
`src/` tree: roughly 75,000 lines of core, with the conclusion that about 12% of it — OAuth,
credentials, persistence, policy, directory, security — would transfer to a new codebase, and the
rest was qm's own product surface with no value to us.

The survey missed the `plugins/` tree entirely. qm also ships:

|                  |                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------- |
| `plugins/web-ui` | ~31k LOC — chat shell on Lit 3 and Vite, panel layout via dockview, sanitized markdown |
| `plugins/admin`  | a 14,144-line single-file admin console, no framework, no build step                   |
| `plugins/portal` | ~4k LOC — OIDC session proxy                                                           |
| `plugins/auth`   | ~2.6k LOC — magic-link email authentication                                            |

Application code is ~117k lines, not 75k. The missing ~43k is almost entirely user-facing surface:
the part a standalone service would have had to build from nothing, and the part least related to
retrieval — meaning it was never going to be rebuilt as a side effect of doing the interesting work.

## Decision

Fork qm. This repository's `main` is qm's history through `7f2c916`, and Company Brain is built on
top of it.

## Why the earlier reasoning doesn't survive

ADR-0001 made three arguments. Two still hold and one was decisive but wrong.

**"Retrieval must be testable in isolation."** Still true, and unaffected. Retrieval will be a
module with its own tests either way; a fork does not force it to be entangled with the harness.
Discipline about that boundary is a code review concern, not an architecture one.

**"The same brain should serve Claude Code and Cursor."** Still true, and still the plan — the
knowledge layer stays addressable over MCP. Forking the harness does not stop us exposing a
service; it just means we are not _only_ a service.

**"We inherit little enough that a fork mostly means deleting."** This was the load-bearing claim
and it was an artifact of the incomplete survey. A fork inherits a working UI, an admin console, an
auth surface and a session proxy, plus CI that typechecks, lints and tests all of it.

## What this costs

- **We own code we did not write.** ~117k lines, including subsystems nobody here has read. The
  3,712 passing tests make that tractable, not free.
- **Upstream drift is now our problem on a schedule.** History is shared, so `git merge qm/main`
  works and the inherited `update-qm` skill automates it — but a merge left undone for months is
  a merge that stops being routine.
- **Dead weight is now our dead weight.** The sandbox, deploy and CLI subsystems are not on the
  H0 path and still have to be kept building.

## What has not changed

[ADR-0002](./0002-permission-model.md) stands unmodified. Permission-scoped retrieval is still the
wedge and still greenfield: qm has no embeddings, and its ACL grants are _authored_ — a record of
what someone shared inside qm — rather than _mirrored_ from the source system's own permissions.
`src/acl/postgres-grant-store.ts` also loads every grant into memory and filters in JavaScript,
which is correct for a few thousand hand-authored shares and wrong for mirrored ACLs over millions
of chunks. The fork gives us more infrastructure. It gives us nothing on the hard part.

## Reversing this

Extract the knowledge modules — they will have been written as leaves regardless — into their own
repository and delete the rest. The cost of reversal grows with how much Company Brain code comes
to depend on qm internals rather than on its interfaces, so that dependency is the thing to watch
in review.
