import { AGENT_CHOICES, GOALS, KITS, kitSummary, ROLES, TEAM_SIZES, type WelcomeInput, type WelcomeProblems } from "./starter.ts";
import { FAVICON, mark } from "./brand.ts";
import { escapeHtml } from "./web.ts";

const ICONS = {
  Code: "M67.84,92.61,25.37,128l42.47,35.39a6,6,0,1,1-7.68,9.22l-48-40a6,6,0,0,1,0-9.22l48-40a6,6,0,0,1,7.68,9.22Zm176,30.78-48-40a6,6,0,1,0-7.68,9.22L230.63,128l-42.47,35.39a6,6,0,1,0,7.68,9.22l48-40a6,6,0,0,0,0-9.22Zm-81.79-89A6,6,0,0,0,154.36,38l-64,176A6,6,0,0,0,94,221.64a6.15,6.15,0,0,0,2,.36,6,6,0,0,0,5.64-3.95l64-176A6,6,0,0,0,162.05,34.36Z",
  Compass: "M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218ZM173.32,74.63l-64,32a6,6,0,0,0-2.69,2.69l-32,64A6,6,0,0,0,80,182a6.06,6.06,0,0,0,2.68-.63l64-32a6,6,0,0,0,2.69-2.69l32-64a6,6,0,0,0-8.05-8.05Zm-33.79,64.9L93.42,162.58l23-46.11,46.11-23Z",
  Stack: "M229.18,173a6,6,0,0,1-2.16,8.2l-96,56a6,6,0,0,1-6,0l-96-56a6,6,0,0,1,6-10.36l93,54.23,93-54.23A6,6,0,0,1,229.18,173ZM221,122.82l-93,54.23L35,122.82a6,6,0,0,0-6,10.36l96,56a6,6,0,0,0,6,0l96-56a6,6,0,0,0-6-10.36ZM26,80a6,6,0,0,1,3-5.18l96-56a6,6,0,0,1,6,0l96,56a6,6,0,0,1,0,10.36l-96,56a6,6,0,0,1-6,0l-96-56A6,6,0,0,1,26,80Zm17.91,0L128,129.05,212.09,80,128,31Z",
  Robot: "M200,50H134V16a6,6,0,0,0-12,0V50H56A30,30,0,0,0,26,80V192a30,30,0,0,0,30,30H200a30,30,0,0,0,30-30V80A30,30,0,0,0,200,50Zm18,142a18,18,0,0,1-18,18H56a18,18,0,0,1-18-18V80A18,18,0,0,1,56,62H200a18,18,0,0,1,18,18ZM74,108a10,10,0,1,1,10,10A10,10,0,0,1,74,108Zm88,0a10,10,0,1,1,10,10A10,10,0,0,1,162,108Zm2,30H92a26,26,0,0,0,0,52h72a26,26,0,0,0,0-52Zm-22,12v28H114V150ZM78,164a14,14,0,0,1,14-14h10v28H92A14,14,0,0,1,78,164Zm86,14H154V150h10a14,14,0,0,1,0,28Z",
  Scales: "M237.57,133.77l-32-80h0a6,6,0,0,0-6.86-3.63L134,64.52V40a6,6,0,0,0-12,0V67.19l-67.3,15a6,6,0,0,0-4.27,3.63h0v0l-32,80A6.1,6.1,0,0,0,18,168c0,21.86,23.31,30,38,30s38-8.14,38-30a6.1,6.1,0,0,0-.43-2.23L64.19,92.33,122,79.48V210H104a6,6,0,0,0,0,12h48a6,6,0,0,0,0-12H134V76.81l56.21-12.49-27.78,69.45A6.1,6.1,0,0,0,162,136c0,21.86,23.31,30,38,30s38-8.14,38-30A6.1,6.1,0,0,0,237.57,133.77ZM56,186a36.89,36.89,0,0,1-17.48-4.56c-5.37-3.13-8.15-7.18-8.49-12.37l26-64.91,26,64.91C81.06,182.85,62.58,186,56,186Zm144-32a36.89,36.89,0,0,1-17.48-4.56c-5.37-3.13-8.15-7.18-8.49-12.37l26-64.91,26,64.91C225.06,150.85,206.58,154,200,154Z",
  Wrench: "M224.91,69.75a6,6,0,0,0-9.63-2.16l-41.07,37.9L154.7,101.3l-4.19-19.51,37.9-41.07a6,6,0,0,0-2.16-9.63,70,70,0,0,0-89.77,94.39l-61.39,53c-.11.09-.21.19-.32.3A30,30,0,0,0,77.2,221.23c.11-.11.21-.21.3-.32l53-61.39a70,70,0,0,0,94.39-89.77ZM160,154a58,58,0,0,1-28-7.22,6,6,0,0,0-7.45,1.33L68.57,212.88a18,18,0,0,1-25.45-25.45l64.76-55.94A6,6,0,0,0,109.2,124a58,58,0,0,1,64-84.53L139.58,75.93a6,6,0,0,0-1.45,5.33l5.65,26.35a6,6,0,0,0,4.61,4.61l26.35,5.65a6,6,0,0,0,5.33-1.45L216.49,82.8A58.06,58.06,0,0,1,160,154Z",
  FileText: "M212.24,83.76l-56-56A6,6,0,0,0,152,26H56A14,14,0,0,0,42,40V216a14,14,0,0,0,14,14H200a14,14,0,0,0,14-14V88A6,6,0,0,0,212.24,83.76ZM158,46.48,193.52,82H158ZM200,218H56a2,2,0,0,1-2-2V40a2,2,0,0,1,2-2h90V88a6,6,0,0,0,6,6h50V216A2,2,0,0,1,200,218Zm-34-82a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h64A6,6,0,0,1,166,136Zm0,32a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h64A6,6,0,0,1,166,168Z",
  Path: "M200,170a30.05,30.05,0,0,0-29.4,24H72a34,34,0,0,1,0-68h96a38,38,0,0,0,0-76H72a6,6,0,0,0,0,12h96a26,26,0,0,1,0,52H72a46,46,0,0,0,0,92h98.6A30,30,0,1,0,200,170Zm0,48a18,18,0,1,1,18-18A18,18,0,0,1,200,218Z",
  Check: "M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z",
  ArrowRight: "M220.24,132.24l-72,72a6,6,0,0,1-8.48-8.48L201.51,134H40a6,6,0,0,1,0-12H201.51L139.76,60.24a6,6,0,0,1,8.48-8.48l72,72A6,6,0,0,1,220.24,132.24Z",
  User: "M229.19,213c-15.81-27.32-40.63-46.49-69.47-54.62a70,70,0,1,0-63.44,0C67.44,166.5,42.62,185.67,26.81,213a6,6,0,1,0,10.38,6C56.4,185.81,90.34,166,128,166s71.6,19.81,90.81,53a6,6,0,1,0,10.38-6ZM70,96a58,58,0,1,1,58,58A58.07,58.07,0,0,1,70,96Z",
  UsersThree: "M243.6,148.8a6,6,0,0,1-8.4-1.2A53.58,53.58,0,0,0,192,126a6,6,0,0,1,0-12,26,26,0,1,0-25.18-32.5,6,6,0,0,1-11.62-3,38,38,0,1,1,59.91,39.63A65.69,65.69,0,0,1,244.8,140.4,6,6,0,0,1,243.6,148.8ZM189.19,213a6,6,0,0,1-2.19,8.2,5.9,5.9,0,0,1-3,.81,6,6,0,0,1-5.2-3,59,59,0,0,0-101.62,0,6,6,0,1,1-10.38-6A70.1,70.1,0,0,1,103,182.55a46,46,0,1,1,50.1,0A70.1,70.1,0,0,1,189.19,213ZM128,178a34,34,0,1,0-34-34A34,34,0,0,0,128,178ZM70,120a6,6,0,0,0-6-6A26,26,0,1,1,89.18,81.49a6,6,0,1,0,11.62-3,38,38,0,1,0-59.91,39.63A65.69,65.69,0,0,0,11.2,140.4a6,6,0,1,0,9.6,7.2A53.58,53.58,0,0,1,64,126,6,6,0,0,0,70,120Z",
  Target: "M220.06,84a102.06,102.06,0,1,1-24.31-32.27l24-24a6,6,0,0,1,8.48,8.49l-96,96a6,6,0,1,1-8.48-8.49l29.39-29.4a42,42,0,1,0,16.78,31.24,6,6,0,1,1,12-.68A54,54,0,1,1,161.7,85.83l25.54-25.55a89.91,89.91,0,1,0,22,28.93A6,6,0,1,1,220.06,84Z",
  ChatCircleText: "M166,112a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h64A6,6,0,0,1,166,112Zm-6,26H96a6,6,0,0,0,0,12h64a6,6,0,0,0,0-12Zm70-10A102,102,0,0,1,79.31,217.65L44.44,229.27a14,14,0,0,1-17.71-17.71l11.62-34.87A102,102,0,1,1,230,128Zm-12,0A90,90,0,1,0,50.08,173.06a6,6,0,0,1,.5,4.91L38.12,215.35a2,2,0,0,0,2.53,2.53L78,205.42a6.2,6.2,0,0,1,1.9-.31,6.09,6.09,0,0,1,3,.81A90,90,0,0,0,218,128Z",
  SignOut: "M118,216a6,6,0,0,1-6,6H48a6,6,0,0,1-6-6V40a6,6,0,0,1,6-6h64a6,6,0,0,1,0,12H54V210h58A6,6,0,0,1,118,216Zm110.24-92.24-40-40a6,6,0,0,0-8.48,8.48L209.51,122H112a6,6,0,0,0,0,12h97.51l-29.75,29.76a6,6,0,1,0,8.48,8.48l40-40A6,6,0,0,0,228.24,123.76Z",
  Brain: "M246,124a54.13,54.13,0,0,0-32-49.33V72a46,46,0,0,0-86-22.67A46,46,0,0,0,42,72v2.67a54,54,0,0,0,0,98.63V176a46,46,0,0,0,86,22.67A46,46,0,0,0,214,176v-2.7A54.07,54.07,0,0,0,246,124ZM88,210a34,34,0,0,1-34-32.94A53.67,53.67,0,0,0,64,178h8a6,6,0,0,0,0-12H64A42,42,0,0,1,50,84.39a6,6,0,0,0,4-5.66V72a34,34,0,0,1,68,0v73.05A45.89,45.89,0,0,0,88,130a6,6,0,0,0,0,12,34,34,0,0,1,0,68Zm104-44h-8a6,6,0,0,0,0,12h8a53.67,53.67,0,0,0,10-.94A34,34,0,1,1,168,142a6,6,0,0,0,0-12,45.89,45.89,0,0,0-34,15.05V72a34,34,0,0,1,68,0v6.73a6,6,0,0,0,4,5.66A42,42,0,0,1,192,166Zm14-54a6,6,0,0,1-6,6h-4a34,34,0,0,1-34-34V80a6,6,0,0,1,12,0v4a22,22,0,0,0,22,22h4A6,6,0,0,1,206,112ZM60,118H56a6,6,0,0,1,0-12h4A22,22,0,0,0,82,84V80a6,6,0,0,1,12,0v4A34,34,0,0,1,60,118Z",
  Sparkle: "M196.89,130.94,144.4,111.6,125.06,59.11a13.92,13.92,0,0,0-26.12,0L79.6,111.6,27.11,130.94a13.92,13.92,0,0,0,0,26.12L79.6,176.4l19.34,52.49a13.92,13.92,0,0,0,26.12,0L144.4,176.4l52.49-19.34a13.92,13.92,0,0,0,0-26.12Zm-4.15,14.86-55.08,20.3a6,6,0,0,0-3.56,3.56l-20.3,55.08a1.92,1.92,0,0,1-3.6,0L89.9,169.66a6,6,0,0,0-3.56-3.56L31.26,145.8a1.92,1.92,0,0,1,0-3.6l55.08-20.3a6,6,0,0,0,3.56-3.56l20.3-55.08a1.92,1.92,0,0,1,3.6,0l20.3,55.08a6,6,0,0,0,3.56,3.56l55.08,20.3a1.92,1.92,0,0,1,0,3.6ZM146,40a6,6,0,0,1,6-6h18V16a6,6,0,0,1,12,0V34h18a6,6,0,0,1,0,12H182V64a6,6,0,0,1-12,0V46H152A6,6,0,0,1,146,40ZM246,88a6,6,0,0,1-6,6H230v10a6,6,0,0,1-12,0V94H208a6,6,0,0,1,0-12h10V72a6,6,0,0,1,12,0V82h10A6,6,0,0,1,246,88Z",
  Lightning: "M213.84,118.63a6,6,0,0,0-3.73-4.25L150.88,92.17l15-75a6,6,0,0,0-10.27-5.27l-112,120a6,6,0,0,0,2.28,9.71l59.23,22.21-15,75a6,6,0,0,0,3.14,6.52A6.07,6.07,0,0,0,96,246a6,6,0,0,0,4.39-1.91l112-120A6,6,0,0,0,213.84,118.63ZM106,220.46l11.85-59.28a6,6,0,0,0-3.77-6.8l-55.6-20.85,91.46-98L138.12,94.82a6,6,0,0,0,3.77,6.8l55.6,20.85Z",
  ShieldCheck: "M208,42H48A14,14,0,0,0,34,56v56c0,51.94,25.12,83.4,46.2,100.64,22.73,18.6,45.27,24.89,46.22,25.15a6,6,0,0,0,3.16,0c.95-.26,23.49-6.55,46.22-25.15C196.88,195.4,222,163.94,222,112V56A14,14,0,0,0,208,42Zm2,70c0,37.76-13.94,68.39-41.44,91.06A131.17,131.17,0,0,1,128,225.72a130.94,130.94,0,0,1-40.56-22.66C59.94,180.39,46,149.76,46,112V56a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2ZM172.24,99.76a6,6,0,0,1,0,8.48l-56,56a6,6,0,0,1-8.48,0l-24-24a6,6,0,0,1,8.48-8.48L112,151.51l51.76-51.75A6,6,0,0,1,172.24,99.76Z",
} as const;
type IconName = keyof typeof ICONS;

