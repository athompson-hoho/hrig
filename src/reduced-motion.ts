/**
 * True when animation should be avoided: the HRig setting, or the operating
 * system's reduced-motion preference (CSS already honors the latter, but
 * script-driven motion such as editor smooth scrolling and cursor blink does
 * not unless it asks).
 */
export function motionReduced(
  setting: boolean,
  match: ((query: string) => { matches: boolean }) | undefined =
    typeof window !== "undefined" ? window.matchMedia?.bind(window) : undefined,
): boolean {
  if (setting) return true;
  try {
    return match?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}
