/** Quiet period after the last selection change before a copy is attempted. */
export const COPY_SELECT_DELAY_MS = 250;
/** Selections longer than this are never copied (guards Select all on a huge buffer). */
export const COPY_SELECT_MAX_CHARS = 20000;

/** True when a settled selection is worth writing out: enabled, non-blank and within the size cap. */
export function shouldCopy(enabled: boolean, text: string): boolean {
  if (!enabled) return false;
  if (text.trim() === "") return false;
  return text.length <= COPY_SELECT_MAX_CHARS;
}

/** Collaborators for the scheduler; timers are injectable so tests never wait in real time. */
export interface CopyOnSelectOptions {
  delayMs?: number;
  enabled: () => boolean;
  read: () => string;
  copy: (text: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
  schedule?: (run: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
}

/** Debounced selection-settle handle: notify on every change, cancel on teardown. */
export interface CopyOnSelect {
  notify: () => void;
  cancel: () => void;
}

/** Builds a scheduler that copies a selection once it has stopped changing. */
export function createCopyOnSelect(options: CopyOnSelectOptions): CopyOnSelect {
  const delayMs = options.delayMs ?? COPY_SELECT_DELAY_MS;
  // Arrow wrappers: calling a global timer as a method of the options object throws in browsers.
  const schedule =
    options.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const unschedule =
    options.unschedule ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let pending: unknown;
  let hasPending = false;
  let lastCopied = "";

  const report = (error: unknown, text: string) => {
    // Forget only this text so a failed copy can be retried by the next settle.
    if (lastCopied === text) lastCopied = "";
    try {
      options.onError?.(error);
    } catch {
      // A failing error reporter must not break the selection flow.
    }
  };

  const settle = () => {
    hasPending = false;
    pending = undefined;
    if (!options.enabled()) return;
    const text = options.read();
    // Clearing a selection must never write anything out; just reset the dedupe memory.
    if (text === "") {
      lastCopied = "";
      return;
    }
    if (!shouldCopy(true, text)) return;
    if (text === lastCopied) return;
    lastCopied = text;
    try {
      const result = options.copy(text);
      if (result && typeof result.then === "function") {
        result.then(undefined, (error: unknown) => report(error, text));
      }
    } catch (error) {
      report(error, text);
    }
  };

  const cancel = () => {
    if (!hasPending) return;
    unschedule(pending);
    hasPending = false;
    pending = undefined;
  };

  return {
    notify() {
      cancel();
      pending = schedule(settle, delayMs);
      hasPending = true;
    },
    cancel,
  };
}
