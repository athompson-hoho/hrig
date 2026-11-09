/** Narrowest sidebar in pixels; the same 210 as the min-width of .sidebar-container in styles.css. */
export const SIDEBAR_MIN_WIDTH = 210;

/** Widest sidebar in pixels that the drag handle allows. */
export const SIDEBAR_MAX_WIDTH = 440;

/** The width in pixels of a new workspace and of any saved value that is not a usable number. */
export const SIDEBAR_DEFAULT_WIDTH = 264;

/**
 * The width to use for a saved or stored sidebar width of any shape: a finite
 * number is clamped to SIDEBAR_MIN_WIDTH..SIDEBAR_MAX_WIDTH (a value already in
 * range comes back unchanged), and anything else (a string, null, undefined, a
 * boolean, an array, an object, NaN, an infinity) gives SIDEBAR_DEFAULT_WIDTH.
 * Never throws and never reads anything but the type of the value.
 */
export function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

/**
 * The width while dragging the handle from startX to clientX: the starting
 * width (normalized first) plus the pointer movement, clamped. Inside the
 * range this is exactly startWidth + clientX - startX, as the handle always
 * computed it. A pointer position that is not a finite number leaves the
 * starting width as it is.
 */
export function dragSidebarWidth(
  startWidth: unknown,
  startX: number,
  clientX: number,
): number {
  const start = normalizeSidebarWidth(startWidth);
  if (typeof startX !== "number" || typeof clientX !== "number") return start;
  const next = start + clientX - startX;
  return Number.isFinite(next) ? normalizeSidebarWidth(next) : start;
}
