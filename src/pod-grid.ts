import type { Seat } from "./types";

export const POD_GRID_LIMIT = 12;

export interface PodGridPlan {
  /** Seats to open (have an attachable session), capped at the limit. */
  seats: Seat[];
  /** Seats skipped because they have no session. */
  noSession: number;
  /** Seats skipped because of the cap. */
  overLimit: number;
  /** Why nothing can be opened, or "" when the plan is usable. */
  blocked: string;
}

/** Which of a pod's seats open as a grid. Opening only attaches terminals; nothing is sent. */
export function planPodGrid(
  podSeats: readonly Seat[],
  current: boolean,
  limit = POD_GRID_LIMIT,
): PodGridPlan {
  if (!current)
    return { seats: [], noSession: 0, overLimit: 0, blocked: "Refresh the connection before opening a stale pod." };
  const withSession = podSeats.filter((s) => !!s.session);
  const noSession = podSeats.length - withSession.length;
  if (!withSession.length)
    return { seats: [], noSession, overLimit: 0, blocked: "No session in this pod has an attachable terminal." };
  return {
    seats: withSession.slice(0, limit),
    noSession,
    overLimit: Math.max(0, withSession.length - limit),
    blocked: "",
  };
}

export function describePodGrid(plan: PodGridPlan): string {
  if (plan.blocked) return plan.blocked;
  const parts = [`Opened ${plan.seats.length} ${plan.seats.length === 1 ? "session" : "sessions"} as a grid`];
  if (plan.noSession) parts.push(`${plan.noSession} without a terminal skipped`);
  if (plan.overLimit) parts.push(`${plan.overLimit} over the ${POD_GRID_LIMIT}-session limit not opened`);
  return parts.join("; ") + ". Undo restores the previous layout.";
}
