export const MEMORY_TYPES = ["user", "feedback", "project", "reference", "topic", "creative"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_PURPOSE: Record<MemoryType, string> = {
  user: "who the person is: role, expertise, how they like to work",
  feedback: "how they want work done: corrections and approaches they confirmed, with the reason",
  project: "ongoing work, goals, constraints and dates that the code does not show",
  reference: "where things live: dashboards, documents, tickets, servers",
  topic: "subjects they know or care about, and what they think about them",
  creative: "ideas, taste and style they are developing",
};

export interface Memory {
  type: MemoryType;
  description: string;
  fact: string;
  why: string;
  how: string;
  auto: boolean;
}

const WHY = /^\*\*Why:\*\*\s*/;
const HOW = /^\*\*How to apply:\*\*\s*/;

export const isMemoryType = (v: string): v is MemoryType => (MEMORY_TYPES as readonly string[]).includes(v);

export function parseMemory(body: string): Memory {
  const memory: Memory = { type: "topic", description: "", fact: "", why: "", how: "", auto: false };
  let rest = body;
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (header) {
    rest = body.slice(header[0].length);
    for (const line of (header[1] as string).split("\n")) {
      const [key, ...value] = line.split(":");
      const v = value.join(":").trim();
      if (key === "type" && isMemoryType(v)) memory.type = v;
      if (key === "description") memory.description = v;
      if (key === "source") memory.auto = v === "auto";
    }
  }
  const fact: string[] = [];
  let into: "fact" | "why" | "how" = "fact";
  const why: string[] = [];
  const how: string[] = [];
  for (const line of rest.split("\n")) {
    if (WHY.test(line)) {
      into = "why";
      why.push(line.replace(WHY, ""));
    } else if (HOW.test(line)) {
      into = "how";
      how.push(line.replace(HOW, ""));
    } else (into === "fact" ? fact : into === "why" ? why : how).push(line);
  }
  memory.fact = fact.join("\n").trim();
  memory.why = why.join("\n").trim();
  memory.how = how.join("\n").trim();
  if (!memory.description) memory.description = memory.fact.split("\n")[0]?.slice(0, 160) ?? "";
  return memory;
}

export function renderMemory(m: Memory): string {
  const header = ["---", `type: ${m.type}`, `description: ${m.description.replace(/\s+/g, " ").trim().slice(0, 200)}`, ...(m.auto ? ["source: auto"] : []), "---"];
  return [header.join("\n"), m.fact.trim(), m.why.trim() ? `**Why:** ${m.why.trim()}` : "", m.how.trim() ? `**How to apply:** ${m.how.trim()}` : ""].filter(Boolean).join("\n\n");
}
