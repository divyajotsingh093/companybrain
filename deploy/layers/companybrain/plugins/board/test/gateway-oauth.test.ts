import assert from "node:assert/strict";
import test from "node:test";
import { gatewayOAuthProvider, guardedFetch } from "../src/gateway.ts";
import { agentToken, buildApp, call, connectAgent, type Harness, sessionCookie } from "./fixtures.ts";

const BRAIN = "https://brain.example";
const UPSTREAM = "https://upstream.example";

const at = (h: Harness, url: string, init: RequestInit = {}) => Promise.resolve(h.app.fetch(new Request(url, init)));

async function approve(upstream: Harness, cookie: string, authorizeUrl: string): Promise<string> {
  const page = await at(upstream, authorizeUrl, { headers: { cookie } });
  assert.equal(page.status, 200, "the upstream shows its consent page");
  const html = await page.text();
  const fields = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields.set(m[1] as string, (m[2] as string).replace(/&amp;/g, "&"));
  fields.set("decision", "allow");
  const res = await at(upstream, `${UPSTREAM}/oauth/authorize`, { method: "POST", headers: { cookie, origin: UPSTREAM, "content-type": "application/x-www-form-urlencoded" }, body: fields });
  assert.equal(res.status, 302);
  return res.headers.get("location") as string;
}

test("a person signs in to an OAuth MCP server once, and their agents call it through the board", async (t) => {
  const upstream = await buildApp({ publicUrl: UPSTREAM });
  const upstreamCookie = await sessionCookie(upstream, "gh-carol");
  const brain = await buildApp({ publicUrl: BRAIN }, { gatewayFetch: (input, init) => Promise.resolve(upstream.app.fetch(new Request(input, init))) });
  const cookie = await sessionCookie(brain, "gh-alice");

  const directory = (await (await at(brain, `${BRAIN}/api/app/directory`, { headers: { cookie } })).json()) as { servers: Array<{ slug: string; auth: string; transport: string }> };
  assert.ok(directory.servers.length > 100);
  assert.ok(directory.servers.every((s) => s.transport === "http"));

  const start = await at(brain, `${BRAIN}/api/app/gateway/oauth/start`, {
    method: "POST",
    headers: { cookie, origin: BRAIN, "content-type": "application/json" },
    body: JSON.stringify({ name: "upstream", url: `${UPSTREAM}/mcp` }),
  });
  assert.equal(start.status, 200);
  const { redirect } = (await start.json()) as { redirect: string };
  assert.ok(redirect.startsWith(`${UPSTREAM}/oauth/authorize?`));

  const callback = await approve(upstream, upstreamCookie, redirect);
  assert.ok(callback.startsWith(`${BRAIN}/gateway/oauth/callback?`));

  const stranger = await sessionCookie(brain, "gh-bob");
  const hijack = await at(brain, callback, { headers: { cookie: stranger } });
  assert.match(hijack.headers.get("location") ?? "", /failed=expired/, "a callback is only honoured for the person who started it");

  const done = await at(brain, callback, { headers: { cookie } });
  assert.equal(done.headers.get("location"), "/app?screen=gateway&connected=upstream");
  const replay = await at(brain, callback, { headers: { cookie } });
  assert.match(replay.headers.get("location") ?? "", /failed=expired/, "a callback works once");

  const [server] = await brain.store.listGateways(1);
  assert.deepEqual({ name: server?.name, auth: server?.auth, hasToken: server?.hasToken }, { name: "upstream", auth: "oauth", hasToken: true });

  const agent = await connectAgent(t, brain, await agentToken(brain, "gh-alice", "claude_code"));
  const tools = await call(agent, "gateway_tools", { server: "upstream" });
  assert.equal(tools.isError, false, tools.text);
  assert.match(tools.text, /whoami/);
  const who = await call(agent, "gateway_call", { server: "upstream", tool: "whoami" });
  assert.equal(who.isError, false, who.text);
  assert.match(who.text, /carol/, "the call runs as the upstream account the person signed in with");

  upstream.clock.now += 31 * 86_400_000;
  brain.clock.now += 31 * 86_400_000;
  const later = await connectAgent(t, brain, await agentToken(brain, "gh-alice", "claude_code"));
  const expired = await call(later, "gateway_call", { server: "upstream", tool: "whoami" });
  assert.match(expired.text, /sign in to it again/);
  const fresh = await sessionCookie(brain, "gh-alice");
  const view = (await (await at(brain, `${BRAIN}/api/app/gateway`, { headers: { cookie: fresh } })).json()) as { servers: Array<{ name: string; signedIn: boolean }> };
  assert.deepEqual(view.servers.map((s) => [s.name, s.signedIn]), [["upstream", false]], "an expired sign-in without a refresh token shows as needing sign-in, not connected");
});

test("starting a sign-in refuses private or malformed servers", async () => {
  const brain = await buildApp({ publicUrl: BRAIN });
  const cookie = await sessionCookie(brain, "gh-alice");
  const post = (body: unknown, origin = BRAIN) =>
    at(brain, `${BRAIN}/api/app/gateway/oauth/start`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ name: "x", url: "https://127.0.0.1/mcp" })).status, 400);
  assert.equal((await post({ name: "Bad Name", url: `${UPSTREAM}/mcp` })).status, 400);
  assert.equal((await post({ name: "x", url: `${UPSTREAM}/mcp` }, "https://evil.example")).status, 403);
});

