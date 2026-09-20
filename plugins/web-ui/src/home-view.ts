import { html, nothing, type TemplateResult } from "lit";
import { AlertTriangle, Check, House, Inbox, KeyRound, ShieldCheck, Sparkles } from "lucide";
import { chip, emptyState, icon, relTime } from "./ui.ts";

export interface HomeItem {
  id: string;
  type: "approval_pending" | "connector_broken";
  title: string;
  detail: string;
  view: string;
  href?: string;
  at?: number;
}

export interface HomeStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  view?: string;
}

export interface HomeSummary {
  needs: HomeItem[];
  setup: HomeStep[];
  asked: boolean;
}

export interface HomeTplOpts {
  user: string;
  data: HomeSummary | null;
  error: string;
  loading: boolean;
  onOpen: (view: string) => void;
}

const ITEM_LABEL: Record<HomeItem["type"], { label: string; tone: "accent" | "warn" }> = {
  approval_pending: { label: "approval", tone: "accent" },
  connector_broken: { label: "connection", tone: "warn" },
};

const ITEM_ACTION: Record<HomeItem["type"], string> = {
  approval_pending: "Open the conversation",
  connector_broken: "Re-authorise",
};

export const FIRST_QUESTIONS = [
  "What changed in my accounts this week?",
  "Summarise where each open deal stands.",
  "Draft a follow-up to the last customer who emailed me.",
];

export function greeting(user: string, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = (user.split("@")[0] ?? user).split(/[.\-_]/)[0] ?? user;
  return `Good ${part}, ${name}`;
}

function itemTpl(item: HomeItem, onOpen: (view: string) => void): TemplateResult {
  const kind = ITEM_LABEL[item.type];
  return html`<article class="home-item">
    <div class="home-item-main">
      <div class="home-item-head">
        ${chip(kind.label, kind.tone)}<h3>${item.title}</h3>
        ${item.at ? html`<span class="home-item-time">${relTime(item.at)}</span>` : nothing}
      </div>
      <p>${item.detail}</p>
    </div>
    <button class="btn" type="button" @click=${() => onOpen(item.view)}>${ITEM_ACTION[item.type]}</button>
  </article>`;
}

function checklistTpl(steps: HomeStep[], onOpen: (view: string) => void): TemplateResult | typeof nothing {
  const remaining = steps.filter((step) => !step.done);
  if (!remaining.length) return nothing;
  return html`<section class="home-section" aria-label="Finish setting up">
    <h2 class="home-section-title">Finish setting up</h2>
    <div class="home-card">
      <p class="home-card-lede">
        ${steps.length - remaining.length} of ${steps.length} done. The agent works better with each one.
      </p>
      <ol class="home-steps">
        ${steps.map(
          (step) => html`<li class=${step.done ? "done" : ""}>
            <span class="home-step-mark">${step.done ? icon(Check, 14) : nothing}</span>
            <div>
              <b>${step.label}</b>
              <p>${step.detail}</p>
            </div>
            ${
              step.done || !step.view
                ? nothing
                : html`<button class="btn" type="button" @click=${() => onOpen(step.view as string)}>Open</button>`
            }
          </li>`,
        )}
      </ol>
    </div>
  </section>`;
}

function welcomeTpl(onOpen: (view: string) => void): TemplateResult {
  return html`<section class="home-section" aria-label="Welcome">
    <div class="home-card home-welcome">
      <span class="home-welcome-icon">${icon(Sparkles, 20)}</span>
      <h2>Ask your first question</h2>
      <p>
        The agent reads only what your own accounts can already reach, and asks before it acts. Start with one of these, or
        anything else.
      </p>
      <ul class="home-prompts">
        ${FIRST_QUESTIONS.map(
          (q) => html`<li><button class="btn" type="button" @click=${() => onOpen("chats")}>${q}</button></li>`,
        )}
      </ul>
      <p class="home-welcome-foot">
        ${icon(ShieldCheck, 15)}<span>Nothing is shared with your team unless you post it.</span>
      </p>
    </div>
  </section>`;
}

export function homeTpl(o: HomeTplOpts): TemplateResult {
  const needs = o.data?.needs ?? [];
  return html`
    <div class="home">
      <div class="home-head">
        <span class="home-eyebrow">${icon(House, 15)}<span>Home</span></span>
        <h1 class="home-title">${greeting(o.user)}</h1>
      </div>
      ${o.error ? html`<div class="home-card home-error">${icon(AlertTriangle, 16)}<span>${o.error}</span></div>` : nothing}
      ${o.data ? checklistTpl(o.data.setup, o.onOpen) : nothing}
      ${o.data && !o.data.asked ? welcomeTpl(o.onOpen) : nothing}
      <section class="home-section" aria-label="Needs you">
        <h2 class="home-section-title">
          Needs you ${needs.length ? html`<span class="home-count">${needs.length}</span>` : nothing}
        </h2>
        ${
          !o.data
            ? html`<p class="empty compact">${o.error ? "Not loaded." : "Loading…"}</p>`
            : needs.length
              ? html`<div class="home-needs">${needs.map((item) => itemTpl(item, o.onOpen))}</div>`
              : emptyState({
                  glyph: Inbox,
                  headline: "Nothing needs you",
                  body: "Approvals waiting on you and connections that stopped working show up here.",
                  action: { label: "Ask something", onClick: () => o.onOpen("chats") },
                })
        }
      </section>
      <p class="home-foot">
        ${icon(KeyRound, 14)}<span>Items clear themselves once the thing behind them is resolved.</span>
      </p>
    </div>
  `;
}
