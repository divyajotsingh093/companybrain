interface Surface {
  bg: string;
  text: string;
  accent: string;
  border: string;
}

import { injectCss } from "./shared";

export function injectGlobalStyles(pal: Surface): void {
  injectCss(
    "companybrain-surfaces",
    `
    html, body { background: ${pal.bg}; }
    body { margin: 0; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    ::selection { background: ${pal.accent}33; color: ${pal.text}; }
    :focus-visible { outline: 2px solid ${pal.accent}; outline-offset: 2px; border-radius: 6px; }
    :focus:not(:focus-visible) { outline: none; }
    input, textarea { caret-color: ${pal.accent}; }
    * { scrollbar-color: ${pal.border} transparent; scrollbar-width: thin; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: ${pal.border}; border-radius: 999px; border: 3px solid ${pal.bg}; }
    ::-webkit-scrollbar-thumb:hover { background: ${pal.accent}; }
    time, [data-numeric] { font-variant-numeric: tabular-nums; }
    @keyframes cb-screen-in { from { opacity: 0; transform: translateY(8px); filter: blur(3px); } }
    [data-screen] { animation: cb-screen-in 360ms cubic-bezier(0.32, 0.72, 0, 1) both; }
    @media (prefers-reduced-motion: reduce) {
      [data-screen] { animation: none; }
    }
  `,
  );
}