test("a server's sign-in is bound to its address: re-pointing a name never sends one server's token to another", async (t) => {
  const one = await buildApp({ publicUrl: "https://one.example" });
  const two = await buildApp({ publicUrl: "https://two.example" });
  const sentToOne: string[] = [];
  let twoDown = false;
  const brain = await buildApp(
    { publicUrl: BRAIN },
    {
      gatewayFetch: (input, init) => {
        const req = new Request(input, init);
        const bearer = req.headers.get("authorization");
        if (bearer && req.url.startsWith("https://one.example")) sentToOne.push(bearer);
        if (twoDown && req.url === "https://two.example/mcp") return Promise.resolve(new Response("down", { status: 503 }));
        return Promise.resolve((req.url.startsWith("https://one.example") ? one : two).app.fetch(req));
      },
    },
  );
  const cookie = await sessionCookie(brain, "gh-alice");
  const start = async (url: string) =>
    ((await (await at(brain, `${BRAIN}/api/app/gateway/oauth/start`, { method: "POST", headers: { cookie, origin: BRAIN, "content-type": "application/json" }, body: JSON.stringify({ name: "x", url }) })).json()) as { redirect: string }).redirect;
  const consentAt = async (h: Harness, base: string, cookieThere: string, url: string) => {
    const html = await (await at(h, url, { headers: { cookie: cookieThere } })).text();
    const fields = new URLSearchParams();
    for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields.set(m[1] as string, (m[2] as string).replace(/&amp;/g, "&"));
    fields.set("decision", "allow");
    return (await at(h, `${base}/oauth/authorize`, { method: "POST", headers: { cookie: cookieThere, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: fields })).headers.get("location") as string;
  };

  const first = await consentAt(one, "https://one.example", await sessionCookie(one, "gh-carol"), await start("https://one.example/mcp"));
  assert.match((await at(brain, first, { headers: { cookie } })).headers.get("location") ?? "", /connected=x/);
  const agent = await connectAgent(t, brain, await agentToken(brain, "gh-alice", "claude_code"));

  const second = await consentAt(two, "https://two.example", await sessionCookie(two, "gh-dave"), await start("https://two.example/mcp"));
  twoDown = true;
  assert.match((await at(brain, second, { headers: { cookie } })).headers.get("location") ?? "", /failed=signin/);
  sentToOne.length = 0;
  const after = await call(agent, "gateway_call", { server: "x", tool: "whoami" });
  assert.equal(after.isError, true);
  assert.match(after.text, /sign in to it again/, "the agent is told the person must sign in again");
  for (const bearer of sentToOne) assert.ok(await one.auth.verify(bearer, "agent"), "every token sent to one.example was issued by one.example");

  const view = (await (await at(brain, `${BRAIN}/api/app/gateway`, { headers: { cookie } })).json()) as { servers: Array<{ name: string; signedIn: boolean }> };
  assert.deepEqual(view.servers.map((s) => [s.name, s.signedIn]), [["x", false]], "the Gateway screen offers to sign in again");
});

test("refresh happens early, and a lost refresh race never wipes the winner's tokens", async () => {
  let row: { ownerUid: number; name: string; url: string; state: string; sealed: string | null; createdAt: number } = { ownerUid: 1, name: "x", url: "https://one.example/mcp", state: "s", sealed: null, createdAt: 0 };
  const rows = { read: async () => row, save: async (url: string, sealed: string) => void (url === row.url && (row = { ...row, sealed })) };
  const clock = { now: 1_000_000 };
  const make = () => gatewayOAuthProvider({ rows, secret: "s".repeat(40), url: "https://one.example/mcp", state: "", callbackUrl: `${BRAIN}/gateway/oauth/callback`, live: true, now: () => clock.now });
  const loser = make();
  await loser.provider.saveTokens({ access_token: "a0", token_type: "Bearer", refresh_token: "r0", expires_in: 3600 });
  assert.equal(await loser.refreshDue(), false);
  clock.now += 3_550_000;
  assert.equal(await loser.refreshDue(), true, "tokens are refreshed a minute before they expire");

  await loser.provider.tokens();
  await make().provider.saveTokens({ access_token: "a1", token_type: "Bearer", refresh_token: "r1", expires_in: 3600 });
  await loser.provider.invalidateCredentials?.("tokens");
  assert.equal((await make().provider.tokens())?.access_token, "a1", "the loser's invalid_grant does not erase the winner's fresh tokens");

  const blip = make();
  await blip.provider.tokens();
  await blip.provider.redirectToAuthorization(new URL("https://one.example/authorize"));
  assert.equal((await make().provider.tokens())?.refresh_token, "r1", "a refresh that failed on an upstream outage keeps the refresh token for next time");

  await loser.provider.saveCodeVerifier("from-live-traffic");
  await assert.rejects(async () => make().provider.codeVerifier(), "live gateway traffic never overwrites an in-progress sign-in");

  const other = gatewayOAuthProvider({ rows, secret: "s".repeat(40), url: "https://two.example/mcp", state: "", callbackUrl: "", live: true, now: () => clock.now });
  assert.equal(await other.provider.tokens(), undefined, "tokens saved for one address are invisible to another");
});

test("the gateway never fetches private or non-https addresses, even when a server's metadata points there", async () => {
  const fetchNothing: typeof fetch = async () => new Response("reached");
  for (const url of ["http://two.example/token", "https://127.0.0.1/token", "https://10.0.0.8/register", "https://one.example:8443/token", "https://metadata.internal/latest"]) {
    await assert.rejects(() => guardedFetch(fetchNothing)(url), /Refused/, url);
  }
  assert.equal(await (await guardedFetch(fetchNothing)("https://one.example/token")).text(), "reached");
});
