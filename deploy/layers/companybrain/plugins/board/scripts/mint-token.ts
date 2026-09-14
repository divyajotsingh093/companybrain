import { loadConfig } from "../src/config.ts";
import { createGitHub } from "../src/github.ts";
import { AGENT_CLIENTS, type AgentClient, mintToken } from "../src/token.ts";

const client = process.argv[2] as AgentClient | undefined;
const githubToken = process.env.GITHUB_TOKEN;

if (!client || !(AGENT_CLIENTS as readonly string[]).includes(client)) {
  console.error(`usage: GITHUB_TOKEN=... node scripts/mint-token.ts <${AGENT_CLIENTS.join("|")}>`);
  process.exit(2);
}
if (!githubToken) {
  console.error("GITHUB_TOKEN is required");
  process.exit(2);
}

const config = loadConfig();
const viewer = await createGitHub(githubToken, { apiUrl: config.githubApiUrl }).viewer();
process.stdout.write(mintToken(config.secret, { githubToken, login: viewer.login, uid: viewer.id, client, issuedAt: Date.now() }));