const icon = (name: IconName, size = 18): string =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

const MARK = mark(30);

export const WELCOME_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const GOAL_ICON: Record<keyof typeof GOALS, IconName> = { answers: "ChatCircleText", agents: "Robot", write: "FileText", onboard: "UsersThree", tools: "Path" };
const KIT_ICON: Record<keyof typeof KITS, IconName> = { engineering: "Code", operations: "Compass", both: "Stack" };

const STYLE = `
:root { color-scheme: dark; --bg:#08080a; --ink:#f4f4f6; --ink-2:rgba(244,244,246,.74); --ink-3:rgba(244,244,246,.6); --line:rgba(255,255,255,.10); --line-2:rgba(255,255,255,.16);
  --field:#101014; --accent:#5eeab0; --accent-ink:#8ff2c9; --accent-bg:rgba(94,234,176,.10); --danger:#f98b8b; --danger-bg:rgba(249,139,139,.10);
  --ease:cubic-bezier(.23,1,.32,1); --sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; --mono:"Geist Mono",ui-monospace,Menlo,monospace; }
* { box-sizing:border-box; }
html { background:var(--bg); }
body { margin:0; min-height:100vh; font:15px/1.55 var(--sans); color:var(--ink); background:
  radial-gradient(52rem 34rem at 12% -8%, rgba(94,234,176,.13), transparent 62%),
  radial-gradient(46rem 34rem at 100% 105%, rgba(129,140,248,.10), transparent 65%), linear-gradient(180deg,#0b0c0e 0%,var(--bg) 55%);
  -webkit-font-smoothing:antialiased; position:relative; overflow-x:clip; }
body::before { content:""; position:absolute; inset:0 0 auto; height:620px; pointer-events:none;
  background-image:radial-gradient(rgba(255,255,255,.12) 1px, transparent 1.3px); background-size:24px 24px;
  -webkit-mask-image:radial-gradient(ellipse 80% 70% at 30% 0%, #000 20%, transparent 75%); mask-image:radial-gradient(ellipse 80% 70% at 30% 0%, #000 20%, transparent 75%); }
body::after { content:""; position:fixed; inset:0; pointer-events:none; opacity:.05; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
a { color:var(--accent-ink); text-underline-offset:3px; }
.ico { flex-shrink:0; display:block; }
.sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.skip { position:absolute; left:16px; top:-60px; z-index:5; background:var(--accent); color:#04140f; padding:10px 16px; border-radius:10px; font-weight:600; text-decoration:none; }
.skip:focus { top:12px; }
.bar { position:relative; z-index:2; max-width:1200px; margin:0 auto; padding:22px 28px; display:flex; align-items:center; gap:14px; }
.brand { display:flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none; font-weight:600; letter-spacing:-.01em; }
.bar .who { margin-left:auto; color:var(--ink-3); font-size:13px; }
.bar form { margin:0; }
.ghost { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:8px; min-height:36px; padding:0 14px; border-radius:999px; font-size:13px; font-weight:500; color:var(--ink-2);
  box-shadow:inset 0 0 0 1px var(--line-2); transition:transform 160ms var(--ease), color 200ms var(--ease), background-color 200ms var(--ease); }
.ghost:active { transform:scale(.97); }
.ghost.danger { color:var(--danger); box-shadow:inset 0 0 0 1px rgba(249,139,139,.28); }
.ghost:focus-visible, .primary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
main { position:relative; z-index:1; }
.welcome { max-width:1200px; margin:0 auto; padding:18px 28px 96px; display:grid; gap:22px 44px; grid-template-columns:minmax(0,1fr) 380px;
  grid-template-areas:"head aside" "steps aside" "finish aside"; align-items:start; }
.head { grid-area:head; padding-top:18px; }
.steps { grid-area:steps; display:grid; gap:16px; }
.aside { grid-area:aside; position:sticky; top:24px; }
.finish { grid-area:finish; }
@media (max-width:1040px) { .welcome { grid-template-columns:minmax(0,1fr); grid-template-areas:"head" "steps" "aside" "finish"; } .aside { position:static; } }
@media (max-width:560px) { .welcome { padding:8px 16px 72px; } .bar { padding:16px; } .bar .who { display:none; } }
.eyebrow { display:inline-flex; align-items:center; gap:8px; padding:5px 12px 5px 10px; border-radius:999px; font:600 11px var(--sans); letter-spacing:.14em; text-transform:uppercase;
  color:var(--accent-ink); background:var(--accent-bg); box-shadow:inset 0 0 0 1px rgba(94,234,176,.22); }
.eyebrow::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--accent); }
h1 { margin:18px 0 12px; font:600 clamp(34px,5vw,52px)/1.04 var(--sans); letter-spacing:-.035em; text-wrap:balance; }
h1 span { display:block; color:var(--ink-3); }
.lede { margin:0; max-width:58ch; color:var(--ink-2); font-size:16.5px; text-wrap:pretty; }
.rail { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; max-width:320px; margin-top:26px; }
.rail span { height:4px; border-radius:999px; background:rgba(255,255,255,.08); transition:background-color 320ms var(--ease), box-shadow 320ms var(--ease); }
.rail-label { margin-top:10px; font-size:12.5px; color:var(--ink-3); }
.alert { margin-top:22px; padding:14px 16px; border-radius:16px; background:var(--danger-bg); box-shadow:inset 0 0 0 1px rgba(249,139,139,.26); color:#fbd0d0; font-size:14px; }
.alert b { color:var(--danger); }
.bezel { padding:6px; border-radius:28px; background:rgba(255,255,255,.04); box-shadow:0 0 0 1px rgba(255,255,255,.10), 0 30px 60px -36px rgba(0,0,0,.9); }
.core { border-radius:22px; padding:22px 24px 24px; background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02)),var(--field);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10), inset 0 1px 0 rgba(255,255,255,.14); }
.step { animation:rise 520ms var(--ease) both; }
.step:nth-child(2) { animation-delay:50ms; } .step:nth-child(3) { animation-delay:100ms; } .step:nth-child(4) { animation-delay:150ms; }
@keyframes rise { from { opacity:0; transform:translateY(10px); } }
.step-head { display:flex; align-items:flex-start; gap:14px; margin-bottom:18px; }
.num { width:30px; height:30px; flex-shrink:0; border-radius:50%; display:grid; place-items:center; font:600 13px var(--mono); color:var(--ink-3);
  box-shadow:inset 0 0 0 1px var(--line-2); transition:background-color 280ms var(--ease), color 280ms var(--ease), box-shadow 280ms var(--ease); }
.num .ico { display:none; }
.step-title { flex:1; min-width:0; }
.step-title h2 { margin:3px 0 2px; font-size:17px; font-weight:600; letter-spacing:-.015em; }
.step-title p { margin:0; font-size:13.5px; color:var(--ink-3); }
.tag { font:500 11.5px var(--sans); color:var(--ink-3); padding:3px 9px; border-radius:999px; box-shadow:inset 0 0 0 1px var(--line); white-space:nowrap; margin-top:4px; }
.fields { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); }
.field { display:flex; flex-direction:column; gap:7px; min-width:0; }
.field > label, legend { font-size:13px; font-weight:500; color:var(--ink-2); }
fieldset { border:0; margin:0; padding:0; min-width:0; }
fieldset + fieldset, .fields + fieldset { margin-top:20px; }
legend { padding:0; margin-bottom:10px; }
input[type=text], input[type=email] { width:100%; min-height:48px; padding:0 15px; border-radius:14px; border:0; outline:0; background:rgba(0,0,0,.28); color:var(--ink); font:15px var(--sans);
  box-shadow:inset 0 0 0 1px var(--line-2); transition:box-shadow 200ms var(--ease), background-color 200ms var(--ease); }
input[type=text]::placeholder, input[type=email]::placeholder { color:rgba(244,244,246,.46); }
input[type=text]:focus, input[type=email]:focus { box-shadow:inset 0 0 0 1px rgba(94,234,176,.55), 0 0 0 4px rgba(94,234,176,.12); background:rgba(0,0,0,.4); }
input[aria-invalid=true] { box-shadow:inset 0 0 0 1px rgba(249,139,139,.6); }
.err { margin:2px 0 0; font-size:13px; color:var(--danger); }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chip { position:relative; display:inline-flex; align-items:center; gap:8px; min-height:42px; padding:0 15px; border-radius:999px; cursor:pointer; font-size:14px; font-weight:500; color:var(--ink-2);
  background:rgba(255,255,255,.035); box-shadow:inset 0 0 0 1px var(--line-2); transition:transform 160ms var(--ease), color 200ms var(--ease), background-color 200ms var(--ease), box-shadow 200ms var(--ease); }
.chip .tick { width:0; opacity:0; transition:width 200ms var(--ease), opacity 200ms var(--ease); overflow:hidden; display:inline-flex; }
.chip:has(input:checked) { color:var(--accent-ink); background:var(--accent-bg); box-shadow:inset 0 0 0 1px rgba(94,234,176,.5); }
.chip:has(input:checked) .tick { width:14px; opacity:1; }
.chip:has(input:focus-visible), .card:has(input:focus-visible), .consent:has(input:focus-visible) { outline:2px solid var(--accent); outline-offset:3px; }
.chip:active, .card:active { transform:scale(.97); }
.cards { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr)); }
.card { position:relative; display:flex; flex-direction:column; gap:10px; padding:16px; border-radius:18px; cursor:pointer; background:rgba(255,255,255,.03);
  box-shadow:inset 0 0 0 1px var(--line-2); transition:transform 160ms var(--ease), background-color 220ms var(--ease), box-shadow 220ms var(--ease); }
.card .ic { width:38px; height:38px; border-radius:12px; display:grid; place-items:center; color:var(--ink-2); background:rgba(255,255,255,.05); box-shadow:inset 0 0 0 1px var(--line);
  transition:color 220ms var(--ease), background-color 220ms var(--ease); }
.card b { font-size:15px; font-weight:600; letter-spacing:-.01em; }
.card .d { font-size:13px; color:var(--ink-3); line-height:1.5; }
.card .n { margin-top:auto; font:500 12px var(--mono); color:var(--ink-3); }
.card .badge { position:absolute; top:14px; right:14px; width:22px; height:22px; border-radius:50%; display:grid; place-items:center; color:#04140f; background:var(--accent);
  opacity:0; transform:scale(.9); transition:opacity 200ms var(--ease), transform 200ms var(--ease); }
.card:has(input:checked) { background:linear-gradient(180deg,rgba(94,234,176,.12),rgba(94,234,176,.04)); box-shadow:inset 0 0 0 1px rgba(94,234,176,.55), 0 20px 40px -28px rgba(94,234,176,.45); }
.card:has(input:checked) .ic { color:#04140f; background:var(--accent); }
.card:has(input:checked) .badge { opacity:1; transform:none; }
.goal { flex-direction:row; align-items:center; gap:12px; padding:12px 14px; }
.goal .ic { width:32px; height:32px; border-radius:10px; }
.goal b { font-size:14px; font-weight:500; line-height:1.35; }
.goal .badge { position:static; margin-left:auto; flex-shrink:0; }
@media (hover:hover) and (pointer:fine) {
  .chip:hover { color:var(--ink); box-shadow:inset 0 0 0 1px rgba(255,255,255,.26); }
  .card:hover { background:rgba(255,255,255,.05); }
  .ghost:hover { color:var(--ink); background:rgba(255,255,255,.05); }
  .primary:hover .arrow { transform:translateX(2px); }
}
.aside .core { padding:22px; }
.aside h2 { display:flex; align-items:center; gap:10px; margin:0 0 4px; font-size:16px; font-weight:600; letter-spacing:-.01em; }
.aside h2 .ico { color:var(--accent); }
.aside .sub { margin:0 0 16px; font-size:13px; color:var(--ink-3); }
.total { display:none; gap:8px; flex-wrap:wrap; margin-bottom:18px; }
.total span { font:500 12px var(--mono); color:var(--accent-ink); padding:5px 10px; border-radius:999px; background:var(--accent-bg); box-shadow:inset 0 0 0 1px rgba(94,234,176,.2); }
.group { padding:14px 0 0; margin-top:14px; border-top:1px solid var(--line); transition:opacity 280ms var(--ease); }
.group:first-of-type { border-top:0; margin-top:0; padding-top:0; }
.group h3 { margin:0 0 10px; display:flex; align-items:center; justify-content:space-between; gap:10px; font:600 11px var(--sans); letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); }
.group h3 em { font-style:normal; letter-spacing:0; text-transform:none; font-weight:500; color:var(--ink-3); display:none; }
.group ul { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.group li { display:flex; align-items:center; gap:10px; font-size:13.5px; color:var(--ink-2); min-width:0; }
.group li .ico { color:var(--ink-3); }
.group li .k { margin-left:auto; font:500 11px var(--mono); color:var(--ink-3); }
.counts { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.counts span { display:inline-flex; align-items:center; gap:6px; padding:4px 9px; border-radius:999px; font-size:12px; color:var(--ink-3); background:rgba(255,255,255,.035); box-shadow:inset 0 0 0 1px var(--line); }
@media (min-width:1041px) { .aside .core { max-height:calc(100vh - 48px); overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; } }
.note { margin:18px 0 0; padding-top:14px; border-top:1px solid var(--line); font-size:12.5px; color:var(--ink-3); display:flex; gap:8px; }
.note .ico { color:var(--accent); margin-top:2px; }
.welcome:has(input[name=kit][value=engineering]:checked) .t-engineering, .welcome:has(input[name=kit][value=operations]:checked) .t-operations, .welcome:has(input[name=kit][value=both]:checked) .t-both { display:flex; }
.welcome:has(input[name=kit][value=engineering]:checked) .g-operations :is(ul, .counts), .welcome:has(input[name=kit][value=operations]:checked) .g-engineering :is(ul, .counts) { opacity:.34; }
.welcome:has(input[name=kit][value=engineering]:checked) .g-operations h3 em, .welcome:has(input[name=kit][value=operations]:checked) .g-engineering h3 em { display:inline; }
.finish .core { display:flex; flex-wrap:wrap; align-items:center; gap:16px 22px; padding:18px 18px 18px 22px; }
.consent { display:flex; align-items:center; gap:12px; cursor:pointer; font-size:14px; color:var(--ink-2); flex:1 1 260px; border-radius:10px; }
.box { width:22px; height:22px; flex-shrink:0; border-radius:7px; display:grid; place-items:center; color:transparent; box-shadow:inset 0 0 0 1px var(--line-2); transition:background-color 200ms var(--ease), color 200ms var(--ease); }
.consent:has(input:checked) .box { background:var(--accent); color:#04140f; box-shadow:none; }
.primary { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:14px; min-height:52px; padding:0 8px 0 24px; border-radius:999px; font-weight:600; font-size:15px;
  color:#04140f; background:linear-gradient(180deg,#8ff2c9,#5eeab0); box-shadow:0 1px 0 rgba(255,255,255,.5) inset, 0 18px 40px -18px rgba(94,234,176,.7); transition:transform 160ms var(--ease), box-shadow 220ms var(--ease); }
.primary:active { transform:scale(.97); }
.primary .arrow { width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:rgba(4,20,15,.12); transition:transform 220ms var(--ease); }
.fine { width:100%; margin:0; font-size:12.5px; color:var(--ink-3); }
.danger { max-width:1200px; margin:0 auto; padding:0 28px 72px; }
@media (max-width:560px) { .danger { padding:0 16px 56px; } }
.danger-row { margin-top:18px; display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; font-size:12.5px; color:var(--ink-3); }
@media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
`;

