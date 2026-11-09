import { validateOverrides, type Overrides } from "./settings";

export const MAX_SETTINGS_JSON = 65536;
export const SETTINGS_FORMAT_VERSION = 1;

export interface ImportReport {
  /** Fatal problem: nothing can be applied. */
  fatal: string | null;
  /** Valid settings that would be applied (replacing the scope). */
  valid: Overrides;
  /** Entries that will be left out, with the reason. */
  skipped: { key: string; reason: string }[];
  /** Keys in the current scope that the import would remove (replace semantics). */
  removed: string[];
  changed: string[];
  added: string[];
  unchanged: string[];
  /** Plain-language notes, e.g. about files from a newer HRig. */
  notes: string[];
}

const empty = (fatal: string | null): ImportReport => ({
  fatal, valid: {}, skipped: [], removed: [], changed: [], added: [], unchanged: [], notes: [],
});

/**
 * Checks a settings JSON text without applying anything. Valid keys are kept
 * individually, so one setting from a newer or older HRig does not block the
 * rest; every skipped entry is reported so the user decides before applying.
 */
export function analyzeSettingsImport(text: string, current: Overrides = {}): ImportReport {
  if (!text.trim()) return empty("Paste or load a settings JSON file first.");
  if (text.length > MAX_SETTINGS_JSON) return empty("Settings JSON must be smaller than 64 KB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return empty("This is not valid JSON: " + (e as Error).message);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return empty("Expected a JSON object with version and settings.");
  const root = parsed as Record<string, unknown>;
  const notes: string[] = [];
  const version = root.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return empty("Expected a numeric version (this HRig reads version 1).");
  if (version > SETTINGS_FORMAT_VERSION)
    notes.push(`This file is format version ${version}; this HRig reads version ${SETTINGS_FORMAT_VERSION}. Settings it does not recognize are skipped.`);
  const settings = root.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return empty("Expected a settings object.");
  const valid: Record<string, unknown> = {};
  const skipped: ImportReport["skipped"] = [];
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      skipped.push({ key: key.slice(0, 60), reason: "reserved name" });
      continue;
    }
    try {
      Object.assign(valid, validateOverrides({ [key]: value }));
    } catch (e) {
      const msg = (e as Error).message;
      skipped.push({ key: key.slice(0, 60), reason: msg.startsWith("Unknown setting") ? "not a setting in this HRig (it may come from a newer or older version)" : msg });
    }
  }
  const cur = current as Record<string, unknown>;
  const keys = Object.keys(valid);
  const added = keys.filter((k) => !Object.hasOwn(cur, k));
  const changed = keys.filter((k) => Object.hasOwn(cur, k) && JSON.stringify(cur[k]) !== JSON.stringify(valid[k]));
  const unchanged = keys.filter((k) => Object.hasOwn(cur, k) && JSON.stringify(cur[k]) === JSON.stringify(valid[k]));
  const removed = Object.keys(cur).filter((k) => !Object.hasOwn(valid, k));
  if (skipped.length) notes.push(`${skipped.length} entr${skipped.length === 1 ? "y is" : "ies are"} skipped; the rest can still be applied.`);
  if (!keys.length && !skipped.length) notes.push("The file has no settings: applying it would clear this scope.");
  return { fatal: null, valid: valid as Overrides, skipped, removed, changed, added, unchanged, notes };
}

export function summarizeImport(r: ImportReport): string {
  if (r.fatal) return r.fatal;
  const parts = [`${r.added.length} added`, `${r.changed.length} changed`, `${r.removed.length} removed`, `${r.unchanged.length} unchanged`];
  if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
  return parts.join(", ");
}
