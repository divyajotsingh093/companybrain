import type { Asker, IngestedDocument, SearchHit, SourceIdentity } from "./types.ts";

export interface KnowledgeStore {
  ingest(doc: IngestedDocument): Promise<string>;
  markAclUncaptured(source: string, externalId: string): Promise<void>;
  remove(source: string, externalId: string): Promise<void>;
  linkIdentity(identity: SourceIdentity, principalId: string): Promise<void>;
  setGroups(principalId: string, groupIds: readonly string[]): Promise<void>;
  resolveAsker(identity: SourceIdentity, domains?: readonly string[]): Promise<Asker | null>;
  search(asker: Asker, query: string, limit?: number): Promise<SearchHit[]>;
  close(): Promise<void>;
}
