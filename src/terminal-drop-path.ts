/** Most files one drop may insert; a bigger drop is refused whole, never cut. */
export const MAX_DROP_FILES = 20;
/** Longest single path, in UTF-16 units, that is quoted and inserted. */
export const MAX_DROP_PATH = 4096;
/** Longest text one drop inserts, quotes and separators included. */
export const MAX_DROP_TEXT = 32768;
/** The only notice for a terminal that is not local: a path on this computer means nothing on another host. */
export const DROP_REMOTE_NOTICE =
  "Dropped paths are local; remote upload is not supported. Nothing was inserted.";
/** The notice for a one-time OpenRig action terminal. */
export const DROP_ACTION_NOTICE =
  "Dropped paths are not inserted into OpenRig action terminals. Nothing was inserted.";
/** The notice for a terminal that is not connected right now. */
export const DROP_ENDED_NOTICE =
  "Terminal is not connected. Nothing was inserted.";

/** The quoting dialects: POSIX shells, Command Prompt and PowerShell. */
export type DropShell = "posix" | "cmd" | "powershell";

/** What decides whether a drop may insert: the terminal's connection kind, its kind of terminal and its connection state. */
export type DropTarget = {
  kind: unknown;
  rigControl: boolean;
  ready: boolean;
  ended: number | null;
};

/** The result of one drop: the text to paste and how many paths it holds, or the refusal. */
export type DropInsert = { text: string; count: number } | { error: string };

// PowerShell reads these typographic single quotes as quote characters, so each is doubled like the plain one.
const POWERSHELL_QUOTES = [
  "'",
  String.fromCharCode(0x2018),
  String.fromCharCode(0x2019),
  String.fromCharCode(0x201a),
  String.fromCharCode(0x201b),
];

// Invisible formatting characters (zero width, direction marks and overrides): the same family the snippet check refuses.
const INVISIBLE = /\p{Cf}/u;

/** True when a drag carries files from outside the app; a tab drag does not, so it is never touched. */
export function isFileDrag(types: unknown): boolean {
  if (typeof types !== "object" || types === null) return false;
  const list = types as { length?: unknown; [index: number]: unknown };
  const length = typeof list.length === "number" ? list.length : 0;
  for (let i = 0; i < length; i++) if (list[i] === "Files") return true;
  return false;
}

/** The dialect a local terminal reads: Windows runs Command Prompt or PowerShell, every other system a POSIX shell. */
export function dropShell(platform: unknown, localShell: unknown): DropShell {
  if (platform !== "win32") return "posix";
  return localShell === "cmd" ? "cmd" : "powershell";
}

/** Quotes one path for the shell, or answers null for an empty or blank path, one over 4096 units, a control, line-separator, invisible or lone-surrogate character, or (Command Prompt only) a percent sign, exclamation mark, caret or double quote. */
export function quote(path: unknown, shell: DropShell): string | null {
  if (typeof path !== "string" || path.trim() === "") return null;
  if (path.length > MAX_DROP_PATH) return null;
  for (const char of path) {
    const code = char.codePointAt(0)!;
    if (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0xd800 && code <= 0xdfff) ||
      INVISIBLE.test(char)
    )
      return null;
  }
  if (shell === "cmd") return /[%!^"]/.test(path) ? null : '"' + path + '"';
  if (shell === "powershell") {
    let text = "";
    for (const char of path)
      text += POWERSHELL_QUOTES.includes(char) ? char + char : char;
    return "'" + text + "'";
  }
  if (shell === "posix") return "'" + path.replace(/'/g, "'\\''") + "'";
  return null;
}

/** Quotes every path, joins them with single spaces and ends with one space (so two drops never fuse into one word), never with a line break; one bad path, no path or too many refuses the whole drop. */
export function dropInsertText(
  paths: readonly unknown[],
  shell: DropShell,
): DropInsert {
  if (!Array.isArray(paths) || paths.length === 0)
    return { error: "Drop a file from this computer to insert its path." };
  if (paths.length > MAX_DROP_FILES)
    return {
      error: `Drop at most ${MAX_DROP_FILES} files at a time. Nothing was inserted.`,
    };
  const quoted: string[] = [];
  for (const path of paths) {
    const one = quote(path, shell);
    if (one === null)
      return {
        error:
          "A dropped path cannot be inserted safely (empty, too long, or with a control, invisible or shell-special character). Nothing was inserted.",
      };
    quoted.push(one);
  }
  const text = quoted.join(" ") + " ";
  if (text.length > MAX_DROP_TEXT)
    return {
      error: "The dropped paths are too long to insert. Nothing was inserted.",
    };
  return { text, count: quoted.length };
}

/** Answers the notice that refuses a drop, or an empty string when the terminal accepts it: action terminals first, then any connection that is not local, then one that is not connected. */
export function dropRefusal(target: DropTarget): string {
  if (target.rigControl) return DROP_ACTION_NOTICE;
  if (target.kind !== "local") return DROP_REMOTE_NOTICE;
  if (target.ended !== null || !target.ready) return DROP_ENDED_NOTICE;
  return "";
}

/** The notice after an insert: how many paths went in and that nothing was run. */
export function dropNotice(count: number): string {
  return `Inserted ${count === 1 ? "1 path" : count + " paths"} at the prompt. Nothing was run.`;
}
