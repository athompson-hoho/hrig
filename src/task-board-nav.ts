/** The task board columns in order: three named states, then one column for every other state. */
export const BOARD_COLUMNS: readonly { state: string; label: string }[] = [
  { state: "pending", label: "pending" },
  { state: "in-progress", label: "in-progress" },
  { state: "blocked", label: "blocked" },
  { state: "other", label: "Other states" },
];
/** The keys the board handles: arrows, Home and End. */
export const NAV_KEYS: readonly string[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
];

/** One column of the board: its state key, the heading shown and its cards in the order given. */
export type BoardColumn<T> = { state: string; label: string; items: T[] };
/** The position of a card: the column index and the row index inside that column. */
export type Cell = { col: number; row: number };
/** What the board remembers of the card that last had focus: its id (when it has one) and where it sat. */
export type Stop = { id: string | null; col: number; row: number };

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

/** The first card of the first column that holds one, or null for an empty board. */
function firstCell(counts: number[]): Cell | null {
  const col = counts.findIndex((n) => n > 0);
  return col < 0 ? null : { col, row: 0 };
}

/** The id of the card at a cell: a non-empty string or a finite number as text; null when it has none. */
function idAt(columns: unknown, cell: Cell): string | null {
  if (!Array.isArray(columns)) return null;
  const column = columns[cell.col];
  const item =
    plain(column) && Array.isArray(column.items)
      ? column.items[cell.row]
      : undefined;
  const id = plain(item) ? item.id : undefined;
  if (typeof id === "string" && id !== "") return id;
  return typeof id === "number" && Number.isFinite(id) ? String(id) : null;
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

/** The key name of a navigation key pressed on its own: a string is a key name, an object is a key event; Ctrl, Alt, Meta, Shift, a key already handled or one typed during text composition gives null, as does any key that is not an arrow, Home or End. */
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

/** The nearest real card to a wanted position: the column is clamped, an empty column gives way to the nearest column with cards (the left one on a tie), the row is clamped; anything that is not a position gives the first card, an empty board gives null. */
export function settleCell(columns: unknown, from: unknown): Cell | null {
  const counts = sizes(columns);
  const first = firstCell(counts);
  const wanted = readCell(from);
  if (first === null || wanted === null) return first;
  const start = Math.min(Math.max(wanted.col, 0), counts.length - 1);
  let col = -1;
  for (let d = 0; d < counts.length && col < 0; d++) {
    if (counts[start - d] > 0) col = start - d;
    else if (counts[start + d] > 0) col = start + d;
  }
  if (col < 0) return first;
  return { col, row: Math.min(Math.max(wanted.row, 0), counts[col] - 1) };
}

/** Where focus goes for a key: Up and Down move inside the column, Left and Right go to the nearest column that has cards keeping the row (clamped), Home and End go to the first and last card of the column; no wrapping, and at an edge the same card is returned. A position that no longer exists is settled first, a missing position gives the first card, and a key that is not handled, or an empty board, gives null. Never throws. */
export function moveFocus(
  columns: unknown,
  from: unknown,
  event: unknown,
): Cell | null {
  const key = navKey(event);
  if (key === null) return null;
  const counts = sizes(columns);
  if (readCell(from) === null) return firstCell(counts);
  const here = settleCell(columns, from);
  if (here === null) return null;
  const last = counts[here.col] - 1;
  if (key === "ArrowUp")
    return { col: here.col, row: Math.max(here.row - 1, 0) };
  if (key === "ArrowDown")
    return { col: here.col, row: Math.min(here.row + 1, last) };
  if (key === "Home") return { col: here.col, row: 0 };
  if (key === "End") return { col: here.col, row: last };
  const step = key === "ArrowLeft" ? -1 : 1;
  for (let col = here.col + step; col >= 0 && col < counts.length; col += step)
    if (counts[col] > 0)
      return { col, row: Math.min(here.row, counts[col] - 1) };
  return here;
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

/** What to remember when the card at a cell takes focus; null when the cell is not a card. */
export function stopAt(columns: unknown, cell: unknown): Stop | null {
  const c = readCell(cell);
  if (c === null || cellIndex(columns, c) < 0) return null;
  return { id: idAt(columns, c), col: c.col, row: c.row };
}

/** The card that should be the one tab stop of the board: the remembered card while its id is still on the board, else the card nearest to where it sat, else the first card; null for an empty board. */
export function tabCell(columns: unknown, stop: unknown): Cell | null {
  const counts = sizes(columns);
  if (firstCell(counts) === null) return null;
  const id = plain(stop) ? stop.id : null;
  if (typeof id === "string" && id !== "")
    for (let col = 0; col < counts.length; col++)
      for (let row = 0; row < counts[col]; row++)
        if (idAt(columns, { col, row }) === id) return { col, row };
  return settleCell(columns, stop);
}
