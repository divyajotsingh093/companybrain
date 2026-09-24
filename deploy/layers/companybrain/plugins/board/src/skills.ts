export const SKILL_PARTS = ["Skill", "Soul", "Heartbeat", "BrainWeaver", "Process", "Tools", "Connectors", "Plugins"] as const;
export type SkillPart = (typeof SKILL_PARTS)[number];

export const PART_PURPOSE: Record<SkillPart, string> = {
  Skill: "what this skill does, and when to reach for it",
  Soul: "the principles, voice and hard lines for doing it well",
  Heartbeat: "the signs it is drifting or going stale, and how often to revisit it",
  BrainWeaver: "how it connects to the rest of the brain, written as [[Entry name]] and owner/name",
  Process: "the steps, in order",
  Tools: "the tools it uses, such as MCP tools, commands and scripts",
  Connectors: "the systems and data it needs, such as repositories and gateway servers",
  Plugins: "the packaged extensions it depends on, such as agent plugins and skill packs",
};

export const MAX_LEARNED_PER_PART = 40;
export const MAX_LEARNING_CHARS = 600;
export const STALE_AFTER_MS = 30 * 24 * 3_600_000;
export const QUIET_AFTER_MS = 7 * 24 * 3_600_000;

export interface Learned {
  at: string;
  by: string;
  note: string;
}

export interface SkillParts {
  parts: Record<SkillPart, { text: string; learned: Learned[] }>;
}

const HEADING = new RegExp(`^##\\s+(${SKILL_PARTS.join("|")})\\s*$`, "i");
const LEARNED_LINE = /^- (\d{4}-\d{2}-\d{2}) learned by ([^:]{1,60}): (.+)$/;

const canonical = (raw: string): SkillPart => SKILL_PARTS.find((p) => p.toLowerCase() === raw.toLowerCase()) as SkillPart;

export function parseSkill(body: string): SkillParts {
  const parts = Object.fromEntries(SKILL_PARTS.map((p) => [p, { text: "", learned: [] as Learned[] }])) as SkillParts["parts"];
  let current: SkillPart = "Skill";
  const text = Object.fromEntries(SKILL_PARTS.map((p) => [p, [] as string[]])) as Record<SkillPart, string[]>;
  for (const line of body.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = canonical(heading[1] as string);
      continue;
    }
    const learned = LEARNED_LINE.exec(line);
    if (learned) parts[current].learned.push({ at: learned[1] as string, by: learned[2] as string, note: learned[3] as string });
    else text[current].push(line);
  }
  for (const p of SKILL_PARTS) parts[p].text = text[p].join("\n").trim();
  return { parts };
}

export function renderSkill(skill: SkillParts): string {
  return SKILL_PARTS.map((p) => {
    const { text, learned } = skill.parts[p];
    const lines = learned.map((l) => `- ${l.at} learned by ${l.by}: ${l.note}`);
    return [`## ${p}`, text, ...lines].filter((l) => l !== "").join("\n");
  }).join("\n\n");
}

export function learnInto(body: string, part: SkillPart, note: string, by: string, at: number): { body: string } | { full: true } {
  const skill = parseSkill(body);
  const target = skill.parts[part];
  if (target.learned.length >= MAX_LEARNED_PER_PART) return { full: true };
  const clean = note.replace(/\s+/g, " ").trim().slice(0, MAX_LEARNING_CHARS);
  if (!target.learned.some((l) => l.note.toLowerCase() === clean.toLowerCase())) {
    target.learned.push({ at: new Date(at).toISOString().slice(0, 10), by: by.replace(/[:\n]/g, " ").slice(0, 60), note: clean });
  }
  return { body: renderSkill(skill) };
}

export type PulseState = "new" | "fresh" | "quiet" | "stale";

export function pulse(skill: SkillParts, updatedAt: number, uses: number, now: number): { state: PulseState; lastLearned: string | null; learned: number; uses: number } {
  const all = SKILL_PARTS.flatMap((p) => skill.parts[p].learned);
  const lastLearned = all.map((l) => l.at).sort().at(-1) ?? null;
  const last = Math.max(updatedAt, lastLearned ? Date.parse(lastLearned) : 0);
  const state: PulseState = !all.length && !uses ? "new" : now - last > STALE_AFTER_MS ? "stale" : now - last > QUIET_AFTER_MS ? "quiet" : "fresh";
  return { state, lastLearned, learned: all.length, uses };
}
