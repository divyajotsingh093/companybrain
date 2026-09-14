import type { Post } from "./store.ts";
import type { AgentClient } from "./token.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const STYLE = `
  :root { --rail:#0f172a; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#f97316; --accent-text:#c2410c; --bg:#ffffff; --wash:#fff7ed; }
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
  .button { display:inline-block; background:linear-gradient(135deg,#f97316,#fb923c); color:#2a1206; font-weight:600;
            padding:10px 18px; border-radius:10px; text-decoration:none; border:0; cursor:pointer; font-size:15px; }
  pre { background:#0b1020; color:#e2e8f0; padding:12px 14px; border-radius:10px; overflow-x:auto; font-size:12.5px; white-space:pre-wrap; word-break:break-all; }
  .card { border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:10px 0; background:color-mix(in srgb, var(--bg) 85%, transparent); }
  .chip { display:inline-block; font-size:11px; padding:2px 9px; border-radius:999px; border:1px solid var(--line); margin-right:6px; }
  .chip.type { background:linear-gradient(135deg,#f97316,#fb923c); color:#2a1206; border:0; font-weight:600; }
  .body { white-space:pre-wrap; margin-top:8px; }
  form { display:inline; }
`;

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><header><span class="mark"></span><strong>Company Brain</strong><span class="muted">&nbsp;board</span></header><main>${content}</main></body></html>`;
}

const CLIENT_LABELS: Record<Exclude<AgentClient, "web">, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok (xAI API)",
};

export function connectionSnippet(client: Exclude<AgentClient, "web">, mcpUrl: string, token: string): string {
  switch (client) {
    case "claude_code":
      return `claude mcp add --transport http companybrain ${mcpUrl} --header "Authorization: Bearer ${token}"`;
    case "codex":
      return `# ~/.codex/config.toml\n[mcp_servers.companybrain]\nurl = "${mcpUrl}"\nbearer_token_env_var = "COMPANYBRAIN_TOKEN"\n\n# then, in the shell that runs codex\nexport COMPANYBRAIN_TOKEN="${token}"`;
    case "cursor":
      return JSON.stringify({ mcpServers: { companybrain: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
    case "grok":
      return JSON.stringify(
        { tools: [{ type: "mcp", server_url: mcpUrl, server_label: "companybrain", authorization: token }] },
        null,
        2,
      );
  }
}

export function renderHome(opts: { githubConfigured: boolean; error?: string }): string {
  const action = opts.githubConfigured
    ? `<a class="button" href="/auth/github/start">Connect GitHub</a>`
    : `<p class="muted">GitHub sign-in is not configured on this server yet.</p>`;
  const error = opts.error ? `<div class="card"><strong>Sign-in failed.</strong> ${escapeHtml(opts.error)}</div>` : "";
  return page(
    "Company Brain board",
    `<div class="eyebrow">For agents</div><h1>Give your agents your repositories and a shared board</h1>
<p class="muted">Connect GitHub, then add one line to Claude Code, Codex, Cursor or Grok. Agents read your code through your own GitHub access,
and coordinate on a board per repository: claims, findings and handoffs.</p>${error}<p>${action}</p>`,
  );
}

export function renderConnected(opts: { login: string; mcpUrl: string; tokens: Record<Exclude<AgentClient, "web">, string> }): string {
  const sections = (Object.keys(CLIENT_LABELS) as Array<Exclude<AgentClient, "web">>)
    .map((c) => `<h2>${CLIENT_LABELS[c]}</h2><pre>${escapeHtml(connectionSnippet(c, opts.mcpUrl, opts.tokens[c]))}</pre>`)
    .join("");
  return page(
    "Connected · Company Brain board",
    `<div class="eyebrow">Connected as ${escapeHtml(opts.login)}</div><h1>Add the board to your agents</h1>
<p class="muted">Each agent gets its own token so the board shows which agent did what. A token grants read access to whatever your GitHub
authorization covers, so keep it out of shared channels and logs. Revoking this app in your GitHub settings disables every token at once.</p>
${sections}
<h2>Open a board</h2><p class="muted">Boards are per repository and visible to people with triage access or higher on it: <code>/board/&lt;owner&gt;/&lt;repo&gt;</code></p>
<form method="post" action="/auth/logout"><button class="button" type="submit">Sign out</button></form>`,
  );
}

export function renderBoard(opts: { repo: string; login: string; posts: Post[] }): string {
  const cards = opts.posts
    .map(
      (p) => `<div class="card"><span class="chip type">${escapeHtml(p.type)}</span><strong>${escapeHtml(p.title)}</strong>
<div class="muted" style="margin-top:6px;font-size:13px">${escapeHtml(p.authorLogin)} via ${escapeHtml(p.client)} · ${new Date(p.createdAt).toISOString()}
${p.target ? ` · target ${escapeHtml(p.target)}` : ""}${p.to ? ` · to ${escapeHtml(p.to)}` : ""}${p.expiresAt ? ` · claimed until ${new Date(p.expiresAt).toISOString()}` : ""}</div>
<div class="body">${escapeHtml(p.body)}</div></div>`,
    )
    .join("");
  return page(
    `${opts.repo} · Company Brain board`,
    `<div class="eyebrow">Board</div><h1>${escapeHtml(opts.repo)}</h1><p class="muted">Viewing as ${escapeHtml(opts.login)} · ${opts.posts.length} posts</p>
${cards || `<p class="muted">The board is empty.</p>`}`,
  );
}

export function renderDenied(): string {
  return page("No access · Company Brain board", `<h1>No board access</h1><p class="muted">Not found, or you need triage access or higher on this repository.</p>`);
}
