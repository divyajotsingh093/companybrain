import { mapDrivePermissions } from "./drive-access.ts";
import type { DrivePermission } from "./drive-access.ts";
import type { IngestedDocument } from "../types.ts";

const DRIVE_SOURCE = "drive";

export interface DriveFile {
  id: string;
  title?: string;
  viewUrl?: string;
  modifiedTime?: string;
}

export interface DriveIngest {
  document: IngestedDocument;
  unmapped: string[];
}

function parseModified(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function driveDocument(
  file: DriveFile,
  permissions: readonly DrivePermission[],
  chunks: readonly string[],
): DriveIngest {
  const { rules, unmapped } = mapDrivePermissions(permissions);
  return {
    document: {
      ref: { source: DRIVE_SOURCE, externalId: file.id },
      title: file.title ?? "",
      url: file.viewUrl ?? null,
      updatedAt: parseModified(file.modifiedTime),
      chunks: [...chunks],
      access: rules,
    },
    unmapped,
  };
}
