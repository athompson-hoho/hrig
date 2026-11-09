/** xterm 6.0.0's own default word separators: space ( ) [ ] { } ' , " and backtick (11 characters). */
export const DEFAULT_WORD_SEPARATOR: string = " ()[]{}',\"`";

/** Longest accepted word separator list, counted as code points. */
export const MAX_WORD_SEPARATOR_LENGTH = 64;

// control characters, which include CR, LF and tab, plus the line and paragraph separators
const UNWANTED = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** Returns a safe separator list: text only, no control or line characters, at most 64 code points, never empty (else the default). */
export function sanitizeWordSeparator(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_WORD_SEPARATOR;
  const kept = Array.from(value.replace(UNWANTED, ""))
    .slice(0, MAX_WORD_SEPARATOR_LENGTH)
    .join("");
  return kept || DEFAULT_WORD_SEPARATOR;
}

/** True exactly when sanitizing the value would leave it unchanged (text, 1 to 64 code points, no control or line characters). */
export function isValidWordSeparator(value: unknown): boolean {
  return sanitizeWordSeparator(value) === value;
}
