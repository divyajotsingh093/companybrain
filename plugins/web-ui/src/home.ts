import { render } from "lit";
import { api } from "./core-bridge";
import { errMessage } from "../../chassis/src/errors";
import { homeTpl, type HomeSummary } from "./home-view.ts";
import { renderSidebarTop, replacePanePreservingFocus, switchView } from "./shell";
import { appState, isView, type View } from "./shell-state";

let summary: HomeSummary | null = null;
let loadError = "";
let loading = false;

export function resetHomeState(): void {
  summary = null;
  appState.viewCounts = {};
  loadError = "";
  loading = false;
}

function open(view: string): void {
  if (isView(view)) switchView(view as View);
}

function draw(): void {
  if (!appState.mainEl || appState.currentView !== "home") return;
  const host = document.createElement("div");
  host.className = "pane home-pane";
  render(homeTpl({ user: appState.me?.user ?? "", data: summary, error: loadError, loading, onOpen: open }), host);
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
