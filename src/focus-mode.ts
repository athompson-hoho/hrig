/** What the person had on screen before focus mode hid it. */
export interface FocusView {
  sidebar: boolean;
  statusBar: boolean;
}

/** Focus mode for this session only: off, or on with the view it hid. */
export type FocusState = { on: false } | { on: true; prev: FocusView };

/**
 * One transition. view is what the sidebar and status bar must show now, or
 * null when nothing is to be applied (leaving focus mode that was never on).
 */
export interface FocusStep {
  state: FocusState;
  view: FocusView | null;
}

/** The state before anything is hidden; every transition that ends off answers with it. */
export const FOCUS_OFF: FocusState = Object.freeze({ on: false as const });

function isOn(state: FocusState): state is { on: true; prev: FocusView } {
  return !!state && state.on === true && !!state.prev;
}

/**
 * Turns focus mode on, remembering the sidebar and status bar values to bring
 * back. A part that was already hidden is remembered hidden, so leaving never
 * shows what the person had closed, and entering again while on keeps the
 * first snapshot instead of remembering the hidden values.
 */
export function enterFocus(state: FocusState, prev: FocusView): FocusStep {
  const view = { sidebar: false, statusBar: false };
  if (isOn(state)) return { state, view };
  return {
    state: {
      on: true,
      prev: {
        sidebar: prev?.sidebar === true,
        statusBar: prev?.statusBar === true,
      },
    },
    view,
  };
}

/**
 * Turns focus mode off and answers exactly the values remembered on entry.
 * When it is not on there is nothing to restore and the view is null.
 */
export function exitFocus(state: FocusState): FocusStep {
  if (!isOn(state)) return { state: FOCUS_OFF, view: null };
  return {
    state: FOCUS_OFF,
    view: { sidebar: state.prev.sidebar, statusBar: state.prev.statusBar },
  };
}

/** Exits when on, otherwise enters with the values currently shown. */
export function toggleFocus(state: FocusState, current: FocusView): FocusStep {
  return isOn(state) ? exitFocus(state) : enterFocus(state, current);
}

/**
 * Called whenever the sidebar value changes: opening the sidebar by any route
 * ends focus mode and leaves the sidebar as the person just made it. A closed
 * sidebar keeps focus mode on.
 */
export function focusAfterSidebar(
  state: FocusState,
  sidebarOpen: boolean,
): FocusState {
  if (!isOn(state)) return FOCUS_OFF;
  return sidebarOpen === true ? FOCUS_OFF : state;
}

/**
 * The status bar renders only when the saved preference is on and focus mode
 * is off. The preference itself is never written by focus mode.
 */
export function showStatusBar(state: FocusState, preference: boolean): boolean {
  return Boolean(preference) && !isOn(state);
}
