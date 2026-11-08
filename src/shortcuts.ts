import { TERMINAL_PANEL_SELECTOR } from "./terminal-keys";

export interface Shortcut {
  id: string;
  label: string;
  keys: string[];
}

export interface ShortcutGroup {
  id: string;
  title: string;
  shortcuts: Shortcut[];
}

export interface HelpKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
}

export interface ReopenKeyEvent extends HelpKeyEvent {
  shiftKey: boolean;
}

/** The same key event shape serves the maximize chord. */
export type MaximizeKeyEvent = ReopenKeyEvent;

/** The same key event shape serves the focus mode chord. */
export type FocusModeKeyEvent = ReopenKeyEvent;

/**
 * The shortcut catalog for a platform, rebuilt on every call. It mirrors the
 * App key handler, terminal-keys, terminal-zoom and the editor save command;
 * the test runs the terminal and zoom chords through the real classifiers so
 * it cannot drift. Cmd labels on darwin, Ctrl labels for every other value.
 */
export function shortcutGroups(platform: string): ShortcutGroup[] {
  const mac = platform === "darwin";
  const mod = mac ? "Cmd" : "Ctrl";
  return [
    {
      id: "workspace",
      title: "Workspace",
      shortcuts: [
        {
          id: "workspace.palette",
          label: mac
            ? "Open the command center (in a terminal, Cmd+K clears instead)"
            : "Open the command center",
          keys: [`${mod}+K`],
        },
        {
          id: "workspace.quickOpen",
          label: "Quick Open a project file",
          keys: [`${mod}+P`],
        },
        {
          id: "workspace.panels",
          label: "Find open panels",
          keys: [`${mod}+Shift+P`],
        },
        {
          id: "workspace.settings",
          label: "Open settings",
          keys: [`${mod}+comma`],
        },
        {
          id: "workspace.openProject",
          label: "Choose a project folder",
          keys: [`${mod}+O`],
        },
        {
          id: "workspace.sidebar",
          label: "Show or hide the sidebar",
          keys: [`${mod}+B`],
        },
        {
          id: "workspace.newShell",
          label: "Open a new shell",
          keys: [`${mod}+Shift+T`],
        },
        {
          id: "workspace.reopenPanel",
          label: "Reopen the file or seat panel closed last",
          keys: [`${mod}+Shift+H`],
        },
        {
          id: "workspace.maximizePanel",
          label: "Maximize or restore the focused panel group",
          keys: [`${mod}+Shift+M`],
        },
        {
          id: "workspace.focusMode",
          label: "Hide or show the sidebar and status bar (focus mode)",
          keys: [`${mod}+Shift+D`],
        },
        {
          id: "workspace.shortcuts",
          label:
            "Show this list (not while typing in a field, the editor or a terminal)",
          keys: ["?"],
        },
      ],
    },
    {
      id: "terminal",
      title: "Terminal",
      shortcuts: [
        {
          id: "terminal.find",
          label: "Find in the terminal",
          keys: [`${mod}+F`],
        },
        {
          id: "terminal.copy",
          label: "Copy the selection",
          keys: [mac ? "Cmd+C" : "Ctrl+Shift+C"],
        },
        {
          id: "terminal.paste",
          label: "Paste",
          keys: mac ? ["Cmd+V"] : ["Ctrl+V", "Ctrl+Shift+V"],
        },
        {
          id: "terminal.clear",
          label: "Clear scrollback",
          keys: [mac ? "Cmd+K" : "Ctrl+Shift+K"],
        },
        {
          id: "terminal.interrupt",
          label: mac
            ? "Interrupt the running command"
            : "Interrupt the running command (Ctrl+C copies instead while text is selected)",
          keys: ["Ctrl+C"],
        },
        {
          id: "terminal.zoomIn",
          label: "Zoom in",
          keys: [`${mod}+=`, `${mod}+Plus`],
        },
        { id: "terminal.zoomOut", label: "Zoom out", keys: [`${mod}+minus`] },
        { id: "terminal.zoomReset", label: "Reset zoom", keys: [`${mod}+0`] },
      ],
    },
    {
      id: "editor",
      title: "Editor",
      shortcuts: [
        { id: "editor.save", label: "Save the file", keys: [`${mod}+S`] },
      ],
    },
  ];
}

