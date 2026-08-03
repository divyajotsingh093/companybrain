import { domainRule, groupRule, principalRule, publicRule } from "../types.ts";
import type { AccessRule } from "../types.ts";

export interface DrivePermission {
  type?: string;
  role?: string;
  emailAddress?: string;
  domain?: string;
  displayName?: string;
  deleted?: boolean;
}

export interface MappedAccess {
  rules: AccessRule[];
  unmapped: string[];
}

const READ_ROLES = new Set(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"]);

const normalizeEmail = (value: string) => value.trim().toLowerCase();

function mapOne(permission: DrivePermission): AccessRule | string {
  const type = permission.type ?? "";
  const role = permission.role ?? "";
  if (!READ_ROLES.has(role)) return `role:${role || "(missing)"}`;
  switch (type) {
    case "user": {
      const email = permission.emailAddress?.trim();
      return email ? principalRule(normalizeEmail(email)) : "user:(no emailAddress)";
    }
    case "group": {
      const email = permission.emailAddress?.trim();
      return email ? groupRule(normalizeEmail(email)) : "group:(no emailAddress)";
    }
    case "domain": {
      const domain = permission.domain?.trim();
      return domain ? domainRule(normalizeEmail(domain)) : "domain:(no domain)";
    }
    case "anyone":
      return publicRule();
    default:
      return `type:${type || "(missing)"}`;
  }
}

export function mapDrivePermissions(permissions: readonly DrivePermission[]): MappedAccess {
  const rules = new Map<string, AccessRule>();
  const unmapped: string[] = [];
  for (const permission of permissions) {
    if (permission.deleted) continue;
    const mapped = mapOne(permission);
    if (typeof mapped === "string") {
      unmapped.push(mapped);
      continue;
    }
    rules.set(`${mapped.granteeKind}\n${mapped.granteeId}`, mapped);
  }
  return { rules: [...rules.values()], unmapped };
}
