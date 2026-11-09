export interface SeatWorkSummary {
  /** True only when OpenRig reported an assigned-work count for a current snapshot. */
  available: boolean;
  /** Confirmed assigned count when available, else null. */
  count: number | null;
  /** Compact badge text; empty for confirmed zero and for unavailable. */
  badge: string;
  label: string;
  tooltip: string;
}

const NOTE =
  "Counts active queue items assigned to this session (pending, in progress, or blocked), from the last inventory snapshot. It says nothing about whether the session is working.";

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Owed-work summary that keeps "not reported / stale" distinct from a confirmed zero. */
export function seatWorkSummary(
  assigned: unknown,
  pending: unknown,
  current: boolean,
): SeatWorkSummary {
  if (!current)
    return {
      available: false, count: null, badge: "",
      label: "Owed work unavailable (inventory is stale or not current)",
      tooltip: `Owed work unavailable: inventory is stale or not current. ${NOTE}`,
    };
  if (!isCount(assigned))
    return {
      available: false, count: null, badge: "",
      label: "Owed work unavailable (not reported by this host)",
      tooltip: `Owed work unavailable: not reported by this host. ${NOTE}`,
    };
  if (assigned === 0)
    return {
      available: true, count: 0, badge: "",
      label: "No owed work reported",
      tooltip: `No owed work reported for this session. ${NOTE}`,
    };
  const detail =
    isCount(pending) && pending <= assigned
      ? `${assigned} assigned (${pending} pending, ${assigned - pending} in progress or blocked)`
      : `${assigned} assigned`;
  return {
    available: true, count: assigned, badge: String(assigned),
    label: `Owed work: ${detail}`,
    tooltip: `Owed work: ${detail}. ${NOTE}`,
  };
}
