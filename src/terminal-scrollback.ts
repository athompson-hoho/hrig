/** True when the viewport is above the live bottom of the buffer. */
export const isScrolledUp = (viewportY: number, baseY: number) =>
  baseY - viewportY > 0;
/**
 * True when the normal buffer holds its maximum (rows + scrollback) lines, so
 * every further line feed discards the oldest line.
 */
export const scrollbackFull = (
  bufferLength: number,
  rows: number,
  scrollback: number,
) => scrollback > 0 && bufferLength >= rows + scrollback;
export const discardNotice = (scrollback: number) =>
  `Older output was dropped: this terminal keeps ${scrollback.toLocaleString()} lines. Raise it in Settings → Terminal.`;
