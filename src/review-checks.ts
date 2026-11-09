/** Most projects whose checks are kept; the oldest project is dropped first. */
export const MAX_PROJECTS = 20;
/** Most checked files kept per project; the oldest check is dropped first. */
export const MAX_PATHS = 200;
/** Longest file path a check is kept for. */
export const MAX_PATH_CHARS = 1024;
/** Longest revision a check is kept for (a revision is an opaque content hash). */
export const MAX_REVISION_CHARS = 128;
/** Most ticked files that are read again when the change list loads or is refreshed. */
export const MAX_RECHECK = 50;

/** Saved checks: per project key (see reviewKey), the content revision each ticked path had when it was ticked. */
export type ReviewChecks = Record<string, Record<string, string>>;
/** What one row shows: unchecked; reviewed (ticked at the revision the file has now); stale (the file changed since it was ticked); failed (the current revision could not be read); unknown (not read yet or not rechecked). */
export type ReviewState =
  "unchecked" | "reviewed" | "stale" | "failed" | "unknown";

const RESERVED = ["__proto__", "constructor", "prototype"];

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Control, line-separator, zero-width and bidirectional-override characters are refused. */
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

function clean(text: string) {
  for (const char of text) if (hidden(char.codePointAt(0)!)) return false;
  return true;
}

function usableKey(key: unknown): key is string {
  return typeof key === "string" && key !== "" && !RESERVED.includes(key);
}

function usableRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value.length <= MAX_REVISION_CHARS &&
    clean(value)
  );
}

/** Whether a changed file's path can be remembered: text, at most 1024 characters, no hidden characters and not a reserved object key. */
export function usablePath(path: unknown): path is string {
  return usableKey(path) && path.length <= MAX_PATH_CHARS && clean(path);
}

/** Whether a changed file can be ticked: a usable path and not a deleted file (there is nothing left to read). */
export function isCheckable(entry: {
  path: unknown;
  status?: unknown;
}): boolean {
  return usablePath(entry.path) && entry.status !== "D";
}

/** One stable string per connection id and project root (the same fields the recent files use). */
export function reviewKey(connectionId: string, root: string): string {
  return JSON.stringify([connectionId, root]);
}

// Own entries only, in stored order (oldest first), so a hostile key never reaches a prototype.
function entriesOf(value: unknown): [string, unknown][] {
  return plain(value) ? Object.entries(value) : [];
}

function pathsOf(value: unknown): [string, string][] {
  const kept: [string, string][] = [];
  for (const [path, revision] of entriesOf(value))
    if (usablePath(path) && usableRevision(revision))
      kept.push([path, revision]);
  return kept.slice(-MAX_PATHS);
}

function build(projects: [string, [string, string][]][]): ReviewChecks {
  return Object.fromEntries(
    projects
      .filter(([, paths]) => paths.length > 0)
      .slice(-MAX_PROJECTS)
      .map(([key, paths]): [string, Record<string, string>] => [
        key,
        Object.fromEntries(paths),
      ]),
  );
}

function cleaned(checks: unknown): [string, [string, string][]][] {
  return entriesOf(checks)
    .filter(([key]) => usableKey(key))
    .map(([key, paths]): [string, [string, string][]] => [key, pathsOf(paths)]);
}

/** Defensive load: keeps at most 20 projects (the newest) of at most 200 checks each, and drops every unusable key, path and revision. */
export function normalizeReviewChecks(value: unknown): ReviewChecks {
  return build(cleaned(value));
}

/** The revision a path was ticked at in this project, or undefined; only an own entry counts. */
function stored(checks: unknown, key: string, path: string) {
  if (!plain(checks) || !has(checks, key)) return undefined;
  const paths = checks[key];
  if (!plain(paths) || !has(paths, path)) return undefined;
  const revision = paths[path];
  return usableRevision(revision) ? revision : undefined;
}

