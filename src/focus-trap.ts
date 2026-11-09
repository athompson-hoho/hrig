/** What a dialog reads from one element to decide whether Tab can land on it. */
export interface FocusCandidate {
  tag: string;
  disabled: boolean;
  hidden: boolean;
  tabIndex: number | null;
  hasHref: boolean;
}

/** Elements the browser focuses with Tab without any tabindex attribute. */
const NATIVE_TAGS = ["button", "input", "select", "textarea", "summary"];

/** True when Tab can land on the element: not disabled, not hidden, a native control, a link with an address, or a tabindex of 0 or more. */
export function isFocusable(candidate: FocusCandidate): boolean {
  if (!candidate || candidate.disabled || candidate.hidden) return false;
  const tab = candidate.tabIndex;
  const given =
    typeof tab === "number" && Number.isFinite(tab) ? Math.trunc(tab) : null;
  if (given !== null && given < 0) return false;
  const tag = String(candidate.tag).toLowerCase();
  if (NATIVE_TAGS.includes(tag)) return true;
  if (tag === "a" && candidate.hasHref) return true;
  return given !== null;
}

/**
 * Where the dialog must move focus for a Tab press, or -1 to let the browser
 * take its own step. Only the ends of the list wrap: Tab on the last item goes
 * to the first and Shift+Tab on the first goes to the last. An activeIndex of
 * -1, or any index outside the list, means focus is outside the dialog: Tab
 * is pulled back to the first item and Shift+Tab to the last.
 */
export function nextFocusIndex(
  count: number,
  activeIndex: number,
  shift: boolean,
): number {
  if (!Number.isInteger(count) || count < 1) return -1;
  const inside =
    Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < count;
  if (!inside) return shift ? count - 1 : 0;
  if (shift) return activeIndex === 0 ? count - 1 : -1;
  return activeIndex === count - 1 ? 0 : -1;
}
