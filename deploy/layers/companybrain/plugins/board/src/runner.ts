import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Model } from "./brain.ts";
import type { StarterAgent } from "./starter.ts";
import type { RunStep } from "./store.ts";
import { clamp, cleanLine, createFence, UNTRUSTED_NOTE } from "./untrusted.ts";

export const MAX_STEPS = 10;
export const RUN_DEADLINE_MS = 240_000;
const RESULT_CHARS = 3_000;
const HISTORY_CHARS = 20_000;
const STEP_TEXT = 1_200;
const TOOL_TIMEOUT_MS = 45_000;
const RUN_MAX_TOKENS = 2_000;

export interface AgentProfile {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  suggestions: string[];
  tools?: readonly string[];
  builds?: boolean;
}

export const CREATE_WRITES: ReadonlySet<string> = new Set(["brain_write", "memory_save"]);

export type Gate = (tool: string, args: Record<string, unknown>, readOnly: boolean) => Promise<string | null>;

type Action = { thought: string; tool: string; arguments: Record<string, unknown> } | { thought: string; final: string } | { thought: string; invalid: true };

const PROTOCOL = [
  "Work in steps. Reply with exactly one JSON object and nothing else.",
  'To use a tool: {"thought": "why, in one sentence", "tool": "tool_name", "arguments": { ... }}',
  'When the goal is done, or you cannot go further: {"thought": "why", "final": "what you did and found, written for the person"}',
  "Use only the tools listed. Take one tool call per step. Stop as soon as the goal is met.",
  UNTRUSTED_NOTE,
].join("\n");

function actionOf(obj: Record<string, unknown>): Action | null {
  const thought = typeof obj.thought === "string" ? obj.thought : "";
  if (typeof obj.tool === "string" && obj.tool) {
    const args = obj.arguments && typeof obj.arguments === "object" && !Array.isArray(obj.arguments) ? (obj.arguments as Record<string, unknown>) : {};
    return { thought, tool: obj.tool, arguments: args };
  }
  if (typeof obj.final === "string") return { thought, final: obj.final };
  return null;
}

