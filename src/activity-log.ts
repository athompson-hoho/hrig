export type LogKind = "info" | "error" | "success";
export type LogFilter = "all" | LogKind;
export interface LogEntry { id: string; time: string; text: string; kind: LogKind }

export const MAX_COPY_CHARS = 200000;

export function filterLog<T extends LogEntry>(entries: readonly T[], filter: LogFilter): T[] {
  return filter === "all" ? [...entries] : entries.filter((e) => e.kind === filter);
}

const LABEL: Record<LogKind, string> = { info: "INFO", success: "OK", error: "ERROR" };

/**
 * Plain text for the displayed entries, oldest first (the panel shows newest
 * first). Control characters are removed; very long logs keep the newest part.
 */
export function formatLog(entries: readonly LogEntry[]): { text: string; count: number; truncated: boolean } {
  const lines = [...entries].reverse().map((e) =>
    `[${e.time}] ${LABEL[e.kind] ?? "INFO"} ${String(e.text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ").replace(/\n+/g, " ⏎ ")}`);
  let text = lines.join("\n");
  let truncated = false;
  if (text.length > MAX_COPY_CHARS) {
    text = text.slice(text.length - MAX_COPY_CHARS);
    text = text.slice(text.indexOf("\n") + 1);
    truncated = true;
  }
  return { text, count: entries.length, truncated };
}
