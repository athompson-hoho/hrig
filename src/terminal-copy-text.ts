/** Removes the spaces and tabs that end a line (before LF, before CRLF, or at the end of the text); everything else is kept. */
export function trimTrailingWhitespace(text: string): string {
  const pieces = text.split("\n");
  const last = pieces.length - 1;
  for (let i = 0; i < pieces.length; i++) {
    let piece = pieces[i];
    // Only a piece followed by an LF can end in the CR of a CRLF break; the CR of the last piece is ordinary text.
    const cr = i < last && piece.endsWith("\r");
    if (cr) piece = piece.slice(0, -1);
    // Scan backwards on purpose: a regular expression backtracks quadratically on a long run of spaces.
    let end = piece.length;
    while (end > 0 && (piece[end - 1] === " " || piece[end - 1] === "\t"))
      end--;
    pieces[i] = piece.slice(0, end) + (cr ? "\r" : "");
  }
  return pieces.join("\n");
}

/** Returns the text unchanged unless trimTrailing is true; a text made only of spaces and tabs is kept so a copy never empties the clipboard. */
export function copyTextForClipboard(
  text: string,
  trimTrailing: boolean,
): string {
  if (!trimTrailing) return text;
  const trimmed = trimTrailingWhitespace(text);
  return trimmed === "" ? text : trimmed;
}
