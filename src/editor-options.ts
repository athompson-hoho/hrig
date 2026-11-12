import type { Preferences } from "./settings";

// Fallbacks mirror the defaults in settings.ts (a test keeps them in sync). They are
// literals so this module does not load settings.ts, which reads the platform.
const FALLBACK = {
  insertSpaces: true,
  wordWrap: "on",
  minimap: false,
  lineNumbers: "on",
  fontLigatures: false,
  renderWhitespace: "selection",
  bracketPairs: true,
} as const;

const WRAP = ["on", "off"] as const;
const NUMBERS = ["on", "relative", "off"] as const;
const WHITESPACE = ["selection", "boundary", "trailing", "all", "none"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/**
 * Editor display options for Monaco, built from the resolved preferences.
 * Enumerated values are checked against the allowed set and fall back to the
 * default, so a damaged settings file can never hand Monaco an invalid string.
 */
export function monacoEditorOptions(
  preferences: Preferences,
  reducedMotion: boolean,
) {
  return {
    fontSize: preferences["editor.fontSize"],
    fontFamily: preferences["editor.fontFamily"],
    tabSize: preferences["editor.tabSize"],
    insertSpaces: bool(preferences["editor.insertSpaces"], FALLBACK.insertSpaces),
    detectIndentation: false,
    wordWrap: oneOf(preferences["editor.wordWrap"], WRAP, FALLBACK.wordWrap),
    minimap: { enabled: bool(preferences["editor.minimap"], FALLBACK.minimap) },
    lineNumbers: oneOf(preferences["editor.lineNumbers"], NUMBERS, FALLBACK.lineNumbers),
    fontLigatures: bool(preferences["editor.fontLigatures"], FALLBACK.fontLigatures),
    renderWhitespace: oneOf(preferences["editor.renderWhitespace"], WHITESPACE, FALLBACK.renderWhitespace),
    bracketPairColorization: { enabled: bool(preferences["editor.bracketPairs"], FALLBACK.bracketPairs) },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: !reducedMotion,
  };
}
