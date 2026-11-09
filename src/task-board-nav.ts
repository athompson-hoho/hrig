/** The task board columns in order: three named states, then one column for every other state. */
export const BOARD_COLUMNS: readonly { state: string; label: string }[] = [
  { state: "pending", label: "pending" },
  { state: "in-progress", label: "in-progress" },
  { state: "blocked", label: "blocked" },
  { state: "other", label: "Other states" },
];
/** The keys the board handles: Up and Down so far. */
export const NAV_KEYS: readonly string[] = ["ArrowUp", "ArrowDown"];

/** One column of the board: its state key, the heading shown and its cards in the order given. */
export type BoardColumn<T> = { state: string; label: string; items: T[] };
/** The position of a card: the column index and the row index inside that column. */
export type Cell = { col: number; row: number };

const NAMED = BOARD_COLUMNS.slice(0, -1).map((c) => c.state);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;

/** The cards per column; anything that is not a column with an items list counts as empty. */
function sizes(columns: unknown): number[] {
  return Array.isArray(columns)
    ? columns.map((c) =>
        plain(c) && Array.isArray(c.items) ? c.items.length : 0,
      )
    : [];
}

/** A cell read from untrusted input: whole numbers only, anything else gives null. */
function readCell(value: unknown): Cell | null {
  const col = plain(value) ? whole(value.col) : null;
  const row = plain(value) ? whole(value.row) : null;
  return col === null || row === null ? null : { col, row };
}

/** The four columns of the board for the visible tasks: pending, in-progress, blocked, then every other state, each in the order given; an entry that is not an object is left out and the input is never changed. */
export function boardColumns<T>(visible: T[]): BoardColumn<T>[] {
  const columns: BoardColumn<T>[] = BOARD_COLUMNS.map((c) => ({
    state: c.state,
    label: c.label,
    items: [],
  }));
  if (!Array.isArray(visible)) return columns;
  for (const item of visible) {
    if (!plain(item)) continue;
    const status: unknown = item.status;
    const at = typeof status === "string" ? NAMED.indexOf(status) : -1;
    columns[at >= 0 ? at : columns.length - 1].items.push(item);
  }
  return columns;
}

/** The key name of a navigation key pressed on its own: a string is a key name, an object is a key event; Ctrl, Alt, Meta, Shift, a key already handled or one typed during text composition gives null, as does any key that is not handled. */
export function navKey(event: unknown): string | null {
  const e = typeof event === "string" ? { key: event } : event;
  if (!plain(e)) return null;
  if (
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    e.shiftKey ||
    e.isComposing ||
    e.defaultPrevented
  )
    return null;
  return typeof e.key === "string" && NAV_KEYS.includes(e.key) ? e.key : null;
}

/** The position of a card in reading order (column by column), the order the cards appear in the page; -1 when the cell is not a card of the columns. */
export function cellIndex(columns: unknown, cell: unknown): number {
  const counts = sizes(columns);
  const c = readCell(cell);
  if (c === null || c.col < 0 || c.col >= counts.length) return -1;
  if (c.row < 0 || c.row >= counts[c.col]) return -1;
  let index = c.row;
  for (let col = 0; col < c.col; col++) index += counts[col];
  return index;
}

/** The cell of the card at a position in reading order; null when there is no such card or the position is not a whole number. */
export function cellAtIndex(columns: unknown, index: unknown): Cell | null {
  const counts = sizes(columns);
  let rest = whole(index);
  if (rest === null || rest < 0) return null;
  for (let col = 0; col < counts.length; col++) {
    if (rest < counts[col]) return { col, row: rest };
    rest -= counts[col];
  }
  return null;
}

/** Where focus goes for a key: Up and Down move inside the column and stop at its first and last card (the same card is returned there); a position that is not a card of the columns, a key that is not handled and an empty board give null. Never throws. */
export function moveFocus(
  columns: unknown,
  from: unknown,
  event: unknown,
): Cell | null {
  const key = navKey(event);
  const here = readCell(from);
  if (key === null || here === null || cellIndex(columns, here) < 0)
    return null;
  const last = sizes(columns)[here.col] - 1;
  return {
    col: here.col,
    row:
      key === "ArrowUp"
        ? Math.max(here.row - 1, 0)
        : Math.min(here.row + 1, last),
  };
}
