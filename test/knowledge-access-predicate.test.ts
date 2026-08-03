import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCESS_PREDICATE_PARAM_COUNT, accessPredicate } from "../src/knowledge/access-predicate.ts";
import { GRANTEE_KINDS, parseGranteeKind } from "../src/knowledge/types.ts";

const asker = { principalId: "P-alice", groupIds: ["G-eng"], domains: ["example.com"] };

test("the predicate binds principal, groups and domains in that order", () => {
  const { params } = accessPredicate(asker, "d", 1);
  assert.equal(params.length, ACCESS_PREDICATE_PARAM_COUNT);
  assert.deepEqual(params, ["P-alice", ["G-eng"], ["example.com"]]);
});

test("the predicate numbers its placeholders from the offset it is given", () => {
  const { sql } = accessPredicate(asker, "d", 4);
  assert.match(sql, /grantee_id = \$4/);
  assert.match(sql, /ANY\(\$5\)/);
  assert.match(sql, /ANY\(\$6\)/);
  assert.doesNotMatch(sql, /\$1\b/);
});

test("the predicate requires acl_captured, so an uncaptured ACL denies", () => {
  const { sql } = accessPredicate(asker, "d", 1);
  assert.match(sql, /d\.acl_captured/);
});

test("the predicate covers every grantee kind the type allows", () => {
  const { sql } = accessPredicate(asker, "d", 1);
  for (const kind of GRANTEE_KINDS) {
    assert.match(sql, new RegExp(`grantee_kind = '${kind}'`), `predicate must handle ${kind}`);
  }
});

test("the predicate scopes itself to the aliased document table", () => {
  const { sql } = accessPredicate(asker, "docs", 1);
  assert.match(sql, /acl\.document_id = docs\.document_id/);
});

test("parseGranteeKind rejects anything outside the four kinds", () => {
  assert.equal(parseGranteeKind("group"), "group");
  assert.equal(parseGranteeKind("everyone"), null);
  assert.equal(parseGranteeKind(null), null);
});

test("every read of knowledge_chunks in the store goes through the access predicate", () => {
  const source = readFileSync(new URL("../src/knowledge/postgres-knowledge-store.ts", import.meta.url), "utf8");
  const selects = source.split(/\bSELECT\b/).slice(1);
  const readsChunks = selects.filter((s) => s.includes("knowledge_chunks"));
  assert.ok(readsChunks.length > 0, "expected at least one query reading knowledge_chunks");
  for (const select of readsChunks) {
    assert.ok(
      select.includes("access.sql"),
      "a SELECT over knowledge_chunks must interpolate the shared access predicate",
    );
  }
});
