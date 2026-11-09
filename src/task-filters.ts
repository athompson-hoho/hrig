/** The four states the state filter offers, in the order the board lists them. */
export const TASK_STATES: readonly string[] = [
  "pending",
  "in-progress",
  "blocked",
  "failed",
];
/** Most characters the text filter keeps. */
export const MAX_FILTER_TEXT = 200;
/** Most characters a seat address filter keeps. */
export const MAX_FILTER_SEAT = 200;
/** Most characters a tag keeps (counted as whole characters, not UTF-16 units). */
export const MAX_TAG_LENGTH = 80;
/** Most distinct tags read from one item. */
export const MAX_ITEM_TAGS = 32;
/** Most tags the tag filter offers. */
export const MAX_TAG_OPTIONS = 100;
/** Most connections that can hold saved filters. */
export const MAX_SAVED_CONNECTIONS = 64;
/** Longest connection id filters are kept for (the limit the main process enforces). */
export const MAX_CONNECTION_KEY = 150;

/** The four task board filters; seat is the owner address, text is not saved. */
export type TaskFilters = {
  seat: string;
  state: string;
  tag: string;
  text: string;
};
/** What is saved for one connection: seat, state and tag only. */
export type SavedTaskFilter = { seat: string; state: string; tag: string };
/** Saved filters keyed by connection id. */
export type SavedTaskFilters = Record<string, SavedTaskFilter>;

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Control, line-separator, zero-width and bidirectional-override characters are dropped. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

function strip(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value) if (!hidden(char.codePointAt(0)!)) text += char;
  return text;
}

const cap = (text: string, max: number) =>
  Array.from(text).slice(0, max).join("");

/** All four filters empty: every task shows. */
export function emptyFilters(): TaskFilters {
  return { seat: "", state: "", tag: "", text: "" };
}

/** A tag as compared: hidden characters dropped, trimmed, lower case, at most 80 characters; anything but a string gives an empty tag. */
export function normalizeTag(value: unknown): string {
  return cap(strip(value).trim().toLowerCase(), MAX_TAG_LENGTH).trim();
}

/** The valid parts of a filter set: strings without hidden characters, a state from the four offered, a normalized tag, capped lengths; anything else gives an empty part and nothing throws. */
export function normalizeFilters(value: unknown): TaskFilters {
  const input: Record<string, unknown> = plain(value) ? value : {};
  const state = strip(input.state).trim();
  return {
    seat: cap(strip(input.seat).trim(), MAX_FILTER_SEAT),
    state: TASK_STATES.includes(state) ? state : "",
    tag: normalizeTag(input.tag),
    text: cap(strip(input.text), MAX_FILTER_TEXT),
  };
}

/** The distinct normalized tags of an item, read from its tags field as an array of strings or a comma list; a missing, null or odd field gives none. */
export function itemTags(item: unknown): string[] {
  if (!plain(item)) return [];
  const raw = item.tags;
  const list: unknown[] = Array.isArray(raw)
    ? raw.slice(0, 200)
    : typeof raw === "string"
      ? raw.slice(0, 2000).split(",")
      : [];
  const tags: string[] = [];
  for (const entry of list) {
    const tag = normalizeTag(entry);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_ITEM_TAGS) break;
  }
  return tags;
}

/** The items every non-empty filter lets through: state and owner equal the item's status and destination, the tag is one of its tags, the text is a case-insensitive part of its title; no filter gives a copy of all items and the input is never changed. */
export function applyFilters<T>(items: T[], filters: unknown): T[] {
  if (!Array.isArray(items)) return [];
  const f = normalizeFilters(filters);
  if (!f.seat && !f.state && !f.tag && !f.text) return items.slice();
  const text = f.text.toLowerCase();
  return items.filter(
    (item) =>
      plain(item) &&
      (!f.state || item.status === f.state) &&
      (!f.seat || item.destination === f.seat) &&
      (!f.tag || itemTags(item).includes(f.tag)) &&
      (!f.text || String(item.title).toLowerCase().includes(text)),
  );
}

