import type { Connection, Inventory, Seat } from "./types";
import { pinConnectionIdentity } from "./seat-pins";

export const attentionSeats = (inventory: Inventory | null): Seat[] =>
  inventory?.seats.filter((seat) => seat.status === "attention") || [];

export function attentionScope(captured: Connection, current: Connection,
  inventory: Inventory | null, health: { key: string; verified: boolean }, error: string) {
  const owned = pinConnectionIdentity(captured) === pinConnectionIdentity(current) &&
    health.key === pinConnectionIdentity(captured);
  const available = owned && !!inventory;
  const ready = available && health.verified && !error;
  return { inventory: available ? inventory : null, ready,
    reason: !owned ? "Captured connection inventory is unavailable." : error ?
      `${inventory ? "Last known/unverified inventory. " : ""}Could not verify inventory for ${captured.name}: ${error}. Check this connection using the existing connection controls.` : !inventory ?
      "Loading captured connection inventory…" : !ready ?
        `Last known/unverified inventory. ${error || "Checking connection…"}` : "Verified captured connection inventory." };
}

export function attentionJumpEligibility(inventory: Inventory | null, captured: Seat, diagnostic = false): string {
  if (!captured.session) return "No attachable session. Inspect readiness in OpenRig.";
  const matches = inventory?.seats.filter((seat) => seat.id === captured.id) || [];
  if (!matches.length) return "This seat is no longer represented.";
  if (matches.some((seat) => seat.rigId !== captured.rigId || seat.rigName !== captured.rigName ||
    seat.session !== captured.session || seat.status !== captured.status)) return "Seat identity, status or session changed or is ambiguous.";
  if (diagnostic ? captured.status !== "failed" || !matches[0].error : captured.status !== "attention")
    return "This seat no longer needs input.";
  return "";
}
