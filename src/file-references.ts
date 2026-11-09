import { matchTerminalPaths } from "./terminal-path-links";

/** Most files one text can list. */
export const MAX_REFS = 10;
/** Most characters of a text that are read for files. */
export const MAX_SCAN_CHARS = 20000;
/** Largest line number kept; a bigger one is dropped and the file is listed without a line. */
export const MAX_LINE = 1000000;
/** Longest relative path that is listed, in characters. */
export const MAX_PATH_CHARS = 512;
/** Longest button text, in characters; a longer one is cut at the start so the file name and the line stay. */
export const MAX_LABEL_CHARS = 80;

/** A file a text mentions: its path relative to the project folder, an optional line and the text of its button. */
export interface FileReference {
  path: string;
  line?: number;
  label: string;
}

interface Root {
  text: string;
  fold: boolean;
}

/** Control characters (tab and line breaks stay, they separate words), line separators, zero-width and direction-changing characters are dropped. */
function hidden(code: number) {
  return (
    (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
    (code >= 127 && code <= 159) ||
    code === 0x61c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

const space = (code: number) => /\s/.test(String.fromCharCode(code));

// The first MAX_SCAN_CHARS characters, without a word the cut would leave half written.
function head(text: string) {
  if (text.length <= MAX_SCAN_CHARS) return text;
  let end = MAX_SCAN_CHARS;
  if (!space(text.charCodeAt(end)))
    while (end > 0 && !space(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}

// Markdown marks around a name (code spans, bold, link brackets) become spaces so the name stands alone, and a
// #L12 or #L12-L20 suffix is written the way the terminal matcher reads a line.
function clean(text: string) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (!hidden(code)) out += char;
  }
  return out
    .replace(/[`*[\]]/g, " ")
    .replace(/#L(\d+)(?:-L?\d+)?(?!\w)/g, ":$1");
}

// The project folder in the form the paths are compared in; a Windows folder is compared without case.
function rootOf(value: unknown): Root | null {
  if (typeof value !== "string" || value.length > MAX_PATH_CHARS) return null;
  const text = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!text) return null;
  return { text, fold: /^[A-Za-z]:/.test(text) || value.includes("\\") };
}

function under(path: string, root: Root): string | null {
  const start = path.slice(0, root.text.length);
  const same = root.fold
    ? start.toLowerCase() === root.text.toLowerCase()
    : start === root.text;
  if (!same || path[root.text.length] !== "/") return null;
  return path.slice(root.text.length + 1);
}

const PART = /^[\w@. -]+$/;

function usablePart(part: string) {
  return PART.test(part) && part === part.trim() && !/^\.{2,}$/.test(part);
}

// A path inside the project folder with forward slashes, or null: an absolute path must lie under the folder, and an
// empty part, a part made only of dots (so "..") or a path that is too long is refused.
function relative(file: string, root: Root | null): string | null {
  let value = file.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(value) || value.startsWith("/")) {
    const inside = root ? under(value, root) : null;
    if (inside === null) return null;
    value = inside;
  }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === ".") continue;
    if (!usablePart(part)) return null;
    parts.push(part);
  }
  if (!parts.length) return null;
  const path = parts.join("/");
  return path.length <= MAX_PATH_CHARS ? path : null;
}

// The end of the name must be an extension with a letter in it, which leaves out versions such as 1.2.3, and a bare
// abbreviation such as e.g. is left out unless a line follows it.
function plausible(path: string, line: number | undefined) {
  if (!/\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(path)) return false;
  return !(line === undefined && /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(path));
}

const lineOf = (line: unknown) =>
  typeof line === "number" &&
  Number.isInteger(line) &&
  line >= 1 &&
  line <= MAX_LINE
    ? line
    : undefined;

function labelOf(path: string, line?: number) {
  const text = line === undefined ? path : path + ":" + line;
  if (text.length <= MAX_LABEL_CHARS) return text;
  return "\u2026" + text.slice(text.length - (MAX_LABEL_CHARS - 1));
}

/** The files a text mentions, at most MAX_REFS, the first mention of each file and line first. It reads the first MAX_SCAN_CHARS characters with the terminal's path matcher, drops hidden characters, accepts only paths relative to the project folder (an absolute path only when it lies under root, then made relative) and refuses any path with a .. part, a web address or a ~. A line is kept only when it is a whole number from 1 to MAX_LINE. */
export function fileReferences(text: unknown, root?: unknown): FileReference[] {
  if (typeof text !== "string" || !text) return [];
  const base = rootOf(root);
  const found: FileReference[] = [];
  const seen = new Set<string>();
  for (const match of matchTerminalPaths(clean(head(text)))) {
    const path = relative(match.file, base);
    if (path === null) continue;
    const line = lineOf(match.line);
    if (!plausible(path, line)) continue;
    const key = path + ":" + (line ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(
      line === undefined
        ? { path, label: labelOf(path) }
        : { path, line, label: labelOf(path, line) },
    );
    if (found.length >= MAX_REFS) break;
  }
  return found;
}
