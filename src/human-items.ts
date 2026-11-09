/** Address shapes of a person in OpenRig, as the daemon classifies them (0.7.7, isHumanSeatSessionRef): human@host, human@kernel, human-<name>@host or @kernel, and <name>@external. The one place to change if OpenRig addresses a person differently. Keep the patterns without the g and y flags: they are tested over and over. */
export const HUMAN_ADDRESS_PATTERNS: readonly RegExp[] = [
  /^human(?:-[A-Za-z0-9._-]+)?@(?:kernel|host)$/,
  /^[A-Za-z0-9._:-]+@external$/,
];
/** States of an item that is still waiting; the default queue list shows only these. */
export const ACTIVE_STATES: readonly string[] = [
  "pending",
  "in-progress",
  "blocked",
];
/** Longest address, id or state read from a row, in characters; a longer value counts as missing. */
export const MAX_FIELD = 200;
/** Most characters read from a subject before it is cleaned. */
export const MAX_READ = 400;
/** Longest subject in a notification, in characters, including the three dots of a cut. */
export const MAX_SUBJECT = 80;

/** An item for the person: its id and a short cleaned subject, nothing else of the row. */
export type HumanItem = { id: string; subject: string };
/** What to tell the person about a batch of new items: the notification title and body, and one line for the activity list. */
export type HumanNotice = {
  title: string;
  body: string;
  entry: string;
  count: number;
};
/** What a connection has already shown: ids is null until the first answer has been taken in silently. */
export type HumanSeen = { key: string; ids: Set<string> | null };
/** Nothing seen yet: the next answer is taken in without a notification. */
export const NO_SEEN: HumanSeen = { key: "", ids: null };

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The first of the named fields that holds non-blank text of a sensible length, trimmed. */
function short(item: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string") {
      const text = value.trim();
      if (text !== "" && text.length <= MAX_FIELD) return text;
    }
  }
  return "";
}

/** Characters that read as a space: controls, line and paragraph separators and the Unicode space characters. */
function spaced(code: number) {
  return (
    code <= 32 ||
    (code >= 127 && code <= 160) ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** Zero-width, direction-changing, invisible-tag and lone surrogate characters are dropped. */
function hidden(code: number) {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/** One line of plain text for a notification: cleaned, spaces collapsed and cut to MAX_SUBJECT characters. */
function cleanSubject(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.slice(0, MAX_READ)) {
    const code = char.codePointAt(0)!;
    if (spaced(code)) text += " ";
    else if (!hidden(code)) text += char;
  }
  const chars = Array.from(text.replace(/ {2,}/g, " ").trim());
  return chars.length <= MAX_SUBJECT
    ? chars.join("")
    : chars.slice(0, MAX_SUBJECT - 3).join("") + "...";
}

/** The subject of a row: its summary, else its subject field. A body or preview is never used. */
function subjectOf(item: Record<string, unknown>): string {
  return cleanSubject(item.summary) || cleanSubject(item.subject);
}

/** True when the row's destination is a person, by HUMAN_ADDRESS_PATTERNS. Reads only the destination; anything that is not a row gives false. */
export function isHumanAddressed(item: unknown): boolean {
  if (!plain(item)) return false;
  const address = short(item, ["destinationSession", "destination"]);
  return (
    address !== "" &&
    HUMAN_ADDRESS_PATTERNS.some((pattern) => pattern.test(address))
  );
}

/** True when the row is addressed to a person and is still waiting (pending, in-progress or blocked). */
export function isOpenHumanItem(item: unknown): boolean {
  if (!isHumanAddressed(item)) return false;
  const state = short(item as Record<string, unknown>, ["state", "status"]);
  return ACTIVE_STATES.includes(state.toLowerCase());
}

/**
 * The items for the person that were not there at the last answer. With seen
 * null (the first answer on a connection) nothing is new: the ids are only
 * taken in, so starting the app never floods. nextSeen is a new set; the one
 * passed in is not changed.
 */
export function newHumanItems(
  items: unknown,
  seen: ReadonlySet<string> | null,
): { fresh: HumanItem[]; nextSeen: Set<string> } {
  const found = new Map<string, Record<string, unknown>>();
  if (Array.isArray(items))
    for (const item of items) {
      if (!isOpenHumanItem(item)) continue;
      const row = item as Record<string, unknown>;
      const id = short(row, ["qitemId", "id"]);
      if (id !== "" && !found.has(id)) found.set(id, row);
    }
  const fresh: HumanItem[] = [];
  if (seen)
    for (const [id, row] of found)
      if (!seen.has(id)) fresh.push({ id, subject: subjectOf(row) });
  const nextSeen = new Set<string>(seen ?? []);
  for (const id of found.keys()) nextSeen.add(id);
  return { fresh, nextSeen };
}

/** The notification for a batch: a count in the title, at most the first subject in the body, one activity line. Nothing else of a row is ever used. */
export function notificationFor(fresh: readonly HumanItem[]): HumanNotice {
  const count = Array.isArray(fresh) ? fresh.length : 0;
  const first: unknown = count > 0 ? fresh[0] : null;
  const subject = plain(first) ? cleanSubject(first.subject) : "";
  const title =
    count === 1 ? "1 new item for you" : count + " new items for you";
  const lead = count === 1 ? "New item for you" : title;
  return {
    title,
    body:
      subject ||
      "Open the Task queue to see " + (count === 1 ? "it." : "them."),
    entry: subject ? lead + ": " + subject : lead,
    count,
  };
}

/**
 * One poll of one connection: the state to keep and the notification to show,
 * if any. A different connection key starts over silently, and an answer that
 * is not a list changes nothing, so neither can flood.
 */
export function nextHumanPoll(
  prev: HumanSeen,
  key: string,
  items: unknown,
): { seen: HumanSeen; notice: HumanNotice | null } {
  const ids = prev && prev.key === key ? prev.ids : null;
  if (!Array.isArray(items)) return { seen: { key, ids }, notice: null };
  const { fresh, nextSeen } = newHumanItems(items, ids);
  return {
    seen: { key, ids: nextSeen },
    notice: fresh.length > 0 ? notificationFor(fresh) : null,
  };
}
