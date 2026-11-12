import type { Connection, Inventory, SeatAttentionRequest } from "./types";
import { pinConnectionIdentity } from "./seat-pins";

export interface SeatNotificationState {
  owner: string | null;
  armed: boolean;
  attentionIds: readonly string[];
}

export function validSeatNotificationName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Array.from(value).length <= 150 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

/** Only current identity membership survives an observation, never seat content. */
export function advanceSeatNotifications(previous: SeatNotificationState, input: {
  enabled: boolean;
  connection: Connection;
  inventory: Inventory | null;
  inventoryError: string;
  health: { key: string; verified: boolean; failures: number };
}): { state: SeatNotificationState; requests: SeatAttentionRequest[] } {
  const owner = pinConnectionIdentity(input.connection);
  if (!input.enabled || !input.inventory || input.inventoryError ||
    input.health.key !== owner || input.health.verified !== true ||
    input.health.failures !== 0 || !Array.isArray(input.inventory.seats)) {
    return { state: { owner: null, armed: false, attentionIds: [] }, requests: [] };
  }

  // These rows are local to this observation. Conflicts cannot select a name,
  // and remain suppressed until a later unambiguous non-attention observation.
  const represented = new Map<string, { name: unknown; status: unknown; conflict: boolean; attention: boolean }>();
  for (const seat of input.inventory.seats) {
    if (!seat || typeof seat.id !== "string" || !seat.id.trim()) continue;
    const row = represented.get(seat.id);
    if (row) {
      row.conflict ||= row.name !== seat.name || row.status !== seat.status;
      row.attention ||= seat.status === "attention";
    } else {
      represented.set(seat.id, { name: seat.name, status: seat.status,
        conflict: false, attention: seat.status === "attention" });
    }
  }
  const prior = new Set(previous.owner === owner && previous.armed ? previous.attentionIds : []);
  const seeded = previous.owner === owner && previous.armed;
  const attentionIds: string[] = [];
  const requests: SeatAttentionRequest[] = [];
  for (const [id, row] of represented) {
    if (!row.attention && !row.conflict) continue;
    attentionIds.push(id);
    if (seeded && !prior.has(id) && row.attention && !row.conflict && validSeatNotificationName(row.name)) {
      requests.push({ seatName: row.name });
    }
  }
  return { state: { owner, armed: true, attentionIds }, requests };
}
