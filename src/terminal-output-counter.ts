/** The largest value a counter holds; anything added past it stays here. */
export const MAX_COUNT = Number.MAX_SAFE_INTEGER;

/** The shortest time between two published updates, so at most 4 per second. */
export const OUTPUT_COUNTER_MIN_INTERVAL_MS = 250;

export interface OutputCounts {
  lines: number;
  bytes: number;
}

export interface OutputCounter {
  add: (chunk: string | Uint8Array) => void;
  reset: () => void;
  snapshot: () => OutputCounts;
}

export interface ThrottleOptions {
  now: () => number;
  schedule: (run: () => void, ms: number) => unknown;
  unschedule: (handle: unknown) => void;
  publish: () => void;
}

export interface Throttle {
  notify: () => void;
  dispose: () => void;
}

/** Adds an amount to a total and never goes past MAX_COUNT; a total or amount that is not a finite number above 0 counts as 0. */
export function addBounded(total: number, amount: number): number {
  const base =
    Number.isFinite(total) && total > 0 ? Math.min(total, MAX_COUNT) : 0;
  const extra = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return extra >= MAX_COUNT - base ? MAX_COUNT : base + extra;
}

/** Lines (line feed characters) and bytes (UTF-8, a lone surrogate counts 3) in one chunk of text or bytes; anything else measures 0 and 0. */
export function measure(chunk: unknown): OutputCounts {
  let lines = 0;
  let bytes = 0;
  if (typeof chunk === "string") {
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i);
      if (code === 10) lines += 1;
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < chunk.length) {
        const next = chunk.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
  } else if (chunk instanceof Uint8Array) {
    bytes = chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 10) lines += 1;
    }
  }
  return { lines, bytes };
}

/** Counts only: two numbers that add() grows from each chunk, never the chunk itself. reset() starts again at zero and snapshot() returns a copy. */
export function createCounter(): OutputCounter {
  let lines = 0;
  let bytes = 0;
  return {
    add(chunk) {
      const size = measure(chunk);
      lines = addBounded(lines, size.lines);
      bytes = addBounded(bytes, size.bytes);
    },
    reset() {
      lines = 0;
      bytes = 0;
    },
    snapshot() {
      return { lines, bytes };
    },
  };
}

const LINE_UNITS = ["", "k", "M", "G", "T", "P"];
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const SEPARATOR = " " + String.fromCharCode(0xb7) + " ";

function whole(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return 0;
  return Math.floor(Math.min(value, MAX_COUNT));
}

// One decimal below 10, a whole number from 10, never a trailing ".0".
function shorten(value: number): string {
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function scale(count: number, base: number, last: number) {
  let value = count;
  let unit = 0;
  while (value >= base && unit < last) {
    value /= base;
    unit += 1;
  }
  const text = shorten(value);
  // 999.7 rounds to 1000: carry into the next unit so it never reads 1000k.
  if (Number(text) >= base && unit < last)
    return { text: shorten(Number(text) / base), unit: unit + 1 };
  return { text, unit };
}

/** "999 lines", "1 line", "1.2k lines", "12k lines", "1.2M lines": units of 1,000, one decimal below 10, a negative or non-numeric count reads 0. */
export function formatLines(count: number): string {
  const lines = whole(count);
  if (lines < 1000) return lines === 1 ? "1 line" : lines + " lines";
  const scaled = scale(lines, 1000, LINE_UNITS.length - 1);
  return scaled.text + LINE_UNITS[scaled.unit] + " lines";
}

/** "512 B", "1.5 KB", "3.4 MB": units of 1,024, one decimal below 10, a negative or non-numeric count reads 0 B. */
export function formatBytes(count: number): string {
  const scaled = scale(whole(count), 1024, BYTE_UNITS.length - 1);
  return scaled.text + " " + BYTE_UNITS[scaled.unit];
}

/** The overlay text, for example "1.2k lines" and "3.4 MB" with a middle dot between them. */
export function format(counts: OutputCounts): string {
  return formatLines(counts.lines) + SEPARATOR + formatBytes(counts.bytes);
}

/** Trailing-edge throttle with the clock and timers injected: the first notify publishes at once, later ones within OUTPUT_COUNTER_MIN_INTERVAL_MS share one scheduled publish, so there are never more than 4 publishes a second; dispose cancels and silences it. */
export function createThrottle(options: ThrottleOptions): Throttle {
  let last: number | null = null;
  let pending: { handle: unknown } | null = null;
  let finished = false;
  const publishAt = (at: number) => {
    last = at;
    options.publish();
  };
  return {
    notify() {
      if (finished || pending) return;
      const now = options.now();
      const previous = last;
      const wait =
        previous === null || !Number.isFinite(previous) || !Number.isFinite(now)
          ? 0
          : Math.min(
              previous + OUTPUT_COUNTER_MIN_INTERVAL_MS - now,
              OUTPUT_COUNTER_MIN_INTERVAL_MS,
            );
      if (wait <= 0) {
        publishAt(now);
        return;
      }
      const entry: { handle: unknown } = { handle: null };
      entry.handle = options.schedule(() => {
        if (finished || pending !== entry) return;
        pending = null;
        publishAt(options.now());
      }, wait);
      pending = entry;
    },
    dispose() {
      finished = true;
      if (!pending) return;
      options.unschedule(pending.handle);
      pending = null;
    },
  };
}
