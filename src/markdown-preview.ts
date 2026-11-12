// Small, dependency-free Markdown subset parser for the read-only editor preview.
// It produces a plain data tree (never HTML strings), so rendering cannot inject
// markup, scripts, remote images, or navigation. Raw HTML is shown as text.

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "link"; children: Inline[]; href: string; safe: boolean }
  | { t: "image"; alt: string; href: string };

export type Block =
  | { t: "heading"; level: number; children: Inline[] }
  | { t: "paragraph"; children: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; children: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "table"; head: Inline[][]; align: ("left" | "right" | "center" | "")[]; rows: Inline[][][] }
  | { t: "hr" };

export const MAX_PREVIEW_CHARS = 200000;
/** Longer single paragraphs are shown as plain text (no inline formatting). */
export const MAX_INLINE_CHARS = 20000;
const MAX_DEPTH = 8;

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

function pushText(out: Inline[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.text += text;
  else out.push({ t: "text", text });
}

// Every lazy span is bounded (400 chars) so an unclosed opener can never scan the
// rest of a paragraph: inline work per opener is bounded (not strictly linear).
const INLINE =
  /\\([\\`*_{}\[\]()#+\-.!|>~<])|(`+)([\s\S]{0,400}?[^`])\2(?!`)|(\*\*|__)(?=\S)([\s\S]{0,400}?\S)\4|(\*|_)(?=\S)([\s\S]{0,400}?\S)\6|(!?)\[([^\]]{0,400})\]\([ \t]{0,20}([^)\s]{0,500})(?:\s{1,20}"[^"]{0,400}")?[ \t]{0,20}\)|<((?:https?:\/\/|mailto:)[^>\s]{1,2000})>/g;

export function parseInline(source: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH || source.length > MAX_INLINE_CHARS) {
    pushText(out, source);
    return out;
  }
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const before = source[m.index - 1] || "";
    const after = source[m.index + m[0].length] || "";
    // Underscores inside words (snake_case) are literal text.
    const wordy = (d: string | undefined) => d?.[0] === "_" && (/\w/.test(before) || /\w/.test(after));
    if (wordy(m[4]) || wordy(m[6])) continue;
    pushText(out, source.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) pushText(out, m[1]);
    else if (m[2] !== undefined) out.push({ t: "code", text: m[3].replace(/^ (.*) $/, "$1") });
    else if (m[4] !== undefined) out.push({ t: "strong", children: parseInline(m[5], depth + 1) });
    else if (m[6] !== undefined) out.push({ t: "em", children: parseInline(m[7], depth + 1) });
    else if (m[10] !== undefined && m[8] === "!") out.push({ t: "image", alt: m[9], href: m[10] });
    else if (m[10] !== undefined)
      out.push({ t: "link", children: parseInline(m[9], depth + 1), href: m[10], safe: SAFE_HREF.test(m[10]) });
    else if (m[11] !== undefined)
      out.push({ t: "link", children: [{ t: "text", text: m[11] }], href: m[11], safe: true });
  }
  pushText(out, source.slice(last));
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "    ").length;
const blank = (line: string) => !line.trim();

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line);
}

export function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  if (depth > MAX_DEPTH) {
    const text = lines.join("\n").trim();
    if (text) blocks.push({ t: "paragraph", children: [{ t: "text", text }] });
    return blocks;
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }
    let m = FENCE.exec(line);
    if (m) {
      const fence = m[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && /^\s*[`~]+\s*$/.test(lines[i]))) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      blocks.push({ t: "code", lang: m[2], text: body.join("\n") });
      continue;
    }
    if ((m = HEADING.exec(line))) {
      blocks.push({ t: "heading", level: m[1].length, children: parseInline(m[2]) });
      i++;
      continue;
    }
    if (HR.test(line) && !LIST.test(line)) { blocks.push({ t: "hr" }); i++; continue; }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ t: "quote", children: parseBlocks(inner, depth + 1) });
      continue;
    }
    if ((m = LIST.exec(line))) {
      const ordered = /\d/.test(m[2]);
      const base = indentOf(line);
      const items: Block[][] = [];
      const start = ordered ? parseInt(m[2], 10) : 1;
      while (i < lines.length) {
        const lm = LIST.exec(lines[i]);
        if (!lm || indentOf(lines[i]) !== base || /\d/.test(lm[2]) !== ordered) break;
        const content = [lm[3]];
        i++;
        while (i < lines.length) {
          if (blank(lines[i])) {
            let j = i;
            while (j < lines.length && blank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) > base) { content.push(""); i = j; continue; }
            break;
          }
          if (indentOf(lines[i]) > base) { content.push(lines[i].replace(/^\s{1,4}/, "")); i++; continue; }
          if (!startsBlock(lines[i])) { content.push(lines[i].trim()); i++; continue; } // lazy continuation
          break;
        }
        items.push(parseBlocks(content, depth + 1));
        while (i < lines.length && blank(lines[i]) && i + 1 < lines.length && LIST.test(lines[i + 1]) && indentOf(lines[i + 1]) === base) i++;
      }
      blocks.push({ t: "list", ordered, start, items });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(line).map((c) => parseInline(c));
      const align = cells(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "");
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|"))
        rows.push(cells(lines[i++]).map((c) => parseInline(c)));
      blocks.push({ t: "table", head, align: align as any, rows });
      continue;
    }
    if (indentOf(line) >= 4 && (!blocks.length || blank(lines[i - 1] ?? ""))) {
      const code: string[] = [];
      while (i < lines.length && (indentOf(lines[i]) >= 4 || (blank(lines[i]) && i + 1 < lines.length && indentOf(lines[i + 1]) >= 4)))
        code.push(lines[i++].replace(/^( {4}|\t)/, ""));
      blocks.push({ t: "code", lang: "", text: code.join("\n") });
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) para.push(lines[i++].trim());
    blocks.push({ t: "paragraph", children: parseInline(para.join(" ")) });
  }
  return blocks;
}

export function isMarkdownPath(path: string | undefined): boolean {
  return !!path && /\.(md|markdown|mdown|mkd)$/i.test(path);
}

export interface MarkdownPreviewModel {
  blocks: Block[];
  /** True when the input exceeded the preview limit and only its start is shown. */
  truncated: boolean;
}

export function parseMarkdown(source: string): MarkdownPreviewModel {
  const text = String(source ?? "");
  const truncated = text.length > MAX_PREVIEW_CHARS;
  const lines = (truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text).replace(/\r\n?/g, "\n").split("\n");
  return { blocks: parseBlocks(lines), truncated };
}
