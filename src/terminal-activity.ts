export interface ActivityConfig {
  /** Line feeds of output that count as a burst worth reporting on. */
  burstLines: number;
  /** Silence after a burst before "went quiet" is reported. */
  quietMs: number;
  /** Minimum gap between bell notifications. */
  bellCooldownMs: number;
  /** Ignore activity this long after (re)attach, which replays history. */
  settleMs: number;
}
export const defaultActivity: ActivityConfig = {
  burstLines: 20,
  quietMs: 8000,
  bellCooldownMs: 30000,
  settleMs: 3000,
};
/**
 * Pure bookkeeping for terminal alerts. It sees only counts and timestamps,
 * never terminal text, so nothing it produces can leak output.
 */
export function createActivityTracker(config: ActivityConfig = defaultActivity) {
  let ignoreUntil = 0;
  let lines = 0;
  let lastOutput = 0;
  let lastBell = -Infinity;
  return {
    attach(now: number) {
      ignoreUntil = now + config.settleMs;
      lines = 0;
      lastOutput = 0;
    },
    output(now: number, lineFeeds: number) {
      if (now < ignoreUntil) return;
      lastOutput = now;
      lines += lineFeeds;
    },
    /** True if a bell at `now` should notify. */
    bell(now: number) {
      if (now < ignoreUntil || now - lastBell < config.bellCooldownMs)
        return false;
      lastBell = now;
      return true;
    },
    /** True once when a burst has gone quiet. */
    tick(now: number) {
      if (
        lines >= config.burstLines &&
        lastOutput > 0 &&
        now - lastOutput >= config.quietMs
      ) {
        lines = 0;
        return true;
      }
      return false;
    },
  };
}
/** Alerts are for terminals the person is not looking at. */
export const shouldAlert = (windowFocused: boolean, panelFocused: boolean) =>
  !windowFocused || !panelFocused;
export const alertText = (
  kind: "bell" | "quiet",
  label: string,
  host: string,
) => ({
  title: kind === "bell" ? `${label} rang the bell` : `${label} went quiet`,
  body: `${host} · terminal activity (no output is included)`,
});
