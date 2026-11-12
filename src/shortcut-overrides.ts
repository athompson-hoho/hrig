import { classifyTerminalKey } from "./terminal-keys";
import { shortcutGroups, type Shortcut, type ShortcutGroup } from "./shortcuts";

/** The setting that keeps the saved overrides as one line of text. */
export const OVERRIDES_SETTING = "shortcuts.overrides";

/** The longest overrides text: the same limit the generic text setting rule has. */
export const MAX_OVERRIDES_TEXT = 1000;

/** The catalog ids whose key press already goes through a classifier in the App handler. */
export const OVERRIDABLE_IDS = [
  "workspace.palette",
  "workspace.quickOpen",
  "workspace.cyclePanelsNext",
  "workspace.cyclePanelsPrevious",
  "workspace.sidebar",
  "workspace.newShell",
  "workspace.closePanel",
  "workspace.focusTerminal",
  "workspace.focusEditor",
  "workspace.focusTasks",
  "workspace.reopenPanel",
  "workspace.maximizePanel",
  "workspace.focusMode",
  "terminal.find",
] as const;

export type OverridableId = (typeof OVERRIDABLE_IDS)[number];

/** Saved overrides: shortcut id to a canonical chord such as Ctrl+Shift+Y. */
export type OverrideMap = Partial<Record<OverridableId, string>>;

export type ChordResult =
  { ok: true; chord: string } | { ok: false; error: string };

export interface Collision {
  id: string;
  chord: string;
  reason: string;
}

export interface IgnoredEntry {
  entry: string;
  reason: string;
}

export interface ParsedOverrides {
  map: OverrideMap;
  ignored: IgnoredEntry[];
}

export type SaveResult =
  { ok: true; text: string } | { ok: false; error: string };

/** The shape of a key event the router reads; a DOM KeyboardEvent fits. */
export interface RouteKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
}

/** What the router decided: run a shortcut (id) or let a released default chord pass (null). */
export interface KeyRoute {
  id: OverridableId | null;
}

/**
 * Shift chords the Monaco editor binds with Ctrl or Cmd, read from the installed
 * package by a test that fails when an upgrade adds one that is missing here.
 */
export const EDITOR_SHIFT_LETTERS = [
  "A",
  "G",
  "I",
  "K",
  "L",
  "O",
  "R",
  "Z",
] as const;

const PRIMARY_WORDS = ["ctrl", "cmd", "command", "mod", "meta"];
const RESERVED_WORDS = ["alt", "option", "opt", "altgr", "win", "windows", "super"];
const EXAMPLE = "Ctrl+Shift+Y";

function fail(error: string): ChordResult {
  return { ok: false, error };
}

/**
 * Checks one typed chord and answers its canonical form. Ctrl, Cmd, Meta and
 * Mod mean the main modifier of the computer. Physical Control+Tab is the
 * deliberate exception; Control is otherwise a main-modifier alias.
 */
