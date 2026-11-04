export const MIN_FONT = 8;
export const MAX_FONT = 32;
export type ZoomAction = "in" | "out" | "reset";
export interface ZoomKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}
/** Ctrl/Cmd with +, =, -, _ or 0. Alt combinations (AltGr) are left alone. */
export function zoomAction(event: ZoomKey): ZoomAction | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  if (event.key === "+" || event.key === "=") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "reset";
  return null;
}
/** Zoom is a per-terminal offset from the Settings font size, in points. */
export const effectiveFontSize = (base: number, offset: number) =>
  Math.min(MAX_FONT, Math.max(MIN_FONT, base + offset));
/** Next offset for an action; keeps base+offset inside the font-size bounds. */
export function nextOffset(
  base: number,
  offset: number,
  action: ZoomAction,
): number {
  if (action === "reset") return 0;
  const size = effectiveFontSize(base, offset + (action === "in" ? 1 : -1));
  return size - base;
}
/** One wheel notch = one point; small trackpad deltas accumulate. */
export function wheelSteps(accumulated: number, deltaY: number) {
  const total = accumulated + deltaY;
  const steps = Math.trunc(total / 100);
  return { steps: steps === 0 ? 0 : -steps, remainder: total - steps * 100 };
}
