import { lineCount } from "./terminal-paste";

/** How many recent pastes one terminal remembers; the oldest one is dropped past this. */
export const MAX_PASTE_HISTORY = 10;

/** The longest text that is remembered: a longer paste still goes to the terminal, but it is never kept. */
export const MAX_PASTE_CHARS = 10000;

/** How many characters of the first line with text the picker shows before an ellipsis. */
export const MAX_PREVIEW_CHARS = 80;

/** What the picker shows for one remembered paste: the cleaned first line with text, the line count the paste dialog would show for it, and its length in characters. */
export interface PastePreview {
  text: string;
  lines: number;
  chars: number;
}

// Only this much of a paste is looked at to find its first line with text, so a huge entry stays cheap.
const SCAN_LIMIT = 4096;

// Control characters (the tab stays and is collapsed later), the soft hyphen, zero-width, direction and other invisible formatting characters, tag characters and lone surrogates: none of them can be shown, and some could reorder what the person reads. The zero-width joiner and the variation selectors stay, so emoji sequences stay whole.
const HIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u{00ad}\u{061c}\u{180e}\u{200b}\u{200c}\u{200e}\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{feff}\u{fff9}-\u{fffb}\ud800-\udfff\u{e0000}-\u{e007f}]/gu;

const SPACES = /\s+/gu;

/** The list with the text moved to the front and at most MAX_PASTE_HISTORY long; empty, whitespace-only, over-long and non-string text is ignored. The text is kept exactly as pasted, so a pasted line break still counts when it is pasted again. The input list is never changed. */
export function pushPaste(list: readonly string[], text: string): string[] {
  if (
    typeof text !== "string" ||
    text.length > MAX_PASTE_CHARS ||
    text.trim() === ""
  )
    return list.slice(0, MAX_PASTE_HISTORY);
  return [text, ...list.filter((item) => item !== text)].slice(
    0,
    MAX_PASTE_HISTORY,
  );
}

/** The picker's line for a paste: the first line that has visible text, cleaned and cut to MAX_PREVIEW_CHARS characters with an ellipsis, plus the line count and the length. Empty text shows nothing. */
export function previewOf(text: string): PastePreview {
  if (typeof text !== "string" || text === "")
    return { text: "", lines: 0, chars: 0 };
  const head = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text;
  let shown = "";
  let start = 0;
  while (start < head.length) {
    let end = start;
    while (end < head.length) {
      const c = head.charCodeAt(end);
      if (c === 13 || c === 10) break;
      end++;
    }
    const line = head
      .slice(start, end)
      .replace(HIDDEN, "")
      .replace(SPACES, " ")
      .trim();
    if (line !== "") {
      shown = line;
      break;
    }
    start = end + (head.startsWith("\r\n", end) ? 2 : 1);
  }
  const points = [...shown];
  if (points.length > MAX_PREVIEW_CHARS)
    shown = points.slice(0, MAX_PREVIEW_CHARS).join("").trimEnd() + "\u{2026}";
  return { text: shown, lines: lineCount(text), chars: text.length };
}

/** The empty list: what a terminal's history becomes when it is cleared. */
export function clearPastes(): string[] {
  return [];
}
