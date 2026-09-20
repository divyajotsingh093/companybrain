import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const state = {
  approvals: [{ requestId: "req-1", command: "hubspot.update_deal", summary: "Set Acme renewal to Closed Won" }] as Array<Record<string, unknown>>,
  providers: {
    google: { connected: true, needsReconnect: true, refreshError: "Google sign-in expired." },
    slack: { connected: true },
  } as Record<string, Record<string, unknown>>,
  models: { pi: [{ id: "m" }] } as Record<string, unknown[]>,
  skills: [] as unknown[],
  sessions: [{ id: "s-1", title: "Renewals", updatedAt: 1_700_000_000_000 }] as Array<Record<string, unknown>>,
  approvalCalls: 0,
};

const core = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  const body = (value: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (path === "/v1/sessions") return body({ sessions: state.sessions });
  if (path.startsWith("/v1/sessions/") && path.endsWith("/approvals")) {
    state.approvalCalls++;
    return body({ approvals: state.approvals });
  }
  if (path === "/v1/connectors/oauth/status") return body({ providers: state.providers });
  if (path === "/v1/runtime-config") return body({ modelsByHarness: state.models });
  if (path === "/v1/skills") return body({ skills: state.skills });
  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise<void>((r) => core.listen(0, r));

process.env.CORE_API_URL = `http://localhost:${(core.address() as AddressInfo).port}`;
process.env.CORE_SIGNING_SECRET = "x".repeat(40);
process.env.NODE_ENV = "test";
process.env.ALLOW_UNSIGNED_TEST_IDENTITY = "1";
process.env.WEB_UI_PRINCIPALS = "alice";

const { handler } = await import("../server/index.ts");
const surface = createServer((req, res) => void handler(req, res));
await new Promise<void>((r) => surface.listen(0, r));
const base = `http://localhost:${(surface.address() as AddressInfo).port}`;
const cookie = (await (await fetch(`${base}/signin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "alice" }) })).headers.get("set-cookie")) ?? "";

test.after(() => {
  surface.close();
  core.close();
});

interface HomeItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  view: string;
}

const home = async (): Promise<{ needs: HomeItem[]; setup: Array<{ id: string; done: boolean }>; asked: boolean }> => {
  const r = await fetch(`${base}/api/home`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
  assert.equal(r.status, 200);
  return (await r.json()) as { needs: HomeItem[]; setup: Array<{ id: string; done: boolean }>; asked: boolean };
};

test("the inbox carries a typed item per pending approval and per broken connection", async () => {
  const { needs } = await home();
  assert.deepEqual(
    needs.map((n) => [n.type, n.title, n.view]),
    [
      ["approval_pending", "Set Acme renewal to Closed Won", "chats"],
      ["connector_broken", "google needs re-authorising", "keychain"],
    ],
  );
  assert.equal(needs[1]?.detail, "Google sign-in expired.");
});

test("an item clears itself once the thing behind it is resolved", async () => {
  state.approvals = [];
  assert.deepEqual((await home()).needs.map((n) => n.type), ["connector_broken"]);
  state.providers.google = { connected: true };
  assert.deepEqual((await home()).needs, []);
  state.approvals = [{ requestId: "req-2", command: "send_email" }];
  assert.deepEqual((await home()).needs.map((n) => n.title), ["send_email"]);
});

test("the setup checklist reports each step from what the core actually has", async () => {
  assert.deepEqual(await home().then((h) => h.setup.map((s) => [s.id, s.done])), [
    ["model", true],
    ["connector", true],
    ["skill", false],
  ]);
  state.skills = [{ name: "crm-hygiene" }];
  state.models = {};
  assert.deepEqual(await home().then((h) => h.setup.map((s) => [s.id, s.done])), [
    ["model", false],
    ["connector", true],
    ["skill", true],
  ]);
});

test("the fan-out over sessions is bounded, and a first-time user is flagged for the welcome", async () => {
  state.sessions = Array.from({ length: 50 }, (_, i) => ({ id: `s-${i}`, title: `t${i}` }));
  state.approvalCalls = 0;
  assert.equal((await home()).asked, true);
  assert.equal(state.approvalCalls, 20);

  state.sessions = [];
  const empty = await home();
  assert.equal(empty.asked, false);
  assert.deepEqual(empty.needs.map((n) => n.type), []);
});

test("home never answers 401, so a route the dev surface cannot reach does not sign the user out", async () => {
  state.sessions = [{ id: "s-1", title: "Renewals" }];
  const r = await fetch(`${base}/api/home`, { headers: { cookie: cookie.split(";")[0] ?? "" } });
  assert.equal(r.status, 200);
  const r2 = await fetch(`${base}/api/home`);
  assert.equal(r2.status, 401, "without a cookie it is still unauthorized");
});
