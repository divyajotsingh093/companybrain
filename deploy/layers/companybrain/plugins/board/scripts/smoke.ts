import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.BOARD_URL;
const token = process.env.BOARD_TOKEN;
const repo = process.argv[2];
if (!url || !token || !repo) {
  console.error("usage: BOARD_URL=https://host BOARD_TOKEN=cb2_... node scripts/smoke.ts <owner/repo>");
  process.exit(2);
}

type ToolResult = { content?: Array<{ text?: string }>; isError?: boolean };
const textOf = (r: unknown) => ((r as ToolResult).content ?? []).map((c) => c.text ?? "").join("\n");

const base = url.replace(/\/+$/, "");
const getStatus = (await fetch(`${base}/mcp`, { method: "GET" })).status;
console.log(`${getStatus === 405 ? "PASS" : "FAIL"}  GET /mcp returns 405 (got ${getStatus})`);
let failures = getStatus === 405 ? 0 : 1;

const client = new Client({ name: "board-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));

async function step(name: string, args: Record<string, unknown>, check: (text: string, result: ToolResult) => boolean): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const body = textOf(result);
  const ok = check(body, result);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${JSON.stringify(args)}  ->  ${body.replace(/\s+/g, " ").slice(0, 160)}`);
  return body;
}

console.log(`tools: ${(await client.listTools()).tools.map((t) => t.name).sort().join(", ")}`);
await step("whoami", {}, (t) => t.includes('"login"'));
await step("list_repos", { limit: 5 }, (t, r) => !r.isError && t.includes("fullName"));
await step("repo_overview", { repo }, (t, r) => !r.isError && t.includes("defaultBranch"));
await step("get_file", { repo, path: "README.md" }, (t, r) => !r.isError && t.startsWith("<untrusted-"));
await step("search_code", { repo, query: "board" }, (_t, r) => !r.isError);
await step("search_code", { repo, query: "x repo:other/elsewhere" }, (t, r) => r.isError === true && t.includes("qualifiers"));
await step("board_read", { repo, limit: 3 }, (_t, r) => !r.isError);
const target = `smoke-${Math.floor(Math.random() * 1e9)}`;
const claim = await step("board_post", { repo, type: "claim", title: "Smoke claim", body: "smoke", target, ttl_minutes: 5 }, (t, r) => !r.isError && t.startsWith("Posted claim"));
await step("board_post", { repo, type: "claim", title: "Smoke claim", body: "renew", target, ttl_minutes: 5 }, (t, r) => !r.isError && t.startsWith("Renewed claim"));
const claimId = /claim ([0-9a-f-]{36})/.exec(claim)?.[1];
if (claimId) await step("board_release", { post_id: claimId }, (t, r) => !r.isError && t.startsWith("Released"));
await step("board_post", { repo, type: "finding", title: "Smoke test", body: "The board endpoint answered every tool." }, (t, r) => !r.isError && t.startsWith("Posted finding"));
await client.close();
console.log(failures ? `${failures} step(s) failed` : "all steps passed");
process.exit(failures ? 1 : 0);
