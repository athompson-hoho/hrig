const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(file, module);
  mod._compile(built.outputFiles[0].text, file);
  return mod.exports;
}

const contrast = load("src/contrast-ratio.ts");
const theme = load("src/themes.ts");
const { sourceColors } = load("src/theme-colors.ts");
const {
  parseHex,
  relativeLuminance,
  contrastRatio,
  requiredRatio,
  meets,
  checkPairs,
} = contrast;

const root = path.join(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
const HC = "high-contrast";
const BLACK = "#000000";
const ACCENTS = ["theme", "mint", "blue", "violet", "amber"];

test("contrast-ratio rules: parseHex, relativeLuminance, contrastRatio, meets and checkPairs follow WCAG 2.x on known values, exact boundaries, alpha and bad input", () => {
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("#000"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseHex("#abc"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseHex("#ABCD"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseHex("#1A2b3C"), { r: 26, g: 43, b: 60 });
  assert.deepEqual(parseHex("#11223344"), { r: 17, g: 34, b: 51 });
  // Without a background the alpha channel is ignored.
  assert.deepEqual(parseHex("#ffffff00"), { r: 255, g: 255, b: 255 });
  // With a background a translucent color is laid over it and rounded to whole channels.
  assert.deepEqual(parseHex("#ffffff80", BLACK), { r: 128, g: 128, b: 128 });
  assert.deepEqual(parseHex("#ff000040", "#0000ff"), { r: 64, g: 0, b: 191 });
  assert.deepEqual(parseHex("#fff8", BLACK), { r: 136, g: 136, b: 136 });
  assert.deepEqual(parseHex("#64646440", "#c8c8c8"), {
    r: 175,
    g: 175,
    b: 175,
  });
  assert.deepEqual(parseHex("#ffffff00", "#336699"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(parseHex("#ffffff", "#336699"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("#ffffff80", "#00000000"), {
    r: 128,
    g: 128,
    b: 128,
  });
  for (const bad of [
    "",
    "fff",
    "#",
    "#ff",
    "#fffff",
    "#fffffff",
    "#fffffffff",
    "#ggg",
    "#12345g",
    " #fff",
    "#fff ",
    "red",
    "rgb(1,2,3)",
    null,
    undefined,
    12,
    {},
  ])
    assert.equal(parseHex(bad), null, "invalid: " + String(bad));
  assert.equal(parseHex("#fff", "nope"), null);
  assert.equal(parseHex("#ffffff80", "#12"), null);

  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.ok(
    Math.abs(relativeLuminance({ r: 255, g: 255, b: 255 }) - 1) < 1e-12,
  );
  assert.ok(
    Math.abs(relativeLuminance({ r: 255, g: 0, b: 0 }) - 0.2126) < 1e-12,
  );
  assert.ok(
    Math.abs(relativeLuminance({ r: 0, g: 255, b: 0 }) - 0.7152) < 1e-12,
  );
  assert.ok(
    Math.abs(relativeLuminance({ r: 0, g: 0, b: 255 }) - 0.0722) < 1e-12,
  );
  assert.equal(
    Math.round(relativeLuminance({ r: 128, g: 128, b: 128 }) * 10000) / 10000,
    0.2159,
  );
  // The linear segment of the sRGB curve (a channel up to 10 of 255) and the first channel on the curved part (11).
  assert.ok(
    Math.abs(relativeLuminance({ r: 10, g: 10, b: 10 }) - 10 / 255 / 12.92) <
      1e-12,
  );
  assert.ok(
    Math.abs(
      relativeLuminance({ r: 11, g: 11, b: 11 }) -
        ((11 / 255 + 0.055) / 1.055) ** 2.4,
    ) < 1e-12,
  );

  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#123456", "#123456"), 1);
  assert.equal(contrastRatio("#fff", "#fff"), 1);
  // Published WCAG values, compared to two decimals.
  const published = [
    ["#777777", "#ffffff", 4.48],
    ["#767676", "#ffffff", 4.54],
    ["#ff0000", "#ffffff", 4],
    ["#0000ff", "#ffffff", 8.59],
    ["#00ff00", "#000000", 15.3],
    ["#808080", "#ffffff", 3.95],
    ["#595959", "#ffffff", 7],
    ["#949494", "#ffffff", 3.03],
  ];
  for (const [a, b, expected] of published)
    assert.equal(round2(contrastRatio(a, b)), expected, a + " on " + b);
  // The ratio itself is never rounded: #777 is 4.478..., not 4.48, and stays under 4.5.
  const gray = contrastRatio("#777", "#fff");
  assert.ok(Math.abs(gray - 4.478089453577214) < 1e-9);
  assert.notEqual(gray, 4.48);
  assert.equal(gray, contrastRatio("#777777", "#ffffff"));
  assert.equal(meets(gray, "text"), false);
  assert.equal(meets(contrastRatio("#767676", "#ffffff"), "text"), true);

  const grid = [
    "#000000",
    "#ffffff",
    "#777777",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#123456",
    "#abcdef",
    "#9cacbf",
    "#a0e3c2",
    "#101115",
    "#c6d1e0",
  ];
  for (const a of grid)
    for (const b of grid) {
      const ab = contrastRatio(a, b);
      assert.ok(ab >= 1 && ab <= 21, a + " " + b);
      assert.equal(ab, contrastRatio(b, a), "symmetric " + a + " " + b);
    }
  // Alpha: a translucent foreground is laid over the (opaque) background first; the background's own alpha is ignored.
  assert.equal(
    contrastRatio("#ffffff80", BLACK),
    contrastRatio("#808080", BLACK),
  );
  assert.equal(contrastRatio("#ffffff00", BLACK), 1);
  assert.equal(contrastRatio("#ffffff", "#00000000"), 21);
  for (const bad of ["", "fff", "#ggg", "#fffff", null, undefined, 12]) {
    assert.ok(Number.isNaN(contrastRatio(bad, "#ffffff")), "fg " + bad);
    assert.ok(Number.isNaN(contrastRatio("#ffffff", bad)), "bg " + bad);
  }

  assert.deepEqual(
    ["text", "large", "non-text"].map(requiredRatio),
    [4.5, 3, 3],
  );
  assert.ok(Number.isNaN(requiredRatio("huge")));
  assert.equal(meets(4.5, "text"), true);
  assert.equal(meets(4.499, "text"), false);
  assert.equal(meets(4.4999999, "text"), false);
  assert.equal(meets(3, "large"), true);
  assert.equal(meets(2.999, "large"), false);
  assert.equal(meets(3, "non-text"), true);
  assert.equal(meets(2.999, "non-text"), false);
  assert.equal(meets(21, "text"), true);
  assert.equal(meets(1, "text"), false);
  for (const bad of [Number.NaN, Infinity, -1, "5", null, undefined])
    assert.equal(meets(bad, "text"), false, "ratio " + String(bad));
  assert.equal(meets(21, "huge"), false);

  const pairs = Object.freeze([
    Object.freeze({
      name: "white on black",
      fg: "#ffffff",
      bg: BLACK,
      kind: "text",
    }),
    Object.freeze({
      name: "gray text",
      fg: "#777777",
      bg: "#ffffff",
      kind: "text",
    }),
    Object.freeze({
      name: "gray border",
      fg: "#949494",
      bg: "#ffffff",
      kind: "non-text",
    }),
    Object.freeze({ name: "bad", fg: "red", bg: "#fff", kind: "text" }),
  ]);
  const results = checkPairs(pairs);
  assert.deepEqual(
    results.map((r) => r.name),
    ["white on black", "gray text", "gray border", "bad"],
  );
  assert.deepEqual(
    results.map((r) => r.pass),
    [true, false, true, false],
  );
  assert.deepEqual(
    results.map((r) => r.required),
    [4.5, 4.5, 3, 4.5],
  );
  assert.deepEqual(
    results.map((r) => r.kind),
    ["text", "text", "non-text", "text"],
  );
  assert.deepEqual(
    results.map((r) => [r.fg, r.bg]),
    pairs.map((p) => [p.fg, p.bg]),
  );
  assert.equal(results[0].ratio, 21);
  assert.equal(round2(results[1].ratio), 4.48);
  assert.ok(Number.isNaN(results[3].ratio));
  assert.deepEqual(checkPairs([]), []);

  assert.deepEqual(Object.keys(contrast).sort(), [
    "checkPairs",
    "contrastRatio",
    "meets",
    "parseHex",
    "relativeLuminance",
    "requiredRatio",
  ]);
});

test("contrast-ratio tracer: the High Contrast theme's own colors, read from the real catalog, themeColor and stylesheet, meet WCAG 2.x through the pure module", () => {
  const hc = theme.themes[HC];
  assert.equal(hc.name, "High Contrast");
  assert.deepEqual(
    [hc.background, hc.panel, hc.line, hc.text, hc.muted, hc.dark],
    [BLACK, BLACK, "#9cacbf", "#ffffff", "#c6d1e0", true],
  );
  for (const key of ["accent", "ansi", "syntax", "family", "selection"])
    assert.equal(hc[key], undefined, "no " + key);

  // The theme's colors as the app applies them: themeColor over the two real surface tokens and the body color.
  const bodyText = theme.themeColor("#c9cdd7", HC);
  const panelToken = theme.themeColor("#14161b", HC);
  const surfaceToken = theme.themeColor("#181a20", HC);

  // The ring the stylesheet draws on every focused control in this theme.
  const css = read("src/styles.css");
  const ring =
    /:root\[data-theme="high-contrast"\] :focus-visible \{\n  outline: 2px solid (#[0-9a-f]{6});\n  outline-offset: 2px;\n\}/.exec(
      css,
    );
  assert.ok(ring, "the High Contrast ring rule is in the stylesheet");
  assert.equal(ring[1], "#ffffff");

  const text = (name, fg, bg) => ({ name, fg, bg, kind: "text" });
  const graphic = (name, fg, bg) => ({ name, fg, bg, kind: "non-text" });
  const pairs = [
    text("text on background", hc.text, hc.background),
    text("text on panel", hc.text, hc.panel),
    text("muted on background", hc.muted, hc.background),
    text("muted on panel", hc.muted, hc.panel),
    text("body text on background", bodyText, hc.background),
    text("text on panel token", hc.text, panelToken),
    text("muted on panel token", hc.muted, panelToken),
    text("text on surface token", hc.text, surfaceToken),
    text("muted on surface token", hc.muted, surfaceToken),
    ...Object.entries(theme.accents).map(([name, fg]) =>
      text("accent " + name, fg, hc.background),
    ),
    ...Object.keys(theme.accents).map((name) =>
      text(
        "derived accent " + name,
        theme.themeColor("#a0e3c2", HC, name),
        hc.background,
      ),
    ),
    graphic("line on background", hc.line, hc.background),
    graphic("line on panel", hc.line, hc.panel),
    graphic("ring on background", ring[1], hc.background),
  ];

  const results = checkPairs(pairs);
  assert.deepEqual(
    results.filter((r) => !r.pass).map((r) => r.name),
    [],
    "every base pair of the theme meets its WCAG threshold",
  );
  // Measured on the real theme (rounded to two decimals only here, for display).
  assert.deepEqual(
    Object.fromEntries(results.map((r) => [r.name, round2(r.ratio)])),
    {
      "text on background": 21,
      "text on panel": 21,
      "muted on background": 13.6,
      "muted on panel": 13.6,
      "body text on background": 19.4,
      "text on panel token": 19.81,
      "muted on panel token": 12.83,
      "text on surface token": 19.18,
      "muted on surface token": 12.42,
      "accent mint": 14.26,
      "accent blue": 9.94,
      "accent violet": 9.37,
      "accent amber": 12.24,
      "derived accent mint": 15.46,
      "derived accent blue": 11.71,
      "derived accent violet": 11.19,
      "derived accent amber": 13.7,
      "line on background": 9.07,
      "line on panel": 9.07,
      "ring on background": 21,
    },
  );
  // The white ring against the border color is below 3:1 (2.32). It is not a required pair: the ring is drawn 2px away from the control, so the gap, not the border, sits next to it.
  assert.equal(round2(contrastRatio(ring[1], hc.line)), 2.32);
  assert.ok(
    css.includes(
      ':root[data-theme="high-contrast"] :focus-visible {\n  outline: 2px solid #ffffff;\n  outline-offset: 2px;\n}',
    ),
  );
});

// sha256 (first 16 hex digits) of themeColor over every source color and every accent choice, measured before this phase changed anything.
const OTHER_THEMES = {
  "hrig-dark": "b8bf3e120170810d",
  graphite: "dd567eacf062ca0c",
  midnight: "e9980be794d45066",
  light: "8d98fe567a6ecdd0",
  "catppuccin-mocha": "16a0eec03f1a8e26",
  "catppuccin-macchiato": "20999b75261234c6",
  "catppuccin-frappe": "014259517d58ba61",
  "catppuccin-latte": "5398fb35f34e861a",
  nord: "e64af0796088cd55",
  dracula: "fd680171a24236f3",
  "tokyo-night": "1d6278b9351bbb11",
  "gruvbox-dark": "b8d5e283561fbc9a",
};

test("contrast-ratio pins: themeColor gives every theme except High Contrast exactly the colors it gave before this phase", () => {
  assert.equal(sourceColors.length, 472);
  for (const id of Object.keys(OTHER_THEMES)) {
    assert.ok(theme.themes[id], id + " is a theme");
    const hash = crypto.createHash("sha256");
    for (const accent of ACCENTS)
      for (const source of sourceColors)
        hash.update(theme.themeColor(source, id, accent) + "\n");
    assert.equal(hash.digest("hex").slice(0, 16), OTHER_THEMES[id], id);
  }
  assert.equal(
    theme.themeColor("#14161b", "hrig-dark", "mint"),
    "#14161b",
    "the default theme keeps the original palette",
  );
});

// ---- What the stylesheets draw in High Contrast ----
const HC_ROOT = ':root[data-theme="high-contrast"]';
const HC_PREFIX = HC_ROOT + " ";

function parseDeclarations(body) {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.includes(":"))
    .map((d) => {
      const at = d.indexOf(":");
      return [d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()];
    });
}

// Every rule of a stylesheet with its selector (whitespace collapsed) and declarations; the rules inside @media and @keyframes are included, the at-rules themselves are not.
function cssRules(text) {
  const rules = [];
  const open = [];
  let body = "";
  for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      open.push(body.trim());
      body = "";
    } else if (ch === "}") {
      const selector = open.pop();
      if (selector && !selector.startsWith("@") && body.trim())
        rules.push({
          selector: selector.replace(/\s+/g, " "),
          declarations: parseDeclarations(body),
        });
      body = "";
    } else body += ch;
  }
  return rules;
}

// Splits at a separator that is not inside parentheses.
function topLevel(value, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of value.replace(/\s+/g, " ")) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function roleOf(prop) {
  if (prop === "color") return "text";
  if (/^background(-color)?$/.test(prop)) return "background";
  if (/^border/.test(prop) || prop === "outline") return "border";
  if (prop === "accent-color") return "control";
  if (prop === "box-shadow") return "shadow";
  if (prop.startsWith("--")) return "variable";
  return null;
}

function opaque(color, backing) {
  const rgb = parseHex(color, backing);
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, "0")).join("")
  );
}
function translucent(color) {
  return (
    (color.length === 9 && !color.endsWith("ff")) ||
    (color.length === 5 && !color.endsWith("f"))
  );
}

// Reads src/styles.css and src/navigation.css and resolves every color the way the theme does in High Contrast: a --color-xxxxxx token through the real themeColor, --muted and --line through the theme's own rule, the rest through :root. Returns the text, border and control pairs to check, the roles of every token and the High Contrast overrides.
function scanStylesheets() {
  const rules = [
    ...cssRules(read("src/styles.css")),
    ...cssRules(read("src/navigation.css")),
  ];
  const defined = new Set();
  for (const rule of rules)
    if (rule.selector === ":root")
      for (const [prop] of rule.declarations)
        if (/^--color-[0-9a-f]{3,8}$/.test(prop)) defined.add(prop.slice(8));
  const vars = new Map();
  const colorOf = (value, depth = 0) => {
    const v = value.trim().replace(/\s*!important$/, "");
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v))
      return v.toLowerCase();
    if (v === "white") return "#ffffff";
    if (v === "black") return BLACK;
    const m = /^var\(\s*--([a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i.exec(v);
    if (!m || depth > 4) return null;
    const [, name, fallback] = m;
    const token = /^color-([0-9a-f]{3,8})$/.exec(name);
    let found = null;
    if (token)
      found = defined.has(token[1])
        ? theme.themeColor("#" + token[1], HC)
        : null;
    else found = vars.get(name) || null;
    if (found) return found;
    return fallback ? colorOf(fallback, depth + 1) : null;
  };
  for (const rule of rules)
    if (rule.selector === ":root")
      for (const [prop, value] of rule.declarations)
        if (prop.startsWith("--") && !prop.startsWith("--color-"))
          vars.set(prop.slice(2), colorOf(value));
  for (const rule of rules)
    if (rule.selector === HC_ROOT)
      for (const [prop, value] of rule.declarations)
        if (prop.startsWith("--")) vars.set(prop.slice(2), colorOf(value));

  // High Contrast overrides written as ':root[data-theme="high-contrast"] <selector> { ... }': base selector -> property -> color.
  const overrides = new Map();
  for (const rule of rules)
    for (const part of rule.selector.split(",").map((s) => s.trim()))
      if (part.startsWith(HC_PREFIX)) {
        const base = part.slice(HC_PREFIX.length).trim();
        const map = overrides.get(base) || new Map();
        for (const [prop, value] of rule.declarations) {
          const color = colorOf(value);
          if (color) map.set(prop, color);
        }
        overrides.set(base, map);
      }
  const overridden = (selectors, prop) => {
    const keys =
      prop === "color"
        ? ["color"]
        : prop === "border"
          ? ["border-color"]
          : prop.startsWith("border")
            ? [prop.endsWith("-color") ? prop : prop + "-color", "border-color"]
            : [prop];
    for (const selector of selectors)
      for (const key of keys) {
        const color =
          overrides.get(selector) && overrides.get(selector).get(key);
        if (color) return color;
      }
    return null;
  };

  const roles = new Map();
  const undefinedTokens = new Set();
  const pairs = [];
  const hc = theme.themes[HC];
  for (const rule of rules) {
    const selectors = rule.selector.split(",").map((s) => s.trim());
    for (const [prop, value] of rule.declarations) {
      const tokens = [...value.matchAll(/var\(--color-([0-9a-f]{3,8})\b/g)].map(
        (m) => m[1],
      );
      if (!tokens.length) continue;
      const role = roleOf(prop);
      assert.ok(
        role,
        "a token is used by a property no rule classifies: " +
          prop +
          " in " +
          rule.selector,
      );
      for (const token of tokens) {
        if (!roles.has(token)) roles.set(token, new Set());
        roles.get(token).add(role);
        if (!defined.has(token)) undefinedTokens.add(token);
      }
    }
    // The theme's own overrides and the rules that never apply in High Contrast are not measured.
    if (
      selectors.every((s) => s.startsWith(HC_PREFIX)) ||
      rule.selector === HC_ROOT ||
      rule.selector.includes(':not([data-theme="high-contrast"])')
    )
      continue;
    const backgrounds = [];
    for (const [prop, value] of rule.declarations)
      if (roleOf(prop) === "background") {
        const color = colorOf(value);
        if (color)
          backgrounds.push({ value, color: opaque(color, hc.background) });
      }
    const backing = backgrounds.length
      ? backgrounds
      : [{ value: "the theme background", color: hc.background }];
    for (const [prop, value] of rule.declarations) {
      const role = roleOf(prop);
      if (role === "text") {
        const fg = overridden(selectors, prop) || colorOf(value);
        if (fg)
          for (const b of backing)
            pairs.push({
              name: rule.selector + " { color: " + value + " } on " + b.value,
              kind: "text",
              fg,
              bg: b.color,
            });
      } else if (role === "border" || role === "control" || role === "shadow") {
        const layers = role === "shadow" ? topLevel(value, ",") : [value];
        for (const layer of layers) {
          const words = topLevel(layer, " ");
          if (role === "shadow" && !words.includes("inset")) continue;
          const word = words.reverse().find((w) => colorOf(w));
          if (!word) continue;
          const color = overridden(selectors, prop) || colorOf(word);
          if (translucent(color)) continue;
          pairs.push({
            name: rule.selector + " { " + prop + ": " + value + " }",
            kind: "non-text",
            fg: color,
            bg: hc.background,
          });
        }
      }
    }
  }
  const selection = rules.find((r) => r.selector === "::selection");
  assert.ok(selection, "the stylesheet has a ::selection rule");
  const selectionBg = selection.declarations.find(([p]) => p === "background");
  pairs.push({
    name: "::selection text on the selection background",
    kind: "text",
    fg: overridden(["::selection"], "color") || theme.themeColor("#c9cdd7", HC),
    bg: opaque(colorOf(selectionBg[1]), hc.background),
  });
  return { pairs, roles, undefinedTokens, defined, overrides, rules };
}

function describePair(r) {
  return (
    r.name +
    " = " +
    r.fg +
    " on " +
    r.bg +
    ": " +
    round2(r.ratio) +
    " (needs " +
    r.required +
    ")"
  );
}

test("contrast-ratio derived: every text, border and control color the stylesheets draw in High Contrast is measured on the real themeColor output and meets WCAG 2.x", () => {
  const scan = scanStylesheets();
  // The :root block defines exactly the 472 colors applyTheme re-colors.
  assert.deepEqual(
    [...scan.defined].sort(),
    sourceColors.map((s) => s.slice(1).toLowerCase()).sort(),
  );
  // Four colors are used by the stylesheets but defined nowhere, so they are not themed in any theme (a finding of this phase; they cannot be measured).
  assert.deepEqual([...scan.undefinedTokens].sort(), [
    "91b4ec",
    "98e2c2",
    "dfc28e",
    "ed929d",
  ]);
  const results = checkPairs(scan.pairs);
  assert.ok(results.filter((r) => r.kind === "text").length >= 250);
  assert.ok(results.filter((r) => r.kind === "non-text").length >= 100);
  const failing = results.filter((r) => !r.pass);
  assert.equal(
    failing.length,
    0,
    failing.length +
      " pair(s) under their WCAG threshold in High Contrast. Use var(--line) or var(--muted), or, for a color used only for borders, add it to highContrastBorders in src/themes.ts:\n" +
      failing.map(describePair).join("\n"),
  );
});

test("contrast-ratio fix: a color used only for borders that sat under 3:1 now draws the theme's border color, in High Contrast only, and every other High Contrast color is as it was", () => {
  const scan = scanStylesheets();
  const hc = theme.themes[HC];
  const sources = new Set(sourceColors.map((s) => s.toLowerCase()));
  const roles = [...scan.roles].filter(([token]) => sources.has("#" + token));
  const borderOnly = new Set(
    roles
      .filter(([, set]) => set.size === 1 && set.has("border"))
      .map(([token]) => "#" + token),
  );
  // The same palette under another id: the code High Contrast ran before this phase.
  theme.themes["hc-before"] = { ...hc };
  try {
    let fixed = 0;
    let kept = 0;
    for (const accent of ACCENTS)
      for (const source of sourceColors) {
        const before = theme.themeColor(source, "hc-before", accent);
        const dim =
          borderOnly.has(source.toLowerCase()) &&
          contrastRatio(before, hc.background) < 3;
        assert.equal(
          theme.themeColor(source, HC, accent),
          dim ? hc.line : before,
          source + " with accent " + accent,
        );
        if (dim) fixed += 1;
        else kept += 1;
      }
    assert.ok(fixed >= 50 * ACCENTS.length, "fixed " + fixed);
    assert.ok(kept > 400 * ACCENTS.length, "kept " + kept);
    // A color that is also a background keeps its value (a hover color must stay dark) and is fixed by a rule for the one selector instead.
    const mixed = roles
      .filter(
        ([token, set]) => set.has("border") && !borderOnly.has("#" + token),
      )
      .map(([token]) => "#" + token)
      .filter(
        (c) =>
          contrastRatio(theme.themeColor(c, "hc-before"), hc.background) < 3,
      );
    for (const color of ["#2a2d36", "#333640"]) {
      assert.ok(
        mixed.includes(color),
        color + " is used for more than borders",
      );
      assert.equal(
        theme.themeColor(color, HC),
        theme.themeColor(color, "hc-before"),
      );
    }
  } finally {
    delete theme.themes["hc-before"];
  }
  // The inserted High Contrast rules, read back from the stylesheet.
  const get = (selector, prop) =>
    scan.overrides.get(selector) && scan.overrides.get(selector).get(prop);
  assert.equal(get("kbd", "border-color"), hc.line);
  assert.equal(get(".sidebar-footer", "border-color"), hc.line);
  assert.equal(get("::selection", "color"), BLACK);
  assert.equal(get(".window-controls button:last-child:hover", "color"), BLACK);
  // Why those two text rules exist: without them the text sat on a light highlight at 1.25:1 and 1.83:1.
  const highlight = theme.themeColor("#3f6255", HC);
  const closeHover = theme.themeColor("#b54754", HC);
  const bodyText = theme.themeColor("#c9cdd7", HC);
  assert.equal(round2(contrastRatio(bodyText, highlight)), 1.25);
  assert.equal(round2(contrastRatio("#ffffff", closeHover)), 1.83);
  assert.ok(contrastRatio(BLACK, highlight) > 15);
  assert.ok(contrastRatio(BLACK, closeHover) > 11);
});

test("contrast-ratio terminal: the colors High Contrast hands to the terminal and the editor are measured; the normal ANSI colors, the cursor and the editor text meet WCAG 2.x and the two known exceptions are recorded, not hidden", () => {
  const settings = load("src/settings.ts");
  const prefs = {
    ...settings.defaults,
    "terminal.theme": "inherit",
    "appearance.accent": "theme",
  };
  const hc = theme.themes[HC];
  const terminal = theme.terminalTheme(prefs, HC);
  const editor = theme.editorTheme(prefs, HC);
  const bg = terminal.background;
  const eb = editor.colors["editor.background"];
  assert.equal(bg, hc.panel);
  assert.equal(terminal.foreground, hc.text);
  const text = (name, fg, back) => ({ name, fg, bg: back, kind: "text" });
  const graphic = (name, fg, back) => ({
    name,
    fg,
    bg: back,
    kind: "non-text",
  });
  const pairs = [
    text("terminal text", terminal.foreground, bg),
    ...[
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
    ].map((name) => text("ANSI " + name, terminal[name], bg)),
    graphic("terminal cursor", terminal.cursor, bg),
    text(
      "terminal text on the selection",
      terminal.foreground,
      terminal.selectionBackground,
    ),
    text("editor text", editor.colors["editor.foreground"], eb),
    text(
      "editor line numbers",
      editor.colors["editorLineNumber.foreground"],
      eb,
    ),
    graphic("editor cursor", editor.colors["editorCursor.foreground"], eb),
    graphic(
      "editor widget border",
      editor.colors["editorWidget.border"],
      editor.colors["editorWidget.background"],
    ),
  ];
  const results = checkPairs(pairs);
  assert.deepEqual(
    results.filter((r) => !r.pass).map((r) => r.name),
    [],
  );
  assert.deepEqual(
    Object.fromEntries(results.map((r) => [r.name, round2(r.ratio)])),
    {
      "terminal text": 21,
      "ANSI red": 9.2,
      "ANSI green": 12.81,
      "ANSI yellow": 12.24,
      "ANSI blue": 9.94,
      "ANSI magenta": 9.37,
      "ANSI cyan": 12.43,
      "ANSI white": 15.28,
      "ANSI brightBlack": 5.02,
      "terminal cursor": 15.46,
      "terminal text on the selection": 8.13,
      "editor text": 21,
      "editor line numbers": 13.6,
      "editor cursor": 15.46,
      "editor widget border": 9.07,
    },
  );
  // Known exceptions, measured and left as they are: ANSI black is a background color (the terminal.minimumContrastRatio setting lifts it where a program prints with it), and no WCAG criterion requires a selection highlight; the real look is a HUMAN-UAT check.
  assert.equal(round2(contrastRatio(terminal.black, bg)), 1.34);
  assert.equal(round2(contrastRatio(terminal.selectionBackground, bg)), 2.58);
  // Nothing here is derived by themeColor: High Contrast has no ANSI or syntax palette of its own, so the default ANSI colors and Monaco's own token colors are used and are not measured by this test.
  assert.equal(hc.ansi, undefined);
  assert.equal(hc.syntax, undefined);
  assert.deepEqual(editor.rules, []);
  assert.equal(editor.base, "vs-dark");
});

test("contrast-ratio docs: SETTINGS.md has one High Contrast paragraph, after the theme notes, that says what is measured, the two thresholds, what was changed and what is left to a person", () => {
  const raw = read("SETTINGS.md");
  assert.ok(!/[^\n -~]/.test(raw), "plain ASCII");
  assert.ok(raw.endsWith("\n") && !raw.endsWith("\n\n"), "one final line feed");
  const lines = raw.split("\n");
  const at = lines.findIndex((l) => l.startsWith("High Contrast: "));
  assert.ok(at > 0);
  assert.equal(lines.filter((l) => l.startsWith("High Contrast: ")).length, 1);
  assert.equal(lines[at - 1], "");
  assert.ok(
    lines[at - 2].startsWith(
      "Terminals can follow the app or use any bundled palette",
    ),
    "directly after the last theme note",
  );
  const paragraph = lines[at];
  for (const claim of [
    "its colors are measured, not only chosen by eye",
    "WCAG 2.x",
    "4.5:1 is required for text and 3:1 for borders, controls and the focus ring",
    "Borders that were too dim against its black background are now drawn in the theme's border color",
    "black on the selection highlight and on the hovered window close button",
    "no other theme changed",
    "ANSI black in the terminal (about 1.3:1) and the terminal selection color (about 2.6:1)",
    "terminal.minimumContrastRatio",
    "How the theme looks on a real screen is checked by hand",
  ])
    assert.ok(paragraph.includes(claim), "SETTINGS.md must say: " + claim);
  // The catalog row still names the theme and the older notes are not touched: the host label paragraph is still directly before the follow-up ideas.
  assert.ok(
    raw.includes(
      "| Coordinated themes | HRig Dark, Graphite, Midnight, Daylight, High Contrast, and Follow Windows",
    ),
  );
  const host = lines.findIndex((l) => l.startsWith("Host label and tint: "));
  assert.ok(lines[host + 2].startsWith("## Follow-up ideas"));
  // No setting was added for it.
  assert.ok(
    !lines.some(
      (l) =>
        /^\| `[a-z.]*[cC]ontrast[a-zA-Z.]*` \|/.test(l) &&
        !l.includes("terminal.minimumContrastRatio"),
    ),
  );
});

test("contrast-ratio wiring: the module is pure and used only by its test; High Contrast alone takes the new branch of themeColor; the stylesheet rules sit beside the theme's own rules and nothing is added at the end", () => {
  const moduleText = read("src/contrast-ratio.ts");
  assert.ok(!/[^\n -~]/.test(moduleText), "plain ASCII");
  const codeLines = moduleText
    .split("\n")
    .filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l));
  assert.ok(
    !codeLines.some((l) => /\bimport\b|\brequire\b/.test(l)),
    "no import",
  );
  assert.ok(
    !codeLines.some((l) =>
      /\b(window|document|navigator|fetch|process|localStorage|sessionStorage|setTimeout|setInterval|console)\b|Date\.now|new Date|Math\.random|innerHTML/.test(
        l,
      ),
    ),
    "no page, storage, clock, timer or network",
  );
  const lines = moduleText.split("\n");
  const exported = lines
    .map((l, i) => [l, i])
    .filter(([l]) => l.startsWith("export "));
  assert.equal(exported.length, 10, "four types and six functions");
  for (const [l, i] of exported)
    assert.ok(
      lines[i - 1].trimEnd().endsWith("*/"),
      "a doc comment above: " + l,
    );
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && f !== "contrast-ratio.ts");
  assert.deepEqual(
    files.filter((f) => /from "\.\/contrast-ratio"/.test(read("src/" + f))),
    [],
    "no app file imports the module: it exists for the test",
  );

  // themeColor: one new guard, High Contrast only, after the community themes and before the derived colors.
  const themes = read("src/themes.ts");
  const guard =
    '  }\n  if (id === "high-contrast" && highContrastBorders.has(source.toLowerCase()))\n    return p.line;\n  let color: string;\n';
  assert.equal(themes.split(guard).length - 1, 1);
  assert.equal(themes.split('id === "high-contrast"').length - 1, 1);
  assert.equal(themes.split("highContrastBorders").length - 1, 2);
  assert.ok(
    themes.includes(
      'export function themeColor(source: string, id: ThemeId, accent = "theme") {',
    ),
    "signature unchanged",
  );
  const list = /const highContrastBorders = new Set\(\[\n([\s\S]*?)\]\);/.exec(
    themes,
  );
  assert.ok(list);
  const entries = list[1].split("\n").filter(Boolean);
  assert.ok(entries.length >= 50);
  for (const entry of entries)
    assert.ok(/^ {2}"#[0-9a-f]{6}",$/.test(entry), entry);
  assert.equal(new Set(entries).size, entries.length, "no color twice");
  assert.deepEqual(
    fs
      .readdirSync(path.join(root, "src"))
      .filter(
        (f) =>
          /\.(ts|tsx)$/.test(f) && read("src/" + f).includes('"high-contrast"'),
      )
      .sort(),
    ["theme-catalog.ts", "themes.ts"],
  );
  assert.ok(
    themes.includes('themeColor(source, id, p["appearance.accent"]),'),
    "applyTheme still re-colors every source through themeColor",
  );

  // styles.css: the new rules are one block, directly after the theme's own focus ring rule and before the next rule, with no important flag.
  const css = read("src/styles.css");
  const block =
    ':root[data-theme="high-contrast"] :focus-visible {\n  outline: 2px solid #ffffff;\n  outline-offset: 2px;\n}\n/* High Contrast: the two borders whose color is also a background elsewhere, and the text on the two light highlights. */\n:root[data-theme="high-contrast"] kbd,\n:root[data-theme="high-contrast"] .sidebar-footer {\n  border-color: var(--line);\n}\n:root[data-theme="high-contrast"] ::selection {\n  color: #000000;\n}\n:root[data-theme="high-contrast"] .window-controls button:last-child:hover {\n  color: #000000;\n}\n\n.theme-collection h4 {';
  assert.equal(css.split(block).length - 1, 1);
  assert.ok(
    css.includes(
      ':root[data-theme="high-contrast"] {\n  --line: #9cacbf;\n  --muted: #c6d1e0;\n}\n:root[data-theme="high-contrast"] input,\n:root[data-theme="high-contrast"] select,\n:root[data-theme="high-contrast"] textarea,\n:root[data-theme="high-contrast"] .theme-picker > button {\n  border-color: var(--line);\n}\n:root[data-theme="high-contrast"] :focus-visible {',
    ),
    "the theme's own rules are as they were",
  );
  assert.ok(css.split(':root[data-theme="high-contrast"]').length - 1 >= 10);
  assert.ok(!/!important/.test(block));
  assert.ok(
    css
      .trimEnd()
      .endsWith(
        ".terminal-size.terminal-output-counter {\n  left: 12px;\n  transform: none;\n  animation: none;\n}",
      ),
    "the output counter rule is still the last rule",
  );
  assert.equal(css.split("{").length, css.split("}").length, "braces balance");
});
