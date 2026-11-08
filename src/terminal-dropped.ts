/** Window event carrying one panel's dropped state to the app shell. */
export const TERMINAL_DROPPED_EVENT = "hrig:terminal-dropped";

/** The per-panel state that decides whether a terminal counts as dropped. */
export interface DroppedInput {
  rigControl: boolean;
  ended: number | null;
  error: string;
  ready: boolean;
}

/** A terminal is dropped when its session ended or it failed before ever connecting. */
export function isDropped(input: DroppedInput): boolean {
  // Rig-control panels are owned by the rig, never by this recovery path.
  if (input.rigControl) return false;
  if (input.ended !== null) return true;
  // A stray error on a ready terminal (a failed link open) is not a drop, and one still connecting has no error yet.
  return input.error !== "" && !input.ready;
}

/** Returns a new set with one id added or removed. */
export function markDropped(
  current: ReadonlySet<string>,
  id: string,
  dropped: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  if (dropped) next.add(id);
  else next.delete(id);
  return next;
}

/** Dropped ids, restricted to the open terminals and in their order when given. */
export function droppedIds(
  current: ReadonlySet<string>,
  open?: readonly string[],
): string[] {
  if (!open) return [...current];
  return open.filter((id) => current.has(id));
}

/** Calls send once per id and returns how many were sent. */
export function reconnectAllDropped(
  ids: readonly string[],
  send: (id: string) => void,
): number {
  for (const id of ids) send(id);
  return ids.length;
}

/** Palette label for the reconnect-all entry. */
export function droppedLabel(count: number): string {
  return `Reconnect all dropped (${count})`;
}

/** Announces one panel's dropped state on the window. */
export function publishTerminalDropped(id: string, dropped: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TERMINAL_DROPPED_EVENT, { detail: { id, dropped } }),
  );
}

/** Subscribes to dropped-state announcements; returns the unsubscribe. */
export function onTerminalDropped(
  listener: (id: string, dropped: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    listener(detail.id, detail.dropped);
  };
  window.addEventListener(TERMINAL_DROPPED_EVENT, handler);
  return () => window.removeEventListener(TERMINAL_DROPPED_EVENT, handler);
}
