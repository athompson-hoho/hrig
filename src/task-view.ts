export interface TaskLike { id?: unknown; title?: unknown; destination?: unknown; status?: unknown; [k: string]: unknown }
export type TaskGroupBy = "state" | "seat";
export interface TaskGroup<T> { key: string; label: string; items: T[] }

const STATES = ["pending", "in-progress", "blocked"] as const;
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/**
 * Case-insensitive search over title, owner address, state and id.
 * Every whitespace-separated term must match somewhere (AND).
 */
export function searchTasks<T extends TaskLike>(items: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...items];
  return items.filter((i) => {
    const hay = [text(i.title), text(i.destination), text(i.status), text(i.id)].join("\n").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** State columns are fixed and ordered; seat groups are sorted by name with Unassigned last. */
export function groupTasks<T extends TaskLike>(items: readonly T[], by: TaskGroupBy): TaskGroup<T>[] {
  if (by === "state") {
    return [...STATES, "other" as const].map((state) => ({
      key: state,
      label: state === "other" ? "Other states" : state,
      items: items.filter((i) => state === "other" ? !(STATES as readonly string[]).includes(text(i.status)) : i.status === state),
    }));
  }
  const map = new Map<string, T[]>();
  for (const i of items) {
    const k = text(i.destination).trim();
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([k, list]) => ({ key: `seat:${k}`, label: k || "Unassigned", items: list }));
}
