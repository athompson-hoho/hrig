/** The columns of an export, in order. This list is the whole allowlist: no other field of a task is ever read. */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  "id",
  "title",
  "state",
  "owner",
  "tags",
  "age",
  "reason",
];
/** Most rows an export holds; the board itself lists at most 1000 tasks. */
export const MAX_EXPORT_ROWS = 1000;
/** Most characters one cell holds, counted in whole characters; a longer cell ends with three dots. */
export const MAX_CELL = 200;
/** Most characters read from one value before anything else happens. */
export const MAX_CELL_READ = 2000;
/** Most tags written to one row. */
export const MAX_ROW_TAGS = 32;
/** The sentence shown with the export buttons and after an export. */
export const EXPORT_NOTE =
  "Exports only the tasks shown, without task bodies. Review before sharing.";

/** One column name of an export. */
export type ExportColumn =
  "id" | "title" | "state" | "owner" | "tags" | "age" | "reason";
/** One exported task: seven text cells. */
export type ExportRow = Record<ExportColumn, string>;
/** The two formats: csv or md (a markdown table). */
export type ExportFormat = "csv" | "md";
/** What the board lends an export: readers for a task's tags (a list of text), its age (an object with a label) and its reason (an object with a line). */
export type ExportReaders = {
  tags?: (item: Record<string, unknown>) => unknown;
  age?: (item: Record<string, unknown>, at: number) => unknown;
  reason?: (item: Record<string, unknown>) => unknown;
};
/** The rows of an export and the number of tasks the list held (more than rows when the list was cut). */
export type ExportSet = { rows: ExportRow[]; total: number };
/** A file ready to be saved: its name, its text and its media type. */
export type ExportFile = { name: string; text: string; type: string };

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

/** Control, zero-width, bidirectional-override, invisible tag characters and lone surrogates are dropped. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    code === 0xad ||
    code === 0x61c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/** Text with hidden characters dropped and every space character made a plain space; tab, line feed and carriage return are kept when asked (CSV quotes them) and are spaces otherwise. */
function clean(value: unknown, keepBreaks: boolean): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.slice(0, MAX_CELL_READ)) {
    const code = char.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13)
      text += keepBreaks ? char : " ";
    else if (gap(code)) text += " ";
    else if (!hidden(code)) text += char;
  }
  return text;
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

/** One CSV cell: cut, defended against spreadsheet formulas, then quoted when it holds a comma, a quote or a line break. */
function csvCell(value: unknown): string {
  let text = cut(clean(value, true), MAX_CELL);
  // A cell a spreadsheet could read as a formula (it starts, after any spaces, with = + - or @, or starts with a tab or a carriage return) gets a single quote in front.
  if (/^[\t\r]/.test(text) || /^\s*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** The rows of a list: only the entries that are objects, at most 1000. */
function listOf(rows: unknown): Record<string, unknown>[] {
  const list: Record<string, unknown>[] = [];
  if (!Array.isArray(rows)) return list;
  for (const row of rows) {
    if (list.length >= MAX_EXPORT_ROWS) break;
    if (plain(row)) list.push(row);
  }
  return list;
}

/** The text of a row's own cell: a string as it is, anything else is empty. */
function cellOf(row: Record<string, unknown>, column: ExportColumn): string {
  const value = has(row, column) ? row[column] : "";
  return typeof value === "string" ? value : "";
}

/** A task field as text: a string as it is, a finite number written out, anything else empty; only the task's own fields count. */
function field(item: Record<string, unknown>, key: string): string {
  const value = has(item, key) ? item[key] : "";
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

/** The rows for the tasks of a list, one per entry that is an object, in list order, at most 1000: id, title, state (the item's status) and owner (its destination) are the item's own text fields, and tags, age (given the time in epoch milliseconds) and reason come from the readers the caller lends; no other field of a task is read, and the total counts every entry that is an object. */
export function exportRows(
  items: unknown,
  at: number,
  readers?: ExportReaders,
): ExportSet {
  const rows: ExportRow[] = [];
  let total = 0;
  if (!Array.isArray(items)) return { rows, total };
  const read: ExportReaders = plain(readers) ? readers : {};
  for (const item of items) {
    if (!plain(item)) continue;
    total += 1;
    if (rows.length >= MAX_EXPORT_ROWS) continue;
    const tags = read.tags ? read.tags(item) : undefined;
    const age = read.age ? read.age(item, at) : null;
    const reason = read.reason ? read.reason(item) : null;
    rows.push({
      id: field(item, "id"),
      title: field(item, "title"),
      state: field(item, "status"),
      owner: field(item, "destination"),
      tags: Array.isArray(tags)
        ? tags
            .filter((tag): tag is string => typeof tag === "string")
            .slice(0, MAX_ROW_TAGS)
            .join(", ")
        : "",
      age: plain(age) && typeof age.label === "string" ? age.label : "",
      reason:
        plain(reason) && typeof reason.line === "string" ? reason.line : "",
    });
  }
  return { rows, total };
}

/** The rows as CSV: a header line, then one line per row, lines ending in CRLF, cells quoted as RFC 4180 asks, and every cell that a spreadsheet could read as a formula prefixed with a single quote. */
export function toCsv(rows: unknown): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of listOf(rows))
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(cellOf(row, c))).join(","));
  return lines.join("\r\n") + "\r\n";
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** The file name for a format and a time in epoch milliseconds: hrig-tasks-YYYYMMDD-HHMM with the extension csv or md, in the computer's local time and never with a connection or rig name; a time that is not a usable date gives hrig-tasks with the extension. */
export function exportName(format: ExportFormat, at: number): string {
  const ext = format === "md" ? "md" : "csv";
  const date = new Date(typeof at === "number" ? at : NaN);
  const year = date.getFullYear();
  if (!(at > 0) || !(year >= 1970 && year <= 9999)) return "hrig-tasks." + ext;
  return (
    "hrig-tasks-" +
    pad(year, 4) +
    pad(date.getMonth() + 1, 2) +
    pad(date.getDate(), 2) +
    "-" +
    pad(date.getHours(), 2) +
    pad(date.getMinutes(), 2) +
    "." +
    ext
  );
}

/** The file for a format: the name for the time, the text of the rows and the media type; any other format throws. */
export function exportFile(
  format: ExportFormat,
  rows: unknown,
  at: number,
): ExportFile {
  if (format === "csv")
    return {
      name: exportName("csv", at),
      text: toCsv(rows),
      type: "text/csv;charset=utf-8",
    };
  throw new Error("Unsupported export format.");
}

const whole = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

/** The text and tooltip of an export button: the count of tasks shown is in the text, the tooltip is the note (or says that nothing is shown). */
export function exportButton(
  format: ExportFormat,
  shown: number,
): { text: string; title: string } {
  const count = whole(shown);
  return {
    text:
      "Export " + (format === "md" ? "Markdown" : "CSV") + " (" + count + ")",
    title: count > 0 ? EXPORT_NOTE : "No tasks are shown to export.",
  };
}

/** The line shown when a download starts: how many tasks go into the file and in which format (the first rows of a longer list say so), then the note. */
export function exportNotice(
  format: ExportFormat,
  exported: number,
  total: number,
): string {
  const done = whole(exported);
  const all = whole(total);
  const name = format === "md" ? "markdown" : "CSV";
  const what =
    done < all
      ? "the first " + done + " of " + all + " tasks"
      : done + (done === 1 ? " task" : " tasks");
  return "Started the download of " + what + " as " + name + ". " + EXPORT_NOTE;
}
