import assert from "node:assert/strict";
import test from "node:test";
import { openStore } from "../src/store.ts";
import { LANES, laneOf, layout, swimlaneTpl, type SwimlaneEvent } from "../src/swimlane.ts";
import { memoryDatabase } from "./fixtures.ts";

const NOW = 1_800_000_000_000;

function event(over: Partial<SwimlaneEvent> & { id: number }): SwimlaneEvent {
  return {
    at: NOW - 60_000,
    kind: "post.created",
    postId: `p${over.id}`,
    postType: "finding",
    title: "a finding",
    actorLogin: "alice",
    client: "claude_code",
    recipient: null,
    expiresAt: null,
    releasedAt: null,
    closedAt: null,
    ...over,
  };
}

const column = (lane: (typeof LANES)[number]) => LANES.indexOf(lane) + 2;

test("lanes cover every agent client plus one for people, and unknown clients land with people", async () => {
  assert.deepEqual([...LANES], ["claude_code", "codex", "cursor", "grok", "human"]);
  assert.equal(laneOf("claude_code"), "claude_code");
  assert.equal(laneOf("grok"), "grok");
  assert.equal(laneOf("web"), "human");
  assert.equal(laneOf("import"), "human");
  assert.equal(laneOf("some_future_agent"), "human");

  const placed = layout([event({ id: 1, client: "cursor" }), event({ id: 2, client: "import", at: NOW - 59_000 })]);
  assert.deepEqual(
    placed.map((p) => [p.lane, p.startCol, p.endCol]),
    [
      ["cursor", column("cursor"), column("cursor") + 1],
      ["human", column("human"), column("human") + 1],
    ],
  );

  const html = swimlaneTpl({ events: [event({ id: 1, client: "nope" })], now: NOW });
  for (const label of ["Claude Code", "Codex", "Cursor", "Grok", "People"]) assert.ok(html.includes(`>${label}</span>`), label);
});

test("handoffs span from the author's lane to the recipient's lane in both directions", async () => {
  const forward = layout([event({ id: 1, postType: "handoff", client: "claude_code", recipient: "cursor" })])[0];
  assert.ok(forward);
  assert.equal(forward.toLane, "cursor");
  assert.equal(forward.forward, true);
  assert.equal(forward.startCol, column("claude_code"));
  assert.equal(forward.endCol, column("cursor") + 1);

  const back = layout([event({ id: 1, postType: "handoff", client: "grok", recipient: "codex" })])[0];
  assert.ok(back);
  assert.equal(back.forward, false);
  assert.equal(back.startCol, column("codex"));
  assert.equal(back.endCol, column("grok") + 1);

  const toPerson = layout([event({ id: 1, postType: "handoff", client: "codex", recipient: "octocat" })])[0];
  assert.ok(toPerson);
  assert.equal(toPerson.toLane, "human");
  assert.equal(toPerson.endCol, column("human") + 1);

  const sameLane = layout([event({ id: 1, postType: "handoff", client: "codex", recipient: "codex" })])[0];
  assert.ok(sameLane);
  assert.equal(sameLane.toLane, null);
  assert.equal(sameLane.endCol, sameLane.startCol + 1);

  const notHandoff = layout([event({ id: 1, postType: "finding", client: "codex", recipient: "cursor" })])[0];
  assert.ok(notHandoff);
  assert.equal(notHandoff.toLane, null);

  const html = swimlaneTpl({ events: [event({ id: 1, postType: "handoff", client: "claude_code", recipient: "cursor" })], now: NOW });
  assert.match(html, /class="swim-ev cross"[^>]*grid-column:2\/5/);
  assert.ok(html.includes("to Cursor"));
});

test("events are laid out in time order on one shared axis, bucketed when dense", async () => {
  const events = [
    event({ id: 3, at: NOW - 1_000, client: "cursor", title: "third" }),
    event({ id: 1, at: NOW - 3_000, client: "grok", title: "first" }),
    event({ id: 2, at: NOW - 2_000, client: "codex", title: "second" }),
  ];
  const placed = layout(events);
  assert.deepEqual(
    placed.map((p) => p.event.title),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    placed.map((p) => p.row),
    [2, 3, 4],
  );
  assert.deepEqual(
    placed.map((p) => p.stamp),
    [new Date(NOW - 3_000).toISOString().slice(11, 16), null, null],
  );

  const spread = layout([event({ id: 1, at: NOW - 30 * 86_400_000 }), event({ id: 2, at: NOW })]);
  assert.deepEqual(
    spread.map((p) => p.stamp),
    [new Date(NOW - 30 * 86_400_000).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10)],
  );

  const ties = layout([event({ id: 9, at: NOW, title: "later id" }), event({ id: 4, at: NOW, title: "earlier id" })]);
  assert.deepEqual(
    ties.map((p) => p.event.title),
    ["earlier id", "later id"],
  );

  const rows = [...swimlaneTpl({ events, now: NOW }).matchAll(/grid-row:(\d+);grid-column/g)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [2, 3, 4]);
});

