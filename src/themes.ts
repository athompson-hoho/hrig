import { sourceColors } from "./theme-colors";
import type { Preferences } from "./settings";
import { themes, type ThemeId } from "./theme-catalog";
export { themes, type ThemeId } from "./theme-catalog";

export const accents: Record<string, string> = {
  mint: "#a0e3c2",
  blue: "#91b4ec",
  violet: "#c1a0e0",
  amber: "#dfc28e",
};
function rgb(hex: string) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function mix(a: string, b: string, amount: number) {
  const x = rgb(a),
    y = rgb(b);
  return (
    "#" +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, amount)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function themeId(
  preferences: Preferences,
  systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches,
): ThemeId {
  return preferences["appearance.theme"] === "system"
    ? systemDark
      ? "hrig-dark"
      : "light"
    : Object.hasOwn(themes, preferences["appearance.theme"])
      ? (preferences["appearance.theme"] as ThemeId)
      : "hrig-dark";
}
export function themeColor(source: string, id: ThemeId, accent = "theme") {
  const p = themes[id],
    [r, g, b] = rgb(source),
    brightness = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  const alpha =
    source.length === 9
      ? source.slice(7)
      : source.length === 5
        ? source.slice(4).repeat(2)
        : "";
  const green = g > r * 1.08 && g > b * 1.02;
  if (id === "hrig-dark" && (accent === "mint" || accent === "theme"))
    return source;
  let chosen =
    accent === "theme"
      ? p.accent || accents.mint
      : accents[accent] || accents.mint;
  if (!p.dark && rgb(chosen).reduce((a, b) => a + b, 0) / 765 > 0.6)
    chosen = mix(p.text, chosen, 0.35);
  if (p.family === "Community") {
    const anchors: Record<string, string> = {
      "#101115": p.background,
      "#14161b": p.panel,
      "#181a20": p.surface || p.panel,
      "#272a33": p.line,
      "#c9cdd7": p.text,
      "#d0d5e0": p.text,
      "#777e8e": p.muted,
      "#a0e3c2": chosen,
      "#a0dbb6": chosen,
      "#98e2c2": chosen,
    };
    if (anchors[source.toLowerCase()]) return anchors[source.toLowerCase()];
  }
  let color: string;
  if (green) {
    color = p.dark
      ? brightness < 0.3
        ? mix(p.panel, chosen, brightness * 0.65)
        : mix(p.text, chosen, 0.8)
      : brightness < 0.3
        ? mix(p.panel, chosen, 0.08)
        : mix(p.text, chosen, 0.35);
  } else if (id === "hrig-dark") return source;
  else if (brightness < 0.24)
    color = mix(p.background, p.line, Math.max(0, (brightness - 0.05) / 0.6));
  else if (brightness < 0.48)
    color = mix(p.line, p.muted, (brightness - 0.24) / 0.24);
  else {
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    color =
      spread > 60
        ? mix(p.text, source, p.dark ? 0.65 : 0.25)
        : mix(p.muted, p.text, (brightness - 0.48) / 0.4);
  }
  return color + alpha;
}
export function applyTheme(doc: Document, p: Preferences, systemDark: boolean) {
  const id = themeId(p, systemDark),
    element = doc.documentElement;
  element.dataset.theme = id;
  element.dataset.density = p["appearance.density"];
  element.dataset.reducedMotion = String(p["appearance.reduceMotion"]);
  element.style.colorScheme = themes[id].dark ? "dark" : "light";
  for (const source of sourceColors)
    element.style.setProperty(
      "--color-" + source.slice(1).toLowerCase(),
      themeColor(source, id, p["appearance.accent"]),
    );
  element.style.fontFamily = p["appearance.fontFamily"];
  if (doc.body) {
    doc.body.style.background = themeColor(
      "#101115",
      id,
      p["appearance.accent"],
    );
    doc.body.style.color = themeColor("#c9cdd7", id, p["appearance.accent"]);
  }
}
export function terminalTheme(p: Preferences, id: ThemeId) {
  const selected =
    p["terminal.theme"] === "inherit"
      ? id
      : p["terminal.theme"] === "dark"
        ? "hrig-dark"
        : Object.hasOwn(themes, p["terminal.theme"])
          ? (p["terminal.theme"] as ThemeId)
          : "hrig-dark";
  const palette = themes[selected];
  return {
    background: palette.panel,
    foreground: palette.text,
    cursor: themeColor("#98e2c2", selected, p["appearance.accent"]),
    selectionBackground:
      palette.selection || (palette.dark ? "#33564e" : "#c8daef"),
    black: palette.dark ? "#20232c" : "#242b36",
    red: palette.dark ? "#ed929d" : "#a02539",
    green: palette.dark ? "#98d8b3" : "#246841",
    yellow: palette.dark ? "#dfc28e" : "#7e5c17",
    blue: palette.dark ? "#91b4ec" : "#285b9b",
    magenta: palette.dark ? "#c1a0e0" : "#78429b",
    cyan: palette.dark ? "#8cd3d9" : "#1c6574",
    white: palette.dark ? "#d7dce7" : "#7b8594",
    brightBlack: "#747c8e",
    ...palette.ansi,
  };
}
export function editorTheme(p: Preferences, id: ThemeId) {
  const palette = themes[id],
    s = palette.syntax;
  const rules = s
    ? Object.entries(s).map(([token, color]) => ({
        token,
        foreground: color.slice(1),
      }))
    : id === "hrig-dark"
      ? [
          { token: "comment", foreground: "697386" },
          { token: "string", foreground: "a1d6b8" },
          { token: "keyword", foreground: "b8abed" },
        ]
      : [];
  return {
    base: (palette.dark ? "vs-dark" : "vs") as "vs-dark" | "vs",
    inherit: true,
    rules,
    colors: {
      "editor.background": palette.panel,
      "editor.foreground": palette.text,
      "editorLineNumber.foreground": palette.muted,
      "editorCursor.foreground": themeColor(
        "#98e2c2",
        id,
        p["appearance.accent"],
      ),
      "editor.selectionBackground":
        palette.selection || (palette.dark ? "#30463f" : "#c8daef"),
      "editor.lineHighlightBackground": mix(
        palette.panel,
        palette.selection || palette.line,
        0.25,
      ),
      "editorWidget.background": palette.surface || palette.panel,
      "editorWidget.border": palette.line,
      "editorGutter.background": palette.panel,
    },
  };
}
