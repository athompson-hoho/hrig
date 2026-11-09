import {
  schema,
  type Setting,
  type SettingKey,
  type SettingsScope,
} from "./settings";

/** One setting changed since HRig started: the setting, the scope, and for the project scope the project it was changed in (empty for the user scope). */
export interface RecentChange {
  key: SettingKey;
  scope: SettingsScope;
  project: string;
}

/** The most changes remembered; the oldest drop first. */
export const MAX_RECENT = 50;

function known(key: unknown): key is SettingKey {
  return typeof key === "string" && schema.some((row) => row.key === key);
}

function isScope(scope: unknown): scope is SettingsScope {
  return scope === "user" || scope === "project";
}

function field(item: object, name: string): unknown {
  return Object.hasOwn(item, name)
    ? (item as Record<string, unknown>)[name]
    : undefined;
}

function sameChange(a: RecentChange, b: RecentChange): boolean {
  return a.key === b.key && a.scope === b.scope && a.project === b.project;
}

// A list read defensively: not a list is an empty one, an entry that is not a known setting in a known scope is dropped, a repeat is dropped (the first one is the most recent), and it is cut to MAX_RECENT. Always a new list.
function clean(list: unknown): RecentChange[] {
  if (!Array.isArray(list)) return [];
  const out: RecentChange[] = [];
  for (const item of list) {
    if (out.length >= MAX_RECENT) break;
    if (!item || typeof item !== "object") continue;
    const key = field(item, "key");
    const scope = field(item, "scope");
    const project = field(item, "project");
    if (!known(key) || !isScope(scope)) continue;
    const entry: RecentChange = {
      key,
      scope,
      project:
        scope === "project" && typeof project === "string" ? project : "",
    };
    if (!out.some((seen) => sameChange(seen, entry))) out.push(entry);
  }
  return out;
}

/** Notes one change: the setting moves to the front, an earlier note of the same setting in the same scope (and project) is dropped, and the list is cut to MAX_RECENT. The list given is never changed. A key the schema does not know, or a scope that is not user or project, is not noted. */
export function noteChange(
  list: unknown,
  key: unknown,
  scope: unknown,
  project: unknown = "",
): RecentChange[] {
  const base = clean(list);
  if (!known(key) || !isScope(scope)) return base;
  const entry: RecentChange = {
    key,
    scope,
    project: scope === "project" && typeof project === "string" ? project : "",
  };
  return [entry, ...base.filter((seen) => !sameChange(seen, entry))].slice(
    0,
    MAX_RECENT,
  );
}

/** Notes several changes as one batch: the first key ends up first and the others follow in the order given. At most MAX_RECENT keys are read. */
export function noteChanges(
  list: unknown,
  keys: unknown,
  scope: unknown,
  project: unknown = "",
): RecentChange[] {
  let result = clean(list);
  if (!Array.isArray(keys)) return result;
  const batch = keys.slice(0, MAX_RECENT);
  for (let i = batch.length - 1; i >= 0; i--)
    result = noteChange(result, batch[i], scope, project);
  return result;
}

function ownValue(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  return Object.hasOwn(source, key)
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

/** The settings whose own value is different in two override maps: added, changed or removed, in the order the settings page lists them. A key whose value is undefined counts as missing. */
export function changedKeys(before: unknown, after: unknown): SettingKey[] {
  return schema
    .filter(
      (row) => !Object.is(ownValue(before, row.key), ownValue(after, row.key)),
    )
    .map((row) => row.key);
}

/** The changes to show while one project is open: the user scope ones and the ones made in that project. */
export function recentFor(list: unknown, project: unknown): RecentChange[] {
  const at = typeof project === "string" ? project : "";
  return clean(list).filter(
    (item) => item.scope === "user" || item.project === at,
  );
}

/** The rows of one scope that were changed, most recent first. It takes the rows to choose from (the whole schema or a filtered part), lists a row once, and skips a key the rows do not have. */
export function recentRows(
  rows: Setting[],
  list: unknown,
  scope: SettingsScope,
): Setting[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<string, Setting>();
  for (const row of rows)
    if (row && typeof row.key === "string") byKey.set(row.key, row);
  const out: Setting[] = [];
  for (const item of clean(list)) {
    const row = byKey.get(item.key);
    if (item.scope === scope && row && !out.includes(row)) out.push(row);
  }
  return out;
}
