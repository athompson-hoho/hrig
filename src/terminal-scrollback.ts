import type { IDisposable, IMarker, Terminal } from "@xterm/xterm";

/** True when the viewport is above the live bottom of the buffer. */
export const isScrolledUp = (viewportY: number, baseY: number) =>
  baseY - viewportY > 0;
export const discardNotice = (scrollback: number) =>
  `Older output was dropped: this terminal keeps ${scrollback.toLocaleString()} lines. Raise it in Settings → Terminal.`;

/**
 * Report when output has really been trimmed out of the terminal's buffer.
 *
 * A marker is anchored to a retained line. xterm disposes a marker when its
 * line leaves the buffer, whatever caused it: line feeds, automatic wrapping
 * or a lowered scrollback setting. Clearing the screen/scrollback disposes it
 * too, but then the buffer is no longer full, so that is re-armed instead of
 * reported. The decision waits for the end of the parse so the buffer has
 * settled; alternate-screen programs never trim the normal buffer.
 */
export function watchScrollbackLoss(
  term: Terminal,
  onLoss: () => void,
): IDisposable {
  let marker: IMarker | undefined;
  let pending = false;
  let stopped = false;
  const arm = () => {
    marker?.dispose();
    const next = term.registerMarker(0);
    marker = next;
    next.onDispose(() => {
      if (marker === next && !stopped) pending = true;
    });
  };
  arm();
  const parsed = term.onWriteParsed(() => {
    if (!pending) return;
    const buffer = term.buffer.active;
    if (buffer.type !== "normal") return; // decide once back on the normal screen
    pending = false;
    const capacity = term.rows + (term.options.scrollback ?? 0);
    if (buffer.length >= capacity) {
      marker = undefined;
      onLoss();
    } else arm();
  });
  return {
    dispose() {
      stopped = true;
      parsed.dispose();
      marker?.dispose();
    },
  };
}
