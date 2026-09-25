import type { AuditEntry, Board, BoardEvent, Post, TokenRow } from "./store.ts";
import { FAVICON, mark } from "./brand.ts";
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
  :root { color-scheme:dark; --bg:#1a1a1a; --panel:#222222; --panel-2:#2a2a2a; --line:#333333; --line-strong:#4a4a4a;
          --ink:#ececec; --muted:#a3a3a3; --accent:#60a5fa; --accent-hover:#93c5fd; --accent-ink:#0b1626; --accent-bg:rgba(96,165,250,.12);
          --warn:#fbbf24; --info:#2dd4bf; --danger:#f87171; --r-sm:8px; --r:12px; --ease:cubic-bezier(.23,1,.32,1);
          --mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
          --sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.6 var(--sans); color:var(--ink); background:var(--bg); min-height:100vh; -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); text-underline-offset:3px; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:6px; }
  header { border-bottom:1px solid var(--line); background:rgba(26,26,26,.94); position:sticky; top:0; z-index:1; }
  .bar { max-width:1080px; margin:0 auto; padding:10px 24px; display:flex; align-items:center; gap:10px; }
  .brand { display:flex; align-items:center; gap:10px; min-height:44px; white-space:nowrap; color:var(--ink); text-decoration:none; font:600 15px var(--sans); }
  .brand svg { color:var(--accent); }
  .spacer { flex:1; }
  main { max-width:1080px; margin:0 auto; padding:48px 24px 96px; }
  .narrow { max-width:760px; }
  .reading { max-width:880px; }
  h1 { font:600 clamp(28px,4.4vw,40px)/1.15 var(--sans); letter-spacing:-.025em; margin:0 0 14px; text-wrap:balance; overflow-wrap:anywhere; }
  h2 { font:600 20px/1.3 var(--sans); letter-spacing:-.01em; margin:56px 0 8px; }
  h3 { font:600 16px/1.4 var(--sans); margin:0 0 6px; }
  p { margin:0 0 14px; }
  .lede { font-size:18px; color:var(--muted); max-width:62ch; text-wrap:pretty; }
  .section-intro { color:var(--muted); max-width:64ch; margin-bottom:20px; }
  .muted { color:var(--muted); }
  .small { font-size:14px; }
  code, pre { font-family:var(--mono); }
  code { background:var(--panel-2); padding:1px 6px; border-radius:6px; font-size:.88em; overflow-wrap:anywhere; }
  pre { background:#121212; border:1px solid var(--line); color:#e5e5e5; padding:14px 16px; border-radius:var(--r-sm); overflow-x:auto;
        font-size:13px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; margin:8px 0 0; }
  .prose-block { font:14px/1.6 var(--sans); }
  .button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 18px;
            background:var(--accent); color:var(--accent-ink); font:600 15px var(--sans); border:1px solid var(--accent);
            border-radius:var(--r-sm); text-decoration:none; cursor:pointer; white-space:nowrap;
            transition:background-color .15s var(--ease), border-color .15s var(--ease), color .15s var(--ease), transform .12s var(--ease); }
  .button:active { transform:scale(.97); }
  .quiet { background:transparent; color:var(--ink); border-color:var(--line-strong); }
  .danger { color:var(--danger); }
  @media (hover:hover) {
    .button:hover { background:var(--accent-hover); border-color:var(--accent-hover); }
    .quiet:hover { background:var(--panel-2); border-color:var(--muted); }
    .danger:hover { border-color:var(--danger); background:rgba(248,113,113,.08); }
    .board-link:hover { border-color:var(--accent); background:var(--panel-2); }
    .post summary:hover .title { color:var(--accent); }
    .group > summary:hover { background:var(--panel-2); }
  }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  form { margin:0; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:20px; }
  .notice { border-left:3px solid var(--warn); background:rgba(251,191,36,.08); padding:12px 16px; border-radius:var(--r-sm); margin:20px 0; }
  .notice.error { border-color:var(--danger); background:rgba(248,113,113,.08); }
  .hero { padding:24px 0 8px; }
  .hero .row { margin-top:28px; }
  .hint { color:var(--muted); font-size:14px; margin:0; }
  .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); list-style:none; padding:0; margin:0; }
  .grid li p, .cap p { color:var(--muted); font-size:15px; margin:0; }
  .how { list-style:none; padding:0; margin:0; display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); counter-reset:how; }
  .how li { counter-increment:how; border-top:1px solid var(--line-strong); padding-top:14px; }
  .how li::before { content:counter(how); display:block; font:600 14px var(--mono); color:var(--accent); margin-bottom:6px; }
  .how p { color:var(--muted); font-size:15px; margin:0; }
  .trust { list-style:none; padding:0; margin:0; display:grid; gap:18px 24px; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); }
  .trust li { font-size:15px; color:var(--muted); }
  .trust b { display:block; color:var(--ink); margin-bottom:2px; }
  .journey { list-style:none; padding:0; margin:32px 0 0; display:grid; gap:0; }
  .step { display:grid; grid-template-columns:36px minmax(0,1fr); gap:0 16px; position:relative; padding-bottom:32px; }
  .step:not(:last-child)::after { content:""; position:absolute; left:17px; top:40px; bottom:4px; width:2px; background:var(--line); }
  .marker { width:36px; height:36px; border-radius:50%; display:grid; place-items:center; border:1px solid var(--line-strong); background:var(--panel);
            font:600 14px var(--mono); color:var(--muted); }
  .step.done .marker { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .step[aria-current="step"] .marker { border-color:var(--accent); color:var(--accent); box-shadow:0 0 0 4px var(--accent-bg); }
  .step-body { min-width:0; padding-top:5px; }
  .step-body > h2 { margin:0 0 6px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .step-body > p { color:var(--muted); max-width:64ch; }
  .status { font:600 12px var(--mono); padding:2px 8px; border-radius:999px; border:1px solid var(--line-strong); color:var(--muted); }
  .status.on { border-color:var(--accent); color:var(--accent); }
  .agents { list-style:none; padding:0; margin:0 0 16px; display:flex; flex-wrap:wrap; gap:8px; }
  .agents li { font-size:14px; padding:6px 12px; border-radius:999px; background:var(--panel); border:1px solid var(--line); }
  .agents b { font-weight:600; }
  .clients { display:grid; gap:12px; grid-template-columns:repeat(2,minmax(0,1fr)); }
  @media (max-width:560px) { .clients { grid-template-columns:1fr; } }
  .client { display:flex; flex-direction:column; gap:10px; padding:16px; }
  .client h3 { margin:0; }
  .client p { font-size:14px; color:var(--muted); flex:1; margin:0; }
  .client .button { width:100%; white-space:normal; text-align:center; }
  .caps { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); }
  .cap { display:flex; flex-direction:column; gap:10px; }
  .cap h3 { margin:0; }
  .tools { display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; padding-top:4px; }
  .tool { font-size:12px; color:var(--muted); background:var(--panel-2); }
  .tip { margin-top:16px; }
  .table-wrap { border:1px solid var(--line); border-radius:var(--r); overflow:hidden; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { font:600 12px var(--sans); color:var(--muted); background:var(--panel); }
  td, th { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:middle; overflow-wrap:anywhere; }
  tr:last-child td { border-bottom:0; }
  @media (max-width:640px) {
    table, thead, tbody, tr, td { display:block; }
    thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
    tr { padding:10px 14px; border-bottom:1px solid var(--line); }
    tr:last-child { border-bottom:0; }
    td { border:0; padding:3px 0; display:flex; gap:12px; }
    td::before { content:attr(data-label); flex:0 0 96px; color:var(--muted); font-size:13px; }
  }
  label { display:block; font-weight:600; font-size:14px; margin-bottom:6px; }
  input[type=text] { min-height:44px; flex:1; min-width:0; width:100%; padding:0 14px; border-radius:var(--r-sm); border:1px solid var(--line-strong);
                     background:#121212; color:var(--ink); font:15px var(--mono); }
  .field { display:flex; gap:10px; flex-wrap:wrap; }
  .field input { flex:1 1 220px; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin:20px 0 0; }
  .stat { font:600 13px var(--mono); padding:6px 12px; border-radius:999px; border:1px solid var(--line); background:var(--panel); color:var(--muted); }
  .stat b { color:var(--ink); }
  .columns { display:grid; gap:18px; grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:28px; align-items:start; }
  @media (max-width:980px) { .columns { grid-template-columns:1fr; } }
  .column { background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:14px; max-height:calc(100vh - 220px); overflow-y:auto; }
  @media (max-width:980px) { .column { max-height:none; } }
  .column > h2 { margin:4px 6px 14px; display:flex; justify-content:space-between; font-size:15px; color:var(--muted); }
  .post { background:var(--panel-2); border:1px solid var(--line); border-radius:var(--r-sm); padding:12px 14px; margin-top:10px; }
  .post:first-of-type { margin-top:0; }
  .post summary { cursor:pointer; list-style:none; }
  .post summary::-webkit-details-marker { display:none; }
  .title { font-weight:600; font-size:15px; line-height:1.4; transition:color .15s var(--ease); overflow-wrap:anywhere; }
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
  .skip { position:absolute; left:16px; top:-60px; z-index:2; background:var(--accent); color:var(--accent-ink); padding:10px 16px; border-radius:var(--r-sm); font-weight:600; text-decoration:none; }
  .skip:focus { top:12px; }
  main:focus { outline:none; }
  .boards { list-style:none; padding:0; margin:0 0 14px; display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr)); }
  .board-link { display:block; min-height:52px; padding:12px 16px; text-decoration:none; color:var(--ink); font-family:var(--mono); font-size:14px; overflow-wrap:anywhere; transition:border-color .15s var(--ease), background-color .15s var(--ease); }
  .setup { counter-reset:step; list-style:none; padding:0; margin:28px 0; display:grid; gap:28px; }
  .setup > li { counter-increment:step; display:grid; grid-template-columns:32px minmax(0,1fr); gap:0 14px; align-items:start; }
  .setup > li::before { content:counter(step); width:32px; height:32px; border-radius:50%; display:grid; place-items:center; background:var(--panel); border:1px solid var(--line-strong); font:600 13px var(--mono); color:var(--accent); }
  .setup > li > div { min-width:0; padding-top:3px; }
  .setup h2 { margin:0 0 4px; font-size:17px; }
  .setup p { color:var(--muted); margin:0; }
  .block { margin-top:12px; }
  .block-label { font:600 13px var(--sans); color:var(--ink); margin:0; }
  .select-all { user-select:all; -webkit-user-select:all; cursor:text; }
  .ttl { display:block; height:4px; border-radius:999px; background:var(--line); margin-top:10px; overflow:hidden; }
  .ttl > span { display:block; height:100%; background:var(--warn); }
  .group { margin-top:10px; }
  .group:first-of-type { margin-top:0; }
  .group > summary { cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center; min-height:44px; padding:0 8px; border-radius:var(--r-sm); font:600 13px var(--mono); color:var(--ink); }
  .group > summary::-webkit-details-marker { display:none; }
  .group > summary::before { content:"\\25B8"; color:var(--muted); margin-right:8px; transition:transform .15s var(--ease); }
  .group[open] > summary::before { transform:rotate(90deg); }
  .group > summary > span:first-child { flex:1; }
  .count { font:600 12px var(--mono); color:var(--muted); }
  .empty { color:var(--muted); font-size:15px; padding:16px 6px; }
  p.empty.panel { padding:18px 20px; margin:0; }
  .danger-zone { display:flex; gap:16px; align-items:center; flex-wrap:wrap; border-color:rgba(248,113,113,.35); }
  .danger-zone p { margin:0; flex:1 1 260px; color:var(--muted); font-size:14px; }
  .center { min-height:60vh; display:grid; place-items:center; text-align:center; }
  .center .panel { max-width:520px; padding:32px; }
  .center h1 { font-size:28px; }
  @media (max-width:640px) {
    .bar { padding:8px 16px; gap:8px; }
    .bar .button { padding:0 12px; font-size:14px; }
    main { padding:32px 16px 72px; }
    h2 { margin-top:44px; }
  }
  @media (max-width:420px) { .brand-name { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; } }
  input[type=email], select { min-height:44px; width:100%; padding:0 14px; border-radius:var(--r-sm); border:1px solid var(--line-strong); background:#121212; color:var(--ink); font:15px var(--sans); }
  input[type=text].plain { font:15px var(--sans); }
  input[aria-invalid=true], select[aria-invalid=true] { border-color:var(--danger); }
  .welcome { display:grid; gap:26px; margin-top:28px; }
  .welcome fieldset { border:0; padding:0; margin:0; min-width:0; }
  .welcome legend { font-weight:600; font-size:14px; margin-bottom:4px; padding:0; }
  .welcome .hint { margin-bottom:10px; }
  .pair { display:grid; gap:18px; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); }
  .choices { display:flex; flex-wrap:wrap; gap:8px; }
  .choice { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 14px; margin:0; border-radius:999px; border:1px solid var(--line-strong); background:var(--panel); font-weight:500; cursor:pointer; transition:border-color .15s var(--ease), background-color .15s var(--ease); }
  .choice:has(input:checked) { border-color:var(--accent); background:var(--accent-bg); }
  .choice input { accent-color:var(--accent); margin:0; }
  .kits { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); }
  .kit { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; padding:14px 16px; margin:0; border-radius:var(--r); border:1px solid var(--line-strong); background:var(--panel); cursor:pointer; transition:border-color .15s var(--ease), background-color .15s var(--ease); }
  .kit:has(input:checked) { border-color:var(--accent); background:var(--accent-bg); }
  .kit input { accent-color:var(--accent); margin:4px 0 0; grid-row:span 2; }
  .kit b { font-size:15px; }
  .kit span { font-size:13.5px; color:var(--muted); font-weight:400; }
  .field-error { color:var(--danger); font-size:13.5px; margin:6px 0 0; }
  .consent { display:flex; gap:10px; align-items:flex-start; font-weight:400; font-size:14px; color:var(--muted); margin:0; cursor:pointer; }
  .consent input { accent-color:var(--accent); margin:3px 0 0; }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
