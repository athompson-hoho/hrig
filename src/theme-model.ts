export const ansiNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
export type AnsiPalette = Record<(typeof ansiNames)[number], string>;
export interface ThemePalette {
  name: string;
  background: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  dark: boolean;
  family?: string;
  source?: string;
  accent?: string;
  surface?: string;
  selection?: string;
  ansi?: AnsiPalette;
  syntax?: {
    comment: string;
    string: string;
    keyword: string;
    number: string;
    type: string;
    function: string;
    variable: string;
  };
}
