export const MAX_RETRIES = 6;
/** Backoff before automatic attempt number `retry` (0-based). */
export const retryDelay = (retry: number) => Math.min(15000, 1000 * 2 ** retry);
export const countdownSeconds = (nextAt: number | null, now: number) =>
  nextAt === null ? 0 : Math.max(0, Math.ceil((nextAt - now) / 1000));
export const reconnectReason = (error: string, exitCode: number | null) =>
  error
    ? error
    : exitCode !== null
      ? `Connection ended (exit ${exitCode}).`
      : "";
/** Lines scrolled up from the live bottom, restorable after a re-attach. */
export const scrollOffset = (baseY: number, viewportY: number) =>
  Math.max(0, baseY - viewportY);
export const restoreLine = (baseY: number, offset: number) =>
  Math.max(0, baseY - offset);
export type ReconnectView =
  | { kind: "retrying"; attempt: number; seconds: number }
  | { kind: "paused" }
  | null;
export function reconnectView(input: {
  seat: boolean;
  retrying: boolean;
  retries: number;
  failed: boolean;
  nextAt: number | null;
  now: number;
}): ReconnectView {
  if (!input.seat) return null;
  if (input.retrying)
    return {
      kind: "retrying",
      attempt: input.retries,
      seconds: countdownSeconds(input.nextAt, input.now),
    };
  if (input.retries >= MAX_RETRIES && input.failed) return { kind: "paused" };
  return null;
}
