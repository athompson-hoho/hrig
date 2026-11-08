/** How many recent find queries are remembered; the oldest one is dropped past this. */
export const MAX_SEARCH_HISTORY = 20;

/** The longest query that is remembered: the same 500 characters the find input accepts. */
export const MAX_SEARCH_QUERY = 500;

/** ArrowUp recalls an older query and ArrowDown a newer one. */
export type HistoryDirection = "older" | "newer";

/** A recalled query and its place in the list; index -1 means back at the empty find box. */
export interface HistoryStep {
  index: number;
  text: string;
}

/** The list with the trimmed query moved to the front and at most MAX_SEARCH_HISTORY long; empty, whitespace-only, over-long and non-string queries are ignored. The input list is never changed. */
export function pushSearchQuery(
  list: readonly string[],
  query: string,
): string[] {
  const text = typeof query === "string" ? query.trim() : "";
  if (text === "" || text.length > MAX_SEARCH_QUERY)
    return list.slice(0, MAX_SEARCH_HISTORY);
  return [text, ...list.filter((item) => item !== text)].slice(
    0,
    MAX_SEARCH_HISTORY,
  );
}

/** The next recalled query, or null when the key must be left alone. Browsing means the box still shows the entry at index; only an empty box starts browsing (ArrowUp, newest first), ArrowUp stops at the oldest entry and ArrowDown past the newest returns to the empty box. */
export function recallSearchQuery(
  list: readonly string[],
  index: number,
  direction: HistoryDirection,
  current: string,
): HistoryStep | null {
  const browsing =
    Number.isInteger(index) &&
    index >= 0 &&
    index < list.length &&
    list[index] === current;
  if (!browsing) {
    if (current !== "" || direction !== "older" || list.length === 0)
      return null;
    return { index: 0, text: list[0] };
  }
  if (direction === "older") {
    const next = Math.min(index + 1, list.length - 1);
    return { index: next, text: list[next] };
  }
  return index === 0
    ? { index: -1, text: "" }
    : { index: index - 1, text: list[index - 1] };
}

/** Plain ArrowUp (older) or ArrowDown (newer); any modifier or an input method composition is not a history key. */
export function historyKeyDirection(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  composing = false,
): HistoryDirection | null {
  if (
    composing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return null;
  if (event.key === "ArrowUp") return "older";
  if (event.key === "ArrowDown") return "newer";
  return null;
}
