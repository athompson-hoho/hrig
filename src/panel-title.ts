/** Longest custom panel title, in characters (code points). */
export const MAX_TITLE = 60;

/** Longest original title kept or restored, in characters. Larger than MAX_TITLE so no existing seat, shell or file name is cut. */
export const MAX_ORIGINAL = 200;

/** Most layout nodes a stored layout may hold before it is refused as unreadable. */
export const MAX_NODES = 20000;

/** Deepest nesting a stored layout may have before it is refused as unreadable. */
export const MAX_DEPTH = 64;

/** What the title helpers read of a layout tab: its component, its name and its config. */
export interface TitledTab {
  component?: unknown;
  name?: unknown;
  config?: unknown;
}

/** The two tab attributes a rename or a reset changes: pass both to Actions.updateNodeAttributes. */
export interface TitlePatch {
  name: string;
  config: Record<string, unknown>;
}

const MAX_INPUT = 2048;
const ZWJ = 0x200d;
const VARIATION_TEXT = 0xfe0e;
const VARIATION_EMOJI = 0xfe0f;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hidden(code: number): boolean {
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0x061c ||
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

function bare(code: number): boolean {
  return (
    code === 32 ||
    code === ZWJ ||
    code === VARIATION_TEXT ||
    code === VARIATION_EMOJI
  );
}

/** Cleans a typed or stored panel title: white space and line breaks become one space, control, zero-width, direction-override and tag characters are dropped, the ends are trimmed and the rest is cut at max characters (default MAX_TITLE, never splitting an astral character). Null when nothing visible is left or the input is not text, which means no custom title. */
export function normalizeTitle(
  input: unknown,
  max: number = MAX_TITLE,
): string | null {
  if (typeof input !== "string") return null;
  const cap = Number.isInteger(max) && max > 0 ? max : MAX_TITLE;
  const spaced = input.slice(0, MAX_INPUT).replace(/\s+/g, " ");
  let kept = "";
  for (const ch of spaced) {
    if (!hidden(ch.codePointAt(0) ?? 0)) kept += ch;
  }
  const chars = Array.from(kept.replace(/ {2,}/g, " ").trim());
  if (chars.length > cap) chars.length = cap;
  while (chars.length > 0) {
    const last = chars[chars.length - 1];
    if (last !== " " && last.codePointAt(0) !== ZWJ) break;
    chars.pop();
  }
  if (chars.every((ch) => bare(ch.codePointAt(0) ?? 0))) return null;
  return chars.join("");
}

function configOf(tab: unknown): Record<string, unknown> | null {
  return isRecord(tab) && isRecord(tab.config) ? tab.config : null;
}

function fallbackTitle(config: Record<string, unknown> | null): string {
  const seat = config !== null && isRecord(config.seat) ? config.seat : null;
  return (seat && normalizeTitle(seat.name, MAX_ORIGINAL)) || "Shell";
}

function withoutTitleKeys(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const copy = { ...config };
  delete copy.customTitle;
  delete copy.defaultTitle;
  return copy;
}

function hasTitleKeys(config: Record<string, unknown>): boolean {
  return "customTitle" in config || "defaultTitle" in config;
}

/** Whether a tab may be renamed: a terminal panel whose config can hold the two title keys. Editors, diffs and every other panel keep the name they were opened with. */
export function canRename(tab: unknown): boolean {
  return (
    isRecord(tab) && tab.component === "terminal" && configOf(tab) !== null
  );
}

/** The custom title a terminal panel carries, cleaned, or null when it has none. */
export function customTitleOf(tab: unknown): string | null {
  const config = canRename(tab) ? configOf(tab) : null;
  return config === null ? null : normalizeTitle(config.customTitle);
}

/** Whether a terminal panel carries a custom title, which is when Reset name has something to restore. */
export function isRenamed(tab: unknown): boolean {
  return customTitleOf(tab) !== null;
}

function originalTitle(tab: TitledTab): string {
  const config = configOf(tab);
  if (customTitleOf(tab) !== null)
    return (
      normalizeTitle(config?.defaultTitle, MAX_ORIGINAL) ??
      fallbackTitle(config)
    );
  return normalizeTitle(tab.name, MAX_ORIGINAL) ?? fallbackTitle(config);
}

/** The title a tab shows: the custom title of a renamed terminal, otherwise the cleaned name (a terminal with no usable name shows its seat name or Shell, any other panel an empty title). */
export function titleOf(tab: unknown): string {
  if (!isRecord(tab)) return "";
  const custom = customTitleOf(tab);
  if (custom !== null) return custom;
  const name = normalizeTitle(tab.name, MAX_ORIGINAL);
  if (name !== null) return name;
  return canRename(tab) ? fallbackTitle(configOf(tab)) : "";
}

/** What a rename changes on a terminal tab, or null when nothing would change (not a terminal, or the result equals what the tab already has). The first rename keeps the original name in defaultTitle; typing nothing usable, or the original name itself, is the same as Reset name. */
export function applyCustomTitle(
  tab: unknown,
  input: unknown,
): TitlePatch | null {
  if (!isRecord(tab) || !canRename(tab)) return null;
  const config = tab.config as Record<string, unknown>;
  const original = originalTitle(tab);
  const wanted = normalizeTitle(input);
  const patch: TitlePatch =
    wanted === null || wanted === original
      ? { name: original, config: withoutTitleKeys(config) }
      : {
          name: wanted,
          config: { ...config, customTitle: wanted, defaultTitle: original },
        };
  const same =
    tab.name === patch.name &&
    config.customTitle === patch.config.customTitle &&
    config.defaultTitle === patch.config.defaultTitle;
  return same ? null : patch;
}

/** What Reset name changes on a renamed terminal tab: the original name back and both title keys removed; null when the tab is not renamed. */
export function resetTitle(tab: unknown): TitlePatch | null {
  if (!isRecord(tab) || !isRenamed(tab)) return null;
  return {
    name: originalTitle(tab),
    config: withoutTitleKeys(tab.config as Record<string, unknown>),
  };
}

function retitle(tab: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...tab };
  const config = configOf(tab);
  if (tab.component === "terminal" && config !== null) {
    const custom = normalizeTitle(config.customTitle);
    if (custom === null) {
      copy.name =
        normalizeTitle(tab.name, MAX_ORIGINAL) ?? fallbackTitle(config);
      if (hasTitleKeys(config)) copy.config = withoutTitleKeys(config);
    } else {
      copy.name = custom;
      copy.config = {
        ...config,
        customTitle: custom,
        defaultTitle:
          normalizeTitle(config.defaultTitle, MAX_ORIGINAL) ??
          fallbackTitle(config),
      };
    }
    return copy;
  }
  if (tab.component === "terminal")
    copy.name = normalizeTitle(tab.name, MAX_ORIGINAL) ?? fallbackTitle(null);
  else if ("name" in tab)
    copy.name = normalizeTitle(tab.name, MAX_ORIGINAL) ?? "";
  if (config !== null && hasTitleKeys(config))
    copy.config = withoutTitleKeys(config);
  return copy;
}

/** A copy of a stored layout in which every tab has a clean title: names are cleaned and cut like a rename, a terminal's custom and original titles are cleaned and agree with its name, and the title keys are removed from every other panel. The input is never changed and the call never throws. Null when the layout is nested deeper than MAX_DEPTH or holds more than MAX_NODES nodes, so the caller treats it as unreadable. */
export function normalizeTabTitles<T>(layout: T): T | null {
  let nodes = 0;
  let failed = false;
  const visit = (value: unknown, depth: number): unknown => {
    if (failed || value === null || typeof value !== "object") return value;
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      failed = true;
      return value;
    }
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    const source = value as Record<string, unknown>;
    if (source.type === "tab") return retitle(source);
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (key !== "__proto__") copy[key] = visit(source[key], depth + 1);
    }
    return copy;
  };
  try {
    const out = visit(layout, 0);
    return failed ? null : (out as T);
  } catch {
    return null;
  }
}
