/** Lowest accepted minimum contrast ratio; 1 means no adjustment. */
export const MIN_CONTRAST_RATIO = 1;
/** Highest accepted minimum contrast ratio (black on white). */
export const MAX_CONTRAST_RATIO = 21;
/** Ratio used when nothing valid is stored; equals xterm's own default. */
export const DEFAULT_CONTRAST_RATIO = 1;

/** Returns 1 for anything that is not a finite number, otherwise the value clamped to 1..21. */
export function normalizeContrastRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_CONTRAST_RATIO;
  return Math.min(MAX_CONTRAST_RATIO, Math.max(MIN_CONTRAST_RATIO, value));
}
