/** Most characters of one text that are read; the rest is cut off and the result says so. */
export const MAX_MARKDOWN_CHARS = 100000;
/** Most blocks (and list items) one text can produce; later ones are cut off and the result says so. */
export const MAX_MARKDOWN_BLOCKS = 2000;
/** Most characters of one line that are read for inline syntax; the rest of the line stays plain text. */
export const MAX_INLINE_LINE = 4000;
/** Most formatted inline nodes (code, bold, italic, link) in one text; later syntax stays plain text. */
export const MAX_INLINE_NODES = 5000;
/** Most characters searched for a closing mark, in total, in one text; once used up, later syntax stays plain text. */
export const MAX_INLINE_SCAN = 400000;
/** Deepest nesting of bold, italic and link content; deeper syntax stays plain text. */
export const MAX_INLINE_DEPTH = 3;
/** Longest link address shown; a longer address is not a link and stays plain text. */
export const MAX_URL_LENGTH = 2000;

/** Inline content of a block. Every string is shown as text and is never read as markup; a link is its text followed by its visible address and is never a clickable link. */
export type MdInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "link"; children: MdInline[]; url: string };
/** The blocks the subset knows: paragraph, heading levels 1 to 3, bullet or numbered list (one level), fenced code, block quote (one level) and rule. */
export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: MdInline[] }
  | { type: "list"; ordered: boolean; start: number; items: MdInline[][] }
  | { type: "code"; text: string }
  | { type: "quote"; children: MdInline[] }
  | { type: "rule" };
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
const LIST = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
// Only plain web addresses are shown as links, and only as text: no space, quote, bracket, angle bracket or backslash.
const WEB_ADDRESS = /^https?:\/\/[^\s<>"'`\\()[\]]+$/i;
const WORD = /[\p{L}\p{N}]/u;

/** Search budget and node count shared by every line of one text. */
type Work = { scan: number; nodes: number };

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isOrdered = (marker: string) => /\d/.test(marker);
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
const spent = (work: Work) =>
  work.scan >= MAX_INLINE_SCAN || work.nodes >= MAX_INLINE_NODES;

/** Start of the next run of exactly `size` backticks at or after `from`, or -1. */
function codeEnd(text: string, from: number, size: number): number {
  let at = from;
  while (at < text.length) {
    const p = text.indexOf("`", at);
    if (p < 0) return -1;
    let q = p;
    while (text[q] === "`") q++;
    if (q - p === size) return p;
    at = q;
  }
  return -1;
}

/** Start of the next run of exactly `size` marks that can close an emphasis opened at `from`, or -1. */
function markEnd(
  text: string,
  from: number,
  mark: string,
  size: number,
): number {
  let at = from;
  while (at < text.length) {
    const p = text.indexOf(mark, at);
    if (p < 0) return -1;
    let q = p;
    while (text[q] === mark) q++;
    const closes =
      q - p === size &&
      p > from &&
      !isSpace(text[p - 1]) &&
      (mark === "*" || !isWord(text[q]));
    if (closes) return p;
    at = q;
  }
  return -1;
}

/** One line of inline syntax: code, bold, italic and links with a plain web address. Everything else, and everything that does not close, stays text. */
function parseInline(
  text: string,
  depth: number,
  work: Work,
  links: boolean,
): MdInline[] {
  const out: MdInline[] = [];
  let from = 0;
  let i = 0;
  const emit = (node: MdInline, start: number, end: number) => {
    if (start > from) out.push({ type: "text", text: text.slice(from, start) });
    out.push(node);
    work.nodes++;
    from = end;
    i = end;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`") {
      let size = 1;
      while (text[i + size] === "`") size++;
      const end = spent(work) ? -1 : codeEnd(text, i + size, size);
      work.scan += (end < 0 ? text.length : end) - i;
      if (end < 0) {
        i += size;
        continue;
      }
      let code = text.slice(i + size, end);
      if (code[0] === " " && code.endsWith(" ") && code.trim())
        code = code.slice(1, -1);
      emit({ type: "code", text: code }, i, end + size);
    } else if ((ch === "*" || ch === "_") && depth < MAX_INLINE_DEPTH) {
      let size = 1;
      while (text[i + size] === ch) size++;
      const open =
        size <= 2 &&
        !isSpace(text[i + size]) &&
        !(ch === "_" && isWord(text[i - 1])) &&
        !spent(work);
      const end = open ? markEnd(text, i + size, ch, size) : -1;
      if (open) work.scan += (end < 0 ? text.length : end) - i;
      if (end < 0) {
        i += size;
        continue;
      }
      const children = parseInline(
        text.slice(i + size, end),
        depth + 1,
        work,
        links,
      );
      emit({ type: size === 2 ? "strong" : "em", children }, i, end + size);
    } else if (ch === "!" && text[i + 1] === "[") {
      // Images are not shown; the whole source stays visible as text.
      i += 2;
    } else if (
      ch === "[" &&
      links &&
      depth < MAX_INLINE_DEPTH &&
      !spent(work)
    ) {
      let nest = 1;
      let close = -1;
      for (let k = i + 1; k < text.length && k - i <= 1000; k++) {
        if (text[k] === "[") nest++;
        else if (text[k] === "]" && --nest === 0) {
          close = k;
          break;
        }
      }
      work.scan += close < 0 ? Math.min(text.length - i, 1000) : close - i;
      let stop = -1;
      if (close > i + 1 && text[close + 1] === "(" && !spent(work)) {
        stop = text.indexOf(")", close + 2);
        work.scan += (stop < 0 ? text.length : stop) - close;
      }
      const url = stop < 0 ? "" : text.slice(close + 2, stop);
      if (!url || url.length > MAX_URL_LENGTH || !WEB_ADDRESS.test(url)) {
        i++;
        continue;
      }
      const children = parseInline(
        text.slice(i + 1, close),
        depth + 1,
        work,
        false,
      );
      emit({ type: "link", children, url }, i, stop + 1);
    } else {
      i++;
    }
  }
  if (from < text.length) out.push({ type: "text", text: text.slice(from) });
  return out;
}

