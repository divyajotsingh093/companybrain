import { html, nothing, type TemplateResult } from "lit";
import { AlertTriangle, ArrowRight, Check, Inbox, type IconNode } from "lucide";
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
  counts?: Record<string, number>;
}

export interface HomeFeature {
  view: string;
  label: string;
  glyph: IconNode;
  blurb: string;
  count?: number;
}

export interface HomeTplOpts {
  user: string;
  accent: string;
  stats: Array<{ label: string; value: number }>;
  data: HomeSummary | null;
  error: string;
  loading: boolean;
  draft: string;
  features: HomeFeature[];
  onOpen: (view: string) => void;
  onAsk: (text: string) => void;
  onDraft: (text: string) => void;
}

const ITEM_LABEL: Record<HomeItem["type"], { label: string; tone: "accent" | "warn" }> = {
  approval_pending: { label: "approval", tone: "accent" },
  connector_broken: { label: "connection", tone: "warn" },
};

const ITEM_ACTION: Record<HomeItem["type"], string> = {
  approval_pending: "Open the conversation",
  connector_broken: "Re-authorise",
};

export const SUGGESTIONS = [
  "Summarise where each open deal stands",
  "What changed in my accounts this week?",
  "Draft a follow-up to the last customer who emailed me",
  "Every Monday at 9, send me a pipeline digest",
];

export interface JourneyStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  view: string;
}

export function journey(data: HomeSummary): JourneyStep[] {
  const counts = data.counts ?? {};
  const setup = (id: string): boolean => data.setup.find((s) => s.id === id)?.done ?? false;
  return [
    {
      id: "connect",
      label: "Connect a source",
      detail: "Mail, calendar, files or a CRM. The agent reads only what you can read.",
      done: setup("connector"),
      view: "keychain",
    },
    { id: "ask", label: "Ask a question", detail: "Anything about the work you already do.", done: data.asked, view: "chats" },
    {
      id: "skill",
      label: "Save it as a skill",
      detail: "A skill does the same work the same way every time.",
      done: (counts.skills ?? 0) > 0,
      view: "skills",
    },
    {
      id: "automate",
      label: "Put it on a schedule",
      detail: "Then it happens without you asking.",
      done: (counts.crons ?? 0) > 0,
      view: "crons",
    },
  ];
}

function askTpl(o: HomeTplOpts): TemplateResult {
  const field = (e: Event): HTMLTextAreaElement =>
    (e.currentTarget as HTMLElement).closest("form")?.querySelector(".home-ask-input") as HTMLTextAreaElement;
  const send = (e: Event): void => {
    const text = (field(e)?.value ?? o.draft).trim();
    if (text) o.onAsk(text);
  };
  return html`
    <section class="home-hero" aria-label="Ask">
      <fluid-orb class="home-orb" size="104" color=${o.accent}></fluid-orb>
      <h1 class="home-ask-title">What do you want to do?</h1>
      <p class="home-ask-lede">
        Ask in your own words. The agent works from your own accounts, asks before it acts, and shows where each answer came
        from.
      </p>
      <form
        class="home-ask"
        @submit=${(e: Event) => {
          e.preventDefault();
          send(e);
        }}
      >
        <textarea
          class="home-ask-input"
          rows="1"
          placeholder="Ask anything, or describe the job you want done…"
          aria-label="Ask anything"
          .value=${o.draft}
          @input=${(e: Event) => o.onDraft((e.currentTarget as HTMLTextAreaElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(e);
            }
          }}
        ></textarea>
        <button class="btn primary home-ask-send" type="submit" ?disabled=${!o.draft.trim()}>
          Ask${icon(ArrowRight, 15)}
        </button>
      </form>
      <ul class="home-suggestions">
        ${SUGGESTIONS.map(
          (s) => html`<li><button class="home-suggestion" type="button" @click=${() => o.onAsk(s)}>${s}</button></li>`,
        )}
      </ul>
      ${
        o.stats.length
          ? html`<ul class="home-stats">
              ${o.stats.map((s) => html`<li><b>${s.value}</b><span>${s.label}</span></li>`)}
            </ul>`
          : nothing
      }
    </section>
  `;
}

