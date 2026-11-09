/** Most notes kept; a new note that would be the 201st pushes out the one changed longest ago. */
export const MAX_NOTES = 200;
/** Most characters (code points, not UTF-16 units) one note keeps; the rest is cut. */
export const MAX_NOTE_CHARS = 2000;
/** Longest note key kept: the connection id, one separator and the seat id. */
export const MAX_NOTE_KEY = 200;

/** One saved note: the cleaned text and the time, in milliseconds since 1970, it was last changed. */
export type SeatNote = { text: string; updatedAt: number };
/** Saved notes keyed by noteKey. */
export type SeatNotes = Record<string, SeatNote>;

const SEPARATOR = "|";
// A saved text is read up to this many UTF-16 units before cleaning, so a hostile file cannot make a load slow.
const SCAN_CHARS = 20000;
// A saved map is read up to this many keys, for the same reason.
const SCAN_KEYS = 1000;
const PREVIEW_CHARS = 80;

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Control, line-separator, zero-width, bidirectional and unpaired-surrogate characters are refused. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfeff
  );
}

function clean(text: string) {
  for (const char of text) if (hidden(char.codePointAt(0)!)) return false;
  return true;
}

function usableKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (key.length < 3 || key.length > MAX_NOTE_KEY) return false;
  const at = key.indexOf(SEPARATOR);
  return at >= 1 && at <= key.length - 2 && clean(key);
}

function stamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** The key one seat's note is kept under: the connection id, a bar and the seat id (rig id or name, a colon and the seat's logical name); empty when either is not text, the connection id holds a bar, the result is over 200 characters or it holds a hidden character. */
export function noteKey(connectionId: unknown, seatId: unknown): string {
  if (typeof connectionId !== "string" || typeof seatId !== "string") return "";
  if (!connectionId || !seatId || connectionId.includes(SEPARATOR)) return "";
  const key = connectionId + SEPARATOR + seatId;
  return usableKey(key) ? key : "";
}

/** Cleans note text: line breaks become line feeds, every control character except line feed and tab, every zero-width, bidirectional and line-separator character and every unpaired surrogate is dropped, the text is cut to 2000 code points and trailing white space is trimmed; anything but a string gives an empty note. At most the first 20000 UTF-16 units are read. */
export function cleanNote(value: unknown): string {
  if (typeof value !== "string") return "";
  const head = value.length > SCAN_CHARS ? value.slice(0, SCAN_CHARS) : value;
  const kept: string[] = [];
  for (const char of head.replace(/\r\n?/g, "\n")) {
    if (kept.length >= MAX_NOTE_CHARS) break;
    const code = char.codePointAt(0)!;
    if (code === 10 || code === 9 || !hidden(code)) kept.push(char);
  }
  return kept.join("").trimEnd();
}

/** How many code points the text holds (what the editor counts against 2000); anything but a string is 0. */
export function countNoteChars(value: unknown): number {
  return typeof value === "string" ? Array.from(value).length : 0;
}

/** The note as one short line for a tooltip: cleaned, white space squeezed, cut to 80 characters and ended with three dots when cut; empty for no note. */
export function notePreview(value: unknown): string {
  const flat = cleanNote(value).replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > PREVIEW_CHARS
    ? chars.slice(0, PREVIEW_CHARS).join("").trimEnd() + "..."
    : flat;
}

/** Defensive load: keeps the entries with a usable key and some text left after cleaning, reads at most 1000 keys, and keeps the 200 changed most recently (an equal time keeps the later entry); a time that is not a finite number of at least 0 counts as 0, so the note is kept but is the first to go. */
export function normalizeSeatNotes(value: unknown): SeatNotes {
  const rows: [string, SeatNote][] = [];
  if (plain(value))
    for (const key of Object.keys(value).slice(0, SCAN_KEYS)) {
      if (!usableKey(key)) continue;
      const entry = value[key];
      if (!plain(entry)) continue;
      const text = cleanNote(entry.text);
      if (text) rows.push([key, { text, updatedAt: stamp(entry.updatedAt) }]);
    }
  if (rows.length > MAX_NOTES) {
    const out = new Set(
      rows
        .map((row, index) => ({ index, at: row[1].updatedAt }))
        .sort((a, b) => a.at - b.at || a.index - b.index)
        .slice(0, rows.length - MAX_NOTES)
        .map((row) => row.index),
    );
    return Object.fromEntries(rows.filter((_, index) => !out.has(index)));
  }
  return Object.fromEntries(rows);
}

/** The saved text for a key, cleaned again, or an empty string; only the key's own entry counts, never an inherited property. */
export function noteFor(notes: unknown, key: string): string {
  if (!plain(notes) || !usableKey(key) || !has(notes, key)) return "";
  const entry = notes[key];
  return plain(entry) ? cleanNote(entry.text) : "";
}

/** Whether a key has a note. */
export function hasNote(notes: unknown, key: string): boolean {
  return noteFor(notes, key) !== "";
}

/** The notes with this key's text set, or the very same object when nothing changes (same cleaned text, or clearing a key that has no note); a text that is empty after cleaning clears the key; a bad key changes nothing; a new key when 200 notes are kept pushes out the one changed longest ago; a time that is not a finite number of at least 0 counts as 0. The notes passed in are never changed. */
export function setNote(
  notes: SeatNotes,
  key: string,
  text: unknown,
  now: number,
): SeatNotes {
  if (!usableKey(key)) return notes;
  const next = cleanNote(text);
  const before = noteFor(notes, key);
  if (next === before) return notes;
  const copy = normalizeSeatNotes(notes);
  delete copy[key];
  if (next) {
    const keys = Object.keys(copy);
    if (keys.length >= MAX_NOTES) {
      let oldest = keys[0];
      for (const k of keys)
        if (copy[k].updatedAt < copy[oldest].updatedAt) oldest = k;
      delete copy[oldest];
    }
    copy[key] = { text: next, updatedAt: stamp(now) };
  }
  return copy;
}
