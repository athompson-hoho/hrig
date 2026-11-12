interface DocLike {
  hidden: boolean;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

/**
 * Like setInterval, but ticks are skipped while the window is hidden, and one
 * catch-up run happens when it becomes visible again if a tick was skipped.
 * Returns the stop function. Use for refresh polling only: work that must
 * keep running in the background (terminal alerts, retries) should not use it.
 */
export function visibleInterval(
  fn: () => void,
  ms: number,
  doc: DocLike | undefined = typeof document !== "undefined" ? document : undefined,
  timers: Timers = { setInterval: (f, m) => setInterval(f, m), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>) },
): () => void {
  let skipped = false;
  const id = timers.setInterval(() => {
    if (doc?.hidden) {
      skipped = true;
      return;
    }
    fn();
  }, ms);
  const onVisible = () => {
    if (doc && !doc.hidden && skipped) {
      skipped = false;
      fn();
    }
  };
  if (typeof doc?.addEventListener === "function") doc.addEventListener("visibilitychange", onVisible);
  return () => {
    timers.clearInterval(id);
    if (typeof doc?.removeEventListener === "function") doc.removeEventListener("visibilitychange", onVisible);
  };
}
