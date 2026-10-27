import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
// Explicit maintenance command; themes never make runtime network requests.
const sources = {
  catppuccin: {
    repo: "catppuccin/palette",
    branch: "main",
    palette: "palette.json",
    license: "LICENSE",
  },
  nord: {
    repo: "nordtheme/nord",
    branch: "develop",
    palette: "src/nord.css",
    license: "license",
  },
  dracula: {
    repo: "dracula/visual-studio-code",
    branch: "master",
    palette: "src/dracula.yml",
    license: "LICENSE",
  },
  tokyo: {
    repo: "folke/tokyonight.nvim",
    branch: "main",
    palette: "extras/kitty/tokyonight_night.conf",
    license: "LICENSE",
  },
  gruvbox: {
    repo: "gruvbox-community/gruvbox",
    branch: "master",
    palette: "colors/gruvbox.vim",
    license: "LICENSE.md",
  },
};
async function read(s, file) {
  const r = await fetch(
    `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${file}`,
  );
  if (!r.ok) throw Error(`Could not read ${s.repo}/${file}: ${r.status}`);
  return r.text();
}
await fs.mkdir("assets/theme-licenses", { recursive: true });
const provenance = {};
for (const [id, s] of Object.entries(sources)) {
  s.branch = execFileSync(
    "gh",
    ["api", `repos/${s.repo}`, "--jq", ".default_branch"],
    { encoding: "utf8" },
  ).trim();
  s.commit = execFileSync(
    "gh",
    ["api", `repos/${s.repo}/commits/${s.branch}`, "--jq", ".sha"],
    { encoding: "utf8" },
  ).trim();
  s.text = await read(s, s.palette);
  await fs.writeFile(
    `assets/theme-licenses/${id}.txt`,
    await read(s, s.license),
  );
  provenance[id] = {
    repository: s.repo,
    commit: s.commit,
    palette: s.palette,
    license: s.license,
  };
}
const ansiNames = [
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
];
const ansi = (values) =>
  Object.fromEntries(
    ansiNames.map((name, i) => {
      if (!/^#[\da-f]{6}$/i.test(values[i] || ""))
        throw Error("Missing ANSI color " + name);
      return [name, values[i].toLowerCase()];
    }),
  );
const community = {};
const cat = JSON.parse(sources.catppuccin.text);
for (const flavour of ["mocha", "macchiato", "frappe", "latte"]) {
  const p = cat[flavour],
    c = Object.fromEntries(
      Object.entries(p.colors).map(([k, v]) => [k, v.hex]),
    ),
    values = Array(16);
  for (const entry of Object.values(p.ansiColors)) {
    values[entry.normal.code] = entry.normal.hex;
    values[entry.bright.code] = entry.bright.hex;
  }
  community["catppuccin-" + flavour] = {
    name: "Catppuccin " + p.name,
    family: "Community",
    source: "https://github.com/catppuccin/palette",
    background: c.base,
    panel: c.base,
    surface: c.mantle,
    line: c.surface1,
    text: c.text,
    muted: c.subtext0,
    dark: p.dark,
    accent: c.mauve,
    selection: c.surface1,
    ansi: ansi(values),
    syntax: {
      comment: c.overlay1,
      string: c.green,
      keyword: c.mauve,
      number: c.peach,
      type: c.yellow,
      function: c.blue,
      variable: c.text,
    },
  };
}
const n = Object.fromEntries(
  [...sources.nord.text.matchAll(/--(nord\d+):\s*(#[\da-f]{6})/gi)].map((m) => [
    m[1],
    m[2],
  ]),
);
community.nord = {
  name: "Nord",
  family: "Community",
  source: "https://www.nordtheme.com/docs/colors-and-palettes/",
  background: n.nord0,
  panel: n.nord0,
  surface: n.nord1,
  line: n.nord3,
  text: n.nord4,
  muted: n.nord3,
  dark: true,
  accent: n.nord8,
  selection: n.nord2,
  ansi: ansi(
    [0, 11, 14, 13, 9, 15, 8, 5, 3, 11, 14, 13, 9, 15, 7, 6].map(
      (i) => n["nord" + i],
    ),
  ),
  syntax: {
    comment: n.nord3,
    string: n.nord14,
    keyword: n.nord9,
    number: n.nord15,
    type: n.nord7,
    function: n.nord8,
    variable: n.nord4,
  },
};
const d = Object.fromEntries(
  [...sources.dracula.text.matchAll(/&(\w+)\s+'(#[\da-f]{6})'/gi)].map((m) => [
    m[1],
    m[2].toLowerCase(),
  ]),
);
community.dracula = {
  name: "Dracula",
  family: "Community",
  source: "https://draculatheme.com/spec",
  background: d.BG,
  panel: d.BG,
  surface: d.BGDark,
  line: d.SELECTION,
  text: d.FG,
  muted: d.COMMENT,
  dark: true,
  accent: d.PURPLE,
  selection: d.SELECTION,
  ansi: ansi(Array.from({ length: 16 }, (_, i) => d["COLOR" + i])),
  syntax: {
    comment: d.COMMENT,
    string: d.YELLOW,
    keyword: d.PINK,
    number: d.PURPLE,
    type: d.CYAN,
    function: d.GREEN,
    variable: d.FG,
  },
};
const t = Object.fromEntries(
  [...sources.tokyo.text.matchAll(/^(\w+)\s+(#[\da-f]{6})\s*$/gim)].map((m) => [
    m[1],
    m[2].toLowerCase(),
  ]),
);
community["tokyo-night"] = {
  name: "Tokyo Night",
  family: "Community",
  source: "https://github.com/folke/tokyonight.nvim",
  background: t.background,
  panel: t.background,
  surface: "#16161e",
  line: t.inactive_tab_background,
  text: t.foreground,
  muted: t.inactive_tab_foreground,
  dark: true,
  accent: t.active_tab_background,
  selection: t.selection_background,
  ansi: ansi(Array.from({ length: 16 }, (_, i) => t["color" + i])),
  syntax: {
    comment: t.inactive_tab_foreground,
    string: t.color2,
    keyword: t.color5,
    number: t.color16,
    type: t.color6,
    function: t.color4,
    variable: t.foreground,
  },
};
const g = Object.fromEntries(
  [
    ...sources.gruvbox.text.matchAll(
      /s:Color\('([^']+)',\s*\['(#[\da-f]{6})'/gi,
    ),
  ].map((m) => [m[1], m[2].toLowerCase()]),
);
g.gray = g.gray_245;
community["gruvbox-dark"] = {
  name: "Gruvbox Dark",
  family: "Community",
  source: "https://github.com/gruvbox-community/gruvbox",
  background: g.dark0,
  panel: g.dark0,
  surface: g.dark1,
  line: g.dark3,
  text: g.light1,
  muted: g.gray,
  dark: true,
  accent: g.bright_orange,
  selection: g.dark2,
  ansi: ansi(
    [
      "dark0",
      "neutral_red",
      "neutral_green",
      "neutral_yellow",
      "neutral_blue",
      "neutral_purple",
      "neutral_aqua",
      "light4",
      "gray",
      "bright_red",
      "bright_green",
      "bright_yellow",
      "bright_blue",
      "bright_purple",
      "bright_aqua",
      "light1",
    ].map((k) => g[k]),
  ),
  syntax: {
    comment: g.gray,
    string: g.bright_green,
    keyword: g.bright_red,
    number: g.bright_purple,
    type: g.bright_yellow,
    function: g.bright_green,
    variable: g.light1,
  },
};
// Raise UI secondary-text contrast while keeping upstream syntax and ANSI colors intact.
function channels(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex) {
  return channels(hex)
    .map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
for (const p of Object.values(community)) {
  const original = channels(p.muted),
    target = channels(p.text);
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const color =
      "#" +
      original
        .map((v, i) =>
          Math.round(v + (target[i] - v) * amount)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    p.muted = color;
    if (contrast(color, p.panel) >= 4.5) break;
  }
}
for (const [id, p] of Object.entries(community))
  for (const key of [
    "background",
    "panel",
    "line",
    "text",
    "muted",
    "accent",
    "selection",
  ])
    if (!/^#[\da-f]{6}$/i.test(p[key] || ""))
      throw Error(`Invalid ${id} ${key}`);
await fs.writeFile(
  "src/community-themes.ts",
  '// Generated from pinned upstream palettes. See THEME_CREDITS.md.\nimport type {ThemePalette} from "./theme-model";\nexport const communityThemes = ' +
    JSON.stringify(community, null, 2) +
    " satisfies Record<string,ThemePalette>;\n",
);
await fs.writeFile(
  "assets/theme-licenses/sources.json",
  JSON.stringify(provenance, null, 2) + "\n",
);
const rows = Object.entries(sources).map(
  ([id, s]) =>
    `| ${id === "catppuccin" ? "Catppuccin Mocha, Macchiato, Frappe, Latte" : id === "tokyo" ? "Tokyo Night" : id === "gruvbox" ? "Gruvbox Dark" : id === "nord" ? "Nord" : "Dracula Classic"} | [${s.repo}](https://github.com/${s.repo}/blob/${s.commit}/${s.palette}) | ${s.commit.slice(0, 12)} | [${id === "tokyo" ? "Apache-2.0" : "MIT"}](assets/theme-licenses/${id}.txt) |`,
);
await fs.writeFile(
  "THEME_CREDITS.md",
  "# Community theme credits\n\nThese are HRig adaptations of community palettes, not official ports or full VS Code extension packages. Core surfaces, syntax tokens, and terminal ANSI colors use the referenced palettes. Secondary workspace shades are derived to fit HRig. All colors ship offline; choosing a theme does not fetch code or contact a theme service.\n\n| Theme | Upstream palette | Revision | License text |\n| --- | --- | --- | --- |\n" +
    rows.join("\n") +
    "\n\nCatppuccin palette version: " +
    cat.version +
    ". Tokyo Night currently uses Apache-2.0 in its repository; its generated terminal file also carries an MIT header. HRig conservatively bundles the repository license. Gruvbox is adapted from the maintained community fork, credited to Pavel Pertsev and contributors.\n\nLicense texts and the provenance manifest are bundled with desktop builds. Theme names belong to their respective projects; no endorsement is implied. To update the adaptations deliberately, run node scripts/update-community-themes.mjs and review/test the generated changes before release.\n",
);
console.log(
  "Generated " +
    Object.keys(community).length +
    " community themes with source revisions and licenses.",
);
