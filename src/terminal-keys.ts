export type TerminalKeyAction = "find" | "paste" | "copy" | "pass";
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
  return "pass";
}