export function parseChord(text: unknown): ChordResult {
  if (typeof text !== "string" || text.trim() === "")
    return fail("Type a shortcut such as " + EXAMPLE + ".");
  const raw = text.trim();
  if (raw.length > 40) return fail("That shortcut is too long.");
  const tokens = raw.split("+").map((token) => token.trim());
  if (tokens.some((token) => token === ""))
    return fail(
      "Write modifiers and one letter joined with +, for example " +
        EXAMPLE +
        ".",
    );
  let primary = 0;
  let control = 0;
  let shift = 0;
  const others: string[] = [];
  for (const token of tokens) {
    const word = token.toLowerCase();
    if (RESERVED_WORDS.includes(word))
      return fail("Alt, Option and Windows combinations cannot be used here.");
    if (PRIMARY_WORDS.includes(word)) primary++;
    else if (word === "control") control++;
    else if (word === "shift") shift++;
    else others.push(token);
  }
  if (primary + control === 0)
    return fail("Start with Ctrl, Cmd, Meta or Control, for example " + EXAMPLE + ".");
  if (primary + control > 1)
    return fail("Use the main modifier or physical Control once.");
  if (shift > 1) return fail("Use Shift once.");
  if (others.length !== 1)
    return fail("Use exactly one key, for example " + EXAMPLE + ".");
  const rawKey = others[0];
  const namedKeys: Record<string, string> = {
    tab: "Tab", escape: "Escape", enter: "Enter", space: "Space",
    comma: "Comma", period: "Period", slash: "Slash", backslash: "Backslash",
    minus: "Minus", equal: "Equal", plus: "Plus", semicolon: "Semicolon",
    quote: "Quote", bracketleft: "BracketLeft", bracketright: "BracketRight",
    backquote: "Backquote",
  };
  for (let i = 1; i <= 12; i++) namedKeys[`f${i}`] = `F${i}`;
  const key = /^[A-Za-z]$/.test(rawKey)
    ? rawKey.toUpperCase()
    : /^\d$/.test(rawKey)
      ? rawKey
      : namedKeys[rawKey.toLowerCase()];
  if (!key) return fail("Use a letter, number, Tab, Enter, Escape, Space, punctuation key or F1-F12.");
  // Control is an alias for the platform's main modifier except for the
  // deliberately physical Control+Tab panel switch.
  const physicalControl = control && key === "Tab";
  const chord = `${physicalControl ? "Control" : "Ctrl"}+${shift ? "Shift+" : ""}${key}`;
  return { ok: true, chord };
}

/** The canonical form of a chord, or null when parseChord refuses it. */
export function normalizeChord(text: unknown): string | null {
  const result = parseChord(text);
  return result.ok ? result.chord : null;
}

/** A canonical chord as the catalog shows it: Cmd on macOS, Ctrl everywhere else. */
export function chordLabel(chord: string, platform: string): string {
  const physical = chord.startsWith("Control+");
  if (physical) return chord.replace(/^Control/, "Ctrl");
  return platform === "darwin" ? chord.replace(/^Ctrl/, "Cmd") : chord;
}

/** The label with spaces instead of plus signs, the way command center hints write it. */
export function chordHint(chord: string, platform: string): string {
  return chordLabel(chord, platform).split("+").join(" ");
}

function named(chord: string): string {
  if (chord.startsWith("Control+")) return chord.replace(/^Control/, "Ctrl");
  return chord.replace(/^Ctrl\+/, "Ctrl/Cmd+");
}

function isOverridable(id: string): id is OverridableId {
  return (OVERRIDABLE_IDS as readonly string[]).includes(id);
}

function entries(groups: ShortcutGroup[]): Shortcut[] {
  return groups.flatMap((group) => group.shortcuts);
}

function labelOf(groups: ShortcutGroup[], id: string): string {
  const found = entries(groups).find((entry) => entry.id === id);
  return found ? found.label : id;
}

/** The canonical default chord of an overridable shortcut, read from the catalog. */
export function defaultChord(id: OverridableId): string {
  const found = entries(shortcutGroups("linux")).find(
    (entry) => entry.id === id,
  );
  const first = found ? normalizeChord(found.keys[0]) : null;
  return first === null ? "" : first;
}

function terminalLetters(): Set<string> {
  const taken = new Set<string>();
  for (const platform of ["darwin", "win32"]) {
    const mac = platform === "darwin";
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      for (const selected of [false, true]) {
        const action = classifyTerminalKey(
          {
            key: letter,
            ctrlKey: !mac,
            metaKey: mac,
            altKey: false,
            shiftKey: true,
          },
          platform,
          selected,
        );
        if (action !== "pass") taken.add(letter);
      }
    }
  }
  // Physical Control+C is a terminal signal (or copy) on every platform even
  // though macOS reserves Cmd as the application's main modifier.
  taken.add("C");
  return taken;
}