/** True only when the path is ticked and its saved revision is exactly the given current revision. */
export function isReviewed(
  checks: unknown,
  key: string,
  path: string,
  revision: unknown,
): boolean {
  const saved = stored(checks, key, path);
  return (
    saved !== undefined && typeof revision === "string" && saved === revision
  );
}

/** The state of one row. `current` is the revision just read (a string), null when the read failed, or undefined when it has not been read. */
export function reviewState(
  checks: unknown,
  key: string,
  path: string,
  current: string | null | undefined,
): ReviewState {
  const saved = stored(checks, key, path);
  if (saved === undefined) return "unchecked";
  if (typeof current === "string")
    return saved === current ? "reviewed" : "stale";
  return current === null ? "failed" : "unknown";
}

/** A new map with this path ticked at the given revision (it becomes the newest check of the newest project), or unticked when the revision is null; the oldest check and project are dropped past the caps. An unusable key, path or revision changes nothing; the input is never modified. */
export function toggleReviewed(
  checks: unknown,
  key: string,
  path: string,
  revision: string | null,
): ReviewChecks {
  const projects = cleaned(checks);
  if (!usableKey(key) || !usablePath(path)) return build(projects);
  const current = projects.find(([name]) => name === key)?.[1] ?? [];
  const others = projects.filter(([name]) => name !== key);
  const rest = current.filter(([name]) => name !== path);
  if (revision === null) return build([...others, [key, rest]]);
  if (!usableRevision(revision)) return build(projects);
  const added: [string, string][] = [...rest, [path, revision]];
  return build([...others, [key, added.slice(-MAX_PATHS)]]);
}

/** The ticked files of the change list, in list order: at most 50 to read again and the rest to report as not rechecked. */
export function recheckPaths(
  entries: readonly { path: string; status?: string }[],
  checks: unknown,
  key: string,
): { read: string[]; skipped: string[] } {
  const ticked: string[] = [];
  for (const entry of entries)
    if (
      isCheckable(entry) &&
      stored(checks, key, entry.path) !== undefined &&
      !ticked.includes(entry.path)
    )
      ticked.push(entry.path);
  return {
    read: ticked.slice(0, MAX_RECHECK),
    skipped: ticked.slice(MAX_RECHECK),
  };
}

/** The checks without the paths of this project that are not in the current change list; an empty list clears the project. Returns the same object when nothing is dropped. */
export function pruneReviewed(
  checks: ReviewChecks,
  key: string,
  currentPaths: readonly string[],
): ReviewChecks {
  if (!plain(checks) || !has(checks, key)) return checks;
  const keep = new Set(currentPaths);
  const paths = entriesOf(checks[key]);
  const left = paths.filter(([path]) => keep.has(path));
  if (left.length === paths.length) return checks;
  return build(
    cleaned(checks).map(([name, list]): [string, [string, string][]] =>
      name === key ? [name, pathsOf(Object.fromEntries(left))] : [name, list],
    ),
  );
}

/** How many checkable files are reviewed at the revision just read, out of how many checkable files there are; `revisions` maps a path to its current revision (null when the read failed) and an unread path counts as not reviewed. `unreadable` lists paths whose read failed when ticked: they are left out of both numbers, so the caller counts them as not checkable. */
export function reviewProgress(
  entries: readonly { path: string; status?: string }[],
  checks: unknown,
  key: string,
  revisions: ReadonlyMap<string, string | null>,
  unreadable?: ReadonlySet<string> | readonly string[],
): { reviewed: number; total: number } {
  const left = new Set<unknown>(
    unreadable instanceof Set || Array.isArray(unreadable) ? unreadable : [],
  );
  const seen = new Set<string>();
  let reviewed = 0;
  for (const entry of entries) {
    if (!isCheckable(entry) || left.has(entry.path) || seen.has(entry.path))
      continue;
    seen.add(entry.path);
    if (isReviewed(checks, key, entry.path, revisions.get(entry.path)))
      reviewed++;
  }
  return { reviewed, total: seen.size };
}
