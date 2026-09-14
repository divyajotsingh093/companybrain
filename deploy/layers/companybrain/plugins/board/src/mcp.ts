import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type AccessChecker, canModerate, canUseBoard, type RepoAccess } from "./access.ts";
import type { Principal } from "./auth.ts";
import { assertRepo, GitHubError, type GitHubClient, MAX_FILE_BYTES } from "./github.ts";
import { AGENT_POST_TYPES, MAX_CLAIM_MINUTES, POST_TYPES, POSTS_PER_HOUR, ACTIVE_CLAIMS_PER_USER, type Post, type Store } from "./store.ts";
import { clamp, cleanLine, createFence, type Fence, UNTRUSTED_NOTE } from "./untrusted.ts";

const MAX_FILE_CHARS = 60_000;
const MAX_README_CHARS = 4_000;
const MAX_POST_BODY_CHARS = 2_000;

export const INSTRUCTIONS = [
  "Company Brain board: shared context and coordination for agents working on GitHub repositories.",
  "Before starting work on a repository, call board_read to see open tasks, active claims, findings and handoffs.",
  "Post a claim with board_post before changing something another agent might also change; post it again to renew it, and release it with board_release when done.",
  "Record what you learn as a finding and pass unfinished work on with a handoff.",
  UNTRUSTED_NOTE,
].join(" ");

export interface BoardDeps {
  principal: Principal;
  access: AccessChecker;
  store: Store;
  github: () => Promise<GitHubClient>;
  publicUrl: string;
  now: () => number;
}

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (value: string): Result => ({ content: [{ type: "text", text: value }] });
const failure = (value: string): Result => ({ content: [{ type: "text", text: value }], isError: true });

export const NO_ACCESS = "Not found, or you do not have access.";
export const NO_BOARD = "No board access for this repository. Board access requires triage, write, maintain or admin permission on it.";

class BoardDenied extends Error {}

export function describeError(err: GitHubError, publicUrl: string): string {
  switch (err.kind) {
    case "invalid":
      return err.message;
    case "unauthorized":
      return `GitHub authorization expired or was revoked. Reconnect at ${publicUrl}.`;
    case "rate_limited":
      return "GitHub rate limit reached. Try again shortly.";
    case "moved":
      return "This repository has moved. Use its current owner/name.";
    case "empty":
      return "This repository is empty.";
    case "unprocessable":
      return `GitHub rejected the request: ${err.message}`;
    case "unavailable":
      return "GitHub is unavailable right now. Try again shortly.";
    default:
      return NO_ACCESS;
  }
}

function renderPost(p: Post, fence: Fence): string {
  const lines = [
    `title: ${p.title}`,
    `by: ${p.authorLogin} via ${p.client}`,
    `at: ${new Date(p.createdAt).toISOString()}`,
  ];
  if (p.target) lines.push(`target: ${p.target}`);
  if (p.to) lines.push(`to: ${p.to}`);
  if (p.expiresAt) lines.push(`claimed_until: ${new Date(p.expiresAt).toISOString()}`);
  lines.push("", clamp(p.body, MAX_POST_BODY_CHARS));
  return `post ${p.id} (${p.type})\n${fence.wrap(`board:${p.repoName}`, lines.join("\n"))}`;
}

const repoArg = z.string().max(201).describe("Repository as owner/name");

