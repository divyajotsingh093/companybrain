import type { Board, Post, TokenRow } from "./store.ts";
import { AGENT_CLIENTS, type AgentClient } from "./token.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export const ERROR_MESSAGES = {
  state: "The sign-in link expired or did not match. Try again.",
  code: "GitHub did not return an authorization code.",
  exchange: "GitHub sign-in could not be completed.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function isErrorCode(value: string | undefined): value is ErrorCode {
  return value !== undefined && Object.hasOwn(ERROR_MESSAGES, value);
}

const STYLE = `
  :root { --rail:#0f172a; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent-text:#c2410c; --bg:#ffffff; --wash:#fff7ed; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e2e8f0; --muted:#94a3b8; --line:#262b33; --bg:#0b0f16; --wash:#1c1410; --accent-text:#fdba74; } }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink);
         background:radial-gradient(circle at 100% 0%, var(--wash) 0%, var(--bg) 45%); min-height:100vh; }
  header { background:var(--rail); color:#e2e8f0; padding:14px 28px; display:flex; align-items:center; gap:10px; }
  .mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(135deg,#f97316,#fb923c); }
  main { max-width:880px; margin:0 auto; padding:32px 28px 64px; }
  h1 { font-size:26px; margin:0 0 6px; } h2 { font-size:17px; margin:28px 0 8px; }
  .eyebrow { font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--accent-text); }
  .muted { color:var(--muted); }
  .button { display:inline-block; background:linear-gradient(135deg,#ea580c,#f97316); color:#1a0a02; font-weight:600;
            padding:9px 16px; border-radius:10px; text-decoration:none; border:0; cursor:pointer; font-size:14px; }
  .quiet { background:transparent; color:var(--ink); border:1px solid var(--line); }
  pre { background:#0b1020; color:#e2e8f0; padding:12px 14px; border-radius:10px; overflow-x:auto; font-size:12.5px; white-space:pre-wrap; word-break:break-all; }
  .card { border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:10px 0; }
  .chip { display:inline-block; font-size:11px; padding:2px 9px; border-radius:999px; background:#fed7aa; color:#431407; font-weight:600; margin-right:6px; }
  .body { white-space:pre-wrap; margin-top:8px; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  table { width:100%; border-collapse:collapse; font-size:14px; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  form { display:inline; }
`;

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><header><span class="mark"></span><strong>Company Brain</strong><span class="muted">&nbsp;board</span></header><main>${content}</main></body></html>`;
}

const CLIENT_LABELS: Record<AgentClient, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok (xAI API)",
};

export function connectionSnippet(client: AgentClient, mcpUrl: string, token: string): string {
  switch (client) {
    case "claude_code":
      return `claude mcp add --transport http companybrain ${mcpUrl} --header "Authorization: Bearer ${token}"`;
    case "codex":
      return `# ~/.codex/config.toml\n[mcp_servers.companybrain]\nurl = "${mcpUrl}"\nbearer_token_env_var = "COMPANYBRAIN_TOKEN"\n\n# in the environment that runs codex\nexport COMPANYBRAIN_TOKEN="${token}"`;
    case "cursor":
      return JSON.stringify({ mcpServers: { companybrain: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
    case "grok":
      return JSON.stringify({ tools: [{ type: "mcp", server_url: mcpUrl, server_label: "companybrain", authorization: token }] }, null, 2);
  }
}

export function renderHome(opts: { githubConfigured: boolean; error?: ErrorCode }): string {
  const action = opts.githubConfigured
    ? `<a class="button" href="/auth/github/start">Connect GitHub</a>`
    : `<p class="muted">GitHub sign-in is not configured on this server yet.</p>`;
  const error = opts.error ? `<div class="card"><strong>Sign-in failed.</strong> ${escapeHtml(ERROR_MESSAGES[opts.error])}</div>` : "";
  return page(
    "Company Brain board",
    `<div class="eyebrow">For agents</div><h1>Give your agents your repositories and a shared board</h1>
<p class="muted">Sign in with GitHub, then add the board to Claude Code, Codex, Cursor or Grok. Agents read code through your own GitHub
access and coordinate on a board per repository: tasks, claims, findings and handoffs.</p>${error}<p>${action}</p>`,
  );
}

function when(ms: number | null): string {
  return ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never";
}

export function renderConnected(opts: { login: string; tokens: TokenRow[] }): string {
  const create = AGENT_CLIENTS.map(
    (c) => `<form method="post" action="/tokens"><input type="hidden" name="client" value="${c}"><button class="button" type="submit">${CLIENT_LABELS[c]}</button></form>`,
  ).join("");
  const rows = opts.tokens
    .map(
      (t) => `<tr><td>${escapeHtml(CLIENT_LABELS[t.client as AgentClient] ?? t.client)}</td><td>${when(t.createdAt)}</td><td>${when(t.lastUsedAt)}</td><td>${when(t.expiresAt)}</td>
<td><form method="post" action="/tokens/${escapeHtml(t.id)}/revoke"><button class="button quiet" type="submit">Revoke</button></form></td></tr>`,
    )
    .join("");
  const table = rows
    ? `<table><thead><tr><th>Agent</th><th>Created</th><th>Last used</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No active agent tokens.</p>`;
  return page(
    "Connected · Company Brain board",
    `<div class="eyebrow">Connected as ${escapeHtml(opts.login)}</div><h1>Connect an agent</h1>
<p class="muted">Each agent gets its own token, shown once. A token can read whatever your GitHub authorization for this app covers, so keep
it out of shared channels and logs. Tokens expire, and you can revoke any of them here.</p>
<div class="row">${create}</div>
<h2>Active tokens</h2>${table}
<h2>Open a board</h2><p class="muted">Boards are per repository, for people with triage access or higher on it: <code>/board/&lt;owner&gt;/&lt;repo&gt;</code></p>
<div class="row"><form method="post" action="/auth/logout"><button class="button quiet" type="submit">Sign out</button></form>
<form method="post" action="/tokens/revoke-all"><button class="button quiet" type="submit">Revoke all tokens and sign out</button></form></div>`,
  );
}

export function renderTokenCreated(opts: { login: string; client: AgentClient; token: string; mcpUrl: string; expiresAt: number }): string {
  return page(
    "New token · Company Brain board",
    `<div class="eyebrow">Connected as ${escapeHtml(opts.login)}</div><h1>${escapeHtml(CLIENT_LABELS[opts.client])}</h1>
<p class="muted">Copy this now; it will not be shown again. It expires ${when(opts.expiresAt)}.</p>
<pre>${escapeHtml(connectionSnippet(opts.client, opts.mcpUrl, opts.token))}</pre>
<p><a class="button quiet" href="/">Done</a></p>`,
  );
}

function card(p: Post): string {
  const meta = [
    `${escapeHtml(p.authorLogin)} via ${escapeHtml(p.client)}`,
    when(p.createdAt),
    p.target ? `target ${escapeHtml(p.target)}` : "",
    p.to ? `to ${escapeHtml(p.to)}` : "",
    p.expiresAt ? `claimed until ${when(p.expiresAt)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="card"><span class="chip">${escapeHtml(p.type)}</span><strong>${escapeHtml(p.title)}</strong>
<div class="muted" style="margin-top:6px;font-size:13px">${meta}</div><div class="body">${escapeHtml(p.body)}</div></div>`;
}

export function renderBoard(opts: { repo: string; login: string; board: Board }): string {
  const section = (title: string, posts: Post[]) => (posts.length ? `<h2>${title} (${posts.length})</h2>${posts.map(card).join("")}` : "");
  const content = [section("Active claims", opts.board.claims), section("Recent findings and handoffs", opts.board.recent), section("Open tasks", opts.board.tasks)].join("");
  return page(
    `${opts.repo} · Company Brain board`,
    `<div class="eyebrow">Board</div><h1>${escapeHtml(opts.repo)}</h1><p class="muted">Viewing as ${escapeHtml(opts.login)}</p>
${content || `<p class="muted">The board is empty.</p>`}`,
  );
}

export function renderDenied(): string {
  return page("No access · Company Brain board", `<h1>No board access</h1><p class="muted">Not found, or you need triage access or higher on this repository.</p>`);
}

export function renderMessage(title: string, message: string): string {
  return page(`${title} · Company Brain board`, `<h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p><p><a class="button quiet" href="/">Home</a></p>`);
}
