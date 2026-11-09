import {
  defaults,
  schema,
  type Overrides,
  type Setting,
  type SettingKey,
} from "./settings";

/** The kinds of value a setting holds. */
export type SettingValue = boolean | number | string;

/**
 * How the open project relates to a setting: it inherits the user value, it
 * overrides it with another value, or it sets the very value the user scope has.
 */
export type OverrideState = "inherited" | "overridden" | "same";

/** One setting seen from both scopes. */
export interface OverrideInfo {
  key: SettingKey;
  state: OverrideState;
  /** The value in the user scope: the person's own value, else the default. */
  userValue: SettingValue;
  /** The project's own value; undefined when the project has none. */
  projectValue: SettingValue | undefined;
}

/** A setting the project overrides, and whether its value differs from the user scope's. */
export interface OverriddenKey {
  key: SettingKey;
  differs: boolean;
}

/** The short note drawn on a user scope row. */
export interface OverrideNote {
  state: "overridden" | "same";
  text: string;
  title: string;
}

/** The count line for the open project. */
export interface OverrideSummary {
  count: number;
  differing: number;
  text: string;
  title: string;
}

/** The longest value text shown in a note, counted as code points. */
export const MAX_VALUE_TEXT = 40;

/** The most setting keys named in the summary tooltip. */
export const MAX_TITLE_KEYS = 10;

function ownValue(source: unknown, key: string): SettingValue | undefined {
  if (!source || typeof source !== "object") return undefined;
  if (!Object.hasOwn(source, key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
    ? value
    : undefined;
}

/** Reads one setting from both scopes. Only own properties count, so an inherited or missing key is never an override. */
export function describeOverride(
  row: Pick<Setting, "key">,
  user: Overrides | null | undefined,
  project: Overrides | null | undefined,
): OverrideInfo {
  const key = row.key;
  const projectValue = ownValue(project, key);
  const userOwn = ownValue(user, key);
  const userValue =
    userOwn !== undefined ? userOwn : (defaults[key] as SettingValue);
  const state: OverrideState =
    projectValue === undefined
      ? "inherited"
      : projectValue === userValue
        ? "same"
        : "overridden";
  return { key, state, userValue, projectValue };
}

/** The settings the project overrides, in the order the settings page lists them, each flagged when its value differs from the user scope's. */
export function overriddenKeys(
  user: Overrides | null | undefined,
  project: Overrides | null | undefined,
): OverriddenKey[] {
  const found: OverriddenKey[] = [];
  for (const row of schema) {
    const info = describeOverride(row, user, project);
    if (info.state !== "inherited")
      found.push({ key: row.key, differs: info.state === "overridden" });
  }
  return found;
}

/** A value as a person reads it: On or Off for a switch, an option's label for a choice, other text on one line cut after 40 characters. */
export function formatValue(
  row: Pick<Setting, "options">,
  value: unknown,
): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value !== "number" && typeof value !== "string") return "";
  const option = row.options?.find((o) => o.value === String(value));
  const text = (option ? option.label : String(value))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "empty";
  const points = Array.from(text);
  return points.length > MAX_VALUE_TEXT
    ? points
        .slice(0, MAX_VALUE_TEXT - 3)
        .join("")
        .trimEnd() + "..."
    : text;
}

/** The note for a user scope row, or null when the project inherits the setting. */
export function overrideNote(
  row: Pick<Setting, "key" | "options">,
  user: Overrides | null | undefined,
  project: Overrides | null | undefined,
): OverrideNote | null {
  const info = describeOverride(row, user, project);
  if (info.state === "inherited") return null;
  const projectText = formatValue(row, info.projectValue);
  const userText = formatValue(row, info.userValue);
  if (info.state === "overridden")
    return {
      state: "overridden",
      text: "Overridden in this project: " + projectText,
      title:
        "This project uses " +
        projectText +
        "; your user setting is " +
        userText +
        ". Open the Project scope to change it or remove the override.",
    };
  return {
    state: "same",
    text: "Also set in this project (same value)",
    title:
      "This project sets the same value as your user setting (" +
      userText +
      ") and keeps it if you change your user setting. Open the Project scope to remove the override.",
  };
}

/** The count line for the open project: how many settings it overrides and how many of those differ from the user scope. Empty text when it overrides none. */
export function summarizeOverrides(
  user: Overrides | null | undefined,
  project: Overrides | null | undefined,
): OverrideSummary {
  const list = overriddenKeys(user, project);
  const count = list.length;
  const differing = list.filter((item) => item.differs).length;
  if (count === 0) return { count, differing, text: "", title: "" };
  const text =
    "This project overrides " +
    count +
    (count === 1 ? " setting" : " settings") +
    (differing === count
      ? "."
      : "; " +
        differing +
        (differing === 1 ? " differs" : " differ") +
        " from your user " +
        (differing === 1 ? "value." : "values."));
  const shown = list.slice(0, MAX_TITLE_KEYS).map((item) => item.key);
  const more = count - shown.length;
  const title =
    "Overridden here: " +
    shown.join(", ") +
    (more > 0 ? " and " + more + " more" : "") +
    ".";
  return { count, differing, text, title };
}
