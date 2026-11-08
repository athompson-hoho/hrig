import { MAX_CLOSED_PANELS } from "./closed-panels";

/** What a panel is, as far as closing it matters: a shell ends, a seat only detaches. */
export type PanelKind = "file" | "seat" | "shell" | "other";

/** One tab of the clicked tab's group, in strip order. */
export interface PanelInfo {
  id: string;
  name: string;
  kind: PanelKind;
  dirty: boolean;
  locked: boolean;
}

/** self closes the clicked tab, others every other tab of its group, right the tabs after it. */
export type CloseScope = "self" | "others" | "right";

/** What closing a set of panels does, ready for the confirmation. */
export interface ClosePlan {
  order: string[];
  panels: number;
  files: number;
  seats: number;
  shells: number;
  others: number;
  dirty: number;
  confirm: boolean;
  title: string;
  description: string;
}

function usable(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function strip(tabIds: readonly string[], locked: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of tabIds) {
    if (!usable(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.filter((id) => !locked.includes(id));
}

/** Every tab of the group except id, in strip order; locked (pinned or not closable) and repeated ids are never targets and an id that is not in the group closes nothing. */
export function closeOthers(
  tabIds: readonly string[],
  id: string,
  locked: readonly string[] = [],
): string[] {
  const all = [...new Set(tabIds.filter(usable))];
  if (!all.includes(id)) return [];
  return strip(tabIds, locked).filter((item) => item !== id);
}

/** Every tab after id in strip order; locked and repeated ids are never targets and an id that is not in the group closes nothing. */
export function closeRight(
  tabIds: readonly string[],
  id: string,
  locked: readonly string[] = [],
): string[] {
  const all = [...new Set(tabIds.filter(usable))];
  const at = all.indexOf(id);
  if (at === -1) return [];
  return strip(all.slice(at + 1), locked);
}

/** file for editor and diff tabs, seat for a terminal attached to a seat, shell for any other terminal, other for the rest. */
export function panelKind(component: unknown, config: unknown): PanelKind {
  if (component === "editor" || component === "diff") return "file";
  if (component !== "terminal") return "other";
  const c =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>)
      : {};
  const seat = c.seat;
  return typeof seat === "object" && seat !== null && !c.rigControlToken
    ? "seat"
    : "shell";
}

function noun(count: number, one: string, many: string): string {
  return count + " " + (count === 1 ? one : many);
}

function join(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/**
 * The panels a scope closes and what to tell the user first. The order is the
 * strip order reversed, so the panel next to the one you kept closes last and
 * is the first Reopen closed panel brings back. A confirmation is needed when
 * more than one panel or any terminal would close.
 */
export function planClose(
  panels: readonly PanelInfo[],
  scope: CloseScope,
  id: string,
): ClosePlan {
  const ids = panels.map((panel) => panel.id);
  const locked = panels
    .filter((panel) => panel.locked)
    .map((panel) => panel.id);
  const targets =
    scope === "others"
      ? closeOthers(ids, id, locked)
      : scope === "right"
        ? closeRight(ids, id, locked)
        : ids.includes(id) && !locked.includes(id)
          ? [id]
          : [];
  const chosen = targets
    .map((target) => panels.find((panel) => panel.id === target))
    .filter((panel): panel is PanelInfo => panel !== undefined);
  const count = (kind: PanelKind) =>
    chosen.filter((panel) => panel.kind === kind).length;
  const files = count("file");
  const seats = count("seat");
  const shells = count("shell");
  const others = count("other");
  const dirty = chosen.filter((panel) => panel.dirty).length;
  const confirm = chosen.length > 1 || shells + seats > 0;
  const kinds = [
    ...(files > 0 ? [noun(files, "file", "files")] : []),
    ...(shells > 0 ? [noun(shells, "shell", "shells")] : []),
    ...(seats > 0 ? [noun(seats, "seat panel", "seat panels")] : []),
    ...(others > 0 ? [noun(others, "other panel", "other panels")] : []),
  ];
  const lines = [
    "This closes " +
      noun(chosen.length, "panel", "panels") +
      ": " +
      join(kinds) +
      ".",
  ];
  if (shells > 0)
    lines.push("Closing a shell ends it and anything running in it.");
  if (seats > 0)
    lines.push("A seat panel only detaches: the seat's session keeps running.");
  if (dirty > 0)
    lines.push(
      noun(dirty, "panel has", "panels have") +
        " unsaved edits and will ask before closing.",
    );
  lines.push(
    files + seats > MAX_CLOSED_PANELS
      ? "Reopen closed panel brings back only the last " +
          MAX_CLOSED_PANELS +
          " closed files and seats."
      : "Files and seat panels can be brought back with Reopen closed panel.",
  );
  return {
    order: [...targets].reverse(),
    panels: chosen.length,
    files,
    seats,
    shells,
    others,
    dirty,
    confirm,
    title: "Close " + noun(chosen.length, "panel", "panels") + "?",
    description: lines.join(" "),
  };
}

/** The line shown when a panel with unsaved edits is next in a run of closes; remaining counts the panels still to close after it. */
export function dirtyPrompt(name: string, remaining: number): string {
  const label = usable(name) ? name : "This panel";
  const tail =
    remaining > 0
      ? " " +
        noun(remaining, "more panel", "more panels") +
        " will close after it."
      : "";
  return (
    label +
    " has unsaved edits. Save them before closing, or discard them." +
    tail
  );
}
