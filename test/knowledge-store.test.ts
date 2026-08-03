import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createPostgresKnowledgeStore } from "../src/knowledge/postgres-knowledge-store.ts";
import { domainRule, groupRule, principalRule, publicRule } from "../src/knowledge/types.ts";
import type { Asker, IngestedDocument } from "../src/knowledge/types.ts";
import type { KnowledgeStore } from "../src/knowledge/knowledge-store.ts";
import { driveDocument } from "../src/knowledge/sources/drive-source.ts";

const URL = process.env.DATABASE_URL;
const skip = URL ? false : "set DATABASE_URL (a Postgres) to run the knowledge-store tests";

const TABLES =
  "knowledge_document_acl, knowledge_chunks, knowledge_documents, knowledge_principal_identity, knowledge_principal_group";

let store: KnowledgeStore;
let admin: import("pg").Pool;

before(async () => {
  if (!URL) return;
  const pg = (await import("pg")).default;
  admin = new pg.Pool({ connectionString: URL, max: 2 });
  await admin.query(`DROP TABLE IF EXISTS ${TABLES} CASCADE`);
  store = createPostgresKnowledgeStore(URL);
  await store.search({ principalId: "warmup", groupIds: [], domains: [] }, "warmup");
});

after(async () => {
  if (!URL) return;
  await store.close();
  await admin.end();
});

beforeEach(async () => {
  if (!URL) return;
  await admin.query(`TRUNCATE ${TABLES} CASCADE`);
});

const doc = (externalId: string, text: string, access: IngestedDocument["access"]): IngestedDocument => ({
  ref: { source: "drive", externalId },
  title: `doc ${externalId}`,
  url: `https://drive.example/${externalId}`,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  chunks: [text],
  access,
});

const alice: Asker = { principalId: "P-alice", groupIds: ["G-eng"], domains: ["example.com"] };
const bob: Asker = { principalId: "P-bob", groupIds: [], domains: ["example.com"] };
const outsider: Asker = { principalId: "P-ext", groupIds: [], domains: ["other.com"] };

test("a principal grant is retrievable by that principal and nobody else", { skip }, async () => {
  await store.ingest(doc("d1", "the quarterly revenue projection", [principalRule("P-alice")]));

  assert.equal((await store.search(alice, "revenue")).length, 1);
  assert.deepEqual(await store.search(bob, "revenue"), []);
  assert.deepEqual(await store.search(outsider, "revenue"), []);
});

test("a group grant reaches members only", { skip }, async () => {
  await store.ingest(doc("d2", "the deployment runbook", [groupRule("G-eng")]));

  assert.equal((await store.search(alice, "runbook")).length, 1);
  assert.deepEqual(await store.search(bob, "runbook"), []);
});

test("a domain grant reaches the domain and stops at its edge", { skip }, async () => {
  await store.ingest(doc("d3", "the employee handbook", [domainRule("example.com")]));

  assert.equal((await store.search(alice, "handbook")).length, 1);
  assert.equal((await store.search(bob, "handbook")).length, 1);
  assert.deepEqual(await store.search(outsider, "handbook"), []);
});

test("a public grant reaches everyone", { skip }, async () => {
  await store.ingest(doc("d4", "the published pricing page", [publicRule()]));

  for (const asker of [alice, bob, outsider]) {
    assert.equal((await store.search(asker, "pricing")).length, 1, `${asker.principalId} should see public`);
  }
});

test("default deny: a document ingested with no access rules is retrievable by nobody", { skip }, async () => {
  await store.ingest(doc("d5", "the acquisition memo", []));

  for (const asker of [alice, bob, outsider]) {
    assert.deepEqual(await store.search(asker, "acquisition"), [], `${asker.principalId} must not see it`);
  }
});

test("default deny: losing the ACL on re-sync makes a previously visible document invisible", { skip }, async () => {
  await store.ingest(doc("d6", "the incident postmortem", [principalRule("P-alice")]));
  assert.equal((await store.search(alice, "postmortem")).length, 1);

  await store.markAclUncaptured("drive", "d6");
  assert.deepEqual(await store.search(alice, "postmortem"), []);
});

test("revoking a grant by re-ingesting a narrower ACL removes access", { skip }, async () => {
  await store.ingest(doc("d7", "the salary band spreadsheet", [groupRule("G-eng"), principalRule("P-bob")]));
  assert.equal((await store.search(alice, "salary")).length, 1);
  assert.equal((await store.search(bob, "salary")).length, 1);

  await store.ingest(doc("d7", "the salary band spreadsheet", [principalRule("P-bob")]));
  assert.deepEqual(await store.search(alice, "salary"), []);
  assert.equal((await store.search(bob, "salary")).length, 1);
});