test("a live claim drains, and a released or closed one reads as closed", async () => {
  const live = swimlaneTpl({
    events: [event({ id: 1, postType: "claim", at: NOW - 15 * 60_000, expiresAt: NOW + 45 * 60_000 })],
    now: NOW,
  });
  assert.match(live, /class="swim-ttl"/);
  assert.match(live, /width:75%;--drain:2700s/);
  assert.ok(!live.includes("swim-ev closed"));

  const released = swimlaneTpl({
    events: [event({ id: 1, postType: "claim", at: NOW - 15 * 60_000, expiresAt: NOW + 45 * 60_000, releasedAt: NOW - 60_000 })],
    now: NOW,
  });
  assert.ok(released.includes("swim-ev closed"));
  assert.ok(!released.includes('class="swim-ttl"'));

  const releaseEvent = swimlaneTpl({ events: [event({ id: 1, kind: "claim.released", postType: "claim" })], now: NOW });
  assert.ok(releaseEvent.includes("swim-ev closed"));
  assert.ok(releaseEvent.includes("released claim"));

  const expired = swimlaneTpl({ events: [event({ id: 1, postType: "claim", at: NOW - 60_000, expiresAt: NOW - 1 })], now: NOW });
  assert.ok(!expired.includes('class="swim-ttl"'));

  assert.match(swimlaneTpl({ events: [event({ id: 1, postType: "claim", expiresAt: NOW + 60_000 })], now: NOW }), /@media \(prefers-reduced-motion: reduce\)/);
});

test("the empty state says what would appear here", async () => {
  const html = swimlaneTpl({ events: [], now: NOW });
  assert.ok(html.includes("No activity yet."));
  assert.match(html, /claim.*finding.*handoff/);
  assert.ok(!html.includes("<details"));
  assert.ok(html.includes('aria-label="Agent swimlane timeline"'));
});

test("untrusted titles, logins and recipients are escaped", async () => {
  const html = swimlaneTpl({
    events: [
      event({
        id: 1,
        postType: "handoff",
        title: `<script>alert("x")</script>`,
        actorLogin: `o'brien<img>`,
        client: `cur"sor`,
        recipient: `<b>them</b>`,
      }),
    ],
    now: NOW,
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img>"));
  assert.ok(!html.includes("<b>them</b>"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("o&#39;brien&lt;img&gt;"));
  assert.ok(html.includes(`cur&quot;sor`));
  assert.ok(html.includes("&lt;b&gt;them&lt;/b&gt;"));
});

test("the store timeline carries the recipient and claim expiry the lanes need", async () => {
  let clock = NOW;
  const store = openStore(await memoryDatabase(), () => clock);
  const base = { repoId: 3, repoName: "a/b", body: "", authorLogin: "alice", authorUid: 1 };
  const claim = await store.addPost({ ...base, type: "claim", title: "hold", target: "src/a.ts", client: "claude_code", ttlMinutes: 60 });
  assert.equal(claim.ok, true);
  clock += 1_000;
  await store.addPost({ ...base, type: "handoff", title: "over to you", to: "cursor", client: "claude_code" });
  clock += 1_000;
  if (claim.ok) await store.releaseClaim(claim.post.id, 3, { uid: 1, login: "alice", client: "claude_code" });

  const timeline = await store.timeline(3);
  assert.deepEqual(
    timeline.map((e) => [e.kind, e.postType, e.recipient]),
    [
      ["post.created", "claim", null],
      ["post.created", "handoff", "cursor"],
      ["claim.released", "claim", null],
    ],
  );
  assert.equal(timeline[0]?.expiresAt, NOW + 3_600_000);
  assert.equal(timeline[0]?.releasedAt, NOW + 2_000);

  const placed = layout(timeline);
  assert.deepEqual(
    placed.map((p) => p.toLane),
    [null, "cursor", null],
  );
  await store.close();
});
