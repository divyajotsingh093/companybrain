import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AccessChecker } from "./access.ts";
import { assertRepo, GitHubError, type GitHubClient } from "./github.ts";
import { AGENT_POST_TYPES, MAX_CLAIM_MINUTES, POST_TYPES, type Post, type Store } from "./store.ts";
import type { Identity } from "./token.ts";
import { clamp, UNTRUSTED_NOTE, untrusted } from "./untrusted.ts";

const MAX_FILE_CHARS = 60_000;
const MAX_README_CHARS = 4_000;

export const INSTRUCTIONS = [
  "Company Brain board: shared context and coordination for agents working on GitHub repositories.",
  "Before starting work on a repository, call board_read to see open tasks, active claims, findings and handoffs.",
  "Post a claim with board_post before changing something another agent might also change, and release it with board_release when done.",
  "Record what you learn as a finding and pass unfinished work on with a handoff.",
  UNTRUSTED_NOTE,
].join(" ");

export interface BoardDeps {
  identity: Identity;
  github: GitHubClient;
  access: AccessChecker;
  store: Store;
}

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: string): Result => ({ content: [{ type: "text", text: value }] });
const failure = (value: string): Result => ({ content: [{ type: "text", text: value }], isError: true });

const NO_ACCESS = "Not found, or you do not have access.";
const NO_BOARD = "No board access for this repository. Board access requires triage, write, maintain or admin permission on it.";

async function guard(run: () => Promise<Result>): Promise<Result> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GitHubError) return failure(err.status === 400 ? err.message : NO_ACCESS);
    throw err;
  }
}

function renderPost(p: Post): string {
  const head = [`[${p.type}] ${p.title}`, `id=${p.id}`, `by=${p.authorLogin} via ${p.client}`, `at=${new Date(p.createdAt).toISOString()}`];
  if (p.target) head.push(`target=${p.target}`);
  if (p.to) head.push(`to=${p.to}`);
  if (p.expiresAt) head.push(`claimed_until=${new Date(p.expiresAt).toISOString()}`);
  return `${head.join(" | ")}\n${untrusted(`board:${p.repo}/${p.id}`, p.body)}`;
}

const repoArg = z.string().describe("Repository as owner/name");

export function createBoardServer(deps: BoardDeps): McpServer {
  const { identity, github, access, store } = deps;
  const server = new McpServer({ name: "companybrain-board", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "whoami",
    { description: "Show the GitHub account and agent client this connection acts as.", annotations: { readOnlyHint: true } },
    async () => text(JSON.stringify({ login: identity.login, client: identity.client })),
  );

  server.registerTool(
    "list_repos",
    {
      description: "List GitHub repositories you can access, most recently pushed first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => guard(async () => text(JSON.stringify(await github.listRepos(limit ?? 30), null, 2))),
  );

  server.registerTool(
    "repo_overview",
    {
      description: "Summarise a repository: description, languages, top-level layout, recent commits and README.",
      inputSchema: { repo: repoArg },
      annotations: { readOnlyHint: true },
    },
    ({ repo }) =>
      guard(async () => {
        const name = assertRepo(repo);
        const [detail, languages, topLevel, commits, readme] = await Promise.all([
          github.repo(name),
          github.languages(name),
          github.topLevel(name),
          github.recentCommits(name, 10),
          github.readme(name),
        ]);
        const facts = {
          repo: detail.fullName,
          private: detail.private,
          description: detail.description,
          defaultBranch: detail.defaultBranch,
          pushedAt: detail.pushedAt,
          languages,
          topLevel,
          recentCommits: commits,
        };
        const readmeBlock = readme ? `\n\nREADME:\n${untrusted(`github:${name}/README`, clamp(readme, MAX_README_CHARS))}` : "";
        return text(`${JSON.stringify(facts, null, 2)}${readmeBlock}`);
      }),
  );

  server.registerTool(
    "get_file",
    {
      description: "Read a file, or list a directory, from a repository.",
      inputSchema: { repo: repoArg, path: z.string().describe("Path within the repository"), ref: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ repo, path, ref }) =>
      guard(async () => {
        const result = await github.getFile(repo, path, ref);
        if (result.kind === "dir") return text(`Directory ${path}:\n${result.entries.join("\n")}`);
        return text(untrusted(`github:${repo}/${path}`, clamp(result.content, MAX_FILE_CHARS)));
      }),
  );

  server.registerTool(
    "search_code",
    {
      description: "Search code within one repository using GitHub code search.",
      inputSchema: { repo: repoArg, query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    ({ repo, query }) =>
      guard(async () => {
        const hits = await github.searchCode(repo, query);
        if (!hits.length) return text("No matches.");
        return text(hits.map((h) => `${h.path}\n${untrusted(`github:${repo}/${h.path}`, h.fragments.join("\n...\n"))}`).join("\n\n"));
      }),
  );

  server.registerTool(
    "board_read",
    {
      description: "Read a repository's board: tasks, active claims, findings and handoffs, newest first.",
      inputSchema: { repo: repoArg, type: z.enum(POST_TYPES).optional(), limit: z.number().int().min(1).max(200).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ repo, type, limit }) =>
      guard(async () => {
        const name = assertRepo(repo);
        if (!(await access.canUseBoard(identity, name))) return failure(NO_BOARD);
        const posts = store.list(name, { ...(type ? { type } : {}), ...(limit ? { limit } : {}) });
        return text(posts.length ? posts.map(renderPost).join("\n\n") : "The board is empty.");
      }),
  );

  server.registerTool(
    "board_post",
    {
      description:
        "Post to a repository's board. A claim marks work you are doing (needs target, expires after ttl_minutes). A finding records something learned. A handoff passes work on (needs to).",
      inputSchema: {
        repo: repoArg,
        type: z.enum(AGENT_POST_TYPES as [string, ...string[]]),
        title: z.string().min(1).max(200),
        body: z.string().max(20_000),
        target: z.string().max(500).optional().describe("What a claim covers: a task id, file path or area"),
        to: z.string().max(200).optional().describe("Who a handoff is for: a GitHub login or agent client"),
        ttl_minutes: z.number().int().min(1).max(MAX_CLAIM_MINUTES).optional(),
      },
    },
    ({ repo, type, title, body, target, to, ttl_minutes }) =>
      guard(async () => {
        const name = assertRepo(repo);
        if (!(await access.canUseBoard(identity, name))) return failure(NO_BOARD);
        if (type === "claim" && !target) return failure("A claim needs a target.");
        if (type === "handoff" && !to) return failure("A handoff needs a recipient in to.");
        const result = store.add({
          repo: name,
          type: type as Post["type"],
          title,
          body,
          target: target ?? null,
          to: to ?? null,
          authorLogin: identity.login,
          authorUid: identity.uid,
          client: identity.client,
          ...(ttl_minutes ? { ttlMinutes: ttl_minutes } : {}),
        });
        if (!result.ok) {
          const c = result.conflict;
          return failure(
            `Already claimed by ${c.authorLogin} via ${c.client} until ${new Date(c.expiresAt ?? 0).toISOString()} (claim ${c.id}). Pick other work or ask them to hand off.`,
          );
        }
        return text(`Posted ${result.post.type} ${result.post.id}.`);
      }),
  );

  server.registerTool(
    "board_release",
    {
      description: "Release a claim you made, so others can take the work.",
      inputSchema: { post_id: z.string().min(1) },
    },
    ({ post_id }) =>
      guard(async () => {
        const released = store.release(post_id, identity.uid, identity.client);
        return released ? text(`Released claim ${released.id}.`) : failure("No active claim with that id made by this connection.");
      }),
  );

  return server;
}