/** Why a chord can never be rebound to, or an empty string when no terminal or editor key uses it. */
export function reservedReason(chord: string): string {
  if (chord === "Control+Tab" || chord === "Control+Shift+Tab") return "";
  const normalized = chord.replace(/^Control\+/, "Ctrl+");
  const key = normalized.split("+").at(-1) || "";
  if (normalized.startsWith("Ctrl+Shift+") && terminalLetters().has(key))
    return named(normalized) + " is a terminal key (find, copy, paste or clear).";
  if (normalized.startsWith("Ctrl+Shift+") && (EDITOR_SHIFT_LETTERS as readonly string[]).includes(key))
    return named(normalized) + " is used by the code editor.";
  if (normalized.startsWith("Ctrl+") && ["Q", "W", "H", "M", "Space", "Tab"].includes(key) && !normalized.startsWith("Ctrl+Shift+"))
    return named(normalized) + " is reserved by the operating system on some computers.";
  if (normalized === "Ctrl+Shift+Tab")
    return named(normalized) + " is reserved by the operating system on some computers.";
  if (normalized === "Ctrl+Shift+Escape")
    return named(normalized) + " is reserved by the operating system.";
  return "";
}

function chordIdentity(chord: string): string {
  // parseChord keeps only Control+Tab physical; all other modifier aliases are canonical.
  return chord;
}

function bareLetter(chord: string): string | null {
  const parts = chord.split("+");
  const key = parts.at(-1) || "";
  return /^[A-Z]$/.test(key) && !parts.includes("Shift") ? key : null;
}

/** Why a shortcut cannot share a chord with a terminal, editor or OS action. */
function conflict(
  groups: ShortcutGroup[],
  id: OverridableId,
  chord: string,
  candidate: OverrideMap,
): string {
  const isOwnDefault = chord === defaultChord(id);
  const letter = bareLetter(chord);
  if (letter && !isOwnDefault)
    return named(chord) + " needs Shift; unshifted Ctrl/Cmd letters belong to terminals and the editor.";
  const reserved = isOwnDefault ? "" : reservedReason(chord);
  if (reserved !== "") return reserved;
  for (const entry of entries(groups)) {
    if (isOverridable(entry.id)) continue;
    if (entry.keys.some((key) => {
      const normalized = normalizeChord(key);
      return normalized !== null && chordIdentity(normalized) === chordIdentity(chord);
    }))
      return named(chord) + " is already used by: " + entry.label + ".";
  }
  for (const other of OVERRIDABLE_IDS) {
    if (other === id) continue;
    if (chordIdentity(effectiveChord(other, candidate)) === chordIdentity(chord))
      return (
        named(chord) + " is already used by: " + labelOf(groups, other) + "."
      );
  }
  return "";
}

function effectiveChord(id: OverridableId, candidate: OverrideMap): string {
  const own = candidate[id];
  return own !== undefined ? own : defaultChord(id);
}

/** Every entry of the map that cannot be applied, with the reason; defaults, each other, terminal and editor keys are checked. */
export function findCollisions(
  groups: ShortcutGroup[],
  map: OverrideMap,
): Collision[] {
  const found: Collision[] = [];
  for (const id of OVERRIDABLE_IDS) {
    const chord = map[id];
    if (chord === undefined) continue;
    const parsed = parseChord(chord);
    if (!parsed.ok) {
      found.push({ id, chord, reason: parsed.error });
      continue;
    }
    const reason = conflict(groups, id, parsed.chord, map);
    if (reason !== "") found.push({ id, chord, reason });
  }
  return found;
}

/** The map without its colliding or malformed entries, plus the reasons. */
export function validateOverrideMap(
  groups: ShortcutGroup[],
  map: unknown,
): { map: OverrideMap; errors: Collision[] } {
  const candidate: OverrideMap = {};
  const errors: Collision[] = [];
  if (map !== null && typeof map === "object" && !Array.isArray(map)) {
    for (const [id, chord] of Object.entries(map)) {
      if (!isOverridable(id)) {
        errors.push({
          id,
          chord: String(chord),
          reason: "This shortcut cannot be rebound.",
        });
        continue;
      }
      const parsed = parseChord(chord);
      if (parsed.ok) candidate[id] = parsed.chord;
      else errors.push({ id, chord: String(chord), reason: parsed.error });
    }
  }
  const bad = findCollisions(groups, candidate);
  const clean: OverrideMap = {};
  for (const id of OVERRIDABLE_IDS) {
    const chord = candidate[id];
    if (chord !== undefined && !bad.some((item) => item.id === id))
      clean[id] = chord;
  }
  return { map: clean, errors: errors.concat(bad) };
}

