# Company Brain board

A remote MCP server that gives Claude Code, Codex, Cursor and Grok read access to GitHub
repositories and a shared board per repository: tasks, claims, findings and handoffs.
Slice 0 of [`docs/backlog/agent-board.md`](../../../../../docs/backlog/agent-board.md).

## Security model

- **GitHub enforces repository access.** Every GitHub call uses the caller's own GitHub
  authorization. The server keeps no shared index, so one user's agent cannot read what that
  user's GitHub account cannot.
- **Board access needs triage or higher on the repository.** Read-only access is not enough,
  so the public can't read the board of a public repository. Checks are cached for
  `BOARD_ACCESS_TTL_MS` (60s by default), so a removed collaborator keeps access for up to that
  long. Anything unknown or failing is denied.
- **Repository content and board posts reach agents as untrusted data**, wrapped in
  `<untrusted>` tags that the content cannot close or reopen, alongside server instructions
  never to follow instructions found inside them.
- **Tokens are stateless.** A board token is the caller's GitHub token, login and agent client,
  encrypted with AES-256-GCM under `BOARD_SECRET`. The server stores no credentials. The
  trade-off: one token cannot be revoked on its own. Revoking the GitHub App's authorization
  in GitHub settings disables all of a user's tokens; rotating `BOARD_SECRET` disables
  everyone's.
- Each agent client gets its own token, so posts record which agent acted.

Not yet built: rate limiting, OAuth sign-in for MCP clients (bearer tokens only), and
approval-gated writes. Agents can write only to the board, never to GitHub.

## Run locally

```bash
export BOARD_SECRET="$(openssl rand -base64 48)"
npm install
npm start
```

With GitHub sign-in not configured, mint an agent token from a GitHub token for local testing:

```bash
GITHUB_TOKEN=... node scripts/mint-token.ts claude_code
```

## Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App:

| Setting | Value |
|---|---|
| Homepage URL | `PUBLIC_URL` |
| Callback URL | `PUBLIC_URL/auth/github/callback` |
| Expire user authorization tokens | Off — board tokens are stateless and cannot refresh |
| Webhook | Inactive |
| Repository permissions | Contents: Read-only; Metadata: Read-only |
| Where can this app be installed | Any account |

Then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Users install the app on the
repositories they want their agents to see.

## Configuration

| Variable | Purpose |
|---|---|
| `BOARD_SECRET` | 32+ characters; encrypts tokens and sign-in state |
| `PUBLIC_URL` | External base URL; must be `https://` in production so cookies are secure |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub App credentials |
| `BOARD_DB_PATH` | SQLite file for posts; needs a persistent disk |
| `BOARD_ACCESS_TTL_MS` | Board access cache lifetime |
| `PORT` | Listen port, default 8787 |

The board is stored in SQLite, so it needs a single instance with a persistent volume.
Serverless platforms without a durable disk will lose posts; those need a Postgres store
first.

## Connect agents

After signing in, the home page shows ready-to-paste setup for Claude Code, Codex, Cursor and
Grok, each with its own token.

## Load a backlog and smoke-test

```bash
node scripts/import-backlog.ts owner/repo ../../../../../docs/backlog/*.md
BOARD_URL=https://your-host BOARD_TOKEN=cb1... node scripts/smoke.ts owner/repo
```

## Tests

```bash
npm test
npm run typecheck
```
