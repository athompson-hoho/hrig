export async function pasteClipboard(actions: {
  readText: () => Promise<string>; hasImage: () => Promise<boolean>;
  pasteText: (text: string) => void; pasteImage: () => Promise<void>;
  confirm?: (text: string, lines: number) => Promise<boolean>;
  confirmEnabled?: boolean;
}) {
  const text=await actions.readText();
  if(text&&actions.confirm&&needsConfirmation(actions.confirmEnabled===true,text)&&(await actions.confirm(text,lineCount(text)))!==true)return;
  if(text){actions.pasteText(text);return;}
  if(await actions.hasImage())await actions.pasteImage();
}

export const PASTE_PREVIEW_MAX_LINES = 8;
export const PASTE_PREVIEW_MAX_LINE_CHARS = 200;

/** Lines in the text: CRLF, CR and LF are one break each and one trailing break adds no line. One pass, no split, so multi-megabyte text stays cheap. */
export function lineCount(text: string): number {
  if (!text) return 0;
  let breaks = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
    if (c === 13 || c === 10) breaks++;
  }
  return endsWithLineBreak(text) ? breaks : breaks + 1;
}

/** Any CR or LF needs confirming, even one trailing newline: without bracketed paste a shell runs a pasted command plus newline at once, although lineCount does not count that newline as a line. */
export function needsConfirmation(enabled: boolean, text: string): boolean {
  if (!enabled) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13 || c === 10) return true;
  }
  return false;
}

/** True when the last character is CR or LF, so the dialog can say the paste will run immediately. */
export function endsWithLineBreak(text: string): boolean {
  if (!text) return false;
  const last = text.charCodeAt(text.length - 1);
  return last === 13 || last === 10;
}

/** First lines of the text for the dialog: breaks normalised to LF, long lines and extra lines cut with an ellipsis. Stops scanning once it has what it shows. */
export function pastePreview(text: string): string {
  const lines: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (lines.length === PASTE_PREVIEW_MAX_LINES) {
      lines.push("…");
      break;
    }
    let end = start;
    while (end < text.length) {
      const c = text.charCodeAt(end);
      if (c === 13 || c === 10) break;
      end++;
    }
    // Slice one past the cap so a line of exactly the cap is not marked as cut.
    const line = text.slice(start, Math.min(end, start + PASTE_PREVIEW_MAX_LINE_CHARS + 1));
    lines.push(line.length > PASTE_PREVIEW_MAX_LINE_CHARS ? line.slice(0, PASTE_PREVIEW_MAX_LINE_CHARS) + "…" : line);
    start = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
  }
  return lines.join("\n");
}
