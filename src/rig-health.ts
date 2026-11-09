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
 * Working/idle/attention counts for the displayed seats. "working" counts the
 * same statuses the status filter does (working + running). Stopped, failed,
 * unknown and other statuses are reported as "other", never folded into idle.
 */
export function rigHealthSummary(
  seats: readonly Seat[] | null | undefined,
  scopeName: string,
  current: boolean,
): RigHealth {
  if (!seats)
    return {
      available: false, current: false, working: 0, idle: 0, attention: 0, other: 0, total: 0,
      text: "Health unavailable",
      detail: `${scopeName} health unavailable: no inventory is represented for this connection.`,
    };
  let working = 0, idle = 0, attention = 0, other = 0;
  for (const s of seats) {
    if (s.status === "working" || s.status === "running") working++;
    else if (s.status === "idle") idle++;
    else if (s.status === "attention") attention++;
    else other++;
  }
  const total = seats.length;
  const parts = [`${working} working`, `${idle} idle`, `${attention} attention`];
  const stale = current ? "" : " · stale";
  const detail =
    `${scopeName}: ${total} ${total === 1 ? "session" : "sessions"}: ${parts.join(", ")}` +
    (other ? `, ${other} other (stopped, failed or unknown)` : "") +
    (current
      ? ". Counts come from the last inventory snapshot."
      : ". Inventory is stale or not verified, so these are last known counts.");
  return {
    available: true, current, working, idle, attention, other, total,
    text: total === 0 ? `No sessions${stale}` : parts.join(" · ") + stale,
    detail,
  };
}
