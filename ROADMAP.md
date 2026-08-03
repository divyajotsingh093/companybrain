# Company Brain — roadmap

_v1, 2026-08-02. Written after reading [qm](https://github.com/divyajotsingh093/qm) and
[Vortic ContextLayer](https://github.com/divyajotsingh093/vortic-contextlayer) end to end. The
horizon format is borrowed from Vortic's `plans/2026-06-29-roadmap-v2.md`, which is the best
artifact in either repo._

## Vision

**One agent for the whole company, that knows what the company knows and respects who knows it.**

The interesting layer was never the model. It's the corpus underneath — where the documents are,
who's allowed to read them, which version is current, and whether the answer can be traced back
to something real. We build that once, for the whole organisation, and let every surface (Slack,
the web app, Claude Code, Cursor) draw from it.

## What we believe

- **Permissions are the schema, not a filter.** A chunk carries the access rules of the system it
  came from, and retrieval resolves them against the asker before ranking. Filtering after the
  fact is how leaks happen.
- **Retrieval exists to keep things out of the context window.** Vortic proved this for tools;
  it's more true for documents. A brain that dumps twenty documents into every prompt is a
  slower, more expensive search box.
- **Buy the commodity, build the wedge.** Postgres, pgvector, embedding models, OAuth, MCP
  connectors and the agent harness are all commodity. Permission-aware organizational retrieval
  is not. Build only that deeply.
- **Citations or it didn't happen.** Every claim links to a source the asker can open. This is
  the difference between a tool people trust and a demo they stop using in week three.
- **Evaluate retrieval, not vibes.** Golden questions in CI from H1 onward. Retrieval quality
  degrades silently, and nobody notices until trust is gone.
- **Ingest where the ACL lives.** Pull from the system of record, not from an export or a
  scraped mirror, because the export doesn't carry the permissions.

---

## Horizons

### H0 — "One team, one brain" (~6 weeks)

One team, three sources, cited answers in Slack. The point is to prove the permission model
against real data, not to be broad.

- **Ingestion for Drive, Slack and GitHub**, each capturing the source's own access rules at the
  same time as the content — file sharing lists, channel membership, repo visibility.
- **Identity resolution** — one person has a Slack ID, a Google account and a GitHub login. Every
  query needs all three resolved, or permission checks are meaningless.
- **Chunk, embed, index** in Postgres + pgvector, with the ACL stored alongside the chunk.
- **Retrieval API and an MCP server** exposing `search` and `fetch`, so the same brain serves qm
  and any local coding agent.
- **Answers with citations in Slack**, via qm as the harness.
- **Incremental re-sync on a schedule**, using qm's existing cron machinery.

_Milestone:_ an employee asks a question in a Slack channel and gets an answer whose every
citation is a document they could already have opened themselves — verified against a colleague
with narrower access who gets a different, correct answer to the same question.

### H1 — "Answers you can trust" (~3 months)

H0 makes it work. H1 makes it safe to rely on, which is a much higher bar.

- **Golden-question eval set in CI** — a fixed set of questions with known-correct sources,
  gating every change to chunking, embedding or ranking.
- **ACL regression suite** — canary documents that must never surface for named test users. This
  runs on every deploy and blocks release on a single failure.
- **Permission drift handling** — access gets revoked, files get unshared, people leave. Re-check
  at read time; don't trust the index's snapshot.
- **Freshness and staleness** — recency weighting, and telling the asker when the best available
  source is two years old.
- **Calibrated abstention** — "I don't know, and here's the closest thing I found" beats a
  confident wrong answer. Measure this explicitly.
- **Conflict surfacing** — when two documents disagree, show both with dates rather than picking.
- **Retrieval traces for admins** — what was retrieved, what the ACL filter removed, what made it
  into the prompt. Vortic's `runs` / `run_steps` schema is the model here.

_Milestone:_ retrieval quality and permission correctness are both measured on every commit, and
a regression blocks the deploy.

### H2 — "The brain works while you sleep" (~Q)

Stop making people ask.

- **Scheduled digests** — what changed in your area this week, drawn from the brain.
- **New-hire onboarding** — a path through the corpus scoped to the role, which is the highest
  value first use anyone has for a company brain.
- **Skills written over the brain** — reusable procedures (qm's skill packs) that query it,
  shareable by grant and promotable org-wide.
- **Proactive answers** — when a question gets asked in a channel and the brain has a good
  citation, offer it.
- **Internal apps over the corpus**, published to the right people.

### H3 — "Org operating system" (6–12 months)

- **Entity resolution** — people, customers, projects and deals as first-class objects the corpus
  hangs off, rather than a flat pile of chunks.
- **Decision memory** — extract decisions with date, owner and rationale. This is the single most
  requested thing a company brain can offer and the hardest to do well.
- **Cross-source graph** — this PR implements that ticket, discussed in that thread, agreed in
  that doc.
- **Enterprise governance** — SSO, audit export, data residency, retention policy.

---

## Deliberately not doing (the anti-roadmap)

- **Building a vector database.** pgvector is enough well past the point we'd have other problems.
- **Training or fine-tuning a model.** The frontier moves faster than we could, in our favour.
- **Rebuilding connectors that already exist as MCP servers.** Drive, Slack, GitHub, Atlassian and
  the rest ship theirs. We consume them — but we still own permission capture, because none of
  them hand it over the way we need.
- **A consumer chat client.** Slack and the coding agents already own that surface.
- **Permission-blind search, even briefly, even internally.** There's no "we'll add ACLs in H1"
  version of this. It's the whole product.
- **Another agent harness.** qm exists, it's MIT, and it's roughly 75k lines ahead of us.

## Immediate next

The H0 permission spine: identity resolution across Slack, Google and GitHub, plus ingestion for
one source that carries its ACL through to the index. Everything else in H0 is ordinary
engineering; this part is the one that decides whether the product is trustworthy, so it goes
first and gets its regression suite before anything is layered on top.
