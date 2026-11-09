import type { Seat } from "./types";

export interface RigHealth {
  /** Counts exist (a snapshot is represented), not necessarily current. */
  available: boolean;
  current: boolean;
  working: number;
  idle: number;
  attention: number;
  other: number;
  total: number;
  text: string;
  detail: string;
}

/**
 * Working/idle/attention counts for the displayed seats. Only seats whose
 * activity is known to be working count as working. A session that is running
 * with unknown activity, and stopped/failed/unknown seats, are reported as
 * "other" (never folded into working or idle).
 */
export function rigHealthSummary(
  seats: readonly Seat[] | null | undefined,
  scopeName: string,
  current: boolean,
  missingRig = false,
): RigHealth {
  if (missingRig)
    return {
      available: false, current, working: 0, idle: 0, attention: 0, other: 0, total: 0,
      text: "Rig not found",
      detail: `${scopeName} is not in the represented inventory (removed or renamed?). Choose another rig in the sidebar.`,
    };
  if (!seats)
    return {
      available: false, current: false, working: 0, idle: 0, attention: 0, other: 0, total: 0,
      text: "Health unavailable",
      detail: `${scopeName} health unavailable: no inventory is represented for this connection.`,
    };
  let working = 0, idle = 0, attention = 0, other = 0;
  for (const s of seats) {
    if (s.status === "working") working++;
    else if (s.status === "idle") idle++;
    else if (s.status === "attention") attention++;
    else other++;
  }
  const total = seats.length;
  const parts = [`${working} working`, `${idle} idle`, `${attention} attention`];
  const stale = current ? "" : " · stale";
  const detail =
    `${scopeName}: ${total} ${total === 1 ? "session" : "sessions"}: ${parts.join(", ")}` +
    (other ? `, ${other} other (running with unknown activity, stopped, failed or unknown)` : "") +
    (current
      ? ". Counts come from the last inventory snapshot."
      : ". Inventory is stale or not verified, so these are last known counts.");
  return {
    available: true, current, working, idle, attention, other, total,
    text:
      total === 0
        ? `No sessions${stale}`
        : parts.concat(other ? [`${other} other`] : []).join(" · ") + stale,
    detail,
  };
}
