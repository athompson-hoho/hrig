import type { Connection, Seat } from "./types";

// Match the inventory/action owner's raw tuple, including absent optional slots.
export function pinConnectionIdentity(connection: Connection): string {
  return JSON.stringify([
    connection.id, connection.kind, connection.host, connection.port,
    connection.distro, connection.rigBinary,
  ]);
}

export function seatPinIdentity(connection: Connection, seatId: string): string {
  return JSON.stringify([...JSON.parse(pinConnectionIdentity(connection)), seatId]);
}

export function normalizePinnedSeats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    try {
      const tuple: unknown = JSON.parse(entry);
      if (!Array.isArray(tuple) || tuple.length !== 7 ||
        typeof tuple[0] !== "string" || !tuple[0].length ||
        !["local", "wsl", "ssh"].includes(tuple[1]) ||
        ![2, 4, 5].every((i) => tuple[i] === null || typeof tuple[i] === "string") ||
        !(tuple[3] === null || (Number.isInteger(tuple[3]) && tuple[3] >= 1 && tuple[3] <= 65535)) ||
        typeof tuple[6] !== "string" || !tuple[6].length) continue;
      const identity = JSON.stringify(tuple);
      if (!seen.has(identity)) {
        seen.add(identity);
        result.push(identity);
      }
    } catch {
      // A bad saved entry must not discard other valid identities.
    }
  }
  return result;
}

export function setSeatPinned(value: unknown, identity: string, pinned: boolean): string[] {
  const pins = normalizePinnedSeats(value);
  if (!pinned) return pins.filter((pin) => pin !== identity);
  return normalizePinnedSeats([...pins, identity]);
}

export function toggleSeatPin(value: unknown, identity: string): string[] {
  const pins = normalizePinnedSeats(value);
  return setSeatPinned(pins, identity, !pins.includes(identity));
}

export function partitionPinnedSeats(seats: readonly Seat[], connection: Connection, pins: unknown): Seat[] {
  const membership = new Set(normalizePinnedSeats(pins));
  const pinned: Seat[] = [];
  const ordinary: Seat[] = [];
  for (const seat of seats) {
    (membership.has(seatPinIdentity(connection, seat.id)) ? pinned : ordinary).push(seat);
  }
  return [...pinned, ...ordinary];
}
