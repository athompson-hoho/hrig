import type { Seat } from "./types";

export function terminalSeatActivity(seat: Seat | undefined, available: boolean) {
  if (!seat) return null;
  if (!available) return { status: "unknown", label: "Activity unavailable", detail: "No current inventory for this seat and connection." };
  const label = seat.status === "attention" ? "Needs input"
    : seat.status === "working" ? "Working"
    : seat.status === "idle" ? "Idle"
    : seat.status === "running" ? "Running"
    : ["stopped", "exited", "failed"].includes(seat.status) ? "Stopped"
    : "Activity unknown";
  return { status: seat.status === "exited" ? "stopped" : seat.status, label, detail: seat.activity || seat.error || label };
}