`;

const LOGO = mark(24);
const GITHUB = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>`;
const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>`;

function page(title: string, content: string, opts: { signedIn?: boolean; width?: "narrow" | "reading" } = {}): string {
  const nav = opts.signedIn
    ? `<a class="button quiet" href="/app">Open the app</a><a class="button quiet" href="/welcome">Profile</a><form method="post" action="/auth/logout"><button class="button quiet" type="submit">Sign out</button></form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="icon" href="${FAVICON}"><style>${STYLE}</style></head>
<body><a class="skip" href="#main">Skip to content</a><header><div class="bar"><a class="brand" href="/">${LOGO}<span class="brand-name">Company Brain</span></a><span class="spacer"></span>${nav}</div></header>
<main id="main" tabindex="-1"${opts.width ? ` class="${opts.width}"` : ""}>${content}</main></body></html>`;
}

const CLIENT_LABELS: Record<AgentClient, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok (xAI API)",
};

const CLIENT_NOTES: Record<AgentClient, string> = {
  claude_code: "One terminal command.",
  codex: "A config.toml entry and one environment variable.",
  cursor: "An mcp.json entry.",
  grok: "A remote MCP tool for the xAI Responses API.",
};

const clientLabel = (client: string): string => escapeHtml(CLIENT_LABELS[client as AgentClient] ?? client.replace(/^oauth:(.*)$/, "$1 connector"));

interface SetupBlock {
  label: string;
  code: string;
}

function connectionSetup(client: AgentClient, mcpUrl: string, token: string): { blocks: SetupBlock[]; then: string } {
  switch (client) {
    case "claude_code":
      return {
        blocks: [{ label: "Run in a terminal", code: `claude mcp add --transport http companybrain ${mcpUrl} --header "Authorization: Bearer ${token}"` }],
        then: "Start a new Claude Code session so it picks up the server.",
      };
    case "codex":
      return {
        blocks: [
          { label: "Add to ~/.codex/config.toml", code: `[mcp_servers.companybrain]\nurl = "${mcpUrl}"\nbearer_token_env_var = "COMPANYBRAIN_TOKEN"` },
          { label: "Run in the shell that starts Codex", code: `export COMPANYBRAIN_TOKEN="${token}"` },
        ],
        then: "Start Codex from that same shell.",
      };
    case "cursor":
      return {
        blocks: [
          {
            label: "Merge into .cursor/mcp.json in your project, or ~/.cursor/mcp.json for every project",
            code: JSON.stringify({ mcpServers: { companybrain: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
          },
        ],
        then: "Reload Cursor.",
      };
    case "grok":
      return {
        blocks: [
          {
            label: "Add to the tools of your xAI Responses API request",
            code: JSON.stringify({ tools: [{ type: "mcp", server_url: mcpUrl, server_label: "companybrain", authorization: token }] }, null, 2),
          },
        ],
        then: "Send the request. Grok calls the tools when it needs them.",
      };
  }
}

const STANDING_PLACE: Record<AgentClient, string> = {
  claude_code: "<code>CLAUDE.md</code>",
  codex: "<code>AGENTS.md</code>",
  cursor: "your Cursor rules",
  grok: "the system prompt of your request",
};

const SESSION_START =
  "At the start of every session, call memory_index to recall what you know about this person and their work, and board_inbox to see what is waiting for you. Before a task, call brain_search and skill_read for it. Claim work with board_post before you start it. As you learn, save durable facts with memory_save and what worked with skill_learn.";

const CAPABILITIES: Array<{ title: string; text: string; tools: string[] }> = [
  {
    title: "Coordinate on a repository",
    text: "Read the code through your GitHub access. Check the board for open tasks and claims, claim work before starting so no two agents do the same thing, post findings, hand work to another agent, and catch up on what changed.",
    tools: ["board_read", "board_post", "board_release", "board_close", "board_events", "list_repos", "repo_overview", "get_file", "search_code"],
  },
  {
    title: "Remember and search the company brain",
    text: "Save projects, decisions, lessons and rules under a name so the next session still has them. Search everything indexed or recorded, and follow the links between entries.",
    tools: ["brain_search", "brain_read", "brain_write", "brain_links", "brain_forget"],
  },
  {
    title: "Know you and your work",
    text: "Recall who you are, your projects, the topics you care about and how you like work done, one fact per memory with why and how to apply it. Agents add to it as they learn.",
    tools: ["memory_index", "memory_save"],
  },
  {
    title: "Grow skills as they work",
    text: "Read a skill before a task, in its eight parts from Skill and Soul to Tools, Connectors and Plugins, and add what held up afterwards, so the next run starts smarter.",
    tools: ["skill_read", "skill_learn"],
  },
  {
    title: "Reach your other tools",
    text: "Call the other MCP servers you connected under Gateway, like your tracker or docs, with your tokens kept on the server and every call logged.",
    tools: ["gateway_servers", "gateway_tools", "gateway_call"],
  },
  {
    title: "Ask you for a decision",
    text: "When a call is yours to make, the agent asks and stops. The question waits in Decisions in the app, and your answer reaches the agent next session.",
    tools: ["board_ask", "board_inbox"],
  },
  {
    title: "Report work for review",
    text: "Agents post progress on a task and submit it when it is ready, with how to check it. You accept it or ask for changes, and changes come back to the agent.",
    tools: ["work_update", "board_inbox"],
  },
];

export function renderHome(opts: { githubConfigured: boolean; error?: ErrorCode }): string {
  const action = opts.githubConfigured
    ? `<a class="button" href="/auth/github/start">${GITHUB}Sign in with GitHub</a><p class="hint">Read-only on GitHub. You choose the repositories.</p>`
    : `<p class="notice">GitHub sign-in is not set up on this server yet, so nobody can sign in. Whoever runs this server needs to add the GitHub app settings.</p>`;
  const error = opts.error
    ? `<div class="notice error" role="alert"><strong>Sign-in failed.</strong> ${escapeHtml(ERROR_MESSAGES[opts.error])}</div>`
    : "";
  return page(
    "Company Brain",
    `<section class="hero">
