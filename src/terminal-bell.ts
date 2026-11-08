import { defaultActivity } from "./terminal-activity";

/** What a terminal bell does inside HRig; the stored setting is validated to one of these. */
export type BellStyle = "none" | "visual";

/** How long the visual flash stays on screen; at most 200 ms and equal to the CSS fade. */
export const BELL_FLASH_MS = 160;

/** Minimum gap between two flashes of one terminal: at most one a second. */
export const BELL_COOLDOWN_MS = 1000;

/** Bells this soon after attach are replayed history; the same window the alert tracker uses. */
export const BELL_SETTLE_MS = defaultActivity.settleMs;

/**
 * True when a bell at `now` should flash: only the exact style "visual", a finite
 * clock, and either no previous flash or a gap of at least the cooldown. A clock
 * that moved backwards never blocks; a bad cooldown falls back to the default.
 */
export function shouldFlash(
  style: string,
  now: number,
  lastFlash: number,
  cooldownMs: number,
): boolean {
  if (style !== "visual" || !Number.isFinite(now)) return false;
  if (!Number.isFinite(lastFlash)) return true;
  const gap = Number.isFinite(cooldownMs)
    ? Math.max(0, cooldownMs)
    : BELL_COOLDOWN_MS;
  const elapsed = now - lastFlash;
  return elapsed < 0 || elapsed >= gap;
}

/** True once `settleMs` has passed since the terminal attached, so replayed bells are skipped. */
export function bellSettled(
  now: number,
  attachedAt: number,
  settleMs: number = BELL_SETTLE_MS,
): boolean {
  return Number.isFinite(now) && now - attachedAt >= settleMs;
}
