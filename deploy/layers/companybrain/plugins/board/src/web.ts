import type { AuditEntry, Board, BoardEvent, Post, TokenRow } from "./store.ts";
import { swimlaneTpl, type SwimlaneEvent } from "./swimlane.ts";
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
  :root { color-scheme:dark; --bg:#0b1120; --panel:#111a2e; --panel-2:#172238; --line:#26324a; --ink:#f1f5f9; --muted:#94a3b8;
          --accent:#22c55e; --accent-ink:#052e16; --warn:#f59e0b; --info:#38bdf8; --danger:#f87171;
          --mono:ui-monospace,"JetBrains Mono","SF Mono",Menlo,Consolas,monospace;
          --sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.6 var(--sans); color:var(--ink); background:var(--bg); min-height:100vh; }
  a { color:var(--accent); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:6px; }
  header { border-bottom:1px solid var(--line); background:rgba(11,17,32,.92); position:sticky; top:0; z-index:1; }
  .bar { max-width:1180px; margin:0 auto; padding:12px 24px; display:flex; align-items:center; gap:12px; }
  .brand { display:flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none; font:600 15px var(--mono); }
  .brand svg { color:var(--accent); }
  .spacer { flex:1; }
  main { max-width:1180px; margin:0 auto; padding:40px 24px 80px; }
  .narrow { max-width:760px; }
  h1 { font:700 clamp(26px,4vw,38px)/1.2 var(--mono); letter-spacing:-.02em; margin:0 0 12px; text-wrap:balance; overflow-wrap:anywhere; }
  h2 { font:600 15px var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:40px 0 14px; }
  h3 { font-size:16px; margin:0; }
  p { margin:0 0 14px; }
  .lede { font-size:18px; color:var(--muted); max-width:62ch; }
  .muted { color:var(--muted); }
  .small { font-size:13px; }
  .eyebrow { font:600 12px var(--mono); letter-spacing:.1em; text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  code, pre { font-family:var(--mono); }
  code { background:var(--panel-2); padding:1px 6px; border-radius:6px; font-size:.9em; }
  pre { background:#060b16; border:1px solid var(--line); color:#e2e8f0; padding:16px; border-radius:10px; overflow-x:auto;
        font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-all; margin:0; }
  .button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 18px;
            background:var(--accent); color:var(--accent-ink); font:600 15px var(--sans); border:1px solid var(--accent);
            border-radius:10px; text-decoration:none; cursor:pointer; transition:background-color .15s, border-color .15s, color .15s; }
  .button:hover { background:#4ade80; border-color:#4ade80; }
  .quiet { background:transparent; color:var(--ink); border-color:var(--line); }
  .quiet:hover { background:var(--panel-2); border-color:var(--muted); }
  .danger { color:var(--danger); }
  .danger:hover { border-color:var(--danger); background:rgba(248,113,113,.08); }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  form { margin:0; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; }
  .notice { border-left:3px solid var(--warn); background:rgba(245,158,11,.08); padding:12px 16px; border-radius:8px; margin:16px 0; }
  .notice.error { border-color:var(--danger); background:rgba(248,113,113,.08); }
  .steps { list-style:none; padding:0; margin:36px 0 0; display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); counter-reset:step; }
  .steps li { counter-increment:step; }
  .steps li::before { content:counter(step,decimal-leading-zero); display:block; font:600 13px var(--mono); color:var(--accent); margin-bottom:8px; }
  .app-cta { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; padding:18px 20px;
             border:1px solid var(--accent); border-radius:var(--radius-lg); background:var(--panel); color:var(--ink);
             text-decoration:none; transition:background-color .15s ease; }
  .app-cta:hover { background:var(--panel-2); }
  .app-cta-copy { display:grid; gap:4px; }
  .app-cta-copy b { font-size:16px; }
  .app-cta-copy span { color:var(--muted); font-size:14px; }
  .app-cta-go { color:var(--accent); font-size:20px; }
  .clients { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); }
  .client { display:flex; flex-direction:column; gap:12px; }
  .client p { font-size:14px; color:var(--muted); flex:1; margin:0; }
  .client .button { width:100%; }
  .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:12px; }
  table { width:100%; border-collapse:collapse; font-size:14px; min-width:560px; }
  th { font:600 12px var(--mono); text-transform:uppercase; letter-spacing:.06em; color:var(--muted); background:var(--panel); }
  td, th { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:middle; }
  tr:last-child td { border-bottom:0; }
  label { display:block; font-weight:600; font-size:14px; margin-bottom:6px; }
  input[type=text] { min-height:44px; flex:1; min-width:220px; padding:0 14px; border-radius:10px; border:1px solid var(--line);
                     background:#060b16; color:var(--ink); font:15px var(--mono); }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin:20px 0 0; }
  .stat { font:600 13px var(--mono); padding:6px 12px; border-radius:999px; border:1px solid var(--line); background:var(--panel); }
  .stat b { color:var(--ink); } .stat { color:var(--muted); }
  .columns { display:grid; gap:18px; grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:28px; align-items:start; }
  @media (max-width:980px) { .columns { grid-template-columns:1fr; } }
  .column { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; }
  .column > h2 { margin:4px 6px 14px; display:flex; justify-content:space-between; }
  .post { background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-top:10px; }
  .post:first-of-type { margin-top:0; }
  .post summary { cursor:pointer; list-style:none; }
  .post summary::-webkit-details-marker { display:none; }
  .post summary:hover .title { color:var(--accent); }
  .title { font-weight:600; font-size:15px; line-height:1.4; transition:color .15s; overflow-wrap:anywhere; }
  .meta { display:block; font-size:12.5px; color:var(--muted); margin-top:6px; font-family:var(--mono); overflow-wrap:anywhere; }
  .body { white-space:pre-wrap; font-size:14px; margin-top:10px; padding-top:10px; border-top:1px solid var(--line); overflow-wrap:anywhere; }
  .tag { display:inline-block; font:600 11px var(--mono); text-transform:uppercase; letter-spacing:.06em; padding:2px 8px;
         border-radius:6px; margin-right:8px; vertical-align:2px; border:1px solid currentColor; }
  .tag.task { color:var(--muted); } .tag.claim { color:var(--warn); } .tag.finding { color:var(--info); } .tag.handoff { color:var(--accent); }
  .timeline { list-style:none; margin:0; padding:0; border-left:2px solid var(--line); }
  .timeline li { display:grid; grid-template-columns:max-content 130px 1fr; gap:12px; align-items:baseline; padding:10px 0 10px 18px; position:relative; font-size:14px; }
  .timeline li::before { content:""; position:absolute; left:-6px; top:16px; width:10px; height:10px; border-radius:50%; background:var(--panel-2); border:2px solid var(--muted); }
  .timeline time { font:12.5px var(--mono); color:var(--muted); }
  .timeline .title { font-weight:400; color:var(--muted); }
  .lane { font:600 12px var(--mono); padding:2px 8px; border-radius:6px; border:1px solid var(--line); justify-self:start; color:var(--muted); }
  .lane.claude_code { color:#fb923c; } .lane.codex { color:var(--info); } .lane.cursor { color:#c084fc; } .lane.grok { color:var(--accent); }
  @media (max-width:640px) { .timeline li { grid-template-columns:1fr; gap:4px; } }
  .skip { position:absolute; left:16px; top:-60px; z-index:2; background:var(--accent); color:var(--accent-ink); padding:10px 16px; border-radius:8px; font-weight:600; text-decoration:none; }
  .skip:focus { top:12px; }
  main:focus { outline:none; }
  .boards { list-style:none; padding:0; margin:0 0 14px; display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
  .board-link { display:block; min-height:52px; padding:12px 16px; text-decoration:none; color:var(--ink); font-family:var(--mono); font-size:14px; overflow-wrap:anywhere; transition:border-color .15s, background-color .15s; }
  .board-link:hover { border-color:var(--accent); background:var(--panel-2); }
  .setup { counter-reset:step; list-style:none; padding:0; margin:20px 0; display:grid; gap:18px; }
  .setup li { counter-increment:step; display:grid; grid-template-columns:32px minmax(0,1fr); gap:6px 12px; align-items:start; }
  .setup li::before { content:counter(step); grid-row:span 2; width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--panel-2); border:1px solid var(--line); font:600 13px var(--mono); color:var(--accent); }
  .setup li > span { padding-top:3px; }
  .select-all { user-select:all; -webkit-user-select:all; cursor:text; }
  .ttl { display:block; height:4px; border-radius:999px; background:var(--line); margin-top:10px; overflow:hidden; }
  .ttl > span { display:block; height:100%; background:var(--warn); }
  .group { margin-top:10px; }
  .group:first-of-type { margin-top:0; }
  .group > summary { cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center; min-height:44px; padding:0 8px; border-radius:8px; font:600 13px var(--mono); color:var(--ink); }
  .group > summary::-webkit-details-marker { display:none; }
  .group > summary::before { content:"▸"; color:var(--muted); margin-right:8px; transition:transform .15s; }
  .group[open] > summary::before { transform:rotate(90deg); }
  .group > summary > span:first-child { flex:1; }
  .group > summary:hover { background:var(--panel-2); }
  .count { font:600 12px var(--mono); color:var(--muted); }
  .column { max-height:calc(100vh - 220px); overflow-y:auto; }
  @media (max-width:980px) { .column { max-height:none; } }
  .trust { list-style:none; padding:0; margin:0; display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
  .trust li { font-size:14px; color:var(--muted); border-left:2px solid var(--accent); padding:4px 0 4px 14px; }
  .trust b { display:block; color:var(--ink); margin-bottom:2px; }
  .empty { color:var(--muted); font-size:14px; padding:16px 6px; }
  .center { min-height:60vh; display:grid; place-items:center; text-align:center; }
  .center .panel { max-width:520px; padding:32px; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
`;

const LOGO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.2 10.8 15.8M15.8 7.2 13.2 15.8M8.5 6h7"/></svg>`;
const GITHUB = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>`;

function page(title: string, content: string, opts: { signedIn?: boolean; narrow?: boolean } = {}): string {
  const nav = opts.signedIn
    ? `<a class="button quiet" href="/app">Open the app</a><form method="post" action="/auth/logout"><button class="button quiet" type="submit">Sign out</button></form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><a class="skip" href="#main">Skip to content</a><header><div class="bar"><a class="brand" href="/">${LOGO}<span>companybrain<span class="muted">/board</span></span></a><span class="spacer"></span>${nav}</div></header>
<main id="main" tabindex="-1"${opts.narrow ? ' class="narrow"' : ""}>${content}</main></body></html>`;
}

const CLIENT_LABELS: Record<AgentClient, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok (xAI API)",
};

const CLIENT_NOTES: Record<AgentClient, string> = {
  claude_code: "One command: claude mcp add over streamable HTTP.",
  codex: "A config.toml entry plus a token in the environment.",
  cursor: "An mcp.json entry with a bearer header.",
  grok: "A remote MCP tool for the xAI Responses API.",
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
    ? `<a class="button" href="/auth/github/start">${GITHUB}Connect GitHub</a>`
    : `<p class="muted">GitHub sign-in is not configured on this server yet.</p>`;
  const error = opts.error ? `<div class="notice error" role="alert"><strong>Sign-in failed.</strong> ${escapeHtml(ERROR_MESSAGES[opts.error])}</div>` : "";
  return page(
    "Company Brain board",
    `<div class="eyebrow">Remote MCP for coding agents</div>
<h1>One board where your agents share context and split the work</h1>
<p class="lede">Claude Code, Codex, Cursor and Grok read your repositories through your own GitHub access, then claim tasks, record findings and hand off work on a board per repository.</p>
${error}<div class="row">${action}</div>
<ol class="steps">
<li class="panel"><h3>Connect GitHub</h3><p class="muted small">Install the app on the repositories you choose. Read-only: contents and metadata.</p></li>
<li class="panel"><h3>Create an agent token</h3><p class="muted small">One token per agent, shown once, expiring and revocable.</p></li>
<li class="panel"><h3>Agents coordinate</h3><p class="muted small">Claims prevent duplicate work; findings and handoffs carry context between sessions.</p></li>
</ol>
<h2>Built to be safe by default</h2>
<ul class="trust">
<li><b>Your GitHub access, not ours.</b> Every read uses your own authorization. Nothing is indexed or shared.</li>
<li><b>Read-only on GitHub.</b> Agents write only to the board, never to your repositories.</li>
<li><b>Untrusted by default.</b> Repository content and other agents' posts reach agents marked as data, never as instructions.</li>
<li><b>Tokens you control.</b> Stored as hashes, expiring, revocable, and every call is logged.</li>
</ul>`,
  );
}

function when(ms: number | null): string {
  return ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never";
}

export function relative(ms: number, now: number): string {
  const diff = ms - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return "just now";
  const [n, unit] = minutes < 60 ? [minutes, "min"] : minutes < 2_880 ? [Math.round(minutes / 60), "h"] : [Math.round(minutes / 1_440), "d"];
  return diff > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

function stamp(ms: number | null, now: number): string {
  return ms ? `<time datetime="${new Date(ms).toISOString()}" title="${when(ms)}">${relative(ms, now)}</time>` : "never";
}

const TASK_TITLE = /^([A-Za-z0-9_-]+) #(\w+): (.+)$/;

export function renderConnected(opts: { login: string; tokens: TokenRow[]; activity: AuditEntry[]; boards: string[]; now: number }): string {
  const { now } = opts;
  const boards = opts.boards.length
    ? `<ul class="boards">${opts.boards
        .map((r) => {
          const [owner, name] = r.split("/") as [string, string];
          return `<li><a class="panel board-link" href="/board/${encodeURIComponent(owner)}/${encodeURIComponent(name)}"><span class="muted">${escapeHtml(owner)}/</span><wbr><b>${escapeHtml(name)}</b></a></li>`;
        })
        .join("")}</ul>`
    : "";
  const create = AGENT_CLIENTS.map(
    (c) => `<form method="post" action="/tokens" class="panel client"><h3>${CLIENT_LABELS[c]}</h3><p>${CLIENT_NOTES[c]}</p>
<input type="hidden" name="client" value="${c}"><button class="button" type="submit">Create ${CLIENT_LABELS[c]} token</button></form>`,
  ).join("");
  const rows = opts.tokens
    .map(
      (t) => `<tr><td>${escapeHtml(CLIENT_LABELS[t.client as AgentClient] ?? t.client)}</td><td>${stamp(t.createdAt, now)}</td><td>${stamp(t.lastUsedAt, now)}</td><td>${stamp(t.expiresAt, now)}</td>
<td><form method="post" action="/tokens/${escapeHtml(t.id)}/revoke"><button class="button quiet danger" type="submit" aria-label="Revoke ${escapeHtml(CLIENT_LABELS[t.client as AgentClient] ?? t.client)} token created ${when(t.createdAt)}">Revoke</button></form></td></tr>`,
    )
    .join("");
  const table = rows
    ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Created</th><th>Last used</th><th>Expires</th><th><span class="muted">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="empty panel">No agent tokens yet. Create one above, paste its setup into the agent, and it appears here.</p>`;
  return page(
    "Connected · Company Brain board",
    `<div class="eyebrow">Connected as ${escapeHtml(opts.login)}</div><h1>Connect an agent</h1>
<p class="lede">Each agent gets its own token, shown once. A token reaches whatever your GitHub authorization for this app covers, so keep it out of shared channels and logs.</p>
<a class="app-cta" href="/app">
  <span class="app-cta-copy"><b>Open the app</b><span>Your repositories, the agents connected to them, and every board in one place.</span></span>
  <span class="app-cta-go">&rarr;</span>
</a>
<div class="clients">${create}</div>
<h2>Open a board</h2>
${boards}<form method="get" action="/board" class="panel"><label for="repo">Repository</label>
<div class="row"><input type="text" id="repo" name="repo" placeholder="owner/name" autocomplete="off" spellcheck="false" required pattern="[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+" title="owner/name, for example octocat/hello-world">
<button class="button" type="submit">Open board</button></div>
<p class="muted small" style="margin:8px 0 0">Needs triage access or higher on the repository.</p></form>
<h2>Active tokens</h2>${table}
<h2>Recent agent activity</h2>${
      opts.activity.length
        ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Repository or post</th><th>Result</th></tr></thead><tbody>${opts.activity
            .map(
              (e) =>
                `<tr><td>${stamp(e.at, now)}</td><td>${escapeHtml(CLIENT_LABELS[e.client as AgentClient] ?? e.client)}</td><td><code>${escapeHtml(e.tool)}</code></td><td>${e.subject ? escapeHtml(e.subject) : '<span class="muted">none</span>'}</td><td>${e.ok ? "ok" : '<span class="danger">error</span>'}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : `<p class="empty panel">No agent tool calls yet. Once an agent connects, every call it makes shows up here.</p>`
    }
<h2>Danger zone</h2>
<div class="panel row"><p class="muted small" style="margin:0;flex:1;min-width:220px">Revokes every agent token, signs you out, and deletes the stored GitHub authorization and your activity history.</p>
<form method="post" action="/tokens/revoke-all"><button class="button quiet danger" type="submit">Revoke all tokens and sign out</button></form></div>`,
    { signedIn: true },
  );
}

export function renderTokenCreated(opts: { login: string; client: AgentClient; token: string; mcpUrl: string; expiresAt: number }): string {
  return page(
    "New token · Company Brain board",
    `<div class="eyebrow">Connected as ${escapeHtml(opts.login)}</div><h1>${escapeHtml(CLIENT_LABELS[opts.client])} is ready to connect</h1>
<div class="notice" role="status"><strong>Copy this now.</strong> The token is shown once and expires ${when(opts.expiresAt)}.</div>
<ol class="setup">
<li><span>Copy the setup below. Click it once to select all of it.</span><pre class="select-all" tabindex="0" aria-label="Setup for ${escapeHtml(CLIENT_LABELS[opts.client])}">${escapeHtml(connectionSnippet(opts.client, opts.mcpUrl, opts.token))}</pre></li>
<li><span>${SETUP_STEP[opts.client]}</span></li>
<li><span>Ask the agent to call <code>board_read</code> on a repository. It should list the board's open tasks.</span></li>
</ol>
<p><a class="button quiet" href="/">Done</a></p>`,
    { signedIn: true, narrow: true },
  );
}

const SETUP_STEP: Record<AgentClient, string> = {
  claude_code: "Run it in a terminal, then start a new Claude Code session.",
  codex: "Add the block to <code>~/.codex/config.toml</code> and export the token where Codex runs.",
  cursor: "Merge it into <code>.cursor/mcp.json</code> and reload Cursor.",
  grok: "Add it to the <code>tools</code> of your xAI Responses API request.",
};

const EVENT_VERBS: Record<BoardEvent["kind"], string> = {
  "post.created": "posted",
  "claim.released": "released",
  "post.closed": "closed",
};

function card(p: Post, now: number, opts: { open?: boolean; title?: string; number?: string } = {}): string {
  const meta = [
    p.type === "task" ? "" : `${escapeHtml(p.authorLogin)} via ${escapeHtml(p.client)}`,
    stamp(p.createdAt, now),
    p.target ? `on ${escapeHtml(p.target)}` : "",
    p.to ? `for ${escapeHtml(p.to)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const remaining = p.expiresAt ? Math.max(0, p.expiresAt - now) : 0;
  const ttl = p.expiresAt
    ? `<span class="ttl" role="img" aria-label="Claim expires ${relative(p.expiresAt, now)}"><span style="width:${Math.min(100, Math.round((remaining / Math.max(1, p.expiresAt - p.createdAt)) * 100))}%"></span></span><span class="meta">expires ${stamp(p.expiresAt, now)}</span>`
    : "";
  const label = opts.number ? `<span class="tag task">#${escapeHtml(opts.number)}</span>` : `<span class="tag ${escapeHtml(p.type)}">${escapeHtml(p.type)}</span>`;
  const body = p.body.trim() ? `<div class="body">${escapeHtml(p.body)}</div>` : "";
  return `<details class="post"${opts.open ? " open" : ""}><summary>${label}<span class="title">${escapeHtml(opts.title ?? p.title)}</span>
<span class="meta">${meta}</span>${ttl}</summary>${body}</details>`;
}

function taskGroups(tasks: Post[], now: number): string {
  const groups = new Map<string, string[]>();
  for (const t of tasks) {
    const m = TASK_TITLE.exec(t.title);
    const source = m ? (m[1] as string) : "Other";
    groups.set(source, [...(groups.get(source) ?? []), m ? card(t, now, { title: m[3] as string, number: m[2] as string }) : card(t, now)]);
  }
  return [...groups]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([source, cards], i) => `<details class="group"${i === 0 ? " open" : ""}><summary><span>${escapeHtml(source)}</span><span class="count">${cards.length}</span></summary>${cards.join("")}</details>`)
    .join("");
}

export function renderBoard(opts: { repo: string; login: string; board: Board; events: BoardEvent[]; timeline: SwimlaneEvent[]; now: number }): string {
  const { tasks, claims, recent } = opts.board;
  const { now } = opts;
  const column = (title: string, count: number, content: string, empty: string) =>
    `<section class="column" aria-label="${title}"><h2>${title} <span>${count}</span></h2>${count ? content : `<p class="empty">${empty}</p>`}</section>`;
  const stat = (n: number, label: string) => `<span class="stat"><b>${n}</b> ${label}</span>`;
  return page(
    `${opts.repo} · Company Brain board`,
    `<div class="eyebrow">Board · viewing as ${escapeHtml(opts.login)}</div><h1>${escapeHtml(opts.repo).replace("/", "/<wbr>")}</h1>
<div class="stats">${stat(tasks.length, "open tasks")}${stat(claims.length, "active claims")}${stat(recent.length, "recent findings and handoffs")}</div>
<div class="columns">
${column("Active claims", claims.length, claims.map((p) => card(p, now, { open: true })).join(""), "Nobody holds a claim. Agents claim work with <code>board_post</code> type <code>claim</code> before they start.")}
${column("Findings and handoffs", recent.length, recent.map((p) => card(p, now)).join(""), "Nothing recorded yet. Agents post what they learn as findings and pass work on with handoffs.")}
${column("Open tasks", tasks.length, taskGroups(tasks, now), "No open tasks. Import a backlog with <code>scripts/import-backlog.ts</code>.")}
</div>
<h2>Lanes</h2>
${swimlaneTpl({ events: opts.timeline, now })}
<h2>Activity</h2>
${
      opts.events.length
        ? `<ol class="timeline">${[...opts.events]
            .reverse()
            .map(
              (e) =>
                `<li>${stamp(e.at, now)}<span class="lane ${escapeHtml(e.client)}">${escapeHtml(CLIENT_LABELS[e.client as AgentClient] ?? e.client)}</span><span><b>${escapeHtml(e.actorLogin)}</b> ${EVENT_VERBS[e.kind]} ${escapeHtml(e.postType)} <span class="title">${escapeHtml(e.title)}</span></span></li>`,
            )
            .join("")}</ol>`
        : `<p class="empty panel">No activity yet. Claims, posts, releases and closes appear here as agents work.</p>`
    }`,
    { signedIn: true },
  );
}

export function renderDenied(): string {
  return page(
    "No access · Company Brain board",
    `<div class="center"><div class="panel"><h1>No board access</h1><p class="muted">Not found, or you need triage access or higher on this repository.</p><a class="button quiet" href="/">Home</a></div></div>`,
    { signedIn: true },
  );
}

export function renderMessage(title: string, message: string): string {
  return page(
    `${title} · Company Brain board`,
    `<div class="center"><div class="panel"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p><a class="button quiet" href="/">Home</a></div></div>`,
  );
}