test("a forbidden document never surfaces even when it is the strongest lexical match", { skip }, async () => {
  await store.ingest(
    doc("secret", "termination termination termination of the contract", [principalRule("P-someone-else")]),
  );
  await store.ingest(doc("open", "a passing mention of termination clauses", [domainRule("example.com")]));

  const hits = await store.search(bob, "termination");
  assert.deepEqual(
    hits.map((h) => h.documentId),
    ["drive:open"],
  );
});

test("removing a document removes its chunks and rules", { skip }, async () => {
  await store.ingest(doc("d8", "the vendor contract", [publicRule()]));
  assert.equal((await store.search(bob, "vendor")).length, 1);

  await store.remove("drive", "d8");
  assert.deepEqual(await store.search(bob, "vendor"), []);
});

test("identity resolution maps a source identity to a principal and its groups", { skip }, async () => {
  await store.linkIdentity({ source: "slack", externalId: "U-ALICE" }, "P-alice");
  await store.linkIdentity({ source: "github", externalId: "alice-gh" }, "P-alice");
  await store.setGroups("P-alice", ["G-eng", "G-oncall"]);

  const viaSlack = await store.resolveAsker({ source: "slack", externalId: "U-ALICE" }, ["example.com"]);
  const viaGithub = await store.resolveAsker({ source: "github", externalId: "alice-gh" }, ["example.com"]);

  assert.equal(viaSlack?.principalId, "P-alice");
  assert.equal(viaGithub?.principalId, "P-alice");
  assert.deepEqual([...(viaSlack?.groupIds ?? [])].sort(), ["G-eng", "G-oncall"]);
  assert.equal(await store.resolveAsker({ source: "slack", externalId: "U-NOBODY" }), null);
});

test("a resolved asker retrieves exactly what their group membership allows", { skip }, async () => {
  await store.linkIdentity({ source: "slack", externalId: "U-ALICE" }, "P-alice");
  await store.setGroups("P-alice", ["G-eng"]);
  await store.ingest(doc("d9", "the oncall rotation", [groupRule("G-eng")]));
  await store.ingest(doc("d10", "the board deck", [groupRule("G-board")]));

  const asker = await store.resolveAsker({ source: "slack", externalId: "U-ALICE" }, ["example.com"]);
  assert.ok(asker);
  assert.equal((await store.search(asker, "oncall")).length, 1);
  assert.deepEqual(await store.search(asker, "board deck"), []);
});

test("hits carry the citation fields an answer needs", { skip }, async () => {
  await store.ingest(doc("d11", "the onboarding checklist", [publicRule()]));

  const [hit] = await store.search(bob, "onboarding");
  assert.ok(hit);
  assert.equal(hit.documentId, "drive:d11");
  assert.equal(hit.title, "doc d11");
  assert.equal(hit.url, "https://drive.example/d11");
  assert.equal(hit.source, "drive");
  assert.equal(hit.ordinal, 0);
  assert.ok(hit.score > 0);
});

test("an empty group list does not accidentally match group-granted documents", { skip }, async () => {
  await store.ingest(doc("d12", "the restricted design doc", [groupRule("G-eng")]));

  const noGroups: Asker = { principalId: "P-bob", groupIds: [], domains: [] };
  assert.deepEqual(await store.search(noGroups, "restricted"), []);
});

test("a Drive file shared to a person reaches only that person", { skip }, async () => {
  const { document } = driveDocument(
    { id: "drive-private", title: "comp review", viewUrl: "https://docs.google.com/d/private" },
    [{ type: "user", role: "owner", emailAddress: "Alice@Example.com" }],
    ["the compensation review for this cycle"],
  );
  await store.ingest(document);

  const owner: Asker = { principalId: "alice@example.com", groupIds: [], domains: ["example.com"] };
  assert.equal((await store.search(owner, "compensation")).length, 1);
  assert.deepEqual(await store.search(bob, "compensation"), []);
});

test("a link-shared Drive file reaches someone it was never shared with directly", { skip }, async () => {
  const { document } = driveDocument(
    { id: "drive-link", title: "whitepaper", viewUrl: "https://docs.google.com/d/link" },
    [
      { role: "writer", type: "anyone" },
      { displayName: "brian", emailAddress: "brian@palaverlabs.com", role: "owner", type: "user" },
    ],
    ["the eApp whitepaper draft"],
  );
  await store.ingest(document);

  assert.equal((await store.search(outsider, "whitepaper")).length, 1);
});

test("a Drive file whose permissions we cannot express is retrievable by nobody", { skip }, async () => {
  const { document, unmapped } = driveDocument(
    { id: "drive-opaque", title: "opaque" },
    [{ type: "teamDrive", role: "reader" }],
    ["a document behind an unmodelled permission"],
  );
  assert.deepEqual(unmapped, ["type:teamDrive"]);
  await store.ingest(document);

  for (const asker of [alice, bob, outsider]) {
    assert.deepEqual(await store.search(asker, "unmodelled"), [], `${asker.principalId} must not see it`);
  }
});
