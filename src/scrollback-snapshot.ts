// Inert and not imported by any app code. It exists so the cap rule of the
// design note docs/terminal-scrollback-persistence.md is written down and
// tested before any storage is approved. Nothing here reads a terminal,
// touches the disk or has a setting.

export interface SnapshotCaps {
  /** Most lines to keep. A line ends with LF or CRLF; a lone CR is not a line break. */
  maxLines: number;
  /** Most UTF-8 bytes to keep. */
  maxBytes: number;
}

export interface Snapshot {
  /** The kept tail of the text, exactly as it appeared (CRLF is not rewritten). */
  text: string;
  /** True when anything at the start of the input was left out. */
  truncated: boolean;
}

/**
 * A cap that is not a usable number fails closed: NaN, a non-number, zero and
 * a negative number all mean keep nothing, never keep everything. A fraction
 * rounds down, and Infinity means no limit for that cap.
 */
function usableCap(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return 0;
  return value === Infinity ? Infinity : Math.floor(value);
}

/** UTF-8 size of a code point; a lone surrogate counts as U+FFFD (3 bytes), as TextEncoder encodes it. */
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return 3;
  return codePoint < 0x10000 ? 3 : 4;
}

function utf8Length(text: string, from: number, to: number): number {
  let bytes = 0;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < to) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
        continue;
      }
    }
    bytes += utf8Size(code);
  }
  return bytes;
}

/** Start of the line that ends at `lineEnd`: just after the LF before that line's own terminator. */
function lineStartBefore(text: string, lineEnd: number): number {
  const searchFrom = text[lineEnd - 1] === "\n" ? lineEnd - 2 : lineEnd - 1;
  return searchFrom < 0 ? 0 : text.lastIndexOf("\n", searchFrom) + 1;
}

/**
 * Keep the end of `text` within both caps. Whole lines are kept while they fit
 * (newest first). Only when not even the last line fits is that line cut, and
 * then on a code point boundary that never splits a surrogate pair or a CRLF,
 * so the result is always well-formed text whose UTF-8 form is within
 * `maxBytes`. Never throws: input that is not a string gives an empty,
 * untruncated result, and any unexpected failure gives an empty, truncated one.
 */
export function boundSnapshot(
  text: unknown,
  caps?: Partial<SnapshotCaps> | null,
): Snapshot {
  if (typeof text !== "string" || text === "")
    return { text: "", truncated: false };
  try {
    const maxLines = usableCap(caps?.maxLines);
    const maxBytes = usableCap(caps?.maxBytes);
    let keepFrom = text.length;
    let lineEnd = text.length;
    let lines = 0;
    let bytes = 0;
    while (lineEnd > 0 && lines < maxLines) {
      const lineStart = lineStartBefore(text, lineEnd);
      const size = utf8Length(text, lineStart, lineEnd);
      if (bytes + size > maxBytes) break;
      bytes += size;
      lines++;
      keepFrom = lineStart;
      lineEnd = lineStart;
    }
    if (lines === 0 && maxLines >= 1 && maxBytes >= 1) {
      // Not even the last line fits: keep the largest tail of it that does.
      const lastStart = lineStartBefore(text, text.length);
      let i = text.length;
      let used = 0;
      while (i > lastStart) {
        let start = i - 1;
        const code = text.charCodeAt(start);
        if (code >= 0xdc00 && code <= 0xdfff && start > 0) {
          const before = text.charCodeAt(start - 1);
          if (before >= 0xd800 && before <= 0xdbff) start--;
        } else if (code === 0x0a && start > 0 && text[start - 1] === "\r") {
          start--;
        }
        const size = utf8Length(text, start, i);
        if (used + size > maxBytes) break;
        used += size;
        i = start;
      }
      keepFrom = i;
    }
    return { text: text.slice(keepFrom), truncated: keepFrom > 0 };
  } catch {
    return { text: "", truncated: true };
  }
}
