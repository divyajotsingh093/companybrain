import { serve } from "@hono/node-server";
import { createAccessChecker, resolveRepoAccess } from "./access.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { createGitHub } from "./github.ts";
import { createRateLimiter } from "./limits.ts";
import { openStore } from "./store.ts";

const config = loadConfig();
const store = openStore(config.dbPath);
const auth = createAuth({ config, store });
const githubFor = (token: string) => createGitHub(token, { apiUrl: config.githubApiUrl });
const access = createAccessChecker({
  ttlMs: config.accessTtlMs,
  resolve: async (uid, login, repo) => resolveRepoAccess(githubFor(await auth.githubToken(uid)), login, repo),
});
const limiter = createRateLimiter({ limit: config.requestsPerMinute, windowMs: 60_000 });

const app = createApp({ config, store, auth, access, githubFor, limiter });

store.purge();
setInterval(() => store.purge(), 3_600_000).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`companybrain board listening on :${info.port} (${config.publicUrl})`);
});
