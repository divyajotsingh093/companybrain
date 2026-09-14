import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const AGENT_CLIENTS = ["claude_code", "codex", "cursor", "grok"] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

export function isAgentClient(value: string): value is AgentClient {
  return (AGENT_CLIENTS as readonly string[]).includes(value);
}

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

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
