/** Longest reason line shown on a card, in characters (a longer reason ends with three dots). */
export const MAX_REASON_LINE = 80;
/** Longest reason kept for the tooltip, in characters (a longer reason ends with three dots). */
export const MAX_REASON_TEXT = 400;
/** Most characters read from one candidate field before anything else happens. */
export const MAX_REASON_READ = 2000;
/** States that count as blocked. */
export const BLOCKED_STATES: readonly string[] = ["blocked"];
/** States that count as held, a task parked on purpose (not seen on real OpenRig rows, which park as blocked). */
export const HELD_STATES: readonly string[] = ["held", "on-hold", "parked"];
/** Fields read, in order, for a blocked task: blockedOn is the field OpenRig prints, the others are candidates. */
export const BLOCKED_REASON_KEYS: readonly string[] = [
  "blockedReason",
  "reason",
  "blockedOn",
];
/** Fields read, in order, for a held task. */
export const HELD_REASON_KEYS: readonly string[] = [
  "heldReason",
  "holdReason",
  "reason",
  "blockedOn",
];

/** Why a card is blocked or held: line is the one-line text on the card, title the longer text for the tooltip. */
export type TaskReason = {
  kind: "blocked" | "held";
  key: string;
  text: string;
  line: string;
  title: string;
};

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Line breaks, tabs and the Unicode space characters read as one space. */
function gap(code: number) {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** Control, zero-width and bidirectional-override characters are dropped. */
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

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.slice(0, MAX_REASON_READ)) {
    const code = char.codePointAt(0)!;
    if (gap(code)) text += " ";
    else if (!hidden(code) && (code < 0xd800 || code > 0xdfff)) text += char;
  }
  return text.replace(/ {2,}/g, " ").trim();
}

function cut(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return (
    chars
      .slice(0, max - 3)
      .join("")
      .replace(/ +$/, "") + "..."
  );
}

function stateOf(item: Record<string, unknown>): string {
  for (const key of ["status", "state"]) {
    if (!has(item, key)) continue;
    const state = clean(item[key]).toLowerCase();
    if (state) return state;
  }
  return "";
}

/** The reason a blocked or held task gives, read from a short list of string fields; null for any other state, for a missing or blank reason and for anything that is not an object. */
export function reasonOf(item: unknown): TaskReason | null {
  if (!plain(item)) return null;
  const state = stateOf(item);
  const kind = BLOCKED_STATES.includes(state)
    ? "blocked"
    : HELD_STATES.includes(state)
      ? "held"
      : null;
  if (kind === null) return null;
  for (const key of kind === "blocked"
    ? BLOCKED_REASON_KEYS
    : HELD_REASON_KEYS) {
    if (!has(item, key)) continue;
    const text = clean(item[key]);
    if (!text) continue;
    const prefix =
      (kind === "blocked" ? "Blocked" : "Held") +
      (key === "blockedOn" ? " on " : ": ");
    const full = cut(text, MAX_REASON_TEXT);
    return {
      kind,
      key,
      text: full,
      line: cut(prefix + full, MAX_REASON_LINE),
      title: prefix + full,
    };
  }
  return null;
}
