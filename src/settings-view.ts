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

/** One piece of a text: the part the search matches, or a part it does not. */
export interface TextPart {
  text: string;
  match: boolean;
}

/** The longest search text marked, counted as code points. A longer one is not marked at all (it cannot occur in a name or description) and is never cut, so a mark never disagrees with the search. */
export const MAX_QUERY = 100;

/** The most of a text that is searched for marks, in UTF-16 units; the rest comes back as plain text. */
export const MAX_SCAN = 2000;

/** The most marks in one text; later matches stay plain. */
export const MAX_MARKS = 20;

// Lower case one code point at a time, remembering for every unit of the result where in the original text its code point starts and ends. A match is mapped back through these, so it always covers whole code points (an emoji or a letter that lower cases to two units is never split).
function fold(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const char of text) {
    const piece = char.toLowerCase();
    folded += piece;
    for (let i = 0; i < piece.length; i++) {
      from.push(at);
      to.push(at + char.length);
    }
    at += char.length;
  }
  return { folded, from, to };
}

/** The text cut into plain and matching parts for the search words, case blind, left to right and never overlapping. The words are matched as text, not as a pattern (a dot or a bracket means itself), so there is nothing to escape and nothing that can run away. The parts always add up to the exact text, and a part is never cut inside a character. Not text or an empty or over-long search gives the text as one plain part; empty text gives no parts. */
export function highlightParts(text: unknown, query: unknown): TextPart[] {
  if (typeof text !== "string" || text === "") return [];
  const plain: TextPart[] = [{ text, match: false }];
  if (typeof query !== "string") return plain;
  const needle = query.trim();
  if (!needle || needle.length > MAX_QUERY * 2) return plain;
  if (Array.from(needle).length > MAX_QUERY) return plain;
  const wanted = fold(needle).folded;
  let head = text;
  if (text.length > MAX_SCAN) {
    const last = text.charCodeAt(MAX_SCAN - 1);
    head = text.slice(
      0,
      last >= 0xd800 && last <= 0xdbff ? MAX_SCAN - 1 : MAX_SCAN,
    );
  }
  const { folded, from, to } = fold(head);
  const parts: TextPart[] = [];
  let done = 0;
  let search = 0;
  let marks = 0;
  while (marks < MAX_MARKS) {
    const found = folded.indexOf(wanted, search);
    if (found < 0) break;
    const start = from[found];
    const end = to[found + wanted.length - 1];
    if (start < done) {
      search = found + 1;
      continue;
    }
    if (start > done)
      parts.push({ text: text.slice(done, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    done = end;
    search = found + wanted.length;
    marks++;
  }
  if (done < text.length) parts.push({ text: text.slice(done), match: false });
  return parts;
}
