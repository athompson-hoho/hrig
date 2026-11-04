import type { IBuffer } from '@xterm/xterm';
export function errorLine(buffer: IBuffer, from: number, direction: -1 | 1): number | null {
  for (let line = from + direction; line >= 0 && line < buffer.length; line += direction) {
    if (/\b(error|failed|fatal|exception)\b|^\s*Traceback/i.test(buffer.getLine(line)?.translateToString(true) || '')) return line;
  }
  return null;
}
