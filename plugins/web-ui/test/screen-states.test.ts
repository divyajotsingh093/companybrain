import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectorState } from "../src/connector-state.ts";

const read = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("a broken connection is repaired in place, never removed and re-added", () => {
  const broken = connectorState({ connected: true, needsReconnect: true, available: true });
  assert.equal(broken.label, "Needs re-authorising");
  assert.equal(broken.tone, "warn");
  assert.equal(broken.action, "Re-authorise");
  assert.match(broken.detail, /keeps its access/);
  assert.doesNotMatch(broken.detail, /remove|delete|again/i);
});

test("connector states cover connected, offered and unavailable without inventing an action", () => {
  assert.deepEqual(connectorState({ connected: true, available: true }), {
    label: "Connected",
    tone: "ok",
    action: null,
    detail: "",
  });
  assert.equal(connectorState({ available: true }).action, "Connect account");
  assert.equal(connectorState({ available: true }).tone, "neutral");
  assert.equal(connectorState({}).label, "Unavailable");
  assert.equal(connectorState({}).action, null, "nothing to click when the instance has no credentials");
});

test("the keychain renders connector health through the shared chip, not its own colours", () => {
  const connectors = read("connectors.ts");
  assert.match(connectors, /const state = connectorState\(p\);/);
  assert.match(connectors, /state\.tone === "ok" \? "" : chip\(state\.label, state\.tone\)/, "a healthy connection needs no badge");
  assert.doesNotMatch(connectors, /class="kc-state/, "the bespoke state span is gone");
  assert.match(connectors, /chip\("Expired", "warn"\)/, "credential expiry uses the same chip");
});

test("every list screen offers a way forward when it is empty", () => {
  for (const [file, headline] of [
    ["crons.ts", "No automations yet"],
    ["contexts.ts", "No projects yet"],
    ["files.ts", "No files yet"],
  ] as const) {
    const source = read(file);
    assert.match(source, /emptyState\(\{/, `${file} still uses a bare empty string`);
    assert.ok(source.includes(headline), `${file} is missing the headline ${headline}`);
  }
  assert.match(read("crons.ts"), /label: "New automation"/);
  assert.match(read("contexts.ts"), /label: "New project"/);
});

test("screens touched in this stage add no colour literals", () => {
  for (const file of ["home-view.ts", "connector-state.ts", "crons.ts", "files.ts"]) {
    const source = read(file);
    const literals = source.match(/#[0-9a-f]{6}\b/gi) ?? [];
    assert.deepEqual(literals, [], `${file} hardcodes a colour`);
  }
});
