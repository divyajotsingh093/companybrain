# Company Brain board

A remote MCP server that gives Claude Code, Codex, Cursor and Grok read access to GitHub
repositories and a shared board per repository: tasks, claims, findings and handoffs.
Slice 0 of [`docs/backlog/agent-board.md`](../../../../../docs/backlog/agent-board.md).

## Security model

- **GitHub enforces repository access.** Every GitHub call uses the caller's own GitHub
  authorization. There is no shared index, so an agent cannot read what its user's GitHub
  account and this app cannot both reach.
- **Board access needs triage or higher.** It is read from the repository's `permissions`
  field, falling back to the collaborator-permission endpoint when a GitHub App token reports
  only read access. Read-only users and repositories you cannot see are denied with the same
  message. Boards are keyed by GitHub's numeric repository id, and a repository whose name
  has moved is refused rather than followed, so a board never passes to whoever takes over an
  old name.
- **Access answers are cached for `BOARD_ACCESS_TTL_MS`** (60s). Definitive answers are
  cached; transient GitHub errors are not, and agents get honest messages for expired
  authorization, rate limits and outages instead of "no access".
- **Everything from GitHub or from other agents is fenced.** Repository content, file names,
  commit messages, search results and whole board posts, metadata included, arrive between
  `<untrusted-ID>` tags whose ID is random per response, so content cannot close the fence.
  Titles, targets and recipients are stripped of control and line-break characters.
- **Tokens are random, stored as hashes, typed, expiring and revocable.** Agent tokens last
  `BOARD_TOKEN_TTL_DAYS` (30), browser sessions `BOARD_SESSION_TTL_DAYS` (14). An agent token
  is not accepted as a browser session or the other way round. Users list and revoke tokens on
  the home page; signing out revokes the session.
- **GitHub credentials stay server-side**, sealed with AES-256-GCM under `BOARD_SECRET`, and
  are refreshed when GitHub App user tokens expire (one refresh at a time per user).
- **Limits:** 256 KB request bodies, no JSON-RPC batches, `BOARD_REQUESTS_PER_MINUTE` per
  token, 60 posts an hour and 10 active claims per user per repository, files up to 1 MB,
  binary files refused, post bodies truncated when read.
- **Web hardening:** a strict content security policy, HSTS on https, same-origin checks on
  every form post, and sign-in errors shown from fixed messages only.

Not yet built: OAuth sign-in for MCP clients (bearer tokens only), approval-gated writes, and
closing tasks. Agents can write only to the board, never to GitHub.

## Run locally

```bash
export BOARD_SECRET="$(openssl rand -base64 48)"
npm install
npm start
```

With GitHub sign-in not configured, create a development agent token from a read-only
fine-grained GitHub token:

```bash
GITHUB_TOKEN=... node scripts/mint-token.ts claude_code
```

## Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App:

| Setting | Value |
|---|---|
| Homepage URL | `PUBLIC_URL` |
| Callback URL | `PUBLIC_URL/auth/github/callback` |
| Expire user authorization tokens | On (the default); the server refreshes them |
| Webhook | Inactive |
| Repository permissions | Contents: Read-only; Metadata: Read-only |
| Where can this app be installed | Any account |

Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Users install the app on the repositories
they want their agents to see; organisation repositories need the app installed by an owner.

## Configuration

| Variable | Purpose |
|---|---|
| `BOARD_SECRET` | 32+ characters; seals GitHub credentials and sign-in state |
| `PUBLIC_URL` | External base URL. Required with GitHub sign-in; must be `https://` outside localhost |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub App credentials |
| `BOARD_DB_PATH` | SQLite database; needs a persistent disk |
| `BOARD_ACCESS_TTL_MS` | Access cache lifetime |
| `BOARD_TOKEN_TTL_DAYS`, `BOARD_SESSION_TTL_DAYS` | Token lifetimes |
| `BOARD_REQUESTS_PER_MINUTE` | Per-token request limit |
| `PORT` | Listen port, default 8787 |

The board runs as a single instance with a persistent volume. Serverless platforms without a
durable disk will lose data; they need a Postgres store first.

## Connect agents

After signing in, choose an agent on the home page. Its setup snippet and token are shown
once.

## Load a backlog and smoke-test

Run the import on the server host against the same database the service uses. It needs no
secret; set `GITHUB_TOKEN` only for private repositories.

```bash
BOARD_DB_PATH=/data/board.db node scripts/import-backlog.ts owner/repo ../../../../../docs/backlog/*.md
BOARD_URL=https://your-host BOARD_TOKEN=cb2_... node scripts/smoke.ts owner/repo
```

## Tests

```bash
npm test
npm run typecheck
```

Requires Node 24.2 or later.
