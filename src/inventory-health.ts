export const CHECKING_SNAPSHOT = "Checking the last successful snapshot…";
/** Consecutive failed polls before the connection is reported as stale. */
export const FAILURES_TO_REPORT = 3;
const QUICK_RETRY_MS = 5000;
const MAX_BACKOFF_MS = 120000;

/**
 * Decide whether a failing inventory should be surfaced. One or two failed
 * polls (a busy host, a slow SSH hop) keep serving the last good data quietly;
 * the banner appears after repeated failures or when the data is old.
 */
export function shouldReport(input: {
  failures: number;
  lastSuccessAt: number | null;
  now: number;
  intervalSeconds: number;
}): boolean {
  if (input.failures === 0) return false;
  if (input.failures >= FAILURES_TO_REPORT) return true;
  if (input.lastSuccessAt === null) return false;
  const limit = Math.max(60000, input.intervalSeconds * 4000);
  return input.now - input.lastSuccessAt > limit;
}

/** Delay before the next poll: quick retries first, then exponential backoff. */
export function pollDelay(intervalSeconds: number, failures: number): number {
  const base = intervalSeconds * 1000;
  if (failures <= 0) return base;
  if (failures < FAILURES_TO_REPORT) return Math.min(base, QUICK_RETRY_MS);
  const doubled = base * 2 ** Math.min(failures - FAILURES_TO_REPORT + 1, 6);
  return Math.min(Math.max(MAX_BACKOFF_MS, base), Math.max(base, doubled));
}

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
