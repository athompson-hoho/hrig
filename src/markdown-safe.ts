/** Most characters of one text that are read; the rest is cut off and the result says so. */
export const MAX_MARKDOWN_CHARS = 100000;
/** Most blocks one text can produce; later ones are cut off and the result says so. */
export const MAX_MARKDOWN_BLOCKS = 2000;

/** Inline content of a block: plain text only. Every string is shown as text and is never read as markup. */
export type MdInline = { type: "text"; text: string };
/** The blocks the subset knows: paragraph, heading levels 1 to 3 and fenced code. */
export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | { type: "code"; text: string };
/** Limits a caller may lower; they can never be raised above the two constants. */
export type MdCaps = { maxChars: number; maxBlocks: number };
/** The parsed blocks, whether the text was cut off by a limit, and the original length in characters. */
export type MdResult = { blocks: MdBlock[]; truncated: boolean; chars: number };

/** Control characters except tab and line feed, line and paragraph separators, zero-width, directional and word-joiner characters are dropped; the joiners used in emoji and some scripts are kept. */
function hidden(code: number): boolean {
  return (
    (code < 32 && code !== 9 && code !== 10) ||
    (code >= 127 && code <= 159) ||
    code === 0x61c ||
    code === 0x200b ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

function clean(text: string): string {
  const unix = text.replace(/\r\n?/g, "\n");
  let out = "";
  let from = 0;
  for (let i = 0; i < unix.length; i++) {
    if (hidden(unix.charCodeAt(i))) {
      out += unix.slice(from, i);
      from = i + 1;
    }
  }
  return from === 0 ? unix : out + unix.slice(from);
}

function limit(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(max, Math.floor(value))
    : max;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,3})[ \t]+(\S.*)$/;

function inline(text: string): MdInline[] {
  return text ? [{ type: "text", text }] : [];
}

function fenceOf(line: string): { marker: string; size: number } | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  // A backtick fence cannot carry a backtick in its info text: that line is inline code.
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { marker: m[1][0], size: m[1].length };
}

function closesFence(line: string, marker: string, size: number): boolean {
  const t = line.trim();
  if (t.length < size) return false;
  for (let i = 0; i < t.length; i++) if (t[i] !== marker) return false;
  return true;
}

/** The heading text without an optional closing run of hashes; plain scans, never a backtracking pattern on a long line. */
function headingText(raw: string): string {
  const text = raw.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === text.length || end === 0) return text;
  const before = text[end - 1];
  return before === " " || before === "\t" ? text.slice(0, end).trim() : text;
}

function startsBlock(line: string): boolean {
  return fenceOf(line) !== null || HEADING.test(line);
}

/** Turns untrusted text into a small tree of blocks: paragraphs, headings 1 to 3 and fenced code. Raw HTML and anything unknown stay plain text, the text is cut at the limits, and nothing throws. */
export function parseMarkdown(
  text: string,
  caps: Partial<MdCaps> = {},
): MdResult {
  const maxChars = limit(caps.maxChars, MAX_MARKDOWN_CHARS);
  const maxBlocks = limit(caps.maxBlocks, MAX_MARKDOWN_BLOCKS);
  const source = typeof text === "string" ? text : "";
  let cut = source.slice(0, maxChars);
  // Never leave half of a surrogate pair at the cut.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const lines = clean(cut).split("\n");
  const blocks: MdBlock[] = [];
  let truncated = source.length > maxChars;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (blocks.length >= maxBlocks) {
      truncated = true;
      break;
    }
    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !closesFence(lines[i], fence.marker, fence.size)
      ) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const title = headingText(heading[2]);
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: inline(title),
      });
      i++;
      continue;
    }
    const rows: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      rows.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: inline(rows.join("\n")) });
  }
  return { blocks, truncated, chars: source.length };
}

/** The fields of a task that can hold its text, in the order they are tried. */
export const TASK_BODY_FIELDS: readonly string[] = [
  "body",
  "bodyPreview",
  "summary",
];

/** The text chosen for display and the field it came from. */
export type TaskBody = { field: string; text: string };

/** The text to show for a task, read defensively from the taskShow result: the first of body, bodyPreview and summary that is a string with something in it; anything else gives null so the board keeps showing the JSON. */
export function pickTaskBody(detail: unknown): TaskBody | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail))
    return null;
  for (const field of TASK_BODY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(detail, field)) continue;
    const value: unknown = (detail as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim())
      return { field, text: value };
  }
  return null;
}