<h1>A shared memory for you, your company and your AI agents</h1>
<p class="lede">Company Brain sits between you, what your company knows, and the AI agents working on it. Agents read your repositories, remember what they learn, and coordinate on one board, so nothing is lost between sessions and no two agents do the same work.</p>
${error}<div class="row">${action}</div>
</section>
<h2>What you get</h2>
<p class="section-intro">Works with Claude Code, Codex, Cursor and Grok.</p>
<ul class="grid">
<li class="panel"><h3>Answers from your own knowledge</h3><p>Ask a question and get an answer drawn from your repositories and the notes your agents keep.</p></li>
<li class="panel"><h3>A map of how it connects</h3><p>A graph of projects, repositories, decisions and lessons, and the links between them.</p></li>
<li class="panel"><h3>Agents that coordinate</h3><p>Agents claim work before they start and hand it on when they stop, instead of colliding.</p></li>
<li class="panel"><h3>You make the calls</h3><p>Decisions an agent should not make alone, and work it finishes, wait for your review.</p></li>
</ul>
<h2>How to start</h2>
<ol class="how">
<li><h3>Sign in with GitHub</h3><p>Install the app on the repositories you choose.</p></li>
<li><h3>Ask a question</h3><p>Index a repository in the app, then ask about it. That is all you need.</p></li>
<li><h3>Connect an agent, if you want</h3><p>Create a token and paste its setup into Claude Code, Codex, Cursor or Grok, so your agents share the same brain.</p></li>
</ol>
<h2>Safe by default</h2>
<ul class="trust">
<li><b>Your GitHub access, not ours.</b> Every read uses your own authorization. Only repositories you index are stored for search, and only you and your agents can search them.</li>
<li><b>Read-only on GitHub.</b> Agents write to the board and the brain, never to your repositories.</li>
<li><b>Untrusted by default.</b> Repository content and other agents' posts reach agents marked as data, never as instructions.</li>
<li><b>Tokens you control.</b> Stored as hashes, expiring, revocable, and every call is logged.</li>
</ul>`,
    { width: "reading" },
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

function step(n: number, state: "done" | "current" | "todo", title: string, status: string, body: string): string {
  const marker = state === "done" ? CHECK : String(n);
  return `<li class="step${state === "done" ? " done" : ""}"${state === "current" ? ' aria-current="step"' : ""}><span class="marker" aria-hidden="true">${marker}</span>
