import { createAuth } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createGitHub } from "../src/github.ts";
import { openStore } from "../src/store.ts";
import { AGENT_CLIENTS, isAgentClient } from "../src/token.ts";

const client = process.argv[2] ?? "";
const githubToken = process.env.GITHUB_TOKEN;

if (!isAgentClient(client) || !githubToken) {
  console.error(`usage: GITHUB_TOKEN=<read-only fine-grained token> node scripts/mint-token.ts <${AGENT_CLIENTS.join("|")}>`);
  console.error("Development only. Real users should sign in through the web page so tokens refresh and can be revoked there.");
  process.exit(2);
}

const config = loadConfig();
const store = openStore(config.dbPath);
const auth = createAuth({ config, store });
const viewer = await createGitHub(githubToken, { apiUrl: config.githubApiUrl }).viewer();
auth.saveGrant(viewer.id, viewer.login, { accessToken: githubToken, expiresAt: null, refreshToken: null, refreshExpiresAt: null });
const issued = auth.issue(viewer.id, "agent", client, config.agentTokenTtlMs);
store.close();
process.stdout.write(issued.token);
