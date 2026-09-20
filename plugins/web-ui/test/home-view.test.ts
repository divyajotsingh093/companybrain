import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=host></div>");
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;

const { render } = await import("lit");
const { homeTpl, journey, SUGGESTIONS } = await import("../src/home-view.ts");
const { Box, Clock, MessageSquare } = await import("lucide");
type HomeSummary = Parameters<typeof homeTpl>[0]["data"] & object;
const host = dom.window.document.getElementById("host") as HTMLElement;

const FEATURES = [
  { view: "chats", label: "Ask", glyph: MessageSquare, blurb: "Ask anything." },
  { view: "skills", label: "Skills", glyph: Box, blurb: "Jobs it knows." as string, count: 19 },
  { view: "crons", label: "Automations", glyph: Clock, blurb: "On a schedule." },
];

const summary = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  needs: [],
  setup: [{ id: "connector", label: "Connect your first source", detail: "d", done: false, view: "keychain" }],
  asked: false,
  counts: {},
  ...over,
});

let opened = "";
let asked = "";
let typed = "";

const draw = (data: HomeSummary | null, over: { draft?: string; error?: string; loading?: boolean } = {}): void => {
  render(
    homeTpl({
      user: "ada@acme.com",
      data,
      error: over.error ?? "",
      loading: over.loading ?? false,
      draft: over.draft ?? "",
      features: FEATURES,
      onOpen: (v) => {
        opened = v;
      },
      onAsk: (t) => {
        asked = t;
      },
      onDraft: (t) => {
        typed = t;
      },
    }),
    host,
  );
};

const text = (): string => (host.textContent ?? "").replace(/\s+/g, " ");

test("home opens on the question, not a greeting", () => {
  draw(summary());
  assert.match(text(), /What do you want to do\?/);
  assert.doesNotMatch(text(), /Good (morning|afternoon|evening)/);
  assert.ok(host.querySelector(".home-ask-input"), "the chat input is the first thing on the page");
  assert.equal(host.querySelectorAll(".home-suggestion").length, SUGGESTIONS.length);
});

test("asking works from the box or a suggestion, and empty input cannot be sent", () => {
  draw(summary(), { draft: "" });
  assert.equal(host.querySelector<HTMLButtonElement>(".home-ask-send")?.disabled, true);

  draw(summary(), { draft: "   " });
  assert.equal(host.querySelector<HTMLButtonElement>(".home-ask-send")?.disabled, true, "whitespace is not a question");

  draw(summary(), { draft: "what changed this week?" });
  assert.equal(host.querySelector<HTMLButtonElement>(".home-ask-send")?.disabled, false);
  host.querySelector("form.home-ask")?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(asked, "what changed this week?");

  host.querySelector<HTMLButtonElement>(".home-suggestion")?.click();
  assert.equal(asked, SUGGESTIONS[0]);

  const input = host.querySelector<HTMLTextAreaElement>(".home-ask-input") as HTMLTextAreaElement;
  input.value = "typed";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(typed, "typed");
});

test("the journey shows where you are and what is next, and goes once it is finished", () => {
  draw(summary());
  assert.match(text(), /Getting started 0 of 4/);
  assert.equal(host.querySelectorAll(".home-journey-step").length, 4);
  assert.equal(host.querySelectorAll(".home-journey-step.next").length, 1, "exactly one step is next");
  assert.ok(host.querySelector(".home-journey-step")?.className.includes("next"), "the first unfinished step is next");

  host.querySelector<HTMLButtonElement>(".home-journey-body")?.click();
  assert.equal(opened, "keychain");

  const done = summary({
    setup: [{ id: "connector", label: "c", detail: "d", done: true }],
    asked: true,
    counts: { skills: 19, crons: 2 },
  });
  draw(done);
  assert.doesNotMatch(text(), /Getting started/);
  assert.deepEqual(
    journey(done).map((s) => s.done),
    [true, true, true, true],
  );
});

test("every feature is on the page, with its count when we know one", () => {
  draw(summary());
  const cards = [...host.querySelectorAll(".home-feature")];
  assert.deepEqual(
    cards.map((c) => c.querySelector("b")?.textContent?.replace(/\s+/g, "")),
    ["Ask", "Skills19", "Automations"],
  );
  assert.ok(
    cards.every((c) => (c.querySelector(".home-feature-blurb")?.textContent ?? "").length > 5),
    "each card says what the feature is for",
  );
  (cards[2] as HTMLElement).click();
  assert.equal(opened, "crons");
});

test("needs you appears only when something needs you", () => {
  draw(summary());
  assert.doesNotMatch(text(), /Needs you/, "an empty inbox earns no section on a working page");

  draw(
    summary({
      needs: [
        { id: "a", type: "approval_pending", title: "Set Acme renewal to Closed Won", detail: "Waiting on you", view: "chats", at: Date.now() - 120_000 },
      ],
    }),
  );
  assert.match(text(), /Needs you 1/);
  assert.equal(host.querySelector(".home-item .badge")?.className, "badge accent");
  (host.querySelector(".home-item") as HTMLElement).click();
  assert.equal(opened, "chats");
});

test("a failed load says so, and never implies the inbox is empty", () => {
  draw(null, { error: "Home could not load what needs you. Try again shortly." });
  assert.match(text(), /could not load/);
  assert.doesNotMatch(text(), /Nothing needs you/);
  assert.ok(host.querySelector(".home-ask-input"), "the page still works for asking");
});

test("Enter sends what is in the box now, not what was there when it last rendered", () => {
  draw(summary(), { draft: "" });
  const input = host.querySelector<HTMLTextAreaElement>(".home-ask-input") as HTMLTextAreaElement;
  input.value = "typed after the last render";
  asked = "";
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(asked, "typed after the last render");

  input.value = "   ";
  asked = "";
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(asked, "", "whitespace still sends nothing");

  input.value = "line one";
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(asked, "", "shift+enter is a newline, not a send");
});