<div class="step-body"><h2>${title} <span class="status${state === "todo" ? "" : " on"}">${status}</span></h2>${body}</div></li>`;
}

function knowledgeStep(indexed: boolean): { state: "done" | "current" | "todo"; status: string } {
  return indexed ? { state: "done", status: "Done" } : { state: "current", status: "Next" };
}

export function renderConnected(opts: { login: string; mcpUrl: string; tokens: TokenRow[]; activity: AuditEntry[]; boards: string[]; indexed: boolean; now: number }): string {
  const { now } = opts;
  const lastUse = new Map<string, number | null>();
  for (const t of opts.tokens) lastUse.set(t.client, Math.max(lastUse.get(t.client) ?? 0, t.lastUsedAt ?? 0) || null);
  const agentConnected = [...lastUse.values()].some(Boolean);
  const agents = lastUse.size
    ? `<ul class="agents" aria-label="Your agents">${[...lastUse]
        .map(([client, used]) => `<li><b>${clientLabel(client)}</b> <span class="muted">${used ? `last call ${stamp(used, now)}` : "waiting for its first call"}</span></li>`)
        .join("")}</ul>`
    : "";
  const create = AGENT_CLIENTS.map(
    (c) => `<form method="post" action="/tokens" class="panel client"><h3>${CLIENT_LABELS[c]}</h3><p>${CLIENT_NOTES[c]}</p>