/**
 * True only for a bare question mark pressed while the user is not typing: not
 * under a modal, with no Ctrl, Meta or Alt, not composing, repeating or already
 * handled, and not inside a field, contenteditable, the Monaco editor or a
 * terminal panel. Shift is ignored because layouts differ.
 */
export function isHelpKey(
  event: HelpKeyEvent,
  target: unknown,
  modalOpen: boolean,
): boolean {
  if (modalOpen || event.key !== "?") return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing || event.repeat || event.defaultPrevented) return false;
  if (target === null || target === undefined) return false;
  const node = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: unknown;
  };
  if (typeof node.tagName === "string") {
    const tag = node.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  }
  if (node.isContentEditable === true) return false;
  // Duck-typed on closest because pop-out windows hand us targets from another DOM.
  if (typeof node.closest === "function") {
    if (node.closest(".monaco-editor")) return false;
    if (node.closest(TERMINAL_PANEL_SELECTOR)) return false;
  }
  return true;
}

/**
 * True when the target's own document already shows a modal dialog. Every
 * Modal and the update-restart overlay render aria-modal, including the ones
 * panels own, which App state does not know about.
 */
export function hasOpenDialog(target: unknown): boolean {
  if (target === null || target === undefined || typeof target !== "object")
    return false;
  const node = target as { ownerDocument?: unknown };
  const doc = (node.ownerDocument ?? target) as { querySelector?: unknown };
  if (typeof doc.querySelector !== "function") return false;
  return Boolean(doc.querySelector('[aria-modal="true"]'));
}

/**
 * True for Shift+H with Cmd on macOS or Ctrl elsewhere and no other modifier,
 * the chord that reopens the panel closed last. Ctrl+Shift+T stays New shell.
 * A held key (repeat), composing or already handled events never match, so one
 * press reopens one panel; plain Ctrl+H and macOS Ctrl+Shift+H are untouched.
 */
export function isReopenPanelKey(
  event: ReopenKeyEvent,
  platform: string,
): boolean {
  if (event.altKey || event.isComposing || event.repeat) return false;
  if (event.defaultPrevented || !event.shiftKey) return false;
  if (typeof event.key !== "string" || event.key.toLowerCase() !== "h")
    return false;
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** Palette hint text for the reopen shortcut on the given platform. */
export function reopenShortcutHint(platform: string): string {
  return platform === "darwin" ? "Cmd Shift H" : "Ctrl Shift H";
}

/**
 * True for Shift+M with Cmd on macOS or Ctrl elsewhere and no other modifier,
 * the chord that maximizes the focused panel group or restores the layout.
 * Monaco binds only plain Ctrl+M (Tab key moves focus) and, on macOS, the
 * physical Control key with Shift+M, so none of its keys is taken. A held key
 * (repeat), composing or already handled events never match, so one press
 * flips the layout once.
 */
export function isMaximizePanelKey(
  event: MaximizeKeyEvent,
  platform: string,
): boolean {
  if (event.altKey || event.isComposing || event.repeat) return false;
  if (event.defaultPrevented || !event.shiftKey) return false;
  if (typeof event.key !== "string" || event.key.toLowerCase() !== "m")
    return false;
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** Palette hint text for the maximize shortcut on the given platform. */
export function maximizeShortcutHint(platform: string): string {
  return platform === "darwin" ? "Cmd Shift M" : "Ctrl Shift M";
}

/**
 * True for Shift+D with Cmd on macOS or Ctrl elsewhere and no other modifier,
 * the chord that turns focus mode on or off. Monaco binds D only with Ctrl or
 * Cmd alone (add selection to next match) and, on macOS, with the physical
 * Control key alone (delete right), never with Shift, so none of its keys is
 * taken. A held key (repeat), composing or already handled events never
 * match, so one press flips focus mode once.
 */
export function isFocusModeKey(
  event: FocusModeKeyEvent,
  platform: string,
): boolean {
  if (event.altKey || event.isComposing || event.repeat) return false;
  if (event.defaultPrevented || !event.shiftKey) return false;
  if (typeof event.key !== "string" || event.key.toLowerCase() !== "d")
    return false;
  return platform === "darwin"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** Palette hint text for the focus mode shortcut on the given platform. */
export function focusModeShortcutHint(platform: string): string {
  return platform === "darwin" ? "Cmd Shift D" : "Ctrl Shift D";
}
