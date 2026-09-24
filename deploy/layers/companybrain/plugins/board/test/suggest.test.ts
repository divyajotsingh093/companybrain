import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { rank, SNOOZE_MS, type Suggestion } from "../src/suggest.ts";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

type H = Awaited<ReturnType<typeof buildApp>>;
const DAY = 24 * 3_600_000;
const json = (h: H, path: string, cookie: string, method = "GET", body?: unknown) =>
  h.app.fetch(new Request(`${ORIGIN}${path}`, { method, headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
const list = async (h: H, cookie: string) => (await (await json(h, "/api/app/suggestions", cookie)).json()) as { suggestions: Suggestion[]; choices: number };

const candidate = (key: string, kind: Suggestion["kind"]) => ({ key, kind, title: key, reason: "", action: { type: "open" as const, screen: "home", label: "Go" } });

test("the loop learns which kinds of suggestion a person acts on", () => {
  const now = 10 * DAY;
  const pool = [candidate("a", "stale_skill"), candidate("b", "stale_source")];
  assert.equal(rank(pool, { stats: [], latest: [] }, now)[0]?.key, "b", "with no history, the higher base value leads");

  const trained = rank(
    pool,
    { stats: [{ kind: "stale_skill", verdict: "accepted", n: 6 }, { kind: "stale_source", verdict: "dismissed", n: 6 }], latest: [] },
    now,
  );
  assert.equal(trained[0]?.key, "a", "after acting on one kind and dismissing the other, the order flips");
  assert.equal(trained[0]?.learned, "You acted on 6 of 6 suggestions like this.");

  const history = (verdict: string, at: number) => ({ stats: [], latest: [{ key: "a", verdict, at }] });
  assert.deepEqual(rank(pool, history("dismissed", 0), now).map((s) => s.key), ["b"], "dismissed never comes back");
  assert.deepEqual(rank(pool, history("snoozed", now - DAY), now).map((s) => s.key), ["b"], "snoozed stays away for a while");
  assert.deepEqual(rank(pool, history("snoozed", now - SNOOZE_MS - 1), now).map((s) => s.key).sort(), ["a", "b"], "and then returns");
});

test("questions nobody could answer become suggestions with options", async () => {
  const h = await buildApp({}, { model: async () => "answer" });
  const cookie = await sessionCookie(h, "gh-alice");
  await json(h, "/api/app/ask", cookie, "POST", { question: "who owns billing?" });
  await json(h, "/api/app/ask", cookie, "POST", { question: "who owns billing?" });

  const first = await list(h, cookie);
  const gap = first.suggestions.find((s) => s.kind === "unanswered_question");
  assert.equal(gap?.title, 'Nothing written down for "who owns billing?"');
  assert.match(gap?.reason ?? "", /Asked 2 times/);
  assert.deepEqual(gap?.action, { type: "open", screen: "work", seed: "Write down the answer to: who owns billing?", label: "Ask an agent to write it" });

  const accepted = await json(h, "/api/app/suggestions", cookie, "POST", { key: gap?.key, verdict: "accepted" });
  assert.equal(accepted.status, 200);
  const after = await list(h, cookie);
  assert.equal(after.choices, 1, "the choice is recorded");
  assert.ok(!after.suggestions.some((s) => s.key === gap?.key), "and the suggestion steps aside once acted on");

  assert.equal((await json(h, "/api/app/suggestions", cookie, "POST", { key: "made:up", verdict: "accepted" })).status, 404);
  const cross = await h.app.fetch(new Request(`${ORIGIN}/api/app/suggestions`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ key: gap?.key, verdict: "dismissed" }) }));
  assert.equal(cross.status, 403);
});

test("a tool agents keep using is offered to the skill, and accepting adds it", async (t) => {
  const gatewayFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const server = new McpServer({ name: "tickets", version: "1.0.0" });
    server.registerTool("find_ticket", { description: "Find a ticket.", inputSchema: { id: z.string() } }, ({ id }) => ({ content: [{ type: "text", text: `Ticket ${id}` }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
  const h = await buildApp({}, { gatewayFetch });
  const cookie = await sessionCookie(h, "gh-alice");
  await json(h, "/api/app/gateway", cookie, "POST", { name: "tickets", url: "https://tickets.example.com/mcp" });
  const agent = await connectAgent(t, h, await agentToken(h, "gh-alice", "claude_code"));
  await call(agent, "skill_learn", { name: "Triage", part: "Skill", learned: "Sort incoming bugs." });
  h.clock.now += 60_000;
  await call(agent, "skill_read", { name: "Triage" });
  await call(agent, "gateway_call", { server: "tickets", tool: "find_ticket", arguments: { id: "1" } });
  await call(agent, "gateway_call", { server: "tickets", tool: "find_ticket", arguments: { id: "2" } });

  const offer = (await list(h, cookie)).suggestions.find((s) => s.kind === "tool_to_skill");
  assert.equal(offer?.title, 'Add tickets:find_ticket to "Triage"');
  assert.equal((await json(h, "/api/app/suggestions", cookie, "POST", { key: offer?.key, verdict: "accepted" })).status, 200);

  const view = (await (await json(h, "/api/app/skill?name=Triage", cookie)).json()) as { parts: Record<string, { learned: Array<{ by: string; note: string }> }> };
  assert.deepEqual(view.parts.Tools?.learned.map((l) => [l.by, l.note]), [["company-brain", "Uses gateway_call tickets:find_ticket."]]);
  assert.ok(!(await list(h, cookie)).suggestions.some((s) => s.kind === "tool_to_skill"), "once the skill mentions it, it is no longer suggested");
});

test("a stale repository can be refreshed straight from its suggestion", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  await json(h, "/api/app/sources", cookie, "POST", { repo: "acme/app" });
  h.clock.now += 8 * DAY;
  const fresh = await sessionCookie(h, "gh-alice");
  const stale = (await list(h, fresh)).suggestions.find((s) => s.kind === "stale_source");
  assert.equal(stale?.action.type, "reindex");
  assert.equal((await json(h, "/api/app/suggestions", fresh, "POST", { key: stale?.key, verdict: "accepted" })).status, 200);
  const sources = (await (await json(h, "/api/app/sources", fresh)).json()) as { sources: Array<{ indexedAt: number }> };
  assert.equal(sources.sources[0]?.indexedAt, h.clock.now, "accepting ran the refresh");
});

test("no question text is kept in the loop's own history, and disconnecting clears it", async () => {
  const h = await buildApp({}, { model: async () => "answer" });
  const cookie = await sessionCookie(h, "gh-alice");
  await json(h, "/api/app/ask", cookie, "POST", { question: "what is the secret launch date?" });
  const gap = (await list(h, cookie)).suggestions.find((s) => s.kind === "unanswered_question");
  assert.ok(gap && !gap.key.includes("secret"), "the suggestion key is a hash, not the question");
  await json(h, "/api/app/suggestions", cookie, "POST", { key: gap?.key, verdict: "snoozed" });
  assert.ok(!JSON.stringify(await h.store.suggestionHistory(1)).includes("secret"));
  assert.ok(!(await h.store.auditTrail(1, 50)).some((a) => a.tool === "ask"), "unanswered questions stay out of activity lists");

  await h.store.deleteCredential(1);
  assert.deepEqual((await h.store.suggestionHistory(1)).latest, [], "disconnecting removes the choices too");
});

test("suggestions are rate limited", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  let limited = false;
  for (let i = 0; i < 32 && !limited; i += 1) limited = (await json(h, "/api/app/suggestions", cookie)).status === 429;
  assert.ok(limited);
});
