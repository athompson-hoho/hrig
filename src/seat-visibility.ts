type SeatLike = { status?: unknown; rigId?: unknown };
type RigLike = { id?: unknown; status?: unknown };

/** A whole count: a finite positive number rounded down, anything else 0. */
function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** True when the seat has stopped or exited, the two statuses the terminal's seat activity also shows as Stopped. A failed seat or one that needs input is never stopped: those need eyes. Never throws. */
export function isStoppedSeat(seat: unknown): boolean {
  if (typeof seat !== "object" || seat === null) return false;
  const status = (seat as SeatLike).status;
  return status === "stopped" || status === "exited";
}

/** The ids of the rigs whose status says archived; only text ids and the exact status count. */
function archivedRigIds(rigs: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(rigs)) return ids;
  for (const rig of rigs) {
    if (typeof rig !== "object" || rig === null) continue;
    const { id, status } = rig as RigLike;
    if (typeof id === "string" && status === "archived") ids.add(id);
  }
  return ids;
}

/** A stopped seat, or a seat of an archived rig (a rig the inventory itself calls archived; a seat whose rig is not listed is kept). A failed seat or one that needs input is never hidden, whatever its rig. */
function isHiddenSeat(seat: unknown, archived: Set<string>): boolean {
  if (typeof seat !== "object" || seat === null) return false;
  const { status, rigId } = seat as SeatLike;
  if (status === "failed" || status === "attention") return false;
  if (status === "stopped" || status === "exited") return true;
  return typeof rigId === "string" && archived.has(rigId);
}

/** The seats to list: all of them, as the same array, when hideStopped is off; otherwise without the stopped seats and the seats of an archived rig. Keeps the order and never changes its input. */
export function visibleSeats<T>(
  seats: T[],
  rigs: unknown,
  hideStopped: boolean,
): T[] {
  if (!Array.isArray(seats)) return [];
  if (!hideStopped) return seats;
  const archived = archivedRigIds(rigs);
  return seats.filter((seat) => !isHiddenSeat(seat, archived));
}

/** How many of these seats the filter would leave out, whether or not it is on. */
export function hiddenCount(seats: unknown, rigs: unknown): number {
  if (!Array.isArray(seats)) return 0;
  const archived = archivedRigIds(rigs);
  let count = 0;
  for (const seat of seats) if (isHiddenSeat(seat, archived)) count += 1;
  return count;
}

/** The text beside SESSIONS: the total while nothing is hidden by choice, and shown of total while the filter is on, never more shown than total. */
export function seatCountText(
  shown: number,
  total: number,
  hiding: boolean,
): string {
  const all = whole(total);
  if (!hiding) return String(all);
  return Math.min(whole(shown), all) + " of " + all;
}

/** The headline of the empty list when every matching seat is hidden. */
export function hiddenSeatsText(count: number): string {
  const n = whole(count);
  return (
    n + " stopped " + (n === 1 ? "session is" : "sessions are") + " hidden"
  );
}
