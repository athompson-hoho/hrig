import { CHECKING_SNAPSHOT } from "./inventory-health";

export type ConnectionState = "connecting" | "checking" | "stale" | "unavailable" | "local" | "connected" | "ready";
export interface ConnectionStatus {
  state: ConnectionState;
  /** Short label for the workspace header. */
  label: string;
  /** Header dot: "unknown" while connecting or not yet known, otherwise "running". */
  dot: "running" | "unknown";
  /** True when the header should use the error tone. */
  error: boolean;
  /** Which explanatory banner the session list shows, if any. */
  banner: "refreshing" | "stale" | "unavailable" | null;
}

/**
 * The one place that decides how the connection is described, so the header
 * label, its dot and the sidebar banners can never disagree.
 */
export function connectionStatus(input: {
  error: string;
  hasInventory: boolean;
  busy: boolean;
  local: boolean;
}): ConnectionStatus {
  const { error, hasInventory, busy, local } = input;
  const checking = error === CHECKING_SNAPSHOT;
  const failed = !!error && !checking;
  const dot: ConnectionStatus["dot"] = busy && !hasInventory ? "unknown" : local || hasInventory ? "running" : "unknown";
  const banner = checking && hasInventory ? "refreshing" : failed && hasInventory ? "stale" : failed ? "unavailable" : null;
  const base = { dot, error: failed, banner } as const;
  if (busy && !hasInventory) return { ...base, state: "connecting", label: "Connecting" };
  if (failed) return { ...base, state: hasInventory ? "stale" : "unavailable", label: "Unavailable" };
  if (checking) return { ...base, state: "checking", label: local ? "Local" : hasInventory ? "Connected" : "Ready" };
  if (local) return { ...base, state: "local", label: "Local" };
  return hasInventory ? { ...base, state: "connected", label: "Connected" } : { ...base, state: "ready", label: "Ready" };
}
