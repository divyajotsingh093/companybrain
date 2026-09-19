import { attachDatabasePool } from "@vercel/functions";
import { Hono } from "hono";
import { createAccessChecker, resolveRepoAccess } from "./access.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { createPool, postgres } from "./db.ts";
import { createGitHub } from "./github.ts";
import { createRateLimiter } from "./limits.ts";
import { createApp } from "./routes.ts";
import { openStore } from "./store.ts";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(config.databaseUrl);
attachDatabasePool(pool);
const store = openStore(postgres(pool));
const auth = createAuth({ config, store });
const githubFor = (token: string) => createGitHub(token, { apiUrl: config.githubApiUrl });
const access = createAccessChecker({
  ttlMs: config.accessTtlMs,
  resolve: async (uid, login, repo) => resolveRepoAccess(githubFor(await auth.githubToken(uid)), uid, login, repo),
});
const limiter = createRateLimiter({ store, limit: config.requestsPerMinute, windowMs: 60_000 });

export default new Hono().route("/", createApp({ config, store, auth, access, githubFor, limiter }));