/** The tags the filter offers: distinct, the 100 most used, sorted. */
export function tagOptions(items: unknown[]): string[] {
  if (!Array.isArray(items)) return [];
  const counts = new Map<string, number>();
  for (const item of items)
    for (const tag of itemTags(item))
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_TAG_OPTIONS)
    .map(([tag]) => tag)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** True when any of the four filters is set. */
export function hasFilters(filters: unknown): boolean {
  const f = normalizeFilters(filters);
  return !!(f.seat || f.state || f.tag || f.text);
}

/** The saved owner and tag that nothing offers any more: an owner missing from the seats and from every task, a tag on no loaded task; an empty string for a part that is set and found, not set, or not judged yet (no seats listed, tasks not loaded). */
export function staleFilters(
  filters: unknown,
  seats: string[],
  items: unknown[] | null,
): { seat: string; tag: string } {
  const f = normalizeFilters(filters);
  const list = Array.isArray(items) ? items : null;
  const known = Array.isArray(seats) && seats.length > 0;
  const seat =
    f.seat &&
    known &&
    list !== null &&
    !seats.includes(f.seat) &&
    !list.some((item) => plain(item) && item.destination === f.seat)
      ? f.seat
      : "";
  const tag =
    f.tag &&
    list !== null &&
    !list.some((item) => itemTags(item).includes(f.tag))
      ? f.tag
      : "";
  return { seat, tag };
}

/** One sentence for each stale owner or tag, joined by a space; an empty string when neither is stale. */
export function staleNote(stale: unknown): string {
  const input: Record<string, unknown> = plain(stale) ? stale : {};
  const seat = cap(strip(input.seat).trim(), MAX_FILTER_SEAT);
  const tag = normalizeTag(input.tag);
  const parts: string[] = [];
  if (seat) parts.push("No seat or task matches the saved owner " + seat + ".");
  if (tag) parts.push("No task has the saved tag " + tag + ".");
  return parts.join(" ");
}

function entry(value: unknown): SavedTaskFilter | null {
  const f = normalizeFilters(value);
  return f.seat || f.state || f.tag
    ? { seat: f.seat, state: f.state, tag: f.tag }
    : null;
}

/** Defensive load: keeps up to 64 connections with at least one valid seat, state or tag, under sane ids, and drops everything else. */
export function normalizeSavedFilters(value: unknown): SavedTaskFilters {
  const result: SavedTaskFilters = {};
  if (!plain(value)) return result;
  let kept = 0;
  for (const key of Object.keys(value)) {
    if (kept >= MAX_SAVED_CONNECTIONS) break;
    if (!key || key.length > MAX_CONNECTION_KEY || key === "__proto__")
      continue;
    const saved = entry(value[key]);
    if (!saved) continue;
    result[key] = saved;
    kept++;
  }
  return result;
}

/** The filters saved for this connection id with an empty text, or all empty; only the connection's own entry counts, never an inherited property. */
export function resolveTaskFilters(
  saved: unknown,
  connectionId: unknown,
): TaskFilters {
  if (
    !plain(saved) ||
    typeof connectionId !== "string" ||
    connectionId === "__proto__" ||
    !has(saved, connectionId)
  )
    return emptyFilters();
  return normalizeFilters(entry(saved[connectionId]));
}

/** A new saved map with this connection's seat, state and tag set, or removed when all three are empty; refuses a 65th connection and a bad id. */
export function saveTaskFilters(
  saved: unknown,
  connectionId: unknown,
  filters: unknown,
): SavedTaskFilters {
  const next = normalizeSavedFilters(saved);
  if (
    typeof connectionId !== "string" ||
    !connectionId ||
    connectionId.length > MAX_CONNECTION_KEY ||
    connectionId === "__proto__"
  )
    return next;
  const one = entry(filters);
  if (!one) {
    delete next[connectionId];
    return next;
  }
  if (
    !has(next, connectionId) &&
    Object.keys(next).length >= MAX_SAVED_CONNECTIONS
  )
    return next;
  next[connectionId] = one;
  return next;
}
