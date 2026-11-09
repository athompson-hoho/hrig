/** Most characters the runtime badge shows (counted as whole characters, not UTF-16 units). */
export const MAX_RUNTIME_LABEL = 16;
/** Most characters the model badge shows. */
export const MAX_MODEL_LABEL = 24;
/** Most characters the full text kept in a badge's tooltip. */
export const MAX_BADGE_TITLE = 80;
/** Most UTF-16 units of one field that are read at all, so a huge value from a seat costs the same as a long one. */
const MAX_READ = 2000;

/** One small label and the full text that goes in its tooltip. */
export type Badge = { label: string; title: string };
/** What a seat row can show: the runtime and the model, each one or none. */
export type SeatBadges = { runtime: Badge | null; model: Badge | null };

/** Control, line-separator, zero-width, bidirectional, tag and lone surrogate characters are dropped. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfeff ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/** The visible text of a field: hidden characters stripped, runs of spaces squeezed, trimmed; anything but a string gives an empty text. */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.slice(0, MAX_READ))
    if (!hidden(char.codePointAt(0)!)) text += char;
  return text.replace(/\s+/g, " ").trim();
}

/** The first characters of a text, counted as whole characters, with no trailing space. */
function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("").trim();
}

function runtimeBadge(value: unknown): Badge | null {
  const text = clean(value);
  const key = text.toLowerCase();
  // The inventory fills in "agent" when the CLI names no runtime, so it says nothing.
  if (!text || key === "agent") return null;
  const title = cut(text, MAX_BADGE_TITLE);
  if (key === "claude-code") return { label: "Claude", title };
  if (key === "codex") return { label: "Codex", title };
  return { label: cut(text, MAX_RUNTIME_LABEL), title };
}

function modelBadge(value: unknown): Badge | null {
  const text = clean(value);
  if (!text) return null;
  return {
    label: cut(text, MAX_MODEL_LABEL),
    title: cut(text, MAX_BADGE_TITLE),
  };
}

/** The runtime and model badges of a seat; a missing, empty, generic or non-text field gives null for that badge. Never throws: inventory rows come from a CLI. */
export function seatBadges(seat: unknown): SeatBadges {
  const row =
    typeof seat === "object" && seat !== null
      ? (seat as { runtime?: unknown; model?: unknown })
      : {};
  return { runtime: runtimeBadge(row.runtime), model: modelBadge(row.model) };
}
