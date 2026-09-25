import assert from "node:assert/strict";
import test from "node:test";
import { AGREEMENT, HANDBOOK, STARTER_AGENTS } from "../src/starter.ts";
import { buildApp, type Harness, ORIGIN, sessionCookie } from "./fixtures.ts";

const FORM = { "content-type": "application/x-www-form-urlencoded" };

const welcome = (h: Harness, cookie: string, fields: Record<string, string | string[]>, origin = ORIGIN) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
  return h.app.fetch(new Request(`${ORIGIN}/welcome`, { method: "POST", headers: { ...FORM, cookie, origin }, body: body.toString() }));
};

const VALID = {
  name: "Alice Liddell",
  email: "Alice@Acme.test",
  company: "Acme Rockets",
  role: "engineering",
  teamSize: "small",
  goals: ["answers", "agents"],
  agents: ["claude_code", "cursor"],
  kit: "engineering",
  updates: "yes",
};

const get = (h: Harness, path: string, cookie: string) => h.app.fetch(new Request(`${ORIGIN}${path}`, { headers: { cookie } }));

test("nobody reaches the app, the setup page or a board before telling us who they are", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  for (const path of ["/", "/app", "/board/acme/app"]) {
    const res = await get(h, path, cookie);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get("location"), "/welcome", path);
  }
  const page = await (await get(h, "/welcome", cookie)).text();
  assert.match(page, /Welcome to Company Brain/);
  assert.match(page, /value="Alice Liddell"/, "the name is prefilled from GitHub");
  assert.match(page, /value="alice@acme.test"/, "so is a public email");
  assert.match(page, /action="\/auth\/logout"/, "you can still sign out");
  assert.match(page, /action="\/tokens\/revoke-all"/, "and revoke every token without handing over any details");
  assert.equal((await get(h, "/welcome", "cb_session=nope")).headers.get("location"), "/", "signed-out visitors go back to sign in");
});

test("a bad submission is sent back with every problem named, escaped, and nothing saved", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  const res = await welcome(h, cookie, { name: "<script>alert(1)</script>", email: "not-an-email", company: "", role: "wizard", teamSize: "huge", kit: "everything" });
  assert.equal(res.status, 400);
  const html = await res.text();
  for (const field of ["email", "company", "role", "teamSize", "kit"]) assert.match(html, new RegExp(`id="${field}-error"`), field);
  assert.match(html, /id="email"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(await h.store.profile(1), null);
  assert.equal((await h.store.listEntries("rule", 1)).length, 0);
});

test("a cross-site submission is refused", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  const res = await welcome(h, cookie, VALID, "https://evil.example");
  assert.equal(res.status, 403);
  assert.equal(await h.store.profile(1), null);
});

test("finishing the welcome step saves the profile and fills the brain with a starter kit", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  const res = await welcome(h, cookie, { ...VALID, agents: ["claude_code", "cursor", "bogus"], goals: ["answers", "answers", "take-over"] });
  assert.equal(res.headers.get("location"), "/app");

  const profile = await h.store.profile(1);
  assert.deepEqual(
    { ...profile, createdAt: 0, updatedAt: 0 },
    {
      uid: 1,
      login: "alice",
      name: "Alice Liddell",
      email: "alice@acme.test",
      company: "Acme Rockets",
      role: "engineering",
      teamSize: "small",
      goals: ["answers"],
      agents: ["claude_code", "cursor"],
      kit: "engineering",
      updates: true,
      createdAt: 0,
      updatedAt: 0,
      askedAt: null,
    },
  );

  const names = async (kind: Parameters<Harness["store"]["listEntries"]>[0]) => (await h.store.listEntries(kind, 1)).map((e) => e.name).sort();
  assert.ok((await names("skill")).includes("Ship a change safely"));
  assert.ok((await names("skill")).includes("Working with Company Brain"), "the agent harness skill is ready before any agent attaches");
  assert.ok(!(await names("skill")).includes("Prepare the weekly update"), "the operations pack is not loaded for an engineering kit");
  assert.ok((await names("rule")).includes("Ask before anything irreversible"));
  assert.ok((await names("process")).includes("Weekly brain review"));
  assert.ok((await names("project")).includes("Get Company Brain running"));
  const roles = await names("role");
  for (const agent of STARTER_AGENTS.filter((a) => a.pack === "engineering")) assert.ok(roles.includes(`${agent.name} agent`), agent.name);
  assert.ok(roles.includes("Owner"));
  assert.deepEqual((await h.store.listUploads(1)).map((u) => u.name).sort(), [AGREEMENT, HANDBOOK].sort());

  const about = (await h.store.getEntry("memory", 1, "About alice"))?.body ?? "";
  assert.match(about, /Alice Liddell/);
  assert.match(about, /Acme Rockets/);
  assert.match(about, /source: auto/);
  assert.match((await h.store.getEntry("memory", 1, "Company"))?.body ?? "", /Acme Rockets/);

  const found = await h.store.search(1, "connect Claude Code", { allow: async () => true, limit: 5 });
  assert.ok(found.some((f) => f.title === "Company Brain handbook"), "a first question is answered from the handbook, with a citation");

  const me = (await (await get(h, "/api/app/me", cookie)).json()) as { profile: { company: string }; starterAgents: Array<{ name: string; prompt: string }> };
  assert.equal(me.profile.company, "Acme Rockets");
  assert.equal(me.starterAgents.length, 3);
  assert.match(me.starterAgents[0]?.prompt ?? "", /Acme Rockets/);
  assert.match(me.starterAgents[0]?.prompt ?? "", /skill_read "Ship a change safely"/);

  assert.equal((await get(h, "/app", cookie)).status, 200);
});

