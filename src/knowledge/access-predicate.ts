import type { Asker } from "./types.ts";

export interface AccessPredicate {
  sql: string;
  params: unknown[];
}

export function accessPredicate(asker: Asker, documentAlias: string, nextParamIndex: number): AccessPredicate {
  const principal = nextParamIndex;
  const groups = nextParamIndex + 1;
  const domains = nextParamIndex + 2;
  const sql = `${documentAlias}.acl_captured
    AND EXISTS (
      SELECT 1 FROM knowledge_document_acl acl
       WHERE acl.document_id = ${documentAlias}.document_id
         AND acl.permission = 'read'
         AND (
              acl.grantee_kind = 'public'
           OR (acl.grantee_kind = 'principal' AND acl.grantee_id = $${principal})
           OR (acl.grantee_kind = 'group'     AND acl.grantee_id = ANY($${groups}))
           OR (acl.grantee_kind = 'domain'    AND acl.grantee_id = ANY($${domains}))
         )
    )`;
  return {
    sql,
    params: [asker.principalId, [...asker.groupIds], [...asker.domains]],
  };
}

export const ACCESS_PREDICATE_PARAM_COUNT = 3;
