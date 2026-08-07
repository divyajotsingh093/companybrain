import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellCss = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");

function block(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${esc}\\s*\\{`, "m").exec(shellCss);
  assert.ok(m, `no top-level "${selector} {" block in shell.css`);
  const end = shellCss.indexOf("}", m.index);
  return shellCss.slice(m.index, end);
}

const THEMED = [
  "--brand-rail",
  "--brand-rail-fg",
  "--brand-rail-muted",
  "--brand-rail-active-bg",
  "--brand-accent-text",
  "--canvas-wash",
  "--chip-outline-border",
  "--chip-outline-fg",
];

test("every themed Bold Signal token is defined in both :root and .dark", () => {
  const light = block(":root");
  const dark = block(".dark");
  const missingLight = THEMED.filter((t) => !light.includes(`${t}:`));
  const missingDark = THEMED.filter((t) => !dark.includes(`${t}:`));
  assert.deepEqual(missingLight, [], "themed tokens missing from :root");
  assert.deepEqual(missingDark, [], "themed tokens missing from .dark");
});

test("--brand-accent is never redefined under .dark", () => {
  const dark = block(".dark");
  assert.ok(
    !/--brand-accent\s*:/.test(dark),
    "--brand-accent is org-configurable via injectBranding and must not be theme-scoped",
  );
});

test("derived accent tokens are computed from --brand-accent", () => {
  const light = block(":root");
  for (const token of ["--brand-accent-hi", "--brand-gradient"]) {
    const decl = light.match(new RegExp(`${token}\\s*:([^;]+);`));
    assert.ok(decl, `${token} not defined in :root`);
    assert.match(decl[1], /var\(--brand-accent/, `${token} must derive from --brand-accent`);
  }
});
