/** How long the size readout stays after the last size change. */
export const SIZE_INDICATOR_MS = 1200;

/** Formats a terminal grid size as "cols x rows". */
export function formatSize(cols: number, rows: number): string {
  return `${cols} x ${rows}`;
}

export interface SizeIndicatorOptions {
  delayMs?: number;
  onShow: (label: string) => void;
  onHide: () => void;
  schedule?: (run: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
}

export interface SizeIndicator {
  report: (cols: number, rows: number) => void;
  dispose: () => void;
}

/** Pure show/hide state machine for the resize readout (timers are injected). */
export function createSizeIndicator(
  options: SizeIndicatorOptions,
): SizeIndicator {
  const delayMs = options.delayMs ?? SIZE_INDICATOR_MS;
  // Arrow wrappers: a global timer called as a property of options throws in browsers.
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const unschedule =
    options.unschedule ??
    ((handle: unknown): void =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  let previous: { cols: number; rows: number } | null = null;
  let pending: { handle: unknown } | null = null;
  let finished = false;

  const cancel = () => {
    if (!pending) return;
    unschedule(pending.handle);
    pending = null;
  };

  return {
    report(cols, rows) {
      if (finished) return;
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
      if (cols < 1 || rows < 1) return;
      if (!previous) {
        // The first valid size is the initial fit, never worth showing.
        previous = { cols, rows };
        return;
      }
      if (previous.cols === cols && previous.rows === rows) return;
      previous = { cols, rows };
      cancel();
      options.onShow(formatSize(cols, rows));
      const entry: { handle: unknown } = { handle: null };
      entry.handle = schedule(() => {
        if (finished || pending !== entry) return;
        pending = null;
        options.onHide();
      }, delayMs);
      pending = entry;
    },
    dispose() {
      finished = true;
      cancel();
    },
  };
}