/** The saved text as id=keys pairs in catalog order, for example workspace.focusMode=Ctrl+Shift+Y. */
export function formatOverrideText(map: OverrideMap): string {
  const parts: string[] = [];
  for (const id of OVERRIDABLE_IDS) {
    const chord = map[id];
    if (chord !== undefined) parts.push(id + "=" + chord);
  }
  return parts.join(",");
}

/** Reads saved text defensively: bad, unknown, repeated and clashing entries are dropped and listed, never thrown. */
export function parseOverrideText(
  text: unknown,
  platform: string,
): ParsedOverrides {
  const ignored: IgnoredEntry[] = [];
  if (typeof text !== "string" || text.trim() === "")
    return { map: {}, ignored };
  if (text.length > MAX_OVERRIDES_TEXT)
    return {
      map: {},
      ignored: [
        {
          entry: text.slice(0, 40),
    reason: `The saved text is longer than ${MAX_OVERRIDES_TEXT} characters.`,
        },
      ],
    };
  const candidate: Record<string, string> = {};
  for (const part of text.split(",")) {
    const piece = part.trim();
    if (piece === "") continue;
    const at = piece.indexOf("=");
    if (at < 1 || piece.indexOf("=", at + 1) !== -1) {
      ignored.push({ entry: piece, reason: "Not in the form id=keys." });
      continue;
    }
    const id = piece.slice(0, at).trim();
    if (!isOverridable(id)) {
      ignored.push({
        entry: piece,
        reason: "That shortcut cannot be rebound.",
      });
      continue;
    }
    if (Object.hasOwn(candidate, id)) {
      ignored.push({ entry: piece, reason: "That shortcut is set twice." });
      continue;
    }
    candidate[id] = piece.slice(at + 1).trim();
  }
  const checked = validateOverrideMap(shortcutGroups(platform), candidate);
  for (const error of checked.errors)
    ignored.push({ entry: error.id + "=" + error.chord, reason: error.reason });
  return { map: checked.map, ignored };
}

/**
 * The catalog with the effective keys of every valid override. An empty or
 * invalid map answers the same groups unchanged, so today's catalog is kept
 * exactly; labels and every other shortcut are never touched.
 */
export function applyOverrides(
  groups: ShortcutGroup[],
  map: OverrideMap,
  platform: string,
): ShortcutGroup[] {
  const clean = validateOverrideMap(groups, map).map;
  if (formatOverrideText(clean) === "") return groups;
  return groups.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.map((shortcut) => {
      const chord = isOverridable(shortcut.id) ? clean[shortcut.id] : undefined;
      return chord === undefined
        ? shortcut
        : { ...shortcut, keys: [chordLabel(chord, platform)] };
    }),
  }));
}

