import type { Terminal } from "@xterm/xterm";

// Use the rendered buffer, never the raw escape/OSC stream. Join soft-wrapped rows.
export function terminalText(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const wrapped = buffer.getLine(i + 1)?.isWrapped;
    const text = line.translateToString(!wrapped);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}
