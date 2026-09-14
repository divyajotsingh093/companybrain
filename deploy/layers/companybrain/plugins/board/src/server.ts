import { serve } from "@hono/node-server";
import { createAccessChecker } from "./access.ts";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createGitHub } from "./github.ts";
import { openStore } from "./store.ts";

const config = loadConfig();
const store = openStore(config.dbPath);
const githubFor = (token: string) => createGitHub(token, { apiUrl: config.githubApiUrl });
const access = createAccessChecker({
  ttlMs: config.accessTtlMs,
  probe: async (identity, repo) => (await githubFor(identity.githubToken).repo(repo)).permissions,
});

const app = createApp({ config, store, access, githubFor });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`companybrain board listening on :${info.port} (${config.publicUrl})`);
});
