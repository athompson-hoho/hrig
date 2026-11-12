/** Lowest per-terminal scrollback the budget will ever impose. */
export const MIN_SCROLLBACK = 1000;

/**
 * Scrollback lines one terminal may keep so that all open terminals together
 * stay within `budget` lines. 0 means no budget. Never raises the user's own
 * per-terminal setting and never goes below MIN_SCROLLBACK (so with a huge
 * number of terminals the true total can exceed the budget).
 */
export function effectiveScrollback(setting: number, openTerminals: number, budget: number): number {
  if (!Number.isFinite(setting) || setting < 1) return MIN_SCROLLBACK;
  if (!Number.isFinite(budget) || budget <= 0) return setting;
  const share = Math.floor(budget / Math.max(1, Math.floor(openTerminals)));
  return Math.max(Math.min(MIN_SCROLLBACK, setting), Math.min(setting, share));
}

const open = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* a listener must not break others */ } });

/** Registers one live terminal view; returns its unregister function. */
export function registerTerminal(id: string): () => void {
  open.add(id);
  emit();
  return () => { if (open.delete(id)) emit(); };
}
export const openTerminalCount = () => open.size;
export function subscribeTerminals(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