export function createBoardServer(deps: BoardDeps): McpServer {
  const { principal, access, store, publicUrl } = deps;
  const server = new McpServer({ name: "companybrain-board", version: "0.2.0" }, { instructions: INSTRUCTIONS });

  async function guard(run: () => Promise<Result>): Promise<Result> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof BoardDenied) return failure(NO_BOARD);
      if (err instanceof GitHubError) return failure(describeError(err, publicUrl));
      console.error(`board tool error: ${err instanceof Error ? err.name : typeof err}`);
      return failure("Something went wrong on the board server. Try again shortly.");
    }
  }

  async function boardAccess(repo: string): Promise<RepoAccess> {
    let result: RepoAccess;
    try {
      result = await access.check(principal.uid, principal.login, assertRepo(repo));
    } catch (err) {
      if (err instanceof GitHubError && (err.kind === "not_found" || err.kind === "forbidden" || err.kind === "moved")) throw new BoardDenied();
      throw err;
    }
    if (!canUseBoard(result.role)) throw new BoardDenied();
    return result;
  }

  server.registerTool(
    "whoami",
    { description: "Show the GitHub account and agent client this connection acts as.", annotations: { readOnlyHint: true } },
    async () => text(JSON.stringify({ login: principal.login, client: principal.client })),
  );

  server.registerTool(
    "list_repos",
    {
      description: "List repositories that both you and this app can access on GitHub, most recently pushed first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) =>
      guard(async () => {
        const repos = await (await deps.github()).listRepos(limit ?? 30);
        return text(createFence().wrap("github:repositories", JSON.stringify(repos, null, 2)));
      }),
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
        const github = await deps.github();
        const detail = await github.repo(name);
        const optional = async <T>(load: Promise<T>, empty: T): Promise<T> => {
          try {
            return await load;
          } catch (err) {
            if (err instanceof GitHubError && (err.kind === "empty" || err.kind === "not_found")) return empty;
            throw err;
          }
        };
        const [languages, topLevel, commits, readme] = await Promise.all([
          optional(github.languages(name), {}),
          optional(github.topLevel(name), [] as string[]),
          optional(github.recentCommits(name, 10), [] as Array<{ sha: string; message: string; author: string; date: string }>),
          optional(github.readme(name), null as string | null),
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
          readme: readme ? clamp(readme, MAX_README_CHARS) : null,
        };
        return text(createFence().wrap(`github:${detail.fullName}`, JSON.stringify(facts, null, 2)));
      }),
  );

  server.registerTool(
    "get_file",
    {
      description: `Read a text file (up to ${MAX_FILE_BYTES} bytes), or list a directory, from a repository.`,
      inputSchema: { repo: repoArg, path: z.string().min(1).max(1000).describe("Path within the repository"), ref: z.string().max(250).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ repo, path, ref }) =>
      guard(async () => {
        const result = await (await deps.github()).getFile(repo, path, ref);
        const fence = createFence();
        const source = `github:${repo}/${path}`;
        switch (result.kind) {
          case "dir":
            return text(fence.wrap(source, `Directory listing:\n${result.entries.join("\n")}`));
          case "too_large":
            return failure(`That file is ${result.size} bytes, over the ${MAX_FILE_BYTES}-byte limit.`);
          case "binary":
            return failure(`That is a binary file (${result.size} bytes).`);
          case "other":
            return failure(`That path is a ${cleanLine(result.type, 30)}, not a file or directory.`);
          case "file":
            return text(fence.wrap(source, clamp(result.content, MAX_FILE_CHARS)));
        }
      }),
  );

  server.registerTool(
    "search_code",
    {
      description:
        "Search code in one repository's default branch using GitHub code search. Plain search terms only; scope qualifiers such as repo: or org: are rejected. GitHub limits code search to about 10 requests a minute.",
      inputSchema: { repo: repoArg, query: z.string().min(1).max(256) },
      annotations: { readOnlyHint: true },
    },
    ({ repo, query }) =>
      guard(async () => {
        const hits = await (await deps.github()).searchCode(repo, query);
        if (!hits.length) return text("No matches.");
        const fence = createFence();
        return text(hits.map((h) => fence.wrap(`github:${h.repo}/${h.path}`, `${h.path}\n${h.fragments.join("\n...\n")}`)).join("\n\n"));
      }),
  );

  server.registerTool(
    "board_read",
    {
      description: "Read a repository's board: all open tasks and active claims, then the most recent findings and handoffs.",
      inputSchema: { repo: repoArg, type: z.enum(POST_TYPES).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ repo, type, limit }) =>
      guard(async () => {
        const a = await boardAccess(repo);
        const board = store.readBoard(a.repoId, { ...(type ? { type } : {}), ...(limit ? { limit } : {}) });
        const fence = createFence();
        const section = (title: string, posts: Post[]) => (posts.length ? `## ${title}\n\n${posts.map((p) => renderPost(p, fence)).join("\n\n")}` : "");
        const out = [
          section("Open tasks", board.tasks),
          section("Active claims", board.claims),
          section("Recent findings and handoffs", board.recent),
        ].filter(Boolean);
        return text(out.length ? out.join("\n\n") : "The board is empty.");
      }),
  );

  server.registerTool(
    "board_post",
    {
      description:
        "Post to a repository's board. A claim marks work you are doing (needs target; post again to renew; expires after ttl_minutes). A finding records something learned. A handoff passes work on (needs to).",
      inputSchema: {
        repo: repoArg,
        type: z.enum(AGENT_POST_TYPES),
        title: z.string().min(1).max(200),
        body: z.string().max(20_000),
        target: z.string().max(500).optional().describe("What a claim covers: a task title, file path or area"),
        to: z.string().max(200).optional().describe("Who a handoff is for: a GitHub login or agent client"),
        ttl_minutes: z.number().int().min(1).max(MAX_CLAIM_MINUTES).optional(),
      },
    },
    ({ repo, type, title, body, target, to, ttl_minutes }) =>
      guard(async () => {
        const a = await boardAccess(repo);
        const cleanTitle = cleanLine(title, 200);
        const cleanTarget = target ? cleanLine(target, 500) : "";
        const cleanTo = to ? cleanLine(to, 200) : "";
        if (!cleanTitle) return failure("A post needs a title.");
        if (type === "claim" && !cleanTarget) return failure("A claim needs a target.");
        if (type === "handoff" && !cleanTo) return failure("A handoff needs a recipient in to.");
        const result = store.addPost({
          repoId: a.repoId,
          repoName: a.fullName,
          type,
          title: cleanTitle,
          body,
          target: cleanTarget || null,
          to: cleanTo || null,
          authorLogin: principal.login,
          authorUid: principal.uid,
          client: principal.client,
          ...(ttl_minutes ? { ttlMinutes: ttl_minutes } : {}),
        });
        if (result.ok) return text(`${result.renewed ? "Renewed" : "Posted"} ${result.post.type} ${result.post.id}.`);
        if (result.reason !== "conflict") {
          return failure(
            result.reason === "post_quota"
              ? `Post limit reached: ${POSTS_PER_HOUR} posts an hour per repository.`
              : `Claim limit reached: ${ACTIVE_CLAIMS_PER_USER} active claims per repository. Release one first.`,
          );
        }
        const c = result.conflict;
        return failure(
          `Already claimed until ${new Date(c.expiresAt ?? 0).toISOString()} by claim ${c.id}. Pick other work, or ask the claimant to hand off.\n${createFence().wrap(
            `board:${c.repoName}`,
            `by: ${c.authorLogin} via ${c.client}`,
          )}`,
        );
      }),
  );

  server.registerTool(
    "board_release",
    {
      description: "Release a claim so others can take the work. You can release your own claims; maintainers and admins can release any.",
      inputSchema: { post_id: z.string().uuid() },
    },
    ({ post_id }) =>
      guard(async () => {
        const post = store.getPost(post_id);
        if (!post || post.type !== "claim") return failure("No claim with that id.");
        let current: string;
        try {
          current = (await (await deps.github()).repoById(post.repoId)).fullName;
        } catch (err) {
          if (err instanceof GitHubError && (err.kind === "not_found" || err.kind === "forbidden")) throw new BoardDenied();
          throw err;
        }
        const a = await boardAccess(current);
        if (a.repoId !== post.repoId) throw new BoardDenied();
        const own = post.authorUid === principal.uid && post.client === principal.client;
        if (!own && !canModerate(a.role)) return failure("Only the claimant, or a maintainer or admin, can release this claim.");
        if (post.releasedAt !== null) return failure("That claim was already released.");
        if ((post.expiresAt ?? 0) <= deps.now()) return failure("That claim already expired.");
        store.releaseClaim(post.id);
        return text(`Released claim ${post.id}.`);
      }),
  );

  return server;
}
