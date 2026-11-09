/** Most closed panels remembered at once; the oldest is forgotten first. */
export const MAX_CLOSED_PANELS = 10;

const MAX_TEXT = 4096;
const MAX_TITLE = 200;
const MAX_LINE = 10000000;

/**
 * What is kept about a closed file or diff panel: only identifiers, never the
 * file contents. line is the line the panel was opened at, when it had one.
 */
export interface ClosedFile {
  kind: "file" | "diff";
  scope: string;
  title: string;
  connectionId: string;
  root: string;
  path: string;
  line?: number;
}

/**
 * What is kept about a closed seat panel: the seat id and nothing about the
 * terminal. A seat entry reopens by attaching to the seat's existing session.
 */
export interface ClosedSeat {
  kind: "seat";
  scope: string;
  title: string;
  connectionId: string;
  seatId: string;
}

/** A remembered closed panel; never file contents, terminal output or commands. */
export type ClosedPanel = ClosedFile | ClosedSeat;

/** The three fields of a layout tab that decide whether it can be reopened. */
export interface ClosedTab {
  component?: unknown;
  name?: unknown;
  config?: unknown;
}

/** What the reopen decision needs to know about the running workspace. */
export interface ReopenContext {
  connectionIds: readonly string[];
  activeConnectionId: string;
  inventoryReady: boolean;
  seats: readonly { id: string; session: string | null }[];
}

/** The only three outcomes of a reopen: open a file, attach a seat, or skip. */
export type ReopenPlan =
  | {
      action: "openFile";
      path: string;
      diff: boolean;
      line?: number;
      connectionId: string;
      root: string;
    }
  | { action: "openSeat"; seatId: string }
  | { action: "skip"; message: string; keep: boolean };

function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > MAX_TEXT || hasControl(value)) return null;
  return value;
}

function cleanTitle(value: unknown, fallback: string): string {
  let text = "";
  if (typeof value === "string") {
    for (let i = 0; i < value.length && text.length < MAX_TITLE; i++) {
      const code = value.charCodeAt(i);
      text += code < 32 || code === 127 ? " " : value[i];
    }
  }
  text = text.trim();
  return text.length > 0 ? text : fallback.slice(0, MAX_TITLE);
}

function cleanLine(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_LINE
    ? value
    : undefined;
}

function identity(entry: ClosedPanel): string {
  const tail =
    entry.kind === "seat" ? entry.seatId : entry.root + "\n" + entry.path;
  return [entry.kind, entry.scope, entry.connectionId, tail].join("\n");
}

function normalizeEntry(value: unknown): ClosedPanel | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const scope = cleanText(raw.scope);
  const connectionId = cleanText(raw.connectionId);
  if (scope === null || connectionId === null) return null;
  const kind = raw.kind;
  if (kind === "seat") {
    const seatId = cleanText(raw.seatId);
    if (seatId === null) return null;
    return {
      kind: "seat",
      scope,
      title: cleanTitle(raw.title, seatId),
      connectionId,
      seatId,
    };
  }
  if (kind !== "file" && kind !== "diff") return null;
  const root = cleanText(raw.root);
  const path = cleanText(raw.path);
  if (root === null || path === null) return null;
  const line = cleanLine(raw.line);
  const entry: ClosedFile = {
    kind,
    scope,
    title: cleanTitle(raw.title, path),
    connectionId,
    root,
    path,
  };
  if (line !== undefined) entry.line = line;
  return entry;
}

/**
 * Clean list, oldest first: unusable entries are dropped, unknown fields are
 * stripped, a repeat of the same panel keeps only its newest copy, and at most
 * MAX_CLOSED_PANELS of the newest remain. Always returns a new array.
 */
export function normalizeClosed(value: unknown): ClosedPanel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const newestFirst: ClosedPanel[] = [];
  for (let i = value.length - 1; i >= 0; i--) {
    if (newestFirst.length >= MAX_CLOSED_PANELS) break;
    const entry = normalizeEntry(value[i]);
    if (entry === null) continue;
    const key = identity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    newestFirst.push(entry);
  }
  return newestFirst.reverse();
}

