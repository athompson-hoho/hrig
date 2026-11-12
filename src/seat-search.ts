import type { Seat } from "./types";

export interface SeatSearchResult {
  seats: Seat[];
  scopedCount: number;
  hasQuery: boolean;
  noMatches: boolean;
}

export function filterSeats(
  seats: readonly Seat[],
  selectedRig: string,
  query: string,
): SeatSearchResult {
  const normalizedQuery = query.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;
  const scoped = seats.filter((seat) => !selectedRig || seat.rigId === selectedRig);
  const matched = hasQuery
    ? scoped.filter((seat) =>
        [seat.name, seat.rigName, seat.runtime, seat.pod, seat.model, seat.session]
          .some((value) => (value ?? "").toLowerCase().includes(normalizedQuery)),
      )
    : scoped;
  return {
    seats: matched,
    scopedCount: scoped.length,
    hasQuery,
    noMatches: hasQuery && scoped.length > 0 && matched.length === 0,
  };
}
