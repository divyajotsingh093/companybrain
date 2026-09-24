import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seal, unseal } from "./token.ts";
import { clamp, cleanLine } from "./untrusted.ts";

export const MAX_GATEWAYS = 20;
export const GATEWAY_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TOOLS = 100;
const MAX_RESULT_CHARS = 40_000;
const CALL_TIMEOUT_MS = 30_000;
const SECRET_PURPOSE = "gateway-token";
const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home|lan)$/i;

export interface Upstream {
  tools(): Promise<Array<{ name: string; description: string }>>;
  call(tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

export function gatewayUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a URL.";
  }
  if (url.protocol !== "https:") return "Use an https:// address.";
  if (url.username || url.password) return "Put the token in the token field, not in the address.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || BLOCKED_HOSTS.test(host) || !host.includes(".")) return "Use a public host name, not a local address or an IP address.";
  return null;
}

export const sealGatewayToken = (secret: string, token: string): string => seal(secret, SECRET_PURPOSE, token);

export async function openUpstream(opts: { url: string; sealedToken: string | null; secret: string; fetch: typeof fetch }): Promise<Upstream> {
  const problem = gatewayUrlProblem(opts.url);
  if (problem) throw new Error(problem);
  const token = opts.sealedToken ? unseal(opts.secret, SECRET_PURPOSE, opts.sealedToken) : null;
  const guarded: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    return opts.fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    fetch: guarded,
    requestInit: typeof token === "string" && token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "companybrain-gateway", version: "1.0.0" });
  await client.connect(transport, { timeout: CALL_TIMEOUT_MS });
  return {
    async tools() {
      const { tools } = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS });
      return tools.slice(0, MAX_TOOLS).map((t) => ({ name: cleanLine(t.name, 120), description: clamp(t.description ?? "", 600) }));
    },
    async call(tool, args) {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
      const parts = Array.isArray(result.content) ? result.content : [];
      const text = parts
        .map((p: { type?: string; text?: string }) => (p.type === "text" && typeof p.text === "string" ? p.text : `[${p.type ?? "unknown"} content omitted]`))
        .join("\n");
      return { text: clamp(text || JSON.stringify(result.structuredContent ?? {}), MAX_RESULT_CHARS), isError: result.isError === true };
    },
    close: () => client.close(),
  };
}
