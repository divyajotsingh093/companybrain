import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPostgresKnowledgeStore } from "../../src/knowledge/postgres-knowledge-store.ts";
import type { Asker } from "../../src/knowledge/types.ts";

const DATABASE_URL = process.env.DATABASE_URL;

let store: ReturnType<typeof createPostgresKnowledgeStore> | null = null;
function getStore() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!store) store = createPostgresKnowledgeStore(DATABASE_URL);
  return store;
}

function isAsker(value: unknown): value is Asker {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return typeof a.principalId === "string" && Array.isArray(a.groupIds) && Array.isArray(a.domains);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const { query, asker } = (req.body ?? {}) as { query?: unknown; asker?: unknown };
  if (typeof query !== "string" || query.trim() === "") {
    res.status(400).json({ error: "query is required" });
    return;
  }
  if (!isAsker(asker)) {
    res.status(400).json({ error: "asker { principalId, groupIds, domains } is required" });
    return;
  }
  try {
    const hits = await getStore().search(asker, query, 10);
    res.status(200).json({ hits });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "search failed" });
  }
}
