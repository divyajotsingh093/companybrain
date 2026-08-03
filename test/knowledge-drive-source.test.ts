import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDrivePermissions } from "../src/knowledge/sources/drive-access.ts";
import { driveDocument } from "../src/knowledge/sources/drive-source.ts";

const OWNER_ONLY = [
  { displayName: "divyajotsingh093", emailAddress: "divyajotsingh093@gmail.com", role: "owner", type: "user" },
];

const LINK_SHARED = [
  { role: "writer", type: "anyone" },
  { displayName: "brian", emailAddress: "brian@palaverlabs.com", role: "owner", type: "user" },
];

test("an owner-only file grants exactly its owner", () => {
  const { rules, unmapped } = mapDrivePermissions(OWNER_ONLY);
  assert.deepEqual(rules, [{ granteeKind: "principal", granteeId: "divyajotsingh093@gmail.com", permission: "read" }]);
  assert.deepEqual(unmapped, []);
});

test("a link-shared file is public even though it also names an owner", () => {
  const { rules, unmapped } = mapDrivePermissions(LINK_SHARED);
  assert.deepEqual(unmapped, []);
  assert.ok(
    rules.some((r) => r.granteeKind === "public"),
    "anyone-type permission must produce a public rule",
  );
  assert.ok(rules.some((r) => r.granteeKind === "principal" && r.granteeId === "brian@palaverlabs.com"));
});

test("each Drive permission type maps onto its grantee kind", () => {
  const { rules } = mapDrivePermissions([
    { type: "user", role: "reader", emailAddress: "a@example.com" },
    { type: "group", role: "reader", emailAddress: "eng@example.com" },
    { type: "domain", role: "reader", domain: "example.com" },
    { type: "anyone", role: "reader" },
  ]);
  assert.deepEqual(
    rules.map((r) => [r.granteeKind, r.granteeId]),
    [
      ["principal", "a@example.com"],
      ["group", "eng@example.com"],
      ["domain", "example.com"],
      ["public", ""],
    ],
  );
});

test("emails and domains normalize to lower case so principals match", () => {
  const { rules } = mapDrivePermissions([
    { type: "user", role: "reader", emailAddress: "  Alice@Example.COM " },
    { type: "domain", role: "reader", domain: "Example.COM" },
  ]);
  assert.deepEqual(
    rules.map((r) => r.granteeId),
    ["alice@example.com", "example.com"],
  );
});

test("deleted permissions are ignored", () => {
  const { rules, unmapped } = mapDrivePermissions([
    { type: "user", role: "reader", emailAddress: "gone@example.com", deleted: true },
    { type: "user", role: "reader", emailAddress: "here@example.com" },
  ]);
  assert.deepEqual(
    rules.map((r) => r.granteeId),
    ["here@example.com"],
  );
  assert.deepEqual(unmapped, []);
});

test("a permission we cannot express is reported and never guessed at", () => {
  const { rules, unmapped } = mapDrivePermissions([
    { type: "domain", role: "reader" },
    { type: "user", role: "reader" },
    { type: "teamDrive", role: "reader" },
    { type: "user", role: "reader", emailAddress: "kept@example.com" },
  ]);
  assert.deepEqual(
    rules.map((r) => r.granteeId),
    ["kept@example.com"],
  );
  assert.deepEqual(unmapped, ["domain:(no domain)", "user:(no emailAddress)", "type:teamDrive"]);
});

test("dropping an unmappable permission narrows access rather than widening it", () => {
  const { rules } = mapDrivePermissions([{ type: "domain", role: "reader" }]);
  assert.deepEqual(rules, [], "a domain grant we cannot name must not become a public grant");
});

test("duplicate grants to the same grantee collapse", () => {
  const { rules } = mapDrivePermissions([
    { type: "user", role: "owner", emailAddress: "a@example.com" },
    { type: "user", role: "writer", emailAddress: "A@example.com" },
  ]);
  assert.equal(rules.length, 1);
});

test("a file with no expressible permission produces an empty ACL, which the store denies", () => {
  const { document } = driveDocument({ id: "f1", title: "t" }, [{ type: "teamDrive", role: "reader" }], ["body"]);
  assert.deepEqual(document.access, []);
});

test("driveDocument carries the citation fields and a parsed timestamp", () => {
  const { document, unmapped } = driveDocument(
    {
      id: "1av8Jsv7gwjOkglWp12tl9FqDO-Z2UOeajL1zGiLjPTE",
      title: "L&A New Business eApp Whitepaper 3.12.26",
      viewUrl: "https://docs.google.com/document/d/1av8Jsv7gwjOkglWp12tl9FqDO-Z2UOeajL1zGiLjPTE/edit",
      modifiedTime: "2026-04-30T09:13:24.916Z",
    },
    LINK_SHARED,
    ["chunk one", "chunk two"],
  );
  assert.equal(document.ref.source, "drive");
  assert.equal(document.ref.externalId, "1av8Jsv7gwjOkglWp12tl9FqDO-Z2UOeajL1zGiLjPTE");
  assert.equal(document.title, "L&A New Business eApp Whitepaper 3.12.26");
  assert.equal(document.updatedAt?.toISOString(), "2026-04-30T09:13:24.916Z");
  assert.equal(document.chunks.length, 2);
  assert.deepEqual(unmapped, []);
});

test("an unparseable modifiedTime becomes null rather than an invalid date", () => {
  const { document } = driveDocument({ id: "f2", modifiedTime: "not-a-date" }, OWNER_ONLY, ["x"]);
  assert.equal(document.updatedAt, null);
});
