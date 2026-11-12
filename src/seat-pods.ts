import type { Connection, Seat } from "./types";
import { pinConnectionIdentity } from "./seat-pins";

export interface PodGroup {
  identity: string;
  podLabel: string;
  rigLabel: string;
  seats: Seat[];
}

export function podIdentity(connection: Connection, seat: Seat): string {
  return JSON.stringify([...JSON.parse(pinConnectionIdentity(connection)),
    seat.rigId ? "rigId" : "rigName", seat.rigId || seat.rigName || "", seat.pod || ""]);
}

export function normalizeCollapsedPods(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    try {
      const tuple = JSON.parse(entry);
      if (!Array.isArray(tuple) || tuple.length !== 9 ||
        typeof tuple[0] !== "string" || !tuple[0].length ||
        !["local", "wsl", "ssh"].includes(tuple[1]) ||
        ![2, 4, 5].every(i => tuple[i] === null || typeof tuple[i] === "string") ||
        !(tuple[3] === null || (Number.isInteger(tuple[3]) && tuple[3] >= 1 && tuple[3] <= 65535)) ||
        !["rigId", "rigName"].includes(tuple[6]) || typeof tuple[7] !== "string" ||
        (tuple[6] === "rigId" && !tuple[7].length) || typeof tuple[8] !== "string") continue;
      result.add(JSON.stringify(tuple));
    } catch {
      // Invalid entries do not discard valid choices for other or absent pods.
    }
  }
  return [...result];
}

export function setPodCollapsed(value: unknown, identity: string, collapsed: boolean): string[] {
  const choices = new Set(normalizeCollapsedPods(value));
  const valid = normalizeCollapsedPods([identity])[0];
  if (valid) {
    if (collapsed) choices.add(valid);
    else choices.delete(valid);
  }
  return [...choices];
}

export function togglePodCollapsed(value: unknown, identity: string): string[] {
  const valid = normalizeCollapsedPods([identity])[0];
  return setPodCollapsed(value, identity, !normalizeCollapsedPods(value).includes(valid));
}

export function groupSeatPods(ordinarySeats: readonly Seat[], connection: Connection): PodGroup[] {
  const groups = new Map<string, PodGroup>();
  for (const seat of ordinarySeats) {
    const identity = podIdentity(connection, seat);
    let group = groups.get(identity);
    if (!group) {
      group = { identity, podLabel: seat.pod || "Ungrouped",
        rigLabel: seat.rigName || seat.rigId || "Unknown rig", seats: [] };
      groups.set(identity, group);
    }
    group.seats.push(seat);
  }
  return [...groups.values()];
}
