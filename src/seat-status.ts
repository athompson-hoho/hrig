import type { Seat } from "./types";

export type SeatStatusFilter = "all" | "working" | "idle" | "attention" | "stopped";

export function filterSeatsByStatus(
  seats: readonly Seat[],
  statusFilter: SeatStatusFilter,
): Seat[] {
  return seats.filter((seat) =>
    statusFilter === "all" ||
    (statusFilter === "stopped"
      ? ["stopped", "exited", "failed"].includes(seat.status)
      : statusFilter === "working"
        ? seat.status === "working" || seat.status === "running"
        : seat.status === statusFilter),
  );
}
