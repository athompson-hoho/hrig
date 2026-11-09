import { defaults, type Preferences } from "./settings";

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
    insertSpaces: bool(preferences["editor.insertSpaces"], defaults["editor.insertSpaces"]),
    detectIndentation: false,
    wordWrap: oneOf(preferences["editor.wordWrap"], WRAP, defaults["editor.wordWrap"] as "on" | "off"),
    minimap: { enabled: bool(preferences["editor.minimap"], defaults["editor.minimap"]) },
    lineNumbers: oneOf(preferences["editor.lineNumbers"], NUMBERS, defaults["editor.lineNumbers"] as "on"),
    fontLigatures: bool(preferences["editor.fontLigatures"], defaults["editor.fontLigatures"]),
    renderWhitespace: oneOf(preferences["editor.renderWhitespace"], WHITESPACE, defaults["editor.renderWhitespace"] as "selection"),
    bracketPairColorization: { enabled: bool(preferences["editor.bracketPairs"], defaults["editor.bracketPairs"]) },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: !reducedMotion,
  };
}