function journeyTpl(steps: JourneyStep[], onOpen: (view: string) => void): TemplateResult | typeof nothing {
  const next = steps.findIndex((s) => !s.done);
  if (next === -1) return nothing;
  return html`
    <section class="home-section" aria-label="Getting started">
      <h2 class="home-section-title">
        Getting started <span class="home-progress">${steps.filter((s) => s.done).length} of ${steps.length}</span>
      </h2>
      <ol class="home-journey">
        ${steps.map(
          (step, i) => html`<li class="home-journey-step ${step.done ? "done" : i === next ? "next" : ""}">
            <span class="home-journey-mark">${step.done ? icon(Check, 13) : html`<span>${i + 1}</span>`}</span>
            <button class="home-journey-body" type="button" @click=${() => onOpen(step.view)}>
              <b>${step.label}</b>
              <span>${step.detail}</span>
            </button>
          </li>`,
        )}
      </ol>
    </section>
  `;
}

function itemTpl(item: HomeItem, onOpen: (view: string) => void): TemplateResult {
  const kind = ITEM_LABEL[item.type];
  return html`<button class="home-item" type="button" @click=${() => onOpen(item.view)}>
    <span class="home-item-main">
      <span class="home-item-head">
        ${chip(kind.label, kind.tone)}<span class="home-item-title">${item.title}</span>
        ${item.at ? html`<span class="home-item-time">${relTime(item.at)}</span>` : nothing}
      </span>
      <span class="home-item-detail">${item.detail}</span>
    </span>
    <span class="home-item-action">${ITEM_ACTION[item.type]}${icon(ArrowRight, 15)}</span>
  </button>`;
}

function needsTpl(o: HomeTplOpts): TemplateResult | typeof nothing {
  const needs = o.data?.needs ?? [];
  if (!o.data && !o.error) return nothing;
  if (o.data && !needs.length) return nothing;
  return html`
    <section class="home-section" aria-label="Needs you">
      <h2 class="home-section-title">
        Needs you ${needs.length ? html`<span class="home-count">${needs.length}</span>` : nothing}
      </h2>
      ${
        o.error && !o.data
          ? html`<div class="home-card home-error">${icon(AlertTriangle, 16)}<span>${o.error}</span></div>`
          : html`<div class="home-needs">${needs.map((item) => itemTpl(item, o.onOpen))}</div>`
      }
    </section>
  `;
}

function featuresTpl(features: HomeFeature[], onOpen: (view: string) => void): TemplateResult {
  return html`
    <section class="home-section" aria-label="Everything you can do">
      <h2 class="home-section-title">Everything you can do</h2>
      <div class="home-features">
        ${features.map(
          (f) => html`<button class="home-feature" type="button" @click=${() => onOpen(f.view)}>
            <span class="home-feature-icon">${icon(f.glyph, 17)}</span>
            <span class="home-feature-copy">
              <b>${f.label}${f.count ? html`<span class="home-feature-count">${f.count}</span>` : nothing}</b>
              <span class="home-feature-blurb">${f.blurb}</span>
            </span>
            <span class="home-feature-go">${icon(ArrowRight, 15)}</span>
          </button>`,
        )}
      </div>
    </section>
  `;
}

export function homeTpl(o: HomeTplOpts): TemplateResult {
  return html`
    <div class="home">
      ${askTpl(o)} ${o.data ? journeyTpl(journey(o.data), o.onOpen) : nothing} ${needsTpl(o)}
      ${featuresTpl(o.features, o.onOpen)}
      ${o.loading && !o.data ? html`<p class="home-foot">Loading what needs you…</p>` : nothing}
    </div>
  `;
}

export { emptyState as homeEmptyState };
