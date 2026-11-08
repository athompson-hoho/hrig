/** Most characters a host label keeps (counted as whole characters, not UTF-16 units). */
export const MAX_TINT_LABEL = 24;
/** Most connections that can hold a label or tint. */
export const MAX_HOST_TINTS = 64;
/** Longest connection id a tint is kept for (the limit the main process enforces). */
export const MAX_TINT_KEY = 150;
/** The only tints: a name picked from a short palette mapped to a fixed color, never free CSS. */
export const TINT_COLORS = {
  red: "#d64545",
  amber: "#d9a31f",
  green: "#3fa66b",
  blue: "#4a8fe0",
  violet: "#8f6fd6",
  gray: "#8b95a5",
} as const;
/** A palette name. */
export type TintColor = keyof typeof TINT_COLORS;
/** What one host shows: an optional short label and an optional palette color. */
export type HostTint = { label?: string; color?: TintColor };
/** Saved tints keyed by connection id. */
export type HostTints = Record<string, HostTint>;

const has = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key);

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Control, line-separator, zero-width and bidirectional-override characters are dropped. */
function hidden(code: number) {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/** Strips hidden characters, trims, squeezes runs of spaces and caps at 24 characters; anything but a string gives an empty label. */
export function cleanTintLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value) if (!hidden(char.codePointAt(0)!)) text += char;
  const squeezed = text.replace(/ {2,}/g, " ").trim();
  return Array.from(squeezed).slice(0, MAX_TINT_LABEL).join("").trim();
}

/** The valid parts of one saved tint, or null when it has no label and no palette color. */
export function normalizeHostTint(value: unknown): HostTint | null {
  if (!plain(value)) return null;
  const label = cleanTintLabel(value.label);
  const color = value.color;
  const tint: HostTint = {};
  if (label) tint.label = label;
  if (typeof color === "string" && has(TINT_COLORS, color))
    tint.color = color as TintColor;
  return tint.label || tint.color ? tint : null;
}

/** Defensive load: keeps up to 64 valid entries under sane connection ids and drops everything else. */
export function normalizeHostTints(value: unknown): HostTints {
  const result: HostTints = {};
  if (!plain(value)) return result;
  let kept = 0;
  for (const key of Object.keys(value)) {
    if (kept >= MAX_HOST_TINTS) break;
    if (!key || key.length > MAX_TINT_KEY || key === "__proto__") continue;
    const tint = normalizeHostTint(value[key]);
    if (!tint) continue;
    result[key] = tint;
    kept++;
  }
  return result;
}

/** The tint saved for this connection id, or null; only the connection's own entry counts, never an inherited property. */
export function resolveHostTint(
  connection: unknown,
  tints: unknown,
): HostTint | null {
  if (!plain(connection) || !plain(tints)) return null;
  const id = connection.id;
  if (typeof id !== "string" || id === "__proto__" || !has(tints, id))
    return null;
  return normalizeHostTint(tints[id]);
}

/** A new map with this connection's tint set, or removed when it has neither label nor color; refuses a 65th connection and a bad id. */
export function setHostTint(
  tints: unknown,
  id: string,
  tint: unknown,
): HostTints {
  const next = normalizeHostTints(tints);
  if (typeof id !== "string" || !id || id.length > MAX_TINT_KEY) return next;
  if (id === "__proto__") return next;
  const clean = normalizeHostTint(tint);
  if (!clean) {
    delete next[id];
    return next;
  }
  if (!has(next, id) && Object.keys(next).length >= MAX_HOST_TINTS) return next;
  next[id] = clean;
  return next;
}

/** The fixed color for a tint, or null when it has no color. */
export function tintColor(tint: HostTint | null | undefined): string | null {
  const name = tint?.color;
  return typeof name === "string" && has(TINT_COLORS, name)
    ? TINT_COLORS[name]
    : null;
}
