import { communityThemes } from "./community-themes";
import type { ThemePalette } from "./theme-model";
const definitions = {
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
  ...communityThemes,
};
export type ThemeId = keyof typeof definitions;
export const themes: Record<ThemeId, ThemePalette> = definitions;
