import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.BOARD_URL;
const token = process.env.BOARD_TOKEN;
const repo = process.argv[2];
if (!url || !token || !repo) {
  console.error("usage: BOARD_URL=https://host BOARD_TOKEN=cb1... node scripts/smoke.ts <owner/repo>");
  process.exit(2);
}

type ToolResult = { content?: Array<{ text?: string }>; isError?: boolean };
const textOf = (r: unknown) => ((r as ToolResult).content ?? []).map((c) => c.text ?? "").join("\n");

const client = new Client({ name: "board-smoke", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${url.replace(/\/+$/, "")}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);

let failures = 0;
async function step(name: string, args: Record<string, unknown>, check: (text: string, result: ToolResult) => boolean) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const body = textOf(result);
  const ok = check(body, result);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${JSON.stringify(args)}  ->  ${body.replace(/\s+/g, " ").slice(0, 140)}`);
  return body;
}

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log(`tools: ${tools.join(", ")}`);
await step("whoami", {}, (t) => t.includes('"login"'));
await step("list_repos", { limit: 5 }, (t, r) => !r.isError && t.includes("fullName"));
await step("repo_overview", { repo }, (t, r) => !r.isError && t.includes("defaultBranch"));
await step("get_file", { repo, path: "README.md" }, (t, r) => !r.isError && t.startsWith("<untrusted"));
await step("search_code", { repo, query: "board" }, (_t, r) => !r.isError);
await step("board_read", { repo, limit: 3 }, (_t, r) => !r.isError);
await step("board_post", { repo, type: "finding", title: "Smoke test", body: "The board endpoint answered every tool." }, (t, r) => !r.isError && t.startsWith("Posted"));
await client.close();
console.log(failures ? `${failures} step(s) failed` : "all steps passed");
process.exit(failures ? 1 : 0);
