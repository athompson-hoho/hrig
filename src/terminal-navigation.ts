import type { IBuffer } from '@xterm/xterm';
export function errorLine(buffer: IBuffer, from: number, direction: -1 | 1): number | null {
  for (let line = from + direction; line >= 0 && line < buffer.length; line += direction) {
    if (/\b(error|failed|fatal|exception)\b|^\s*Traceback/i.test(buffer.getLine(line)?.translateToString(true) || '')) return line;
  }
  return null;
}
export function errorSearchOrigin(viewport: number, previous: {line:number;viewport:number}|null): number {
  return previous && previous.viewport === viewport ? previous.line : viewport;
}