/** Inline syntax for the lines of one block, a line feed between lines, plain text kept in as few nodes as possible. Only the first part of a very long line is read for syntax. */
function inline(lines: string[], work: Work): MdInline[] {
  const out: MdInline[] = [];
  const text = (value: string) => {
    const last = out[out.length - 1];
    if (!value) return;
    if (last && last.type === "text") last.text += value;
    else out.push({ type: "text", text: value });
  };
  lines.forEach((line, k) => {
    if (k) text("\n");
    const head = line.slice(0, MAX_INLINE_LINE);
    for (const node of parseInline(head, 0, work, true)) {
      if (node.type === "text") text(node.text);
      else out.push(node);
    }
    text(line.slice(head.length));
  });
  return out;
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

/** Three or more of one of - * _ on a line, spaces and tabs between them allowed, nothing else. */
function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || (t[0] !== "-" && t[0] !== "*" && t[0] !== "_"))
    return false;
  let marks = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === t[0]) marks++;
    else if (t[i] !== " " && t[i] !== "\t") return false;
  }
  return marks >= 3;
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
  return (
    fenceOf(line) !== null ||
    HEADING.test(line) ||
    isRule(line) ||
    LIST.test(line) ||
    QUOTE.test(line)
  );
}

/** Turns untrusted text into a small tree of blocks: paragraphs, headings 1 to 3, bullet and numbered lists, fenced code, block quotes and rules, with code, bold, italic and plain-address links inside. Raw HTML and anything unknown stay plain text, the text is cut at the limits, and nothing throws. */
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
  const work: Work = { scan: 0, nodes: 0 };
  // Blocks and list items together count against the block limit.
  let used = 0;
  let truncated = source.length > maxChars;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (used >= maxBlocks) {
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
      used++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const title = headingText(heading[2]);
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: inline([title], work),
      });
      used++;
      i++;
      continue;
    }
    if (isRule(line)) {
      blocks.push({ type: "rule" });
      used++;
      i++;
      continue;
    }
    const first = LIST.exec(line);
    if (first) {
      const ordered = isOrdered(first[1]);
      const items: MdInline[][] = [];
      let item = [first[2].trim()];
      const finish = () => {
        if (used >= maxBlocks) truncated = true;
        else {
          items.push(inline(item, work));
          used++;
        }
      };
      i++;
      while (i < lines.length && lines[i].trim()) {
        const next = lines[i];
        const m = LIST.exec(next);
        if (isRule(next) || fenceOf(next) || HEADING.test(next)) break;
        if (QUOTE.test(next)) break;
        if (m && isOrdered(m[1]) === ordered) {
          finish();
          item = [m[2].trim()];
        } else if (m || !/^ {2}/.test(next)) {
          break;
        } else {
          item.push(next.trim());
        }
        i++;
      }
      finish();
      if (items.length)
        blocks.push({
          type: "list",
          ordered,
          start: ordered ? Number.parseInt(first[1], 10) : 1,
          items,
        });
      used++;
      continue;
    }
    if (QUOTE.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        rows.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1].trim());
        i++;
      }
      if (rows.some(Boolean)) {
        blocks.push({ type: "quote", children: inline(rows, work) });
        used++;
      }
      continue;
    }
    const rows: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      rows.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: inline(rows, work) });
    used++;
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
