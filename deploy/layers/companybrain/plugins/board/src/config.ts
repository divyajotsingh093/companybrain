export interface Config {
  port: number;
  publicUrl: string;
  secret: string;
  dbPath: string;
  githubClientId: string | undefined;
  githubClientSecret: string | undefined;
  githubApiUrl: string;
  githubWebUrl: string;
  accessTtlMs: number;
  agentTokenTtlMs: number;
  sessionTtlMs: number;
  requestsPerMinute: number;
}

const DAY_MS = 86_400_000;

function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname.endsWith(".test");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.BOARD_SECRET ?? "";
  if (secret.length < 32) throw new Error("BOARD_SECRET must be at least 32 characters; generate one with openssl rand -base64 48");
  const port = Number(env.PORT ?? 8787);
  const githubClientId = env.GITHUB_CLIENT_ID || undefined;
  const githubClientSecret = env.GITHUB_CLIENT_SECRET || undefined;
  if (githubClientId && !env.PUBLIC_URL) throw new Error("PUBLIC_URL is required when GitHub sign-in is configured");
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== "https:" && !isLocal(parsed)) throw new Error("PUBLIC_URL must use https outside localhost");
  return {
    port,
    publicUrl,
    secret,
    dbPath: env.BOARD_DB_PATH ?? "board.db",
    githubClientId,
    githubClientSecret,
    githubApiUrl: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""),
    githubWebUrl: (env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/+$/, ""),
    accessTtlMs: Number(env.BOARD_ACCESS_TTL_MS ?? 60_000),
    agentTokenTtlMs: Number(env.BOARD_TOKEN_TTL_DAYS ?? 30) * DAY_MS,
    sessionTtlMs: Number(env.BOARD_SESSION_TTL_DAYS ?? 14) * DAY_MS,
    requestsPerMinute: Number(env.BOARD_REQUESTS_PER_MINUTE ?? 120),
  };
}
