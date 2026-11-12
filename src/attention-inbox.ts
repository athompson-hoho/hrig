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
    reason: !owned ? `This panel belongs to ${captured.name}. Matching inventory is unavailable in the current connection. Return to the matching connection and reopen Attention center.` : error ?
      `${inventory ? `Showing last known inventory for ${captured.name}. Jump is unavailable. ` : ""}Could not verify inventory for ${captured.name}: ${error}. Check this connection using the existing connection controls.` : !inventory ?
      (health.verified ? `Inventory for ${captured.name} is unavailable. Check this connection using the existing connection controls.` : `Loading represented inventory for ${captured.name}…`) : !ready ?
        `Checking inventory for ${captured.name}. Jump is unavailable until this connection is verified.` : "Verified captured connection inventory." };
}

export function attentionJumpEligibility(inventory: Inventory | null, captured: Seat, diagnostic = false): string {
  if (!captured.session) return "This seat has no attachable tmux session. Inspect its readiness in OpenRig.";
  const matches = inventory?.seats.filter((seat) => seat.id === captured.id) || [];
  if (!matches.length) return "This seat is no longer in the represented inventory. Review the updated Attention center before trying again.";
  if (matches.some((seat) => seat.rigId !== captured.rigId || seat.rigName !== captured.rigName ||
    seat.session !== captured.session || seat.status !== captured.status)) {
    if (matches.some((seat) => seat.session !== captured.session))
      return "This seat's session changed. Review the updated seat and use its current Jump action.";
    if (matches.some((seat) => seat.status !== captured.status))
      return "This seat is no longer marked as needing input. Review the updated Attention center.";
    return "This seat has conflicting represented targets. Check its identity in OpenRig before opening it.";
  }
  if (diagnostic ? captured.status !== "failed" || !matches[0].error : captured.status !== "attention")
    return "This seat is no longer marked as needing input. Review the updated Attention center.";
  return "";
}