const DONE = (step: number): string =>
  `.welcome:has(${CONDITIONS[step - 1]}) .s${step} .num { background:var(--accent); color:#04140f; box-shadow:0 0 16px rgba(94,234,176,.35); }
.welcome:has(${CONDITIONS[step - 1]}) .s${step} .num b { display:none; } .welcome:has(${CONDITIONS[step - 1]}) .s${step} .num .ico { display:block; }
.welcome:has(${CONDITIONS[step - 1]}) .rail span:nth-child(${step}) { background:var(--accent); box-shadow:0 0 10px rgba(94,234,176,.45); }`;

const CONDITIONS = [
  "#name:valid):has(#email:valid",
  "#company:valid):has(input[name=role]:checked):has(input[name=teamSize]:checked",
  "input[name=goals]:checked, input[name=agents]:checked",
  "input[name=kit]:checked",
];

export function renderWelcome(opts: { login: string; values: WelcomeInput; errors: WelcomeProblems; editing: boolean; privacyUrl: string; failure?: string }): string {
  const { values: v, errors: e } = opts;
  const kit = kitSummary();
  const first = v.name.split(/\s+/)[0] ?? "";
  const described = (k: keyof WelcomeProblems) => (e[k] ? ` aria-invalid="true" aria-describedby="${k}-error"` : "");
  const err = (k: keyof WelcomeProblems) => (e[k] ? `<p class="err" id="${k}-error">${escapeHtml(e[k] as string)}</p>` : "");
  const input = (id: "name" | "email" | "company", label: string, type: string, extra: string) =>
    `<div class="field"><label for="${id}">${label}</label><input type="${type}" id="${id}" name="${id}" value="${escapeHtml(v[id])}" required${extra}${described(id)}>${err(id)}</div>`;
  const tick = `<span class="tick">${icon("Check", 14)}</span>`;
  const chips = (name: "role" | "teamSize" | "agents", type: "radio" | "checkbox", choices: Record<string, string>, chosen: string[]) =>
    `<div class="chips">${Object.entries(choices)
      .map(([value, label]) => `<label class="chip"><input class="sr" type="${type}" name="${name}" value="${value}"${chosen.includes(value) ? " checked" : ""}${type === "radio" ? " required" : ""}>${tick}${escapeHtml(label)}</label>`)
      .join("")}</div>`;
  const step = (n: number, title: string, sub: string, tag: string, body: string) =>
    `<section class="step s${n} bezel" aria-labelledby="s${n}-t"><div class="core"><div class="step-head"><span class="num" aria-hidden="true"><b>${n}</b>${icon("Check", 15)}</span><div class="step-title"><h2 id="s${n}-t">${title}</h2><p>${sub}</p></div><span class="tag">${tag}</span></div>${body}</div></section>`;
  const goals = `<div class="cards">${Object.entries(GOALS)
    .map(
      ([value, label]) =>
        `<label class="card goal"><input class="sr" type="checkbox" name="goals" value="${value}"${v.goals.includes(value) ? " checked" : ""}><span class="ic">${icon(GOAL_ICON[value as keyof typeof GOALS])}</span><b>${escapeHtml(label)}</b><span class="badge">${icon("Check", 13)}</span></label>`,
    )
    .join("")}</div>`;
  const kits = `<div class="cards">${Object.entries(KITS)
    .map(([value, k]) => {
      const t = kit.totals[value as keyof typeof KITS];
      return `<label class="card"><input class="sr" type="radio" name="kit" value="${value}"${v.kit === value ? " checked" : ""} required><span class="ic">${icon(KIT_ICON[value as keyof typeof KITS], 20)}</span><b>${escapeHtml(k.label)}</b><span class="d">${escapeHtml(k.detail)}</span><span class="n">${t.skills} skills · ${t.agents} agents</span><span class="badge">${icon("Check", 13)}</span></label>`;
    })
    .join("")}</div>`;
  const KIND_ICON: Record<string, IconName> = { rule: "Scales", role: "User", process: "Path", lesson: "Lightning", record: "FileText", project: "Target", skill: "Wrench" };
  const li = (ic: IconName, text: string, kind?: string) => `<li>${icon(ic, 16)}<span>${escapeHtml(text)}</span>${kind ? `<span class="k">${kind}</span>` : ""}</li>`;
  const counted = (items: Array<{ kind: string }>) => {
    const n = new Map<string, number>();
    for (const i of items) n.set(i.kind, (n.get(i.kind) ?? 0) + 1);
    return `<div class="counts">${[...n].map(([k, c]) => `<span>${icon(KIND_ICON[k] ?? "FileText", 13)}${c} ${c === 1 ? k : `${k}s`}</span>`).join("")}</div>`;
  };
  const packGroup = (p: "engineering" | "operations", label: string) =>
    `<div class="group g-${p}"><h3>${label}<em>Not in this kit</em></h3><ul>${[
      ...kit.packs[p].agents.map((a) => li("Robot", `${a} agent`, "agent")),
      ...kit.packs[p].skills.map((s) => li("Wrench", s, "skill")),
    ].join("")}</ul>${counted(kit.packs[p].others)}</div>`;
  const totals = (["engineering", "operations", "both"] as const)
    .map((k) => `<div class="total t-${k}"><span>${kit.totals[k].entries} entries</span><span>${kit.totals[k].agents} starter agents</span><span>${kit.documents.length} documents</span></div>`)
    .join("");
  const aside = `<aside class="aside bezel" aria-label="What your brain will start with"><div class="core">
<h2>${icon("Brain", 20)}${opts.editing ? "Your starter kit" : "Your brain will start with"}</h2><p class="sub">${opts.editing ? "Switching kit adds only the new pack. Nothing you deleted comes back." : "Written in the moment you finish, and yours to edit or delete."}</p>${totals}
<div class="group"><h3>In every kit</h3><ul>${kit.documents.map((d) => li("FileText", d, "document")).join("")}${li("Wrench", kit.harness, "skill")}${kit.memories.map((m) => li("Brain", m, "memory")).join("")}</ul>${counted(kit.core)}</div>
${packGroup("engineering", "Engineering pack")}${packGroup("operations", "Operations pack")}
<p class="note">${icon("Sparkle", 15)}<span>Your first question on Home is answered from these, with every source cited.</span></p></div></aside>`;
  const failure = opts.failure
    ? `<div class="alert" role="alert">${escapeHtml(opts.failure)}</div>`
    : Object.keys(e).length
      ? `<div class="alert" role="alert"><b>Check the highlighted fields.</b> ${Object.values(e).map((m) => escapeHtml(m as string)).join(" ")}</div>`
      : "";
  const heading = opts.editing ? `Your profile<span>Change anything, any time.</span>` : `${first ? `Welcome, ${escapeHtml(first)}.` : "Welcome."}<span>Let's set up your brain.</span>`;
  const lede = opts.editing
    ? "Choosing another kit adds its pack. Nothing you or your agents wrote is changed or brought back."
    : "Four short steps, about two minutes. We use your answers to fill Company Brain with skills, rules and agents that fit your team, so it is useful from the first question instead of empty.";
  const nav = opts.editing
    ? `<a class="ghost" href="/app">Open the app ${icon("ArrowRight", 14)}</a><form method="post" action="/auth/logout"><button class="ghost" type="submit">${icon("SignOut", 15)}Sign out</button></form>`
    : `<form method="post" action="/auth/logout"><button class="ghost" type="submit">${icon("SignOut", 15)}Sign out</button></form>`;
  const body = `<form method="post" action="/welcome" class="welcome" novalidate>
<div class="head"><span class="eyebrow">${opts.editing ? "Profile" : "Set up"}</span><h1>${heading}</h1><p class="lede">${lede}</p>
<div class="rail" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p class="rail-label">Steps fill in as you go.</p>${failure}</div>
<div class="steps">
${step(1, "About you", "So your agents know who they are working with.", "Required", `<div class="fields">${input("name", "Your name", "text", ` maxlength="80" autocomplete="name" placeholder="Ada Lovelace"`)}${input("email", "Work email", "email", ` maxlength="200" autocomplete="email" inputmode="email" pattern="[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}" placeholder="you@company.com"`)}</div>`)}
${step(
  2,
  "Your team",
  "Company Brain belongs to a team, even a team of one.",
  "Required",
  `<div class="fields">${input("company", "Company or team", "text", ` maxlength="100" autocomplete="organization" placeholder="Acme"`)}</div>
<fieldset role="radiogroup" aria-required="true"${described("role")}><legend>Your role</legend>${chips("role", "radio", ROLES, [v.role])}${err("role")}</fieldset>
<fieldset role="radiogroup" aria-required="true"${described("teamSize")}><legend>Team size</legend>${chips("teamSize", "radio", TEAM_SIZES, [v.teamSize])}${err("teamSize")}</fieldset>`,
)}
${step(3, "How you will use it", "Shapes what Home suggests first.", "Optional", `<fieldset><legend>What do you want it for?</legend>${goals}</fieldset><fieldset><legend>Which AI agents do you use?</legend>${chips("agents", "checkbox", AGENT_CHOICES, v.agents)}</fieldset>`)}
${step(4, "Your starter kit", "Ready-made skills, rules, processes and agents. The preview shows exactly what each one adds.", "Required", `<fieldset role="radiogroup" aria-required="true"${described("kit")}><legend class="sr">Starter kit</legend>${kits}${err("kit")}</fieldset>`)}
</div>
${aside}
<div class="finish bezel"><div class="core">
<label class="consent"><input class="sr" type="checkbox" name="updates" value="yes"${v.updates ? " checked" : ""}><span class="box">${icon("Check", 14)}</span>Email me occasional product updates.</label>
<button class="primary" type="submit">${opts.editing ? "Save profile" : "Set up my brain"}<span class="arrow">${icon("ArrowRight", 18)}</span></button>
<p class="fine">Signed in with GitHub as ${escapeHtml(opts.login)}. We keep these details with your account and never share them. <a href="${escapeHtml(opts.privacyUrl)}">Privacy</a></p>
</div></div>
</form>`;
  const danger = opts.editing
    ? ""
    : `<div class="danger"><div class="danger-row"><form method="post" action="/tokens/revoke-all" style="margin:0"><button class="ghost danger" type="submit">Revoke all tokens and sign out</button></form><span>Revoking deletes every agent token and the stored GitHub authorization. It cannot be undone.</span></div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.editing ? "Your profile" : "Welcome to Company Brain"}</title><link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@500&display=swap">
<style>${STYLE}${[1, 2, 3, 4].map(DONE).join("\n")}</style></head>
<body><a class="skip" href="#main">Skip to the form</a><header class="bar"><a class="brand" href="/">${MARK}<span>Company Brain</span></a><span class="who">${escapeHtml(opts.login)}</span>${nav}</header>
<main id="main" tabindex="-1">${body}${danger}</main></body></html>`;
}
