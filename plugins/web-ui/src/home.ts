import { render } from "lit";
import { newChat } from "./chat";
import { api } from "./core-bridge";
import { errMessage } from "../../chassis/src/errors";
import { newChatDraftKey, saveDraft } from "./drafts";
import { homeTpl, type HomeFeature, type HomeSummary } from "./home-view.ts";
import { NAV, renderSidebarTop, replacePanePreservingFocus, switchView } from "./shell";
import { appState, isView, type View } from "./shell-state";

const BLURB: Record<string, string> = {
  chats: "Ask anything, in your own words, and approve what it wants to do.",
  contexts: "Give a piece of work its own place: its chats, files and people.",
  files: "What you and the agent have made or uploaded.",
  skills: "The jobs the agent knows how to do the same way every time.",
  crons: "Work that happens on a schedule, without you asking.",
  deploys: "Small apps the agent has built and deployed for you.",
  keychain: "The accounts the agent may use, and exactly what it may do with them.",
  memory: "The facts the agent carries into every conversation.",
};

let summary: HomeSummary | null = null;
let loadError = "";
let loading = false;
let draft = "";

export function resetHomeState(): void {
  summary = null;
  appState.viewCounts = {};
  loadError = "";
  loading = false;
  draft = "";
}

function open(view: string): void {
  if (isView(view)) switchView(view as View);
}

function ask(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  draft = "";
  saveDraft(newChatDraftKey(appState.me?.user), trimmed);
  newChat();
}

function features(): HomeFeature[] {
  return NAV.filter((row) => row.view !== "home" && BLURB[row.view]).map((row) => {
    const count = appState.viewCounts[row.view];
    return {
      view: row.view,
      label: row.label,
      glyph: row.glyph,
      blurb: BLURB[row.view] as string,
      ...(count ? { count } : {}),
    };
  });
}

function draw(): void {
  if (!appState.mainEl || appState.currentView !== "home") return;
  const host = document.createElement("div");
  host.className = "pane home-pane";
  render(
    homeTpl({
      user: appState.me?.user ?? "",
      data: summary,
      error: loadError,
      loading,
      draft,
      features: features(),
      onOpen: open,
      onAsk: ask,
      onDraft: (text) => {
        const wasEmpty = !draft.trim();
        draft = text;
        if (wasEmpty !== !draft.trim()) draw();
      },
    }),
    host,
  );
  replacePanePreservingFocus(host);
}

export async function renderHome(): Promise<void> {
  loading = true;
  loadError = "";
  draw();
  try {
    summary = await api<HomeSummary>("/api/home");
    appState.viewCounts = (summary.counts ?? {}) as Partial<Record<View, number>>;
    renderSidebarTop();
  } catch (err) {
    loadError = errMessage(err, "Home could not load what needs you. Try again shortly.");
  } finally {
    loading = false;
  }
  draw();
}
