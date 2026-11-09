/** The layout changes that may offer Undo: a whole arrangement replaced at once. A drag, split, rename or maximize never does. */
export type UndoKind = "preset" | "sessions" | "role";

/** The text of the button in the notice. */
export const UNDO_LABEL = "Undo";

/** Milliseconds a plain notice stays, as before this feature. */
export const NOTICE_MS = 4500;

/** Milliseconds a notice with an Undo button stays, long enough to read and decide. */
export const UNDO_MS = 8000;

/** Longest name of a preset or role template shown in the notice, in characters. */
export const MAX_LABEL = 40;

/** The notice text and whether it carries an Undo button. */
export interface UndoOffer {
  text: string;
  canUndo: boolean;
}

/** What offerFor reads: the kind of change, a name, the history length after the snapshot, and the layout before and after. */
export interface OfferInput {
  kind: unknown;
  label?: unknown;
  pastLength: unknown;
  before: unknown;
  after: unknown;
}

/** What an offer remembers about the moment it was made: history depth, the entry Undo would restore and the layout shape. */
export interface UndoMark {
  depth: number;
  top: unknown;
  shape: string;
}

/** An Undo offer as the app holds it: the notice text it belongs to and the mark of its moment. */
export interface UndoNotice {
  text: string;
  mark: UndoMark;
}

const KINDS: readonly string[] = ["preset", "sessions", "role"];
const MAX_DEPTH = 32;
const MAX_NODES = 5000;

function isKind(value: unknown): value is UndoKind {
  return typeof value === "string" && KINDS.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hidden(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const spaced = value.split(/\s+/).join(" ");
  const kept: string[] = [];
  for (const ch of spaced) {
    const code = ch.codePointAt(0) ?? 0;
    if (!hidden(code)) kept.push(ch);
  }
  const text = kept.join("").trim();
  const chars = Array.from(text);
  if (chars.length <= MAX_LABEL) return text;
  return (
    chars
      .slice(0, MAX_LABEL - 3)
      .join("")
      .trimEnd() + "..."
  );
}

function messageFor(kind: UndoKind | null, label: unknown): string {
  const name = cleanLabel(label);
  if (kind === "preset")
    return name ? name + " arrangement applied" : "Arrangement applied";
  if (kind === "sessions") return "Rig sessions arranged";
  if (kind === "role")
    return name ? "Role template applied: " + name : "Role template applied";
  return "Layout changed";
}

function nodeShape(
  node: unknown,
  depth: number,
  budget: { left: number },
): string | null {
  if (!isRecord(node) || depth > MAX_DEPTH || budget.left <= 0) return null;
  budget.left -= 1;
  const type = typeof node.type === "string" ? node.type : "";
  const name = typeof node.name === "string" && node.name ? node.name : "";
  if (type === "tab")
    return JSON.stringify([typeof node.id === "string" ? node.id : "", name]);
  const place = typeof node.location === "string" ? ":" + node.location : "";
  const label = name ? "=" + JSON.stringify(name) : "";
  const parts: string[] = [];
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const part = nodeShape(child, depth + 1, budget);
    if (part === null) return null;
    parts.push(part);
  }
  return type + place + label + "(" + parts.join(",") + ")";
}

/** The structure of a layout as text: rows, groups and the ids and titles of the panels in them, in order, and group names. Sizes, the selected tab, the focused group and generated group ids are left out, so only a panel that moved, appeared, went away or was renamed changes it. Null when the input is not a layout or is too large to read. */
export function layoutShape(model: unknown): string | null {
  if (!isRecord(model)) return null;
  const budget = { left: MAX_NODES };
  const main = nodeShape(model.layout, 0, budget);
  if (main === null) return null;
  const parts = ["L" + main];
  const borders = Array.isArray(model.borders) ? model.borders : [];
  for (const border of borders) {
    const part = nodeShape(border, 0, budget);
    if (part === null) return null;
    parts.push("B" + part);
  }
  const windows = isRecord(model.subLayouts) ? model.subLayouts : {};
  for (const key of Object.keys(windows).sort()) {
    const sub = windows[key];
    const part = nodeShape(isRecord(sub) ? sub.layout : null, 0, budget);
    if (part === null) return null;
    parts.push("W" + JSON.stringify(key) + part);
  }
  return parts.join(";");
}

/** The notice for a layout change and whether Undo is offered: only for a known kind, only when history holds the snapshot taken just before and only when the layout really changed. The text for a preset or the sessions arrangement is the one the app showed before. */
export function offerFor(input: OfferInput): UndoOffer {
  const kind = isKind(input.kind) ? input.kind : null;
  const text = messageFor(kind, input.label);
  const length = input.pastLength;
  if (kind === null || typeof length !== "number" || !(length >= 1))
    return { text, canUndo: false };
  const before = layoutShape(input.before);
  const after = layoutShape(input.after);
  return {
    text,
    canUndo: before !== null && after !== null && before !== after,
  };
}

function viewOf(
  history: unknown,
): { past: unknown[]; future: unknown[] } | null {
  if (!isRecord(history)) return null;
  const { past, future } = history;
  if (!Array.isArray(past) || !Array.isArray(future)) return null;
  return { past, future };
}

/** Records the moment an offer is made: how deep the history is, which entry Undo would restore and the shape of the layout just applied. */
export function markOffer(history: unknown, current: unknown): UndoMark {
  const view = viewOf(history);
  const past = view ? view.past : [];
  return {
    depth: past.length,
    top: past.length ? past[past.length - 1] : undefined,
    shape: layoutShape(current) ?? "",
  };
}

/** Whether an offer still stands: the history has the same depth and the same top entry, nothing was undone, and the panels are still where the change left them. Anything else, or any input that is not a mark, a history or a layout, withdraws it. */
export function offerValid(
  mark: unknown,
  history: unknown,
  current: unknown,
): boolean {
  if (!isRecord(mark)) return false;
  const { depth, top, shape } = mark;
  const view = viewOf(history);
  if (view === null || typeof depth !== "number" || typeof shape !== "string")
    return false;
  if (depth < 1 || shape === "" || view.future.length !== 0) return false;
  if (view.past.length !== depth || view.past[depth - 1] !== top) return false;
  return layoutShape(current) === shape;
}

/** How long to keep the notice, in milliseconds, or null for no timer: none while nothing is shown, and none while the pointer rests on a notice that has an Undo button. */
export function toastDelay(
  visible: boolean,
  hasAction: boolean,
  hovered: boolean,
): number | null {
  if (!visible) return null;
  if (!hasAction) return NOTICE_MS;
  return hovered ? null : UNDO_MS;
}
