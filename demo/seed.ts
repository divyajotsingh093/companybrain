import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPostgresKnowledgeStore } from "../src/knowledge/postgres-knowledge-store.ts";
import { driveDocument } from "../src/knowledge/sources/drive-source.ts";
import { REAL_RESUME, REAL_WHITEPAPER, SYNTHETIC_COMP_REVIEW, SYNTHETIC_RUNBOOK, chunk } from "./seed-data.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("set DATABASE_URL to the demo Postgres before running the seed script");
  process.exit(1);
}

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = (name: string) => readFileSync(`${here}seed-fixtures/${name}`, "utf8");

async function main() {
  const store = createPostgresKnowledgeStore(DATABASE_URL!);

  const docs = [
    driveDocument(REAL_RESUME.file, REAL_RESUME.permissions, chunk(fixture("resume.md"))),
    driveDocument(REAL_WHITEPAPER.file, REAL_WHITEPAPER.permissions, chunk(fixture("whitepaper.md"))),
    driveDocument(SYNTHETIC_COMP_REVIEW.file, SYNTHETIC_COMP_REVIEW.permissions, chunk(SYNTHETIC_COMP_REVIEW.body)),
    driveDocument(SYNTHETIC_RUNBOOK.file, SYNTHETIC_RUNBOOK.permissions, chunk(SYNTHETIC_RUNBOOK.body)),
  ];

  for (const { document, unmapped } of docs) {
    if (unmapped.length > 0) {
      console.warn(`${document.title}: unmapped permissions ${JSON.stringify(unmapped)}`);
    }
    const id = await store.ingest(document);
    console.log(`ingested ${id}  (${document.chunks.length} chunk(s), ${document.access.length} rule(s))`);
  }

  await store.close();
  console.log("done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
