import { createPgPool, withPgTransaction } from "../persistence/pg-pool.ts";
import { accessPredicate } from "./access-predicate.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";
import type { Asker, IngestedDocument, SearchHit, SourceIdentity } from "./types.ts";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS knowledge_documents(
      document_id  TEXT PRIMARY KEY,
      source       TEXT NOT NULL,
      external_id  TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      url          TEXT,
      updated_at   TIMESTAMPTZ,
      acl_captured BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (source, external_id)
    )`,
  `CREATE TABLE IF NOT EXISTS knowledge_chunks(
      chunk_id    TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
      ordinal     INTEGER NOT NULL,
      text        TEXT NOT NULL,
      tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
      UNIQUE (document_id, ordinal)
    )`,
  `CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv ON knowledge_chunks USING GIN(tsv)`,
  `CREATE TABLE IF NOT EXISTS knowledge_document_acl(
      document_id  TEXT NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
      grantee_kind TEXT NOT NULL,
      grantee_id   TEXT NOT NULL,
      permission   TEXT NOT NULL,
      PRIMARY KEY (document_id, grantee_kind, grantee_id, permission)
    )`,
  `CREATE INDEX IF NOT EXISTS knowledge_document_acl_grantee
      ON knowledge_document_acl(grantee_kind, grantee_id, document_id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_principal_identity(
      source       TEXT NOT NULL,
      external_id  TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      PRIMARY KEY (source, external_id)
    )`,
  `CREATE INDEX IF NOT EXISTS knowledge_principal_identity_principal
      ON knowledge_principal_identity(principal_id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_principal_group(
      principal_id TEXT NOT NULL,
      group_id     TEXT NOT NULL,
      PRIMARY KEY (principal_id, group_id)
    )`,
];

const documentId = (source: string, externalId: string) => `${source}:${externalId}`;

export function createPostgresKnowledgeStore(connectionString: string): KnowledgeStore {
  const db = createPgPool(connectionString, SCHEMA);
  const { q } = db;

  return {
    async ingest(doc: IngestedDocument) {
      const id = documentId(doc.ref.source, doc.ref.externalId);
      const captured = doc.access.length > 0;
      await withPgTransaction(await db.pool(), async (client) => {
        await client.query(
          `INSERT INTO knowledge_documents (document_id, source, external_id, title, url, updated_at, acl_captured)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (document_id) DO UPDATE
             SET title = EXCLUDED.title,
                 url = EXCLUDED.url,
                 updated_at = EXCLUDED.updated_at,
                 acl_captured = EXCLUDED.acl_captured`,
          [id, doc.ref.source, doc.ref.externalId, doc.title, doc.url, doc.updatedAt, captured],
        );
        await client.query("DELETE FROM knowledge_document_acl WHERE document_id = $1", [id]);
        for (const rule of doc.access) {
          await client.query(
            `INSERT INTO knowledge_document_acl (document_id, grantee_kind, grantee_id, permission)
               VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [id, rule.granteeKind, rule.granteeId, rule.permission],
          );
        }
        await client.query("DELETE FROM knowledge_chunks WHERE document_id = $1", [id]);
        for (const [ordinal, text] of doc.chunks.entries()) {
          await client.query(
            "INSERT INTO knowledge_chunks (chunk_id, document_id, ordinal, text) VALUES ($1, $2, $3, $4)",
            [`${id}#${ordinal}`, id, ordinal, text],
          );
        }
      });
      return id;
    },

    async markAclUncaptured(source: string, externalId: string) {
      await withPgTransaction(await db.pool(), async (client) => {
        const id = documentId(source, externalId);
        await client.query("UPDATE knowledge_documents SET acl_captured = FALSE WHERE document_id = $1", [id]);
        await client.query("DELETE FROM knowledge_document_acl WHERE document_id = $1", [id]);
      });
    },

    async remove(source: string, externalId: string) {
      await q("DELETE FROM knowledge_documents WHERE document_id = $1", [documentId(source, externalId)]);
    },

    async linkIdentity(identity: SourceIdentity, principalId: string) {
      await q(
        `INSERT INTO knowledge_principal_identity (source, external_id, principal_id)
           VALUES ($1, $2, $3)
         ON CONFLICT (source, external_id) DO UPDATE SET principal_id = EXCLUDED.principal_id`,
        [identity.source, identity.externalId, principalId],
      );
    },

    async setGroups(principalId: string, groupIds: readonly string[]) {
      await withPgTransaction(await db.pool(), async (client) => {
        await client.query("DELETE FROM knowledge_principal_group WHERE principal_id = $1", [principalId]);
        for (const groupId of groupIds) {
          await client.query(
            "INSERT INTO knowledge_principal_group (principal_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [principalId, groupId],
          );
        }
      });
    },

    async resolveAsker(identity: SourceIdentity, domains: readonly string[] = []) {
      const rows = await q(
        "SELECT principal_id FROM knowledge_principal_identity WHERE source = $1 AND external_id = $2",
        [identity.source, identity.externalId],
      );
      const principalId = rows[0]?.principal_id as string | undefined;
      if (!principalId) return null;
      const groups = await q("SELECT group_id FROM knowledge_principal_group WHERE principal_id = $1", [principalId]);
      return {
        principalId,
        groupIds: groups.map((r) => r.group_id as string),
        domains: [...domains],
      };
    },

    async search(asker: Asker, query: string, limit = 10) {
      const params: unknown[] = [query, limit];
      const access = accessPredicate(asker, "d", params.length + 1);
      params.push(...access.params);
      const rows = await q(
        `SELECT c.chunk_id, c.document_id, c.ordinal, c.text,
                d.title, d.url, d.source,
                ts_rank(c.tsv, websearch_to_tsquery('english', $1)) AS score
           FROM knowledge_chunks c
           JOIN knowledge_documents d ON d.document_id = c.document_id
          WHERE c.tsv @@ websearch_to_tsquery('english', $1)
            AND ${access.sql}
          ORDER BY score DESC, c.document_id, c.ordinal
          LIMIT $2`,
        params,
      );
      return rows.map((r): SearchHit => ({
        chunkId: r.chunk_id as string,
        documentId: r.document_id as string,
        ordinal: r.ordinal as number,
        text: r.text as string,
        title: r.title as string,
        url: (r.url as string | null) ?? null,
        source: r.source as string,
        score: Number(r.score),
      }));
    },

    close: db.close,
  };
}