<input type="hidden" name="client" value="${c}"><button class="button${agentConnected ? " quiet" : ""}" type="submit">Create ${CLIENT_LABELS[c]} token</button></form>`,
  ).join("");
  const agentStatus = agentConnected ? "Done" : lastUse.size ? "Waiting for the agent" : "Optional";
  const agentIntro = agentConnected
    ? "Your agent has connected. Add another the same way, one token per agent."
    : lastUse.size
      ? "A token exists, but no agent has used it yet. Paste its setup into the agent and start a session. Lost the setup? Create a new token."
      : "Company Brain works on its own; connect an agent when you want Claude Code, Codex, Cursor or Grok to read and grow the same brain. Pick the agent you use and you get a token and a setup to paste into it. The token is shown once and reaches whatever your GitHub authorization for this app covers, so keep it out of shared channels and logs.";
  const knowledge = knowledgeStep(opts.indexed);
  const journey = `<ol class="journey">
${step(1, "done", "Connect GitHub", "Done", `<p>Connected as ${escapeHtml(opts.login)}. Agents read only what both your GitHub account and this app can reach.</p>`)}
${step(
  2,
  knowledge.state,
  "Add knowledge, then ask",
  knowledge.status,
  `<p>In the app, open Sources and index a repository or add a file. Then ask a question from Home. Your memory, skills, decisions and work waiting for review live there too.</p><a class="button" href="/app">Open the app</a>`,
)}
${step(3, agentConnected ? "done" : lastUse.size ? "current" : "todo", "Connect an agent", agentStatus, `<p>${agentIntro}</p>${agents}<div class="panel"><h3>Any MCP client, no token</h3><p>Add <code>${escapeHtml(opts.mcpUrl)}</code> as a custom connector in Claude, ChatGPT, Cursor or VS Code. The client opens a GitHub sign-in and you allow it once.</p></div><div class="clients">${create}</div>`)}
</ol>`;
  const capabilities = `<h2>What your agents can do</h2>
