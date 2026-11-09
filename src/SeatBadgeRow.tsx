import type { Seat } from "./types";
import { seatBadges } from "./seat-badges";

/** The runtime and model badges under a seat's name in the sidebar list, or nothing when the seat has neither. The text is cleaned by seatBadges and drawn as plain text; the tooltip carries the longer form. */
export function SeatBadgeRow({ seat }: { seat: Seat }) {
  const { runtime, model } = seatBadges(seat);
  if (!runtime && !model) return null;
  return (
    <span className="seat-badges">
      {runtime && (
        <span className="badge" data-kind="runtime" title={runtime.title}>
          {runtime.label}
        </span>
      )}
      {model && (
        <span className="badge" data-kind="model" title={model.title}>
          {model.label}
        </span>
      )}
    </span>
  );
}