/** Shortcuts whose label, keys or group title hold every word of the query; an empty query keeps everything. */
export function filterShortcutGroups(
  groups: ShortcutGroup[],
  query: string,
): ShortcutGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  const result: ShortcutGroup[] = [];
  for (const group of groups) {
    const shortcuts = group.shortcuts.filter((shortcut) => {
      const haystack = (
        group.title +
        " " +
        shortcut.label +
        " " +
        shortcut.keys.join(" ")
      ).toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    if (shortcuts.length > 0) result.push({ ...group, shortcuts });
  }
  return result;
}

/** The new saved text after setting one shortcut to the typed chord, or the reason it is refused. */
export function saveOverride(
  text: unknown,
  id: string,
  chordText: string,
  platform: string,
): SaveResult {
  if (!isOverridable(id))
    return {
      ok: false,
      error: "This shortcut is fixed and cannot be rebound.",
    };
  const parsed = parseChord(chordText);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const groups = shortcutGroups(platform);
  const current = parseOverrideText(text, platform).map;
  if (parsed.chord === defaultChord(id)) {
    const next = { ...current };
    delete next[id];
    return { ok: true, text: formatOverrideText(next) };
  }
  const reason = conflict(groups, id, parsed.chord, current);
  if (reason !== "") return { ok: false, error: reason };
  return {
    ok: true,
    text: formatOverrideText({ ...current, [id]: parsed.chord }),
  };
}

/** The saved text with one shortcut back at its default; other overrides are kept. */
export function resetOverride(
  text: unknown,
  id: string,
  platform: string,
): string {
  const next = { ...parseOverrideText(text, platform).map };
  if (isOverridable(id)) delete next[id];
  return formatOverrideText(next);
}

const EVENT_CODES: Record<string, string> = {
  "0": "Digit0", "1": "Digit1", "2": "Digit2", "3": "Digit3", "4": "Digit4",
  "5": "Digit5", "6": "Digit6", "7": "Digit7", "8": "Digit8", "9": "Digit9",
  Tab: "Tab", Escape: "Escape", Enter: "Enter", Space: "Space",
  Comma: "Comma", Period: "Period", Slash: "Slash", Backslash: "Backslash",
  Minus: "Minus", Equal: "Equal", Plus: "Equal", Semicolon: "Semicolon",
  Quote: "Quote", BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backquote: "Backquote",
};
for (let i = 1; i <= 12; i++) EVENT_CODES[`F${i}`] = `F${i}`;

function matches(
  event: RouteKeyEvent,
  chord: string,
  platform: string,
  allowExtraShift = false,
): boolean {
  if (event.altKey || typeof event.key !== "string") return false;
  const parsed = parseChord(chord);
  if (!parsed.ok) return false;
  const parts = parsed.chord.split("+");
  const key = parts[parts.length - 1];
  const shift = parts.includes("Shift");
  if (event.shiftKey !== shift && !(allowExtraShift && !shift && event.shiftKey)) return false;
  const eventKey = ({
    Space: " ", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
    Minus: "-", Equal: "=", Plus: "+", Semicolon: ";", Quote: "'",
    BracketLeft: "[", BracketRight: "]", Backquote: "`",
  } as Record<string, string>)[key] ?? key;
  const physicalCode = EVENT_CODES[key];
  const keyMatches = physicalCode && event.code
    ? event.code === physicalCode
    : event.key.toLowerCase() === eventKey.toLowerCase();
  if (!keyMatches) return false;
  if (parts[0] === "Control") return event.ctrlKey && !event.metaKey;
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/**
 * Resolves an app shortcut from its current chord. A press of the default
 * chord after it has moved answers {id: null}, releasing it to the panel.
 * Held, composing or already handled presses never run an action.
 */
export function routeOverriddenKey(
  event: RouteKeyEvent,
  platform: string,
  map: OverrideMap,
): KeyRoute | null {
  if (event.altKey || event.isComposing || event.defaultPrevented) return null;
  for (const id of OVERRIDABLE_IDS) {
    const overridden = map[id] !== undefined;
    const chord = map[id] ?? defaultChord(id);
    const legacyShift =
      (id === "workspace.palette" || id === "workspace.sidebar") &&
      chord === defaultChord(id);
    if (matches(event, chord, platform, legacyShift)) return { id };
    if (overridden && matches(event, defaultChord(id), platform, legacyShift)) return { id: null };
  }
  return null;
}

/** The commands with the default chord in a hint replaced by the effective one; the commands are untouched when nothing is overridden. */
export function withEffectiveHints<T extends { hint: string }>(
  commands: readonly T[],
  platform: string,
  map: OverrideMap,
): T[] {
  const moved = OVERRIDABLE_IDS.filter((id) => map[id] !== undefined);
  if (moved.length === 0) return commands.slice();
  return commands.map((command) => {
    for (const id of moved) {
      const old = " " + chordHint(defaultChord(id), platform);
      const chord = map[id];
      if (chord !== undefined && command.hint.endsWith(old))
        return {
          ...command,
          hint:
            command.hint.slice(0, command.hint.length - old.length) +
            " " +
            chordHint(chord, platform),
        };
    }
    return command;
  });
}
