export type TerminalCommand = "focus" | "clear" | "find" | "reconnect" | "reconnect-dropped" | "insert" | "run" | "task-from-selection";
export interface TerminalSnippet { id: string; name: string; text: string }
// A single printable line cannot submit input or inject terminal control keys.
export function snippetError(text: string): string {
  if (!text.trim()) return "Enter a command first.";
  if (text.length > 10000) return "Keep snippets under 10,000 characters.";
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029\p{Cf}]/u.test(text)) return "Use a single line without control or invisible formatting characters. Nothing was sent.";
  return "";
}
export function sendTerminalCommand(id: string, command: TerminalCommand, text?: string) {
  window.dispatchEvent(new CustomEvent("hrig:terminal-command", { detail: { id, command, text } }));
}