test("coming back never overwrites or resurrects anything, and a new kit only adds its own pack", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  await welcome(h, cookie, VALID);
  await h.store.putEntry({ kind: "rule", ownerUid: 1, name: "Ask before anything irreversible", body: "Our own version." });
  await h.store.deleteEntry("process", 1, "Weekly brain review");
  await h.store.deleteUpload(1, AGREEMENT);
  await h.store.putUpload(1, HANDBOOK, "Our handbook", "How we really work.");

  const edit = await get(h, "/welcome", cookie);
  assert.match(await edit.text(), /Your profile/);
  await welcome(h, cookie, { ...VALID, updates: "no" });
  assert.equal(await h.store.getEntry("process", 1, "Weekly brain review"), null, "a deleted starter entry stays deleted");
  assert.deepEqual((await h.store.listUploads(1)).map((u) => u.name), [HANDBOOK], "a deleted starter document stays deleted");

  await welcome(h, cookie, { ...VALID, company: "Acme", kit: "both" });
  assert.equal((await h.store.getEntry("rule", 1, "Ask before anything irreversible"))?.body, "Our own version.");
  assert.ok((await h.store.getEntry("skill", 1, "Prepare the weekly update")) !== null, "switching to both adds the operations pack");
  assert.ok((await h.store.getEntry("role", 1, "Chief of staff agent")) !== null, "and its agents");
  assert.equal(await h.store.getEntry("process", 1, "Weekly brain review"), null, "but not the shared entries again");
  assert.equal((await h.store.listUploads(1)).find((u) => u.name === HANDBOOK)?.title, "Our handbook", "an edited handbook is never replaced");
  assert.equal((await h.store.profile(1))?.company, "Acme");
  assert.match((await h.store.getEntry("memory", 1, "Company"))?.body ?? "", /Acme is the company/, "a renamed company updates the one company memory");
  assert.equal((await h.store.listEntries("memory", 1)).filter((m) => /is the company this brain belongs to/.test(m.body)).length, 1);
});

test("connecting an agent keeps who you are, and revoking everything deletes your profile", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  await welcome(h, cookie, VALID);
  const created = await h.app.fetch(new Request(`${ORIGIN}/tokens`, { method: "POST", headers: { ...FORM, cookie, origin: ORIGIN }, body: "client=claude_code" }));
  assert.equal(created.status, 200);
  assert.match((await h.store.getEntry("memory", 1, "About alice"))?.body ?? "", /Acme Rockets/, "creating a token does not thin the memory back to GitHub facts");
  const me = (await (await get(h, "/api/app/me", cookie)).json()) as { starterAgents: unknown[] };
  await h.store.deleteEntry("role", 1, "Code reviewer agent");
  const after = (await (await get(h, "/api/app/me", cookie)).json()) as { starterAgents: Array<{ name: string }> };
  assert.equal(after.starterAgents.length, me.starterAgents.length - 1, "a deleted starter agent no longer shows a card");

  await h.app.fetch(new Request(`${ORIGIN}/tokens/revoke-all`, { method: "POST", headers: { ...FORM, cookie, origin: ORIGIN } }));
  assert.equal(await h.store.profile(1), null);
});

test("email addresses must look like one, and odd characters are cleaned", async () => {
  const h = await buildApp();
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  for (const email of ["a@b.com,x@c.de", "a;b@acme.test", "a@acme", "a@-acme.test", "\u0000@acme.test"]) {
    const res = await welcome(h, cookie, { ...VALID, email });
    assert.equal(res.status, 400, email);
  }
  await welcome(h, cookie, { ...VALID, company: "Acme\u202Egnp.exe\u200B" });
  assert.equal((await h.store.profile(1))?.company, "Acme gnp.exe");
});

test("the first question is remembered, and a returning user goes straight to the app", async () => {
  const h = await buildApp({}, { model: async () => "Open Agents and create a token [1]." });
  const cookie = await sessionCookie(h, "gh-alice", { welcomed: false });
  await welcome(h, cookie, VALID);
  const asked = await h.app.fetch(
    new Request(`${ORIGIN}/api/app/ask`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: ORIGIN }, body: JSON.stringify({ question: "How do I connect Claude Code?" }) }),
  );
  assert.equal(asked.status, 200);
  const at = (await h.store.profile(1))?.askedAt;
  assert.equal(typeof at, "number");

  const start = await h.app.fetch(new Request(`${ORIGIN}/auth/github/start`));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
  const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const callback = await h.app.fetch(new Request(`${ORIGIN}/auth/github/callback?code=good-code&state=${state}`, { headers: { cookie: stateCookie } }));
  assert.equal(callback.headers.get("location"), "/app");
  assert.match((await h.store.getEntry("memory", 1, "About alice"))?.body ?? "", /Acme Rockets/, "signing in again keeps the profile in memory");
});
