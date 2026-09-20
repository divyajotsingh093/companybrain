import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id=host></div>");
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;

const { render } = await import("lit");
const { homeTpl } = await import("../src/home-view.ts");
type HomeSummary = Parameters<typeof homeTpl>[0]["data"] & object;
const host = dom.window.document.getElementById("host") as HTMLElement;

const summary = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  needs: [],
  setup: [
    { id: "model", label: "Choose a model provider", detail: "d", done: true },
    { id: "connector", label: "Connect your first source", detail: "d", done: false, view: "keychain" },
  ],
  asked: true,
  ...over,
});

let opened = "";
const draw = (data: HomeSummary | null, error = "", loading = false): void => {
  render(homeTpl({ user: "ada@acme.com", data, error, loading, onOpen: (v) => (opened = v) }), host);
};

const text = (): string => (host.textContent ?? "").replace(/\s+/g, " ");

test("home greets the person by name and never by their full address", () => {
  draw(summary());
  assert.match(text(), /Good (morning|afternoon|evening), ada/);
  assert.doesNotMatch(text(), /ada@acme\.com/);
});

test("the checklist shows only while a step is unfinished, and marks the finished ones", () => {
  draw(summary());
  assert.match(text(), /Finish setting up/);
  assert.equal(host.querySelectorAll(".home-steps li").length, 2);
  assert.equal(host.querySelectorAll(".home-steps li.done").length, 1);
  assert.equal(host.querySelectorAll(".home-steps li .btn").length, 1, "only the unfinished step offers an action");

  draw(summary({ setup: [{ id: "model", label: "Choose a model provider", detail: "d", done: true }] }));
  assert.doesNotMatch(text(), /Finish setting up/);
});

test("a first-time user gets the welcome, and it goes once they have asked something", () => {
  draw(summary({ asked: false, setup: [] }));
  assert.match(text(), /Ask your first question/);
  assert.equal(host.querySelectorAll(".home-prompts li").length, 3);

  draw(summary({ asked: true, setup: [] }));
  assert.doesNotMatch(text(), /Ask your first question/);
});

test("each inbox item states its kind, what it is, and one action", () => {
  draw(
    summary({
      needs: [
        { id: "a", type: "approval_pending", title: "Set Acme renewal to Closed Won", detail: "Waiting on you in Renewals", view: "chats", at: Date.now() - 120_000 },
        { id: "c", type: "connector_broken", title: "google needs re-authorising", detail: "Google sign-in expired.", view: "keychain" },
      ],
      setup: [],
    }),
  );
  const items = [...host.querySelectorAll(".home-item")];
  assert.equal(items.length, 2);
  assert.equal(items[0]?.querySelector(".badge")?.textContent, "approval");
  assert.equal(items[0]?.querySelector(".badge")?.className, "badge accent");
  assert.match(items[0]?.querySelector(".home-item-action")?.textContent ?? "", /Open the conversation/);
  assert.match(items[0]?.querySelector(".home-item-time")?.textContent ?? "", /m ago/);
  assert.equal(items[1]?.querySelector(".badge")?.className, "badge warn");
  assert.match(items[1]?.querySelector(".home-item-action")?.textContent ?? "", /Re-authorise/);
  (items[1] as HTMLElement).click();
  assert.equal(opened, "keychain", "the whole row is the target, not just a button");
  assert.match(text(), /Needs you 2/);
});

test("an empty inbox explains what would appear there and offers a way in", () => {
  draw(summary({ setup: [] }));
  assert.match(text(), /Nothing needs you/);
  const cta = host.querySelector<HTMLButtonElement>(".empty-state .btn");
  assert.equal(cta?.textContent, "Ask something");
  cta?.click();
  assert.equal(opened, "chats");
});

test("a failure to load says so instead of showing an empty inbox as if it were true", () => {
  draw(null, "Home could not load what needs you. Try again shortly.");
  assert.match(text(), /could not load/);
  assert.equal(host.querySelector(".home-error")?.textContent?.includes("could not load"), true);
  assert.doesNotMatch(text(), /Nothing needs you/);
});
