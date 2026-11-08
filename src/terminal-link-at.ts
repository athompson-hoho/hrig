/** The most characters of link text the right-click menu will open or copy. */
export const MAX_LINK_TEXT = 4096;

/** What a link under the pointer is: a web address or a file path. */
export type LinkKind = "url" | "path";

/** A link xterm underlines under the pointer: its text (the address, or the path without its line number) and, for a path, the line to open at. */
export interface TerminalLink {
  kind: LinkKind;
  text: string;
  line?: number;
}

/** Shared by the terminal panel (fills it from xterm's link events and says how to open a link) and the right-click menu (reads it). */
export interface TerminalLinks {
  hovered: TerminalLink | null;
  open: ((link: TerminalLink) => void) | null;
}

/** Answers the link for text xterm reported under the pointer, or null when it is not safe to offer: an unknown kind, a non-string, empty or over-long text, a control or line-separator character, or a line that is not a positive whole number. */
export function hoveredLink(
  kind: unknown,
  text: unknown,
  line?: unknown,
): TerminalLink | null {
  if (kind !== "url" && kind !== "path") return null;
  if (typeof text !== "string" || text.length === 0) return null;
  if (text.length > MAX_LINK_TEXT) return null;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || (code >= 127 && code <= 159)) return null;
    if (code === 8232 || code === 8233) return null;
  }
  if (kind === "url" || line === undefined) return { kind, text };
  if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1)
    return null;
  return { kind, text, line };
}

/** Answers true only for the click that opens a link: the primary button, and on macOS not a Control-click, which is a right-click there. */
export function isPrimaryActivation(
  event: { button?: unknown; ctrlKey?: unknown },
  platform: unknown,
): boolean {
  return (
    event.button === 0 && !(platform === "darwin" && event.ctrlKey === true)
  );
}

/** Hover and leave handlers for one kind of xterm link: hover records what is under the pointer, leave forgets it; no other state, and nothing is sent anywhere. */
export function linkHover(
  links: { current: TerminalLinks },
  kind: LinkKind,
  line?: number,
): { hover(event: unknown, text: string): void; leave(): void } {
  return {
    hover(_event, text) {
      links.current.hovered = hoveredLink(kind, text, line);
    },
    leave() {
      links.current.hovered = null;
    },
  };
}
