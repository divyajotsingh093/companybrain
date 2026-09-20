import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/shell.ts", import.meta.url), "utf8");

function block(selector: string): string {
  const m = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m").exec(css);
  assert.ok(m, `no top-level "${selector} {" block`);
  return css.slice(m.index, css.indexOf("}", m.index));
}

const THEMED = [
  "--surface-1",
  "--surface-2",
  "--surface-3",
  "--surface-border",
  "--surface-shadow",
  "--state-ok",
  "--state-ok-wash",
  "--state-warn",
  "--state-warn-wash",
  "--state-danger",
  "--state-danger-wash",
  "--state-info",
  "--state-info-wash",
];

test("surface and state tokens are defined in both themes", () => {
  const light = block(":root");
  const dark = block(".dark");
  assert.deepEqual(
    THEMED.filter((t) => !light.includes(`${t}:`)),
    [],
    "missing from :root",
  );
  assert.deepEqual(
    THEMED.filter((t) => !dark.includes(`${t}:`)),
    [],
    "missing from .dark",
  );
});

test("the type scale is defined once, in :root", () => {
  const light = block(":root");
  for (const token of ["--text-xs", "--text-sm", "--text-md", "--text-lg", "--text-xl", "--text-2xl", "--font-mono"]) {
    assert.ok(light.includes(`${token}:`), `${token} missing from :root`);
  }
  assert.ok(!block(".dark").includes("--text-"), "the type scale must not be theme-scoped");
});

test("every badge tone takes its colours from state tokens, never literals", () => {
  for (const tone of ["ok", "warn", "danger", "info"]) {
    const rule = new RegExp(`\\.badge\\.${tone} \\{([^}]*)\\}`).exec(css);
    assert.ok(rule, `.badge.${tone} is not styled`);
    assert.match(rule[1] as string, new RegExp(`var\\(--state-${tone}\\)`));
    assert.doesNotMatch(rule[1] as string, /#[0-9a-f]{3,8}/i, `.badge.${tone} uses a colour literal`);
  }
});

test("the nav map lists every view once, and each row carries a label, icon and group", () => {
  const map = /export const NAV: [^=]+= \[(.*?)\n\];/s.exec(shell);
  assert.ok(map, "NAV array not found");
  const rows = [...(map[1] as string).matchAll(/\{ view: "(\w+)", glyph: ICON\.(\w+), label: "([^"]+)", group: "(\w*)" \}/g)];
  const views = rows.map((r) => r[1]);
  assert.deepEqual(views, [...new Set(views)], "a view appears twice in the nav");
  assert.deepEqual(views.slice(0, 1), ["home"], "Home is the first row");
  assert.deepEqual(
    rows.map((r) => r[3]),
    ["Home", "Ask", "Projects", "Files", "Skills", "Automations", "Apps", "Keychain", "Memory"],
  );
  assert.deepEqual([...new Set(rows.map((r) => r[4]).filter(Boolean))], ["Work", "Build", "Settings"]);
});

test("home is the landing view and renders through the nav's own dispatch", () => {
  const state = readFileSync(new URL("../src/shell-state.ts", import.meta.url), "utf8");
  assert.match(state, /const VIEWS = \["home",/);
  assert.match(state, /currentView: "home" as View/);
  assert.match(shell, /case "home":\s*\n\s*void renderHome\(\);/);
});

test("chip and empty state render their tones and actions", async () => {
  const dom = new JSDOM("<!doctype html><div id=host></div>");
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = dom.window;
  globals.document = dom.window.document;
  const { render } = await import("lit");
  const { chip, emptyState } = await import("../src/ui.ts");
  const { Inbox } = await import("lucide");
  const host = dom.window.document.getElementById("host") as HTMLElement;

  render(chip("expired", "danger"), host);
  assert.equal(host.querySelector(".badge")?.className, "badge danger");
  assert.equal(host.textContent?.trim(), "expired");

  render(chip("plain"), host);
  assert.equal(host.querySelector(".badge")?.className.trim(), "badge");

  let clicked = 0;
  render(
    emptyState({ glyph: Inbox, headline: "Nothing needs you", body: "Approvals show up here.", action: { label: "Ask", onClick: () => clicked++ } }),
    host,
  );
  assert.equal(host.querySelector(".empty-state h2")?.textContent, "Nothing needs you");
  assert.ok(host.querySelector(".empty-state .empty-icon svg"), "the icon is rendered");
  host.querySelector<HTMLButtonElement>(".empty-state .btn")?.click();
  assert.equal(clicked, 1);

  render(emptyState({ glyph: Inbox, headline: "Empty", body: "No action here." }), host);
  assert.equal(host.querySelector(".empty-state .btn"), null, "no button without an action");
});
