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