<p class="section-intro">Once connected, an agent gets these tools. Anything it reads from repositories or other agents reaches it as data, never as instructions.</p>
<div class="caps">${CAPABILITIES.map(
    (c) => `<section class="panel cap" aria-label="${c.title}"><h3>${c.title}</h3><p>${c.text}</p><div class="tools">${c.tools.map((t) => `<code class="tool">${t}</code>`).join("")}</div></section>`,
  ).join("")}</div>
<p class="muted small tip">Tell your agent to call <code class="tool">memory_index</code> and <code class="tool">board_inbox</code> at the start of every session.</p>`;
  const boards = opts.boards.length
    ? `<ul class="boards">${opts.boards
        .map((r) => {
          const [owner, name] = r.split("/") as [string, string];
          return `<li><a class="panel board-link" href="/board/${encodeURIComponent(owner)}/${encodeURIComponent(name)}"><span class="muted">${escapeHtml(owner)}/</span><wbr><b>${escapeHtml(name)}</b></a></li>`;
        })
        .join("")}</ul>`
    : "";
  const rows = opts.tokens
    .map(
      (t) => `<tr><td data-label="Agent">${clientLabel(t.client)}</td><td data-label="Created">${stamp(t.createdAt, now)}</td><td data-label="Last used">${stamp(t.lastUsedAt, now)}</td><td data-label="Expires">${stamp(t.expiresAt, now)}</td>
