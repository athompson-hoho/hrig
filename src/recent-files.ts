export const MAX_RECENT = 20;
export const MAX_RECENT_PROJECTS = 50;
const MAX_PATH = 1000;
/** Remembered project-relative paths, keyed by project (see recentKey). */
export type RecentFiles = Record<string, string[]>;
/** One Quick Open row built from a remembered path. */
export interface RecentRow {
  name: string;
  path: string;
}

// Only project-relative paths are ever remembered: stored data is untrusted,
// so absolute, drive, parent-directory, NUL and oversized values are refused.
function usable(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.trim() !== "" &&
    path.length <= MAX_PATH &&
    !path.includes("\0") &&
    !/^[\\/]/.test(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.split(/[\\/]/).includes("..")
  );
}

// The recents view shows for exactly the empty query with something
// remembered; the rows and the scan-reset decision both read this.
function showsRecents(query: string, recent: readonly string[]): boolean {
  return query === "" && recent.length > 0;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One stable string per connection id and project root. */
export function recentKey(connectionId: string, root: string): string {
  return JSON.stringify([connectionId, root]);
}

/** Defensive parse of a stored list: usable paths, de-duplicated, capped. */
export function normalizeRecents(value: unknown, max = MAX_RECENT): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (seen.size >= max) break;
    if (usable(item)) seen.add(item);
  }
  return [...seen];
}

/** Move or insert a path at the front, de-duplicated and capped. */
export function touchRecent(
  list: readonly string[],
  path: string,
  max = MAX_RECENT,
): string[] {
  if (!usable(path)) return list.slice(0, max);
  return [path, ...list.filter((entry) => entry !== path)].slice(0, max);
}

/** The list without one path. */
export function forgetRecent(list: readonly string[], path: string): string[] {
  return list.filter((entry) => entry !== path);
}

/** A project's remembered paths; any missing or malformed value gives []. */
export function recentsFor(map: unknown, key: string): string[] {
  if (!plain(map) || !Object.prototype.hasOwnProperty.call(map, key)) return [];
  return normalizeRecents(map[key]);
}

// Rebuilt with Object.fromEntries so a stored __proto__ key stays plain data.
function cleaned(map: unknown): [string, string[]][] {
  if (!plain(map)) return [];
  return Object.entries(map)
    .map(([key, value]): [string, string[]] => [key, normalizeRecents(value)])
    .filter(([, list]) => list.length > 0);
}

function build(entries: [string, string[]][]): RecentFiles {
  return Object.fromEntries(entries.slice(-MAX_RECENT_PROJECTS));
}

/** Record an opened path; the touched project becomes the newest. */
export function recordRecent(
  map: unknown,
  key: string,
  path: string,
): RecentFiles {
  const entries = cleaned(map);
  if (!usable(path)) return build(entries);
  const current = entries.find(([name]) => name === key)?.[1] ?? [];
  return build([
    ...entries.filter(([name]) => name !== key),
    [key, touchRecent(current, path)],
  ]);
}

/** Forget a path in one project; an emptied project is dropped. */
export function removeRecent(
  map: unknown,
  key: string,
  path: string,
): RecentFiles {
  return build(
    cleaned(map)
      .map(([name, list]): [string, string[]] =>
        name === key ? [name, forgetRecent(list, path)] : [name, list],
      )
      .filter(([, list]) => list.length > 0),
  );
}

/** Quick Open rows for the empty query, or null for the normal search. */
export function recentRows(
  query: string,
  recent: readonly string[],
): RecentRow[] | null {
  if (!showsRecents(query, recent)) return null;
  return recent.map((path) => ({
    name: path.slice(path.lastIndexOf("/") + 1) || path,
    path,
  }));
}

/** 1-based position of an id in the recent list, 999 when it is not listed. */
export function recentRank(recent: readonly string[], id: string): number {
  return recent.indexOf(id) + 1 || 999;
}

/** Whether a finished project scan may snap the selection to the first row. */
export function scanResetsSelection(
  query: string,
  recent: readonly string[],
): boolean {
  return !showsRecents(query, recent);
}
