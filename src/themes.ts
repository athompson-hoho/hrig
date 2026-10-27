import { sourceColors } from "./theme-colors";
import type { Preferences } from "./settings";
export const themes = {
  "hrig-dark": {
    name: "HRig Dark",
    background: "#101115",
    panel: "#14161b",
    line: "#353e4c",
    text: "#d0d5e0",
    muted: "#8995a7",
    dark: true,
  },
  graphite: {
    name: "Graphite",
    background: "#171717",
    panel: "#202020",
    line: "#444444",
    text: "#e1e1e1",
    muted: "#a0a0a0",
    dark: true,
  },
  midnight: {
    name: "Midnight",
    background: "#0b1220",
    panel: "#101b2d",
    line: "#31455d",
    text: "#dbe8f8",
    muted: "#8cabc8",
    dark: true,
  },
  light: {
    name: "Daylight",
    background: "#f5f6f8",
    panel: "#ffffff",
    line: "#c7cdd7",
    text: "#222d3c",
    muted: "#58677b",
    dark: false,
  },
  "high-contrast": {
    name: "High Contrast",
    background: "#000000",
    panel: "#000000",
    line: "#9cacbf",
    text: "#ffffff",
    muted: "#c6d1e0",
    dark: true,
  },
};
export type ThemeId = keyof typeof themes;
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
    : preferences["appearance.theme"] in themes
      ? (preferences["appearance.theme"] as ThemeId)
      : "hrig-dark";
}
export function themeColor(source: string, id: ThemeId, accent = "mint") {
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
  if (id === "hrig-dark" && accent === "mint") return source;
  let color: string;
  if (green) {
    const chosen = accents[accent] || accents.mint;
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
      : p["terminal.theme"] === "light"
        ? "light"
        : "hrig-dark";
  const palette = themes[selected];
  return {
    background: palette.panel,
    foreground: palette.text,
    cursor: themeColor("#98e2c2", selected, p["appearance.accent"]),
    selectionBackground: selected === "light" ? "#c8daef" : "#33564e",
    black: palette.dark ? "#20232c" : "#242b36",
    red: palette.dark ? "#ed929d" : "#a02539",
    green: palette.dark ? "#98d8b3" : "#246841",
    yellow: palette.dark ? "#dfc28e" : "#7e5c17",
    blue: palette.dark ? "#91b4ec" : "#285b9b",
    magenta: palette.dark ? "#c1a0e0" : "#78429b",
    cyan: palette.dark ? "#8cd3d9" : "#1c6574",
    white: palette.dark ? "#d7dce7" : "#7b8594",
    brightBlack: "#747c8e",
  };
}