/**
 * The reopenable description of a layout tab, or null when it must not be
 * reopened: shells and rig-control terminals (closing them ended the process,
 * and a reopen would start a new one), tools, settings and anything malformed.
 * A terminal counts only when it is a seat panel whose id matches its seat.
 */
export function describeClosedPanel(
  tab: ClosedTab,
  scope: string,
): ClosedPanel | null {
  if (typeof tab !== "object" || tab === null) return null;
  const config = tab.config;
  if (typeof config !== "object" || config === null) return null;
  const c = config as Record<string, unknown>;
  const connection = c.connection;
  if (typeof connection !== "object" || connection === null) return null;
  const connectionId = (connection as Record<string, unknown>).id;
  if (tab.component === "editor" || tab.component === "diff") {
    return normalizeEntry({
      kind: tab.component === "diff" ? "diff" : "file",
      scope,
      title: tab.name,
      connectionId,
      root: c.root,
      path: c.path,
      line: c.line,
    });
  }
  if (tab.component !== "terminal" || c.rigControlToken) return null;
  const seat = c.seat;
  if (typeof seat !== "object" || seat === null) return null;
  const seatId = (seat as Record<string, unknown>).id;
  if (typeof seatId !== "string" || typeof connectionId !== "string")
    return null;
  if (c.terminalId !== "seat:" + connectionId + ":" + seatId) return null;
  return normalizeEntry({
    kind: "seat",
    scope,
    title: tab.name,
    connectionId,
    seatId,
  });
}

/** The list with one more closed panel on top; null or unusable adds nothing. */
export function pushClosed(
  stack: readonly ClosedPanel[],
  entry: ClosedPanel | null,
): ClosedPanel[] {
  return normalizeClosed(entry === null ? stack : [...stack, entry]);
}

/**
 * Removes and returns the most recently closed panel of one workspace scope;
 * panels of other scopes stay. Never changes the list it is given.
 */
export function popLatest(
  stack: readonly ClosedPanel[],
  scope: string,
): { entry: ClosedPanel | null; stack: ClosedPanel[] } {
  const list = normalizeClosed(stack);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].scope === scope)
      return {
        entry: list[i],
        stack: [...list.slice(0, i), ...list.slice(i + 1)],
      };
  }
  return { entry: null, stack: list };
}

/**
 * Decides how to reopen a popped entry using only the app's normal open paths.
 * Files and diffs reopen through the file opener; a seat reopens by attaching
 * to its existing session; nothing here can start, relaunch or type into
 * anything. keep is true when the problem is likely to pass (stale inventory,
 * a seat with no session yet), so the entry can be put back.
 */
export function planReopen(
  entry: ClosedPanel,
  context: ReopenContext,
): ReopenPlan {
  if (entry.kind !== "seat") {
    if (!context.connectionIds.includes(entry.connectionId))
      return {
        action: "skip",
        message:
          entry.title + " cannot be reopened: its connection was removed.",
        keep: false,
      };
    const plan: Extract<ReopenPlan, { action: "openFile" }> = {
      action: "openFile",
      path: entry.path,
      diff: entry.kind === "diff",
      connectionId: entry.connectionId,
      root: entry.root,
    };
    if (entry.line !== undefined) plan.line = entry.line;
    return plan;
  }
  if (entry.connectionId !== context.activeConnectionId)
    return {
      action: "skip",
      message: "Switch to the seat's connection to reopen " + entry.title + ".",
      keep: false,
    };
  if (!context.inventoryReady)
    return {
      action: "skip",
      message:
        "Refresh the connection before reopening " +
        entry.title +
        ". Nothing was started.",
      keep: true,
    };
  const seat = context.seats.find((s) => s.id === entry.seatId);
  if (!seat)
    return {
      action: "skip",
      message: entry.title + " is no longer in this rig.",
      keep: false,
    };
  if (!seat.session)
    return {
      action: "skip",
      message:
        entry.title + " has no attachable session yet. Nothing was started.",
      keep: true,
    };
  return { action: "openSeat", seatId: entry.seatId };
}
