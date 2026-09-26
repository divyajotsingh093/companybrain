import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createPipedreamAdapter, pipedreamGatewayUrl, pipedreamSlug } from "../src/pipedream.ts";
import { agentToken, buildApp, call, connectAgent, ORIGIN, sessionCookie } from "./fixtures.ts";

const pdConfig = { clientId: "test-client", clientSecret: "test-secret", projectId: "proj_test", environment: "development" as const };

test("Pipedream adapter caches short-lived auth and isolates user headers", async () => {
  const seen: Array<{ uid: string; slug: string; authorization: string }> = [];
  let issued = 0;
  let time = 1_800_000_000_000;
  const fake: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    if (req.url === "https://api.pipedream.com/v1/oauth/token") {
      const body = await req.json() as Record<string, string>;
      assert.deepEqual(body, { grant_type: "client_credentials", client_id: "test-client", client_secret: "test-secret" });
      return Response.json({ access_token: `pd-${++issued}`, expires_in: 120 });
    }
    assert.equal(new URL(req.url).origin, "https://remote.mcp.pipedream.net");
    seen.push({ uid: req.headers.get("x-pd-external-user-id") ?? "", slug: req.headers.get("x-pd-app-slug") ?? "", authorization: req.headers.get("authorization") ?? "" });
    assert.equal(req.headers.get("x-pd-project-id"), "proj_test");
    assert.equal(req.headers.get("x-pd-environment"), "development");
    const server = new McpServer({ name: "fake-pipedream", version: "0.1.0" });
    server.registerTool("read_item", { inputSchema: { id: z.string() } }, ({ id }) => ({ content: [{ type: "text", text: `item ${id}` }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
  const adapter = createPipedreamAdapter({ config: pdConfig, fetch: fake, now: () => time });
  for (const uid of [1, 2, 1]) {
    const upstream = await adapter.open(uid, "notion");
    try { assert.equal((await upstream.tools())[0]?.name, "read_item"); } finally { await upstream.close(); }
  }
  assert.equal(issued, 1);
  assert.deepEqual([...new Set(seen.map((s) => s.uid))], ["companybrain-1", "companybrain-2"]);
  assert.ok(seen.every((s) => s.slug === "notion" && s.authorization === "Bearer pd-1"));
  time += 61_000;
  const refreshed = await adapter.open(1, "notion");
  await refreshed.close();
  assert.equal(issued, 2);
});

test("Pipedream connection is opt-in, development-only and per user", async (t) => {
  const fake: typeof fetch = async () => Response.json({ access_token: "test", expires_in: 120 });
  const h = await buildApp({ pipedream: pdConfig }, { gatewayFetch: fake });
  const alice = await sessionCookie(h, "gh-alice");
  const request = (app: string, cookie: string, origin = ORIGIN) => h.app.fetch(new Request(`${ORIGIN}/api/app/gateway/pipedream`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ app }) }));
  assert.equal((await request("notion", alice, "https://wrong.example")).status, 403);
  assert.equal((await request("https://evil.example", alice)).status, 400);
  assert.equal((await request("notion", alice)).status, 200);
  const listed = await h.store.listGateways(1);
  assert.equal(listed[0]?.url, pipedreamGatewayUrl("notion"));
  assert.equal(listed[0]?.auth, "pipedream");
  assert.equal((await h.store.listGateways(2)).length, 0);
  const bob = await connectAgent(t, h, await agentToken(h, "gh-bob", "codex"));
  assert.equal((await call(bob, "gateway_tools", { server: "pd-notion" })).isError, true);
  const production = await buildApp({ pipedream: { ...pdConfig, environment: "production" } });
  const cookie = await sessionCookie(production, "gh-alice");
  assert.equal((await production.app.fetch(new Request(`${ORIGIN}/api/app/gateway/pipedream`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: '{"app":"notion"}' }))).status, 403);
  assert.ok(pipedreamSlug("notion"));
  assert.ok(!pipedreamSlug("../../secret"));
});
