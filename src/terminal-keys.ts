export type TerminalKeyAction = "find" | "paste" | "copy" | "clear" | "pass";
export interface KeyLike {
  type?: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
/**
 * Decide what a terminal key press means to the app rather than the shell.
 * Ctrl+C is "copy" only while text is selected; otherwise it must reach the
 * PTY as SIGINT. Ctrl+Shift+C always means copy on non-mac platforms.
 * Cmd+K (macOS) and Ctrl+Shift+K (elsewhere) mean "clear"; plain Ctrl+K is
 * deliberately not claimed because it is readline kill-line.
 */
export function classifyTerminalKey(
  event: KeyLike,
  platform: string,
  hasSelection: boolean,
): TerminalKeyAction {
  if (event.altKey) return "pass";
  const mac = platform === "darwin";
  const key = event.key.toLowerCase();
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if ((event.ctrlKey || event.metaKey) && key === "f")
    return "find";
  if (!primary) return "pass";
  if (key === "v") return mac ? (event.shiftKey ? "pass" : "paste") : "paste";
  if (key === "c") {
    if (mac) return !event.shiftKey && hasSelection ? "copy" : "pass";
    return event.shiftKey || hasSelection ? "copy" : "pass";
  }
  if (key === "k") return mac !== event.shiftKey ? "clear" : "pass";
  return "pass";
}
/** Palette hint text for the clear shortcut on the given platform. */
export function clearShortcutLabel(platform: string): string {
  return platform === "darwin" ? "Cmd K" : "Ctrl Shift K";
}
/** CSS selector of the root element of a terminal panel. */
export const TERMINAL_PANEL_SELECTOR = ".terminal-panel";
/**
 * True when the key is a clear combo and the event target sits inside a
 * terminal panel. The App-level shortcut handler uses this to step aside so
 * the terminal's own key handler gets the key. Duck-typed on `closest`
 * because pop-out windows hand us targets from another DOM.
 */
export function terminalOwnsKey(
  event: KeyLike,
  platform: string,
  target: EventTarget | null,
): boolean {
  if (classifyTerminalKey(event, platform, false) !== "clear") return false;
  const closest = (target as { closest?: unknown } | null)?.closest;
  if (typeof closest !== "function") return false;
  return Boolean(closest.call(target, TERMINAL_PANEL_SELECTOR));
}
