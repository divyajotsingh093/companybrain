export const GRANTEE_KINDS = ["principal", "group", "domain", "public"] as const;
export type GranteeKind = (typeof GRANTEE_KINDS)[number];

export interface AccessRule {
  granteeKind: GranteeKind;
  granteeId: string;
  permission: "read";
}

export interface SourceIdentity {
  source: string;
  externalId: string;
}

export interface Asker {
  principalId: string;
  groupIds: readonly string[];
  domains: readonly string[];
}

interface DocumentRef {
  source: string;
  externalId: string;
}

export interface IngestedDocument {
  ref: DocumentRef;
  title: string;
  url: string | null;
  updatedAt: Date | null;
  chunks: readonly string[];
  access: readonly AccessRule[];
}

export interface SearchHit {
  documentId: string;
  chunkId: string;
  ordinal: number;
  text: string;
  title: string;
  url: string | null;
  source: string;
  score: number;
}

export function parseGranteeKind(value: unknown): GranteeKind | null {
  if (typeof value !== "string") return null;
  return (GRANTEE_KINDS as readonly string[]).includes(value) ? (value as GranteeKind) : null;
}

export const publicRule = (): AccessRule => ({ granteeKind: "public", granteeId: "", permission: "read" });
export const principalRule = (id: string): AccessRule => ({
  granteeKind: "principal",
  granteeId: id,
  permission: "read",
});
export const groupRule = (id: string): AccessRule => ({ granteeKind: "group", granteeId: id, permission: "read" });
export const domainRule = (id: string): AccessRule => ({ granteeKind: "domain", granteeId: id, permission: "read" });
