import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seal, unseal } from "./token.ts";
import { clamp, cleanLine } from "./untrusted.ts";

export const MAX_GATEWAYS = 20;
export const GATEWAY_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TOOLS = 100;
const MAX_RESULT_CHARS = 40_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CALL_TIMEOUT_MS = 30_000;
const SECRET_PURPOSE = "gateway-token";
const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home|lan|nip\.io|sslip\.io|xip\.io)$/i;

const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  PRIVATE.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) {
  PRIVATE.addSubnet(net, bits, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

export async function assertPublicHost(host: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<void> {
  const addresses = await resolve(host);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("That host resolves to a private address.");
}

export const publicFetch: typeof fetch = async (input, init) => {
  await assertPublicHost(new URL(input instanceof Request ? input.url : String(input)).hostname);
  return fetch(input, init);
};

function limited(res: Response): Response {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw new Error("The server sent too much data.");
  if (!res.body) return res;
  let seen = 0;
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength;
        if (seen > MAX_RESPONSE_BYTES) ctl.error(new Error("The server sent too much data."));
        else ctl.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

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
  if (url.port && url.port !== "443") return "Use the standard https port.";
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
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
    return opts.fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout }).then(limited);
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
