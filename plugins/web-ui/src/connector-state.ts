import type { Tone } from "./ui.ts";

export interface ConnectorHealth {
  connected?: boolean;
  needsReconnect?: boolean;
  available?: boolean;
}

export interface ConnectorState {
  label: string;
  tone: Tone;
  action: string | null;
  detail: string;
}

export function connectorState(provider: ConnectorHealth): ConnectorState {
  if (provider.needsReconnect) {
    return {
      label: "Needs re-authorising",
      tone: "warn",
      action: "Re-authorise",
      detail: "Anything that uses it is paused until you re-authorise. The connection keeps its access.",
    };
  }
  if (provider.connected) {
    return { label: "Connected", tone: "ok", action: null, detail: "" };
  }
  if (provider.available) {
    return { label: "Not connected", tone: "neutral", action: "Connect account", detail: "" };
  }
  return { label: "Unavailable", tone: "neutral", action: null, detail: "This instance has no credentials for it yet." };
}
