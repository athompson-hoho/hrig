import type { Seat } from "./types";

export type SeatSort = "name" | "activity" | "attention-first";

// Fixed English collation gives natural numeric, case/accent-insensitive names.
// Comparator-equal names retain their source order in every mode.
const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function activityRank(status: string): number {
  switch (status) {
    case "working": return 0;
    case "running": return 1;
    case "attention": return 2;
    case "idle": return 3;
    case "stopped":
    case "exited":
    case "failed": return 4;
    default: return 5;
  }
}

export function sortSeats(seats: readonly Seat[], mode: SeatSort): Seat[] {
  const rank = (seat: Seat) => mode === "activity"
    ? activityRank(seat.status)
    : mode === "attention-first" ? (seat.status === "attention" ? 0 : 1) : 0;
  return seats.map((seat, index) => ({ seat, index }))
    .sort((a, b) => rank(a.seat) - rank(b.seat) ||
      names.compare(a.seat.name, b.seat.name) || a.index - b.index)
    .map(({ seat }) => seat);
}
