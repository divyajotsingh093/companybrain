import { useEffect, useState, type RefObject } from "react";

export const THEME = "dark" as const;

export const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

export const ERROR_COPY: Record<string, string> = {
  already_answered: "That was already answered somewhere else. Reloading it now.",
  busy: "An agent is already running. Wait for it to finish, then start the next one.",
  sign_in: "Your session expired. Reload to sign in again.",
  entry_quota: "You have reached the limit for this kind. Remove one first.",
  empty_name: "That name is empty once cleaned up. Try plain text.",
  too_long: "That is too long to store.",
  blocked: "That request did not come from this site.",
  not_found: "It was already removed.",
  bad_fields: "That question did not come through. Type it again.",
  bad_json: "That question did not come through. Type it again.",
  no_model: "Answering is not configured yet.",
  model_failed: "Could not reach the model, try again.",
  rate_limited: "Too many questions just now. Wait a moment and ask again.",
  daily_limit: "You have reached today's question limit.",
  no_access: "You do not have access to that repository.",
  too_large: "That is too large to send.",
  bad_url: "That server address cannot be used.",
  unreachable: "That server could not be reached.",
  too_many: "You have connected the most servers allowed. Remove one first.",
  unsupported_file: "Only text files can be added: .md, .mdx, .markdown, .txt, .rst or .adoc.",
  empty_file: "That file is empty, so there is nothing to answer from.",
  document_quota: "You have reached the limit for stored documents. Remove a file or a source first.",
  needs_note: "Say what needs to change before sending it back.",
  not_in_review: "That request is no longer waiting on your review. Reloading it now.",
};

export const CLIENT_LABEL: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  web: "Web",
  import: "Import",
};

export const clientName = (client: string): string => CLIENT_LABEL[client] ?? client.replace(/^oauth:(.*)$/, "$1 connector");

export function when(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const diff = ms - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const [n, unit] = mins < 60 ? [mins, "min"] : mins < 2880 ? [Math.round(mins / 60), "h"] : [Math.round(mins / 1440), "d"];
  if (mins < 1) return "just now";
  return diff > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export function reason(err: unknown): string {
  return err instanceof Error ? err.message : "The request failed";
}

const OFFLINE = "The request did not reach the server. Check your connection and try again.";

export async function get<T>(path: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { credentials: "same-origin" });
  } catch {
    throw new ApiError(OFFLINE, "network");
  }
  if (r.status === 401) {
    location.href = "/";
    throw new ApiError("sign in", "sign_in");
  }
  if (!r.ok) throw new ApiError("The server could not answer just now", "status");
  try {
    return (await r.json()) as T;
  } catch {
    throw new ApiError("The server sent something unreadable", "status");
  }
}

export async function send<T = unknown>(path: string, init: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(OFFLINE, "network");
  }
  const detail = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!r.ok) {
    const code = detail.error ?? "status";
    throw new ApiError(ERROR_COPY[code] ?? "The server could not answer just now.", code, typeof detail.message === "string" ? detail.message : undefined);
  }
  return detail;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return send<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function injectCss(id: string, css: string): void {
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.append(el);
}

export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setReduced(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
