/** A color with whole-number channels from 0 to 255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** What a pair is for: normal text, large text, or any other part of the interface (a border, an icon, a focus ring). */
export type ContrastKind = "text" | "large" | "non-text";

/** One named pair of colors to check, written as hex strings. */
export interface ContrastPair {
  name: string;
  fg: string;
  bg: string;
  kind: ContrastKind;
}

/** The outcome of checking one pair: its measured ratio, the ratio it needed and whether it got there. */
export interface ContrastResult extends ContrastPair {
  ratio: number;
  required: number;
  pass: boolean;
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function channels(hex: string): { rgb: Rgb; alpha: number } | null {
  if (typeof hex !== "string" || !HEX.test(hex)) return null;
  let digits = hex.slice(1);
  if (digits.length <= 4)
    digits = digits
      .split("")
      .map((c) => c + c)
      .join("");
  const at = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
  return {
    rgb: { r: at(0), g: at(2), b: at(4) },
    alpha: digits.length === 8 ? at(6) / 255 : 1,
  };
}

/**
 * Reads #rgb, #rgba, #rrggbb or #rrggbbaa (any letter case) and returns null for anything else.
 * Without a background the alpha channel is ignored; with a background (an opaque hex string) a translucent color is laid over it and the channels are rounded to whole numbers, as a screen does.
 */
export function parseHex(hex: string, background?: string): Rgb | null {
  const top = channels(hex);
  if (!top) return null;
  if (background === undefined) return top.rgb;
  const under = channels(background);
  if (!under) return null;
  if (top.alpha === 1) return top.rgb;
  const lay = (over: number, base: number) =>
    Math.round(over * top.alpha + base * (1 - top.alpha));
  return {
    r: lay(top.rgb.r, under.rgb.r),
    g: lay(top.rgb.g, under.rgb.g),
    b: lay(top.rgb.b, under.rgb.b),
  };
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque color: 0 for black, 1 for white. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  );
}

/**
 * WCAG 2.x contrast ratio between two hex colors, from 1 (equal) to 21 (black on white), never rounded.
 * The background is read as opaque; a translucent foreground is laid over it first. Returns NaN when either color is not valid hex.
 */
export function contrastRatio(fg: string, bg: string): number {
  const back = parseHex(bg);
  const front = parseHex(fg, bg);
  if (!back || !front) return Number.NaN;
  const a = relativeLuminance(front);
  const b = relativeLuminance(back);
  return Math.min(21, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
}

/** The ratio a kind needs: 4.5 for text, 3 for large text, 3 for non-text parts; NaN for an unknown kind. */
export function requiredRatio(kind: ContrastKind): number {
  if (kind === "text") return 4.5;
  if (kind === "large" || kind === "non-text") return 3;
  return Number.NaN;
}

/** True when a measured ratio reaches what its kind needs; the ratio is compared as it is, so 4.499 does not pass for text. */
export function meets(ratio: number, kind: ContrastKind): boolean {
  return Number.isFinite(ratio) && ratio >= requiredRatio(kind);
}

/** Measures every pair in order and says which ones reach their required ratio. */
export function checkPairs(pairs: readonly ContrastPair[]): ContrastResult[] {
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return {
      name: pair.name,
      fg: pair.fg,
      bg: pair.bg,
      kind: pair.kind,
      ratio,
      required: requiredRatio(pair.kind),
      pass: meets(ratio, pair.kind),
    };
  });
}
