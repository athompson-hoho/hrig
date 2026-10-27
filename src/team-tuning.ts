import type { DesignSeat } from "./types";

export const comparisonFields = [
  { key: "agentId", label: "Agent" },
  { key: "runtime", label: "Runtime" },
  { key: "mission", label: "Mission" },
  { key: "boundaries", label: "Boundaries and escalation" },
  { key: "expectedOutput", label: "Expected output and evidence" },
  { key: "handoff", label: "Handoff condition and recipient" },
] as const;
export function compareTeamSeats(before: DesignSeat[], after: DesignSeat[]) {
  const read = (
    seat: DesignSeat,
    key: (typeof comparisonFields)[number]["key"],
  ) =>
    key === "agentId" || key === "runtime"
      ? seat[key]
      : seat.firstHandoff?.[key] || "";
  const added = after.filter(
    (seat) => !before.some((old) => old.id === seat.id),
  );
  const removed = before.filter(
    (seat) => !after.some((next) => next.id === seat.id),
  );
  const matched = after.flatMap((seat, index) => {
    const oldIndex = before.findIndex((old) => old.id === seat.id);
    if (oldIndex < 0) return [];
    const old = before[oldIndex];
    const changes: { label: string; before: string; after: string }[] =
      comparisonFields.flatMap(({ key, label }) =>
        read(old, key) === read(seat, key)
          ? []
          : [{ label, before: read(old, key), after: read(seat, key) }],
      );
    if (oldIndex !== index)
      changes.unshift({
        label: "Position",
        before: String(oldIndex + 1),
        after: String(index + 1),
      });
    return [{ seat, changes }];
  });
  return {
    added,
    removed,
    changed: matched.filter((row) => row.changes.length),
    unchanged: matched
      .filter((row) => !row.changes.length)
      .map((row) => row.seat),
    hubBefore: before[0]?.id || "None",
    hubAfter: after[0]?.id || "None",
  };
}

export type ProtectedSeat = { aliases: string[]; seat: DesignSeat };
export function protectSeat(
  protectedSeats: ProtectedSeat[],
  previous: DesignSeat,
  next: DesignSeat,
): ProtectedSeat[] {
  const existing = protectedSeats.find((p) => p.seat === previous);
  const updated = {
    aliases: [...new Set([existing?.aliases[0] ?? previous.id, next.id])],
    seat: next,
  };
  return existing
    ? protectedSeats.map((p) => (p === existing ? updated : p))
    : [...protectedSeats, updated];
}
export function mergeTunedSeats(
  proposed: DesignSeat[],
  protectedSeats: ProtectedSeat[],
): DesignSeat[] {
  const inserted = new Set<ProtectedSeat>();
  const result: DesignSeat[] = [];
  for (const seat of proposed) {
    const match = protectedSeats.find((p) => p.aliases.includes(seat.id));
    if (!match) result.push(seat);
    else if (!inserted.has(match)) {
      result.push(match.seat);
      inserted.add(match);
    }
  }
  for (const p of protectedSeats) if (!inserted.has(p)) result.push(p.seat);
  if (result.length > 6)
    throw new Error(
      "Keeping edited seats would exceed six seats. Allow AI changes for a seat or choose a smaller proposal.",
    );
  if (
    new Set(result.map((s) => s.id)).size !== result.length ||
    protectedSeats.some((p) =>
      protectedSeats.some(
        (other) => other !== p && other.aliases.includes(p.seat.id),
      ),
    )
  )
    throw new Error(
      "Edited seat names conflict. Give every seat a unique name before applying a proposal.",
    );
  return result;
}
