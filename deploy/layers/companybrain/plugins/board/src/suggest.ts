import { parseSkill, pulse, type SkillPart } from "./skills.ts";

export type SuggestionKind =
  | "review_waiting"
  | "decision_waiting"
  | "unanswered_question"
  | "tool_to_skill"
  | "missing_entry"
  | "connector_missing"
  | "stale_source"
  | "stale_skill";

export type SuggestionAction =
  | { type: "open"; screen: string; seed?: string; label: string }
  | { type: "reindex"; repo: string; label: string }
  | { type: "learn"; skill: string; part: SkillPart; note: string; label: string };

export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  title: string;
  reason: string;
  action: SuggestionAction;
  score: number;
  learned: string | null;
}

export const BASE: Record<SuggestionKind, number> = {
  review_waiting: 1,
  decision_waiting: 0.95,
  unanswered_question: 0.8,
  tool_to_skill: 0.75,
  missing_entry: 0.6,
  connector_missing: 0.6,
  stale_source: 0.5,
  stale_skill: 0.45,
};

export const SNOOZE_MS = 3 * 24 * 3_600_000;
export const ACTED_MS = 24 * 3_600_000;
const EXPLORE = 0.25;

export interface KindStats {
  accepted: number;
  snoozed: number;
  dismissed: number;
}

export function kindStats(rows: Array<{ kind: string; verdict: string; n: number }>): Map<string, KindStats> {
  const stats = new Map<string, KindStats>();
  for (const r of rows) {
    const s = stats.get(r.kind) ?? { accepted: 0, snoozed: 0, dismissed: 0 };
    if (r.verdict === "accepted" || r.verdict === "snoozed" || r.verdict === "dismissed") s[r.verdict] += r.n;
    stats.set(r.kind, s);
  }
  return stats;
}

export function learnedValue(s: KindStats | undefined, total: number): number {
  const a = s?.accepted ?? 0;
  const tries = a + (s?.dismissed ?? 0) + (s?.snoozed ?? 0);
  const mean = (a + 1) / (a + (s?.dismissed ?? 0) + 0.5 * (s?.snoozed ?? 0) + 2);
  return mean + EXPLORE * Math.sqrt(Math.log(total + 2) / (tries + 1));
}

export function rank(
  candidates: Array<Omit<Suggestion, "score" | "learned">>,
  history: { stats: Array<{ kind: string; verdict: string; n: number }>; latest: Array<{ key: string; verdict: string; at: number }> },
  now: number,
  limit = 5,
): Suggestion[] {
  const stats = kindStats(history.stats);
  const total = [...stats.values()].reduce((n, s) => n + s.accepted + s.snoozed + s.dismissed, 0);
  const latest = new Map(history.latest.map((l) => [l.key, l]));
  const hidden = (key: string): boolean => {
    const last = latest.get(key);
    if (!last) return false;
    if (last.verdict === "dismissed") return true;
    if (last.verdict === "snoozed") return now - last.at < SNOOZE_MS;
    return now - last.at < ACTED_MS;
  };
  const seen = new Set<string>();
  return candidates
    .filter((c) => !hidden(c.key) && !seen.has(c.key) && seen.add(c.key))
    .map((c) => {
      const s = stats.get(c.kind);
      const tries = (s?.accepted ?? 0) + (s?.dismissed ?? 0) + (s?.snoozed ?? 0);
      return {
        ...c,
        score: BASE[c.kind] * learnedValue(s, total),
        learned: tries >= 3 ? `You acted on ${s?.accepted ?? 0} of ${tries} suggestions like this.` : null,
      };
    })
    .sort((x, y) => y.score - x.score || x.key.localeCompare(y.key))
    .slice(0, limit);
}

export interface Signals {
  now: number;
  reviews: Array<{ id: string; title: string; repoName: string }>;
  decisions: Array<{ id: string; title: string; repoName: string }>;
  unanswered: Array<{ question: string; n: number }>;
  missing: Array<{ name: string; n: number }>;
  sources: Array<{ repoName: string; indexedAt: number }>;
  skills: Array<{ name: string; body: string; updatedAt: number }>;
  gateways: string[];
  observed: Array<{ skill: string; tools: Array<{ tool: string; subject: string | null; n: number }> }>;
}

