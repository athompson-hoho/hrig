export interface SeatActivityAge {
  available: boolean;
  /** Compact text for the row ("4 min"); empty when unavailable. */
  text: string;
  /** Accessible/visible label. */
  label: string;
  /** Tooltip sentence explaining scope. */
  tooltip: string;
}

const SCOPE =
  "Time since OpenRig last observed terminal output for this session (tmux window activity). It is not how long the seat has been in its current status, and it reflects the last inventory snapshot.";

function unavailable(reason: string): SeatActivityAge {
  return {
    available: false,
    text: "",
    label: `Last terminal activity unavailable (${reason})`,
    tooltip: `Last terminal activity unavailable: ${reason}. ${SCOPE}`,
  };
}

/**
 * Age of the raw OpenRig lastActivityAt fact against a reader clock.
 * Floors to s/min/h/days. Missing, invalid, future, or non-current inventory
 * yields an explicit unavailable state, never "just now".
 */
export function seatActivityAge(
  lastActivityAt: unknown,
  nowMs: number,
  current: boolean,
): SeatActivityAge {
  if (!current) return unavailable("inventory is stale or not current");
  if (typeof lastActivityAt !== "string" || !lastActivityAt)
    return unavailable("not reported by this host");
  const at = Date.parse(lastActivityAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs))
    return unavailable("invalid timestamp or clock");
  const ms = nowMs - at;
  if (ms < 0) return unavailable("timestamp is ahead of this computer's clock");
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const text =
    s < 60 ? `${s} s` : m < 60 ? `${m} min` : h < 24 ? `${h} h` : `${d} day${d === 1 ? "" : "s"}`;
  return {
    available: true,
    text,
    label: `Last terminal activity ${text} ago`,
    tooltip: `Last terminal activity ${text} ago. ${SCOPE}`,
  };
}