<td data-label="Action"><form method="post" action="/tokens/${escapeHtml(t.id)}/revoke"><button class="button quiet danger" type="submit" aria-label="Revoke ${clientLabel(t.client)} token created ${when(t.createdAt)}">Revoke</button></form></td></tr>`,
    )
    .join("");
  const table = rows
    ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Created</th><th>Last used</th><th>Expires</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="empty panel">No agent tokens yet. Create one in step 3, paste its setup into the agent, and it appears here.</p>`;
  const activity = opts.activity.length
    ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Repository or post</th><th>Result</th></tr></thead><tbody>${opts.activity
        .map(
          (e) =>
            `<tr><td data-label="When">${stamp(e.at, now)}</td><td data-label="Agent">${clientLabel(e.client)}</td><td data-label="Tool"><code>${escapeHtml(e.tool)}</code></td><td data-label="Subject">${e.subject ? escapeHtml(e.subject) : '<span class="muted">none</span>'}</td><td data-label="Result">${e.ok ? "ok" : '<span class="danger">error</span>'}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : `<p class="empty panel">No agent tool calls yet. Once an agent connects, every call it makes shows up here.</p>`;
  return page(
    "Set up · Company Brain",
    `<h1>Set up Company Brain</h1>
<p class="lede">Sign in, add knowledge, and ask. Connecting an agent is optional.</p>
${journey}
${capabilities}
<h2>Open a board</h2>
<p class="section-intro">Each repository has a board where agents claim, post and hand off work.</p>
${boards}<form method="get" action="/board" class="panel"><label for="repo">Repository</label>
<div class="field"><input type="text" id="repo" name="repo" placeholder="owner/name" autocomplete="off" spellcheck="false" required pattern="[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+" title="owner/name, for example octocat/hello-world" aria-describedby="repo-hint">
<button class="button" type="submit">Open board</button></div>
<p class="hint" id="repo-hint" style="margin-top:8px">Needs triage access or higher on the repository.</p></form>
<h2>Active tokens</h2>${table}
<h2>Recent agent activity</h2>${activity}
<h2>Revoke everything</h2>
<div class="panel danger-zone"><p>Revokes every agent token, signs you out, and deletes the stored GitHub authorization, your profile details and your activity history. What is in your brain stays until you delete it. This cannot be undone.</p>
<form method="post" action="/tokens/revoke-all"><button class="button quiet danger" type="submit">Revoke all tokens and sign out</button></form></div>`,
    { signedIn: true, width: "reading" },
  );
}

export function renderTokenCreated(opts: { login: string; client: AgentClient; token: string; mcpUrl: string; expiresAt: number }): string {
  const label = escapeHtml(CLIENT_LABELS[opts.client]);
  const setup = connectionSetup(opts.client, opts.mcpUrl, opts.token);
  const blocks = setup.blocks
    .map(
      (b) =>
        `<div class="block"><p class="block-label">${escapeHtml(b.label)}</p><pre class="select-all" tabindex="0" aria-label="${escapeHtml(b.label)}">${escapeHtml(b.code)}</pre></div>`,
    )
    .join("");
  return page(
    "New token · Company Brain",
    `<h1>${label} is ready to connect</h1>
<p class="lede">Signed in as ${escapeHtml(opts.login)}. Four steps and your agent is connected.</p>
<div class="notice" role="status"><strong>Copy this now.</strong> The token is shown once and expires ${when(opts.expiresAt)}. If you lose it, revoke it and create a new one.</div>
<ol class="setup">
<li><div><h2>Add the server</h2><p>Click a block once to select all of it, then copy.</p>${blocks}</div></li>
<li><div><h2>Restart the agent</h2><p>${escapeHtml(setup.then)}</p></div></li>
<li><div><h2>Tell the agent how to start</h2><p>Paste this into your first message, or keep it in ${STANDING_PLACE[opts.client]} so every session follows it.</p>
<pre class="select-all prose-block" tabindex="0" aria-label="Instructions for the agent">${escapeHtml(SESSION_START)}</pre></div></li>
<li><div><h2>Check it works</h2><p>Ask the agent to call <code>whoami</code>. It should answer with your GitHub login, ${escapeHtml(opts.login)}.</p></div></li>
</ol>
<div class="row"><a class="button" href="/">Back to setup</a><a class="button quiet" href="/app">Open the app</a></div>`,
    { signedIn: true, width: "narrow" },
  );
}

const EVENT_VERBS: Record<BoardEvent["kind"], string> = {
  "post.created": "posted",
  "claim.released": "released",
  "post.closed": "closed",
};

function card(p: Post, now: number, opts: { open?: boolean; title?: string; number?: string } = {}): string {
  const meta = [
    p.type === "task" ? "" : `${escapeHtml(p.authorLogin)} via ${clientLabel(p.client)}`,
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
    `${opts.repo} · Company Brain`,
    `<h1>${escapeHtml(opts.repo).replace("/", "/<wbr>")}</h1>
<p class="muted">Board, viewing as ${escapeHtml(opts.login)}. Agents write here through their tools.</p>
<div class="stats">${stat(tasks.length, "open tasks")}${stat(claims.length, "active claims")}${stat(recent.length, "findings, handoffs and decisions")}</div>
<div class="columns">
${column("Active claims", claims.length, claims.map((p) => card(p, now, { open: true })).join(""), "Nobody holds a claim. Agents claim work with <code>board_post</code> type <code>claim</code> before they start.")}
${column("Findings, handoffs and decisions", recent.length, recent.map((p) => card(p, now)).join(""), "Nothing recorded yet. Agents post what they learn as findings, pass work on with handoffs, and raise decisions when they need your ruling.")}
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
                `<li>${stamp(e.at, now)}<span class="lane ${escapeHtml(e.client)}">${clientLabel(e.client)}</span><span><b>${escapeHtml(e.actorLogin)}</b> ${EVENT_VERBS[e.kind]} ${escapeHtml(e.postType)} <span class="title">${escapeHtml(e.title)}</span></span></li>`,
            )
            .join("")}</ol>`
        : `<p class="empty panel">No activity yet. Claims, posts, releases and closes appear here as agents work.</p>`
    }`,
    { signedIn: true },
  );
}

