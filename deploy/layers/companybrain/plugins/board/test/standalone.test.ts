import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_NAMES } from "../src/mcp.ts";
import { buildApp, ORIGIN, sessionCookie } from "./fixtures.ts";

test("signing in fills in who you are, with no agent attached", async () => {
  const h = await buildApp();
  const start = await h.app.fetch(new Request(`${ORIGIN}/auth/github/start`));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const callback = await h.app.fetch(new Request(`${ORIGIN}/auth/github/callback?code=good-code&state=${state}`, { headers: { cookie: stateCookie } }));
  assert.equal(callback.headers.get("location"), "/");
  const about = await h.store.getEntry("memory", 1, "About alice");
  assert.match(about?.body ?? "", /type: user/);
  assert.equal(await h.store.getEntry("skill", 1, "Working with Company Brain"), null, "the agent starter skill waits until an agent is attached");
});

test("the setup page leads with using Company Brain on its own, and lists every agent tool", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice");
  const html = await (await h.app.fetch(new Request(`${ORIGIN}/`, { headers: { cookie } }))).text();
  assert.ok(html.indexOf("Add knowledge, then ask") < html.indexOf("Connect an agent"), "knowledge comes before agents");
  assert.match(html, /Connect an agent <span class="status[^"]*">Optional<\/span>/);
  assert.doesNotMatch(html, /After step 2/);
  const missing = [...TOOL_NAMES].filter((t) => t !== "whoami" && !html.includes(`<code class="tool">${t}</code>`));
  assert.deepEqual(missing, [], "every tool an agent gets is described on the setup page");
});
