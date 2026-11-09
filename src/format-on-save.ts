/** Languages for which Monaco ships a document formatter (no external tools are run). */
export const FORMATTABLE = new Set([
  "json", "jsonc", "css", "scss", "less", "html", "typescript", "javascript",
]);
export const MAX_FORMAT_CHARS = 500000;
/** Longest Save waits for the formatter before saving the file as written. */
export const FORMAT_TIMEOUT_MS = 4000;

/**
 * Whether Save should first run the editor's built-in formatter. Opt-in,
 * never for read-only or very large buffers, and only for languages that have
 * a built-in formatter, so nothing is reformatted unexpectedly.
 */
export function shouldFormatOnSave(input: {
  enabled: boolean;
  languageId: string;
  chars: number;
  readOnly: boolean;
}): boolean {
  return (
    input.enabled === true &&
    !input.readOnly &&
    FORMATTABLE.has(input.languageId) &&
    Number.isFinite(input.chars) &&
    input.chars > 0 &&
    input.chars <= MAX_FORMAT_CHARS
  );
}