export function parseAction(reply: string): Action {
  const text = reply.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/```(?:json)?/g, "").trim();
  if (!text.includes("{")) return { thought: "", final: text };
  for (let start = text.indexOf("{"), tries = 0; start >= 0 && tries < 20; start = text.indexOf("{", start + 1), tries++) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        continue;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const action = actionOf(parsed as Record<string, unknown>);
        if (action) return action;
      }
    }
  }
  return { thought: "", invalid: true };
}

function recent(history: string[]): string {
  const kept: string[] = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i] as string;
    if (size + item.length > HISTORY_CHARS) break;
    kept.unshift(item);
    size += item.length;
  }
  return kept.join("\n\n");
}

export async function runAgent(opts: {
  model: Model;
  client: Client;
  profile: AgentProfile;
  goal: string;
  gate: Gate;
  record: (step: Omit<RunStep, "at">) => Promise<void>;
  onCall?: (tool: string, args: Record<string, unknown>, ok: boolean) => Promise<void>;
  signal?: AbortSignal;
}): Promise<{ status: "done" | "stopped"; answer: string }> {
  const { profile, record } = opts;
  const tools = (await opts.client.listTools()).tools.filter((t) => !profile.tools || profile.tools.includes(t.name));
  const catalog = tools
    .map((t) => `- ${t.name}(${Object.keys((t.inputSchema?.properties ?? {}) as Record<string, unknown>).join(", ")}): ${(t.description ?? "").split("\n")[0]}`)
    .join("\n");
  const fence = createFence();
  const history: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1;
    const prompt = [
      profile.instructions,
      `The person's goal:\n${opts.goal}`,
      `Tools you can use:\n${catalog}`,
      PROTOCOL,
      history.length ? `What you have done so far:\n${recent(history)}` : "You have not taken any steps yet.",
      last ? "This is your last step. Reply with a final answer now." : `Step ${step + 1} of ${MAX_STEPS}.`,
    ].join("\n\n");
    const action = parseAction(await opts.model(prompt, { maxTokens: RUN_MAX_TOKENS, ...(opts.signal ? { signal: opts.signal } : {}) }));
    if (action.thought) await record({ kind: "thought", text: clamp(cleanLine(action.thought, 600), STEP_TEXT) });
    if ("invalid" in action) {
      await record({ kind: "error", text: "The model's reply was not valid JSON, so the agent was asked again." });
      history.push(`Step ${step + 1}: your reply was not a valid JSON object. Reply with exactly one JSON object. Keep bodies short so the reply is not cut off.`);
      continue;
    }
    if ("final" in action) {
      const answer = clamp(action.final.trim() || "The agent finished without a summary.", 6_000);
      await record({ kind: "final", text: answer });
      return { status: "done", answer };
    }
    const args = JSON.stringify(action.arguments);
    const known = tools.find((t) => t.name === action.tool);
    const refused = known ? await opts.gate(action.tool, action.arguments, known.annotations?.readOnlyHint === true) : `${action.tool} is not one of your tools.`;
    if (refused) {
      await record({ kind: "blocked", tool: cleanLine(action.tool, 80), text: refused });
      history.push(`Step ${step + 1}: you asked for ${cleanLine(action.tool, 80)}. It was refused: ${refused}`);
      continue;
    }
    await record({ kind: "call", tool: action.tool, text: clamp(args, STEP_TEXT) });
    let result: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    try {
      result = (await opts.client.callTool({ name: action.tool, arguments: action.arguments }, undefined, { timeout: TOOL_TIMEOUT_MS, ...(opts.signal ? { signal: opts.signal } : {}) })) as typeof result;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      result = { isError: true, content: [{ type: "text", text: "The tool did not answer in time, or failed. Try another approach." }] };
    }
    const text = (result.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`)).join("\n") || "(no output)";
    await record({ kind: "result", tool: action.tool, text: clamp(text, STEP_TEXT), ok: result.isError !== true });
    await opts.onCall?.(action.tool, action.arguments, result.isError !== true);
    history.push(`Step ${step + 1}: you called ${action.tool} with ${clamp(args, 600)}.${result.isError ? " It failed." : ""} Result:\n${fence.wrap(`tool:${action.tool}`, clamp(text, RESULT_CHARS))}`);
  }
  const answer = `Stopped after ${MAX_STEPS} steps without a final answer. The steps above show how far it got.`;
  await record({ kind: "final", text: answer });
  return { status: "stopped", answer };
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const LIBRARIAN_GOAL =
  "Read what this company has indexed and written down, then add the entries that are missing: processes, rules, roles, lessons, records, skills and memory. Link each new entry to related ones with [[Name]]. Add at most five entries, and finish with a list of what you added and why.";

export const LIBRARIAN: AgentProfile = {
  id: "librarian",
  name: "Librarian",
  summary: "Builds the brain on its own: reads your sources and writes the processes, rules, roles, lessons and skills that are missing.",
  instructions: [
    "You are the Librarian for this company's shared brain. Your job is to keep the brain complete, so every agent and person finds what they need.",
    "Start with memory_index and brain_search to see what exists. Use list_repos, repo_overview, search_code, get_file and brain_read to learn from the company's own sources.",
    "Write only what the sources support. Never invent policy. Never replace an existing entry: pick a new, specific name, or skip it.",
    "Prefer processes (how recurring work gets done), rules (what is allowed and who approves), roles (who owns what), lessons (what went wrong and what to do instead) and records (facts worth keeping). Keep each entry short and concrete, and link related entries with [[Name]].",
  ].join("\n"),
  suggestions: [LIBRARIAN_GOAL, "Write down the release process from what the repositories show, as a process entry.", "Find rules hidden in the code and docs, such as who approves what, and record them."],
  tools: ["whoami", "memory_index", "memory_save", "brain_search", "brain_read", "brain_links", "brain_write", "skill_read", "list_repos", "repo_overview", "search_code", "get_file"],
  builds: true,
};

export const ASSISTANT: AgentProfile = {
  id: "assistant",
  name: "Assistant",
  summary: "A general agent with every Company Brain tool: search, memory, skills, boards, decisions and your connected servers.",
  instructions: [
    "You are an agent working inside this company's Company Brain, on behalf of the signed-in person.",
    "Start with memory_index to load what the company already knows. Use brain_search before guessing. Save what you learn with memory_save or brain_write so the next agent has it.",
    "Ask a person with board_ask before anything risky: deleting data, force-pushing, changing production, spending money or contacting a customer.",
  ].join("\n"),
  suggestions: ["What should a new engineer know first? Save the answer as memory.", "Summarise what is open on the board and what is waiting on a person.", "List the tools my connected servers offer and suggest a skill for the most useful one."],
};

export function profilesFor(starters: StarterAgent[]): AgentProfile[] {
  const roles = starters.map((a) => ({
    id: slug(a.name),
    name: a.name,
    summary: a.summary,
    instructions: [
      `You are the ${a.name} agent in this company's Company Brain, acting for the signed-in person.`,
      `You own: ${a.owns}`,
      `You decide: ${a.decides}`,
      `Ask a person with board_ask before: ${a.asks} If board_ask is refused because changes are off, stop and say what needs a person.`,
      `Read the skill "${a.skill}" with skill_read first and follow it. Start with memory_index, and save what you learn with memory_save.`,
    ].join("\n"),
    suggestions: [`Follow "${a.skill}" for the work that is open on the board.`, `What is the next thing a ${a.name.toLowerCase()} should do here? Do the first safe step.`],
  }));
  return [ASSISTANT, LIBRARIAN, ...roles];
}
