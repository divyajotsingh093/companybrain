# Self-learning harnesses — what we should take

**Verdict: adopt the loop, keep the human gate. Learn from failures, never across principals.**

Reviewed 2026-09-20.

## Correction to the premise

The YC Paper Club "Harness Edition" (26 Aug 2026) did **not** cover a Shanghai AI Laboratory
paper; it covered Prime Agent, OpenJarvis and qm itself
([event](https://events.ycombinator.com/yc-paperclub-Aug26),
[reading list](https://academy.dair.ai/papers/collections/harness-engineering)). The Shanghai AI
Laboratory paper is real and separate: **Self-Harness: Harnesses That Improve Themselves**,
Zhang et al., [arXiv:2606.09498](https://arxiv.org/abs/2606.09498) (v1 Jun 2026, v3 Aug 2026).

## Self-Harness

Model weights stay frozen; the *harness* changes. Three stages, looped:

1. **Mine weaknesses.** Run the model, collect execution traces, cluster the failed ones by
   verifier-grounded failure signature. The unit of learning is a recurring failure, not a mistake.
2. **Propose edits.** The model, shown the failure evidence and the current harness, emits several
   minimal candidate edits to declared editable surfaces: prompt, tool config, verification
   guidance, recovery rules. The control architecture is not rewritten.
3. **Gate.** Re-run each candidate on held-in and held-out splits. Accept only when neither
   regresses and one improves. Accepted edits merge with an auditable lineage.

Reported: Terminal-Bench-2.0 42.2→53.9 (MiniMax M2.5), 18.0→36.7 (Qwen3.5-35B-A3B), 46.1→57.0
(GLM-5); AppWorld 44.4→85.0 (GLM-5). Different models learn different edits. The authors say
plainly that "higher-stakes applications need stronger acceptance criteria than pass-rate
non-regression alone".

## The pattern across the field

| Technique | What is learned | Gate |
|---|---|---|
| Self-Harness ([2606.09498](https://arxiv.org/abs/2606.09498)) | Harness config edits | Two-split re-eval |
| ACE ([2510.04618](https://arxiv.org/abs/2510.04618)) | Itemised strategy bullets | Deterministic delta merge, no LLM rewrite |
| ReasoningBank ([2509.25140](https://arxiv.org/abs/2509.25140)) | Distilled strategies from wins *and* losses | Self-judged — weakest |
| AWM ([2409.07429](https://arxiv.org/abs/2409.07429)) | Reusable sub-workflows | LLM judge, successes only |
| Voyager ([2305.16291](https://arxiv.org/abs/2305.16291)) | Executable skills | The environment itself |
| GEPA ([2507.19457](https://arxiv.org/abs/2507.19457)) | Evolved prompts | Scored rollouts, Pareto front |

Every mechanism reporting durable held-out gains has a non-LLM oracle in its gate. The ones gated
only by self-judgment report gains with no defence against confidently wrong distillation.

## What we build

New backlog items: harness #13 (failure signatures become a proposed skill edit), company-brain #11
(edits land as deltas against named sections), company-brain #12 (board findings distil per skill,
scoped by the skill's ACL). Existing items carry the rest: run receipts (harness #9) are the trace
substrate and are better than the paper's, because they are built only from observed records;
immutable skill versions (harness #12) are what an edit lands as; golden cases (company-brain #8)
become the gate; `human_led` by default (company-brain #7) covers edits as well as creation.

Start the loop only where a real verifier exists — CRM hygiene, field-mismatch refusals, data
validation — not on "was this the right outreach email".

## What we refuse

- **Self-judged promotion.** Every promotion needs the human approver harness #4 is making atomic.
- **A cross-principal experience pool.** A distilled item derived from one principal's documents is
  a derived row and must obey company-brain #4's predicate. Pooling launders content through
  paraphrase, so document-id canaries would not catch the leak. Distil to the skill, never to a
  shared bank.
- **Letting the loop edit permission, approval or envelope surfaces.** An agent that learns "the
  run failed because an approval was denied" will propose removing the approval. The editable
  surface is an allowlist: instructions, examples, tool usage guidance, recovery steps. Never
  `requiredCapabilities`, declared credentials, envelope action sets, autonomy level or knowledge
  access mode.
- **Weight-level or RL self-evolution.** Context and config edits are reviewable as a diff and
  survive model swaps. GEPA beats GRPO with far fewer rollouts anyway.

One flagged risk: [On Safety Risks in Experience-Driven Self-Evolving Agents](https://arxiv.org/abs/2604.16968)
reports that experience gathered on benign tasks still degrades refusal behaviour, because
accumulated experience teaches that acting is what success looks like. Mining denials as
first-class negative signal is the counterweight.

**Unverified:** that the YC episode covered this paper (its own reading list says otherwise);
Self-Harness's compute cost per round; VentureBeat's "33 to 60 percent" range, which does not match
the paper's own table.
