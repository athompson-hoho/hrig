import {
  schema,
  type Setting,
  type SettingKey,
  type SettingsScope,
} from "./settings";

/** The most setting names listed in the confirmation; the rest are counted. */
export const MAX_NAMED = 8;

/** The words for resetting the changed settings of one category in one scope. */
export interface SectionReset {
  /** How many settings the reset would change. */
  count: number;
  /** The label of the button in the category heading. */
  button: string;
  /** The tooltip of that button. */
  buttonTitle: string;
  /** The question the confirmation asks. */
  title: string;
  /** The sentence under the question. */
  subtitle: string;
  /** The settings the reset would change, by the names the rows show; empty when there are none. */
  detail: string;
  /** The label of the confirming button. */
  confirm: string;
  /** The line shown once the reset is done. */
  notice: string;
}

function ownDefined(source: unknown, key: string): boolean {
  return (
    !!source &&
    typeof source === "object" &&
    Object.hasOwn(source, key) &&
    (source as Record<string, unknown>)[key] !== undefined
  );
}

/** The settings of one category that the scope has changed, in the order the settings page lists them. Only the scope's own map counts (an inherited or missing key never does), and a setting of another category is never in the list. */
export function modifiedKeysInCategory(
  rows: Setting[],
  own: unknown,
  category: unknown,
): SettingKey[] {
  if (!Array.isArray(rows) || typeof category !== "string") return [];
  return rows
    .filter(
      (row) =>
        !!row &&
        row.category === category &&
        typeof row.key === "string" &&
        ownDefined(own, row.key),
    )
    .map((row) => row.key);
}

function plural(count: number, one: string, many: string): string {
  return count + " " + (count === 1 ? one : many);
}

/** The words for resetting the given changed settings of one category: in the user scope the defaults come back and the project's overrides stay, in the project scope the overrides are removed and the user's values apply. */
export function describeSectionReset(
  scope: SettingsScope,
  category: string,
  keys: SettingKey[],
  rows: Setting[] = schema,
): SectionReset {
  const list = Array.isArray(keys) ? keys : [];
  const count = list.length;
  const name = typeof category === "string" ? category : "";
  const labels = list.map((key) => {
    const row = Array.isArray(rows)
      ? rows.find((candidate) => candidate && candidate.key === key)
      : undefined;
    return row ? row.label : String(key);
  });
  const shown = labels.slice(0, MAX_NAMED);
  const more = count - shown.length;
  const detail = count
    ? shown.join(", ") + (more > 0 ? " and " + more + " more" : "") + "."
    : "";
  if (scope === "project")
    return {
      count,
      button: "Remove " + name + " overrides",
      buttonTitle: count
        ? "Remove " +
          plural(count, "project override", "project overrides") +
          " in " +
          name
        : "This project has no " + name + " overrides",
      title: "Remove " + name + " project overrides?",
      subtitle:
        "Remove " +
        plural(count, "project override", "project overrides") +
        " in " +
        name +
        " and inherit your user preferences.",
      detail,
      confirm: "Remove overrides",
      notice:
        "Removed " +
        plural(count, "project override", "project overrides") +
        " in " +
        name +
        ".",
    };
  return {
    count,
    button: "Reset " + name,
    buttonTitle: count
      ? "Restore the default of " +
        plural(count, "changed setting", "changed settings") +
        " in " +
        name
      : "No " + name + " setting is changed",
    title: "Reset " + name + " settings?",
    subtitle:
      "Restore the default value of " +
      plural(count, "changed setting", "changed settings") +
      " in " +
      name +
      ". Project overrides remain.",
    detail,
    confirm: "Reset settings",
    notice:
      "Reset " + plural(count, "setting", "settings") + " in " + name + ".",
  };
}