export const STALE_SOURCE_MS = 7 * 24 * 3_600_000;

export function candidates(sig: Signals): Array<Omit<Suggestion, "score" | "learned">> {
  const out: Array<Omit<Suggestion, "score" | "learned">> = [];
  for (const r of sig.reviews) {
    out.push({ key: `review:${r.id}`, kind: "review_waiting", title: `Review "${r.title}"`, reason: `An agent finished this in ${r.repoName} and it is waiting on you.`, action: { type: "open", screen: "work", label: "Review" } });
  }
  for (const d of sig.decisions) {
    out.push({ key: `decision:${d.id}`, kind: "decision_waiting", title: `Rule on "${d.title}"`, reason: `An agent in ${d.repoName} stopped and is waiting for your call.`, action: { type: "open", screen: "decisions", label: "Rule on it" } });
  }
  for (const q of sig.unanswered) {
    out.push({
      key: `unanswered:${q.question.toLowerCase()}`,
      kind: "unanswered_question",
      title: `Nothing written down for "${q.question}"`,
      reason: q.n > 1 ? `Asked ${q.n} times and nothing in the brain answered it.` : "Asked, and nothing in the brain answered it.",
      action: { type: "open", screen: "work", seed: `Write down the answer to: ${q.question}`, label: "Ask an agent to write it" },
    });
  }
  const connected = new Set(sig.gateways);
  for (const s of sig.skills) {
    const skill = parseSkill(s.body);
    if (pulse(skill, s.updatedAt, 0, sig.now).state === "stale") {
      out.push({ key: `stale_skill:${s.name.toLowerCase()}`, kind: "stale_skill", title: `Refresh the skill "${s.name}"`, reason: "Nothing new has been learned into it for over 30 days.", action: { type: "open", screen: "skill", label: "Open skill" } });
    }
    const wanted = [skill.parts.Connectors.text, ...skill.parts.Connectors.learned.map((l) => l.note)].join("\n");
    for (const m of wanted.matchAll(/gateway:([a-z0-9][a-z0-9-]{0,39})/gi)) {
      const server = (m[1] as string).toLowerCase();
      if (!connected.has(server)) {
        out.push({ key: `connector:${server}`, kind: "connector_missing", title: `Connect ${server}`, reason: `The skill "${s.name}" relies on it, but it is not connected through the gateway.`, action: { type: "open", screen: "gateway", label: "Connect" } });
      }
    }
  }
  const skillText = new Map(sig.skills.map((s) => [s.name.toLowerCase(), s.body.toLowerCase()]));
  for (const o of sig.observed) {
    const body = skillText.get(o.skill.toLowerCase());
    if (body === undefined) continue;
    for (const t of o.tools) {
      if (t.tool !== "gateway_call" || !t.subject || t.n < 2) continue;
      if (body.includes(t.subject.toLowerCase())) continue;
      out.push({
        key: `tool:${o.skill.toLowerCase()}:${t.subject.toLowerCase()}`,
        kind: "tool_to_skill",
        title: `Add ${t.subject} to "${o.skill}"`,
        reason: `Agents used it ${t.n} times right after reading this skill, but the skill does not mention it.`,
        action: { type: "learn", skill: o.skill, part: "Tools", note: `Uses gateway_call ${t.subject}.`, label: "Add to skill" },
      });
    }
  }
  for (const m of sig.missing) {
    out.push({ key: `missing:${m.name.toLowerCase()}`, kind: "missing_entry", title: `Write "${m.name}"`, reason: `${m.n} ${m.n === 1 ? "entry links" : "entries link"} to it, but nobody has written it yet.`, action: { type: "open", screen: "memory", seed: m.name, label: "Write it" } });
  }
  for (const s of sig.sources) {
    if (!s.repoName.includes("/") || sig.now - s.indexedAt < STALE_SOURCE_MS) continue;
    out.push({ key: `stale_source:${s.repoName.toLowerCase()}`, kind: "stale_source", title: `Refresh ${s.repoName}`, reason: "Its documents were last read more than a week ago.", action: { type: "reindex", repo: s.repoName, label: "Refresh now" } });
  }
  return out;
}
