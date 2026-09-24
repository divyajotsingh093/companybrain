export interface Config {
  port: number;
  publicUrl: string;
  secret: string;
  databaseUrl: string | undefined;
  cronSecret: string | undefined;
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

function positive(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.BOARD_SECRET ?? "";
  if (secret.length < 32) throw new Error("BOARD_SECRET must be at least 32 characters; generate one with openssl rand -base64 48");
  const port = positive(env, "PORT", 8787);
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
    databaseUrl: env.BOARD_DATABASE_URL || env.DATABASE_URL || undefined,
    cronSecret: env.CRON_SECRET || undefined,
    githubClientId,
    githubClientSecret,
    githubApiUrl: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""),
    githubWebUrl: (env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/+$/, ""),
    accessTtlMs: positive(env, "BOARD_ACCESS_TTL_MS", 60_000),
    agentTokenTtlMs: positive(env, "BOARD_TOKEN_TTL_DAYS", 30) * DAY_MS,
    sessionTtlMs: positive(env, "BOARD_SESSION_TTL_DAYS", 14) * DAY_MS,
    requestsPerMinute: positive(env, "BOARD_REQUESTS_PER_MINUTE", 120),
  };
}
