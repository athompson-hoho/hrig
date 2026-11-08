/** Most panels remembered at once; the oldest is forgotten first. */
export const MAX_MRU_PANELS = 100;

/** 1 goes back to an older panel (Ctrl+Tab); -1 goes forward, wrapping to the oldest (Ctrl+Shift+Tab). */
export type CycleDirection = 1 | -1;

/**
 * Newest first. While Control is held, hold is the frozen copy that repeated
 * presses walk through, expect is the panel the app itself just selected, and
 * seen is the last active panel noted.
 */
export interface MruState {
  order: string[];
  hold: string[] | null;
  expect: string | null;
  seen: string | null;
}

function usable(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function clean(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!usable(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** The list with id moved to the front: repeats, empty and non-string entries dropped, newest MAX_MRU_PANELS kept. Never changes the list it is given. */
export function touch(list: readonly string[], id: string): string[] {
  const rest = clean(list).filter((item) => item !== id);
  return (usable(id) ? [id, ...rest] : rest).slice(0, MAX_MRU_PANELS);
}

/** The list without id, cleaned the same way. Never changes the list it is given. */
export function remove(list: readonly string[], id: string): string[] {
  return clean(list)
    .filter((item) => item !== id)
    .slice(0, MAX_MRU_PANELS);
}

/**
 * The panel one step from current along the list, newest first. Ids that
 * isOpen rejects are skipped, the walk wraps, and null means there is no other
 * open panel. A current that is not in the list steps to the newest (1) or the
 * oldest (-1) open panel.
 */
export function cycle(
  list: readonly string[],
  current: string | null,
  direction: CycleDirection,
  isOpen: (id: string) => boolean = () => true,
): string | null {
  const open = clean(list).filter((id) => id === current || isOpen(id));
  const at = current === null ? -1 : open.indexOf(current);
  const others = open.filter((id) => id !== current).length;
  if (others === 0) return null;
  const step = direction === -1 ? -1 : 1;
  if (at === -1) return step === 1 ? open[0] : open[open.length - 1];
  return open[(at + step + open.length) % open.length];
}

/** A state with nothing remembered. */
export function emptyMru(): MruState {
  return { order: [], hold: null, expect: null, seen: null };
}

/**
 * The active panel is now id. A change the app did not make itself moves id to
 * the front and ends a hold; the panel the app just selected for a press
 * leaves the order alone so the walk through the frozen copy continues.
 */
export function noteActive(state: MruState, id: string | null): MruState {
  if (!usable(id) || id === state.seen) return state;
  if (state.hold !== null && id === state.expect)
    return { ...state, expect: null, seen: id };
  return { order: touch(state.order, id), hold: null, expect: null, seen: id };
}

/** The panel id is gone: it leaves the order and the frozen copy. */
export function noteClosed(state: MruState, id: string): MruState {
  return {
    order: remove(state.order, id),
    hold: state.hold === null ? null : remove(state.hold, id),
    expect: state.expect === id ? null : state.expect,
    seen: state.seen === id ? null : state.seen,
  };
}

/**
 * One press of the switch chord. The first press of a hold freezes the order;
 * every press walks from the active panel through that frozen copy. target is
 * the panel to select, or null (and no change) when there is nowhere to go.
 */
export function stepCycle(
  state: MruState,
  current: string | null,
  direction: CycleDirection,
  isOpen: (id: string) => boolean,
): { state: MruState; target: string | null } {
  const frozen = state.hold ?? [...state.order];
  const target = cycle(frozen, current, direction, isOpen);
  if (target === null) return { state, target: null };
  return { state: { ...state, hold: frozen, expect: target }, target };
}

/** Control was released (or the window lost focus): the panel the walk stopped on becomes the newest and the hold ends. */
export function endCycle(state: MruState, current: string | null): MruState {
  if (state.hold === null) return state;
  return {
    order: usable(current) ? touch(state.order, current) : state.order,
    hold: null,
    expect: null,
    seen: usable(current) ? current : state.seen,
  };
}
