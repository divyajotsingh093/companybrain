import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const CLIENTS = ["claude_code", "codex", "cursor", "grok", "web"] as const;
export type AgentClient = (typeof CLIENTS)[number];
export const AGENT_CLIENTS: readonly AgentClient[] = CLIENTS.filter((c) => c !== "web");

export interface Identity {
  githubToken: string;
  login: string;
  uid: number;
  client: AgentClient;
  issuedAt: number;
}

const TOKEN_PREFIX = "cb1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(secret: string, purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}\0${secret}`).digest();
}

export function seal(secret: string, purpose: string, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(secret: string, purpose: string, sealed: string): unknown {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, purpose), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

export function mintToken(secret: string, identity: Identity): string {
  return TOKEN_PREFIX + seal(secret, "token", identity);
}

export function readToken(secret: string, presented: string | null | undefined): Identity | null {
  if (!presented) return null;
  const token = presented.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const value = unseal(secret, "token", token.slice(TOKEN_PREFIX.length));
  return isIdentity(value) ? value : null;
}

function isIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.githubToken === "string" &&
    typeof o.login === "string" &&
    typeof o.uid === "number" &&
    typeof o.issuedAt === "number" &&
    typeof o.client === "string" &&
    (CLIENTS as readonly string[]).includes(o.client)
  );
}
