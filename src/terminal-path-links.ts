import type { IBuffer, IBufferRange } from "@xterm/xterm";

export interface PathMatch {
  file: string;
  line?: number;
  start: number;
  end: number; // exclusive UTF-16 offset
}

// Deliberately conservative: quotes must enclose the entire path. URL tokens,
// shell expansions, escaped quotes and ambiguous whitespace are not file links.
export function matchTerminalPaths(text: string): PathMatch[] {
  const matches: PathMatch[] = [];
  const tokens = /["'][^\r\n]*|[^\s]+/g;
  let cursor = 0;
  while (cursor < text.length) {
    while (/[\s([{]/.test(text[cursor] || "") && cursor < text.length) cursor++;
    if (cursor >= text.length) break;
    let start = cursor,
      value = "",
      quoted = false;
    const quote = text[cursor];
    if (quote === '"' || quote === "'") {
      quoted = true;
      start = ++cursor;
      const close = text.indexOf(quote, cursor);
      if (close < 0) {
        while (cursor < text.length && !/\s/.test(text[cursor])) cursor++;
        continue;
      }
      value = text.slice(cursor, close);
      cursor = close + 1;
      const suffix = text.slice(cursor).match(/^:\d+(?::\d+)?/);
      if (suffix) {
        value += suffix[0];
        cursor += suffix[0].length;
      }
      if (cursor < text.length && !/[\s)\]},;]/.test(text[cursor])) {
        while (cursor < text.length && !/\s/.test(text[cursor])) cursor++;
        continue;
      }
    } else {
      tokens.lastIndex = cursor;
      const token = tokens.exec(text);
      if (!token) break;
      value = token[0].replace(/[.\]},;:]+$/, "");
      if (!/\(\d+(?:,\d+)?\)$/.test(value)) value = value.replace(/\)+$/, "");
      cursor = token.index + token[0].length;
    }
    const parsed = value.match(/^(.*?)(?::(\d+)(?::\d+)?|\((\d+)(?:,\d+)?\))?$/);
    if (!parsed) continue;
    const file = parsed[1];
    const valid = quoted
      ? /^(?:[A-Za-z]:[\\/]|\/)?[\w@. -]+(?:[\\/][\w@. -]+)*\.[A-Za-z0-9]{1,12}$/
      : /^(?:[A-Za-z]:[\\/]|\/)?[\w@.\-]+(?:[\\/][\w@.\-]+)*\.[A-Za-z0-9]{1,12}$/;
    if (!valid.test(file) || file.trim() !== file) continue;
    // A space-containing basename alone is indistinguishable from quoted prose.
    // Require a path separator before its first space (use ./ for a root file).
    if (quoted && file.includes(" ")) {
      const separator = file.search(/[\\/]/);
      if (separator < 0 || separator > file.indexOf(" ")) continue;
    }
    const location = parsed[2] || parsed[3];
    const line = location ? Number(location) : undefined;
    if (line !== undefined && (!Number.isSafeInteger(line) || line < 1))
      continue;
    // Include the location suffix in the underline (and the closing quote when
    // the suffix follows it), but never pass quotes to the backend.
    matches.push({
      file,
      line,
      start,
      end: quoted
        ? cursor - (text[cursor - 1] === quote ? 1 : 0)
        : start + value.length,
    });
  }
  return matches;
}

// xterm coordinates count cells, while JS regex offsets count UTF-16 units.
// Build the mapping from cells so wide/combining characters before a path do
// not move its hit target. Follow only soft wraps, never hard line breaks.
export function terminalPathLinks(
  buffer: IBuffer,
  y: number,
): (PathMatch & { range: IBufferRange })[] {
  let first = y - 1,
    last = first;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped)
    last++;
  if (last - first > 200) return [];
  let text = "";
  const starts: { x: number; y: number }[] = [],
    ends: { x: number; y: number }[] = [];
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row);
    if (!line) return [];
    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      text += chars;
      for (let i = 0; i < chars.length; i++) {
        starts.push({ x: col + 1, y: row + 1 });
        ends.push({ x: col + cell.getWidth(), y: row + 1 });
      }
    }
    if (text.length > 32768) return [];
  }
  return matchTerminalPaths(text.trimEnd()).flatMap((match) => {
    const start = starts[match.start],
      end = ends[match.end - 1];
    return start && end && start.y <= y && end.y >= y
      ? [{ ...match, range: { start, end } }]
      : [];
  });
}