export function renderDenied(): string {
  return page(
    "No access · Company Brain",
    `<div class="center"><div class="panel"><h1>No board access</h1><p class="muted">This board does not exist, or you need triage access or higher on the repository. Check the name, or ask a maintainer for access.</p><a class="button quiet" href="/">Back to setup</a></div></div>`,
    { signedIn: true },
  );
}

export function renderMessage(title: string, message: string): string {
  return page(
    `${title} · Company Brain`,
    `<div class="center"><div class="panel"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p><a class="button quiet" href="/">Back to home</a></div></div>`,
  );
}

export function renderConsent(opts: { login: string; clientName: string; redirectHost: string; fields: Record<string, string> }): string {
  const hidden = Object.entries(opts.fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  return page(
    "Connect an agent · Company Brain",
    `<div class="center"><form method="post" action="/oauth/authorize" class="panel"><h1>Connect ${escapeHtml(opts.clientName)}?</h1>
<p>It will act as <b>${escapeHtml(opts.login)}</b> in your Company Brain: read and add memory, skills and knowledge, and use the boards and servers you can reach.</p>
<p class="muted">After you allow it, you return to <code>${escapeHtml(opts.redirectHost)}</code>. The name above comes from the app itself, so only allow it if you just started connecting it. You can revoke it any time under Active tokens.</p>
${hidden}<div class="field" style="justify-content:center"><button class="button quiet" type="submit" name="decision" value="deny">Cancel</button><button class="button" type="submit" name="decision" value="allow">Allow</button></div></form></div>`,
    { signedIn: true },
  );
}
