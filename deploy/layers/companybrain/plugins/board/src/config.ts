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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.BOARD_SECRET ?? "";
  if (secret.length < 32) throw new Error("BOARD_SECRET must be at least 32 characters");
  const port = Number(env.PORT ?? 8787);
  return {
    port,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    secret,
    dbPath: env.BOARD_DB_PATH ?? "board.db",
    githubClientId: env.GITHUB_CLIENT_ID || undefined,
    githubClientSecret: env.GITHUB_CLIENT_SECRET || undefined,
    githubApiUrl: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""),
    githubWebUrl: (env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/+$/, ""),
    accessTtlMs: Number(env.BOARD_ACCESS_TTL_MS ?? 60_000),
  };
}
