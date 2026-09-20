import { html, render, type TemplateResult } from "lit";
import { House, Inbox } from "lucide";
import { replacePanePreservingFocus } from "./shell";
import { appState } from "./shell-state";
import { emptyState, icon } from "./ui";

export function homeHeaderTpl(user: string): TemplateResult {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = (user.split("@")[0] ?? user).split(/[.\-_]/)[0] ?? user;
  return html`
    <div class="home-head">
      <span class="home-eyebrow">${icon(House, 15)}<span>Home</span></span>
      <h1 class="home-title">Good ${part}, ${name}</h1>
    </div>
  `;
}

export function homeTpl(opts: { user: string; needs: TemplateResult[] }): TemplateResult {
  return html`
    <div class="home">
      ${homeHeaderTpl(opts.user)}
      <section class="home-section" aria-label="Needs you">
        <h2 class="home-section-title">Needs you</h2>
        ${
          opts.needs.length
            ? html`<div class="home-needs">${opts.needs}</div>`
            : emptyState({
                glyph: Inbox,
                headline: "Nothing needs you",
                body: "Approvals, broken connections and failing automations show up here.",
              })
        }
      </section>
    </div>
  `;
}

export function renderHome(): void {
  if (!appState.mainEl) return;
  const host = document.createElement("div");
  host.className = "pane home-pane";
  render(homeTpl({ user: appState.me?.user ?? "", needs: [] }), host);
  replacePanePreservingFocus(host);
}
