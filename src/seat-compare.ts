export interface CompareSeat { id: string; name: string; rigName: string; session?: string; pod?: string }

/** Seats that can be shown beside `current`: other sessions with a recorded session name. */
export function compareCandidates<T extends CompareSeat>(seats: readonly T[], current: CompareSeat): T[] {
  return seats
    .filter((s) => s.id !== current.id && !!s.session)
    .sort((a, b) => `${a.rigName}/${a.name}`.localeCompare(`${b.rigName}/${b.name}`));
}

/** Label for the picker, disambiguating equal names across rigs. */
export function compareLabel(seat: CompareSeat): string {
  return `${seat.name} (${seat.rigName}${seat.pod ? " · " + seat.pod : ""})`;
}

export function snapshotStats(text: string): { lines: number; words: number } {
  const trimmed = text.trim();
  if (!trimmed) return { lines: 0, words: 0 };
  return { lines: trimmed.split("\n").length, words: trimmed.split(/\s+/).length };
}
