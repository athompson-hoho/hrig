const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
function bundled(file) {
  const result = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(file, module);
  mod._compile(result.outputFiles[0].text, file);
  return mod.exports;
}
const settings = bundled("src/settings.ts");
const theme = bundled("src/themes.ts");
test("community themes preserve official anchors, syntax palettes, full ANSI colors, and independent terminal selection", () => {
  const ids = [
    "catppuccin-mocha",
    "catppuccin-macchiato",
    "catppuccin-frappe",
    "catppuccin-latte",
    "nord",
    "dracula",
    "tokyo-night",
    "gruvbox-dark",
  ];
  const luminance = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const id of ids) {
    const p = theme.themes[id];
    assert.ok(p);
    settings.validateOverrides({
      "appearance.theme": id,
      "terminal.theme": id,
      "appearance.accent": "theme",
    });
    assert.equal(Object.keys(p.ansi).length, 16);
    const terminal = theme.terminalTheme(
      { ...settings.defaults, "terminal.theme": id },
      "hrig-dark",
    );
    assert.equal(terminal.background, p.panel);
    assert.equal(terminal.red, p.ansi.red);
    assert.equal(theme.themeColor("#14161b", id, "theme"), p.panel);
    const editor = theme.editorTheme(settings.defaults, id);
    assert.equal(editor.colors["editor.background"], p.panel);
    assert.equal(
      editor.rules.find((r) => r.token === "keyword").foreground,
      p.syntax.keyword.slice(1),
    );
    const a = luminance(p.panel),
      b = luminance(p.muted);
    assert.ok(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
      id + " UI secondary contrast",
    );
  }
  assert.equal(theme.themes["catppuccin-mocha"].panel, "#1e1e2e");
  assert.equal(theme.themes.nord.panel, "#2e3440");
  assert.equal(theme.themes.dracula.syntax.keyword, "#ff79c6");
  assert.equal(theme.themes.dracula.ansi.brightRed, "#ff6e6e");
  assert.equal(theme.themes["catppuccin-latte"].dark, false);
  assert.equal(theme.themeColor("#a0e3c2", "dracula", "theme"), "#bd93f9");
});
test("settings preserve explicit project defaults while rejecting unknown, unsafe, and out-of-range imports", () => {
  assert.equal(
    settings.resolveSettings(
      { "editor.fontSize": 20 },
      { "editor.fontSize": 13 },
    )["editor.fontSize"],
    13,
  );
  assert.deepEqual(
    settings.validateOverrides({ "notifications.desktop": false }),
    { "notifications.desktop": false },
  );
  for (const value of [
    { "editor.fontSize": 999 },
    { "editor.fontSize": "13" },
    { "editor.tabSize": 2.5 },
    { "terminal.localShell": "arbitrary.exe" },
    { "appearance.theme": "missing" },
    { "editor.fontFamily": "font; color:red" },
    { "not.real": true },
  ])
    assert.throws(() => settings.validateOverrides(value));
  assert.throws(() =>
    settings.validateOverrides(JSON.parse('{"__proto__":{"polluted":true}}')),
  );
  assert.deepEqual(
    settings.safeOverrides({ "appearance.theme": "missing" }),
    {},
  );
  assert.equal(settings.resolveSettings()["terminal.autoReconnect"], true);
  assert.notEqual(
    settings.projectKey("wsl", "/app"),
    settings.projectKey("ssh", "/app"),
  );
});
test("theme palettes resolve system appearance and preserve default colors without invalid CSS values", () => {
  assert.equal(
    theme.themeId({ ...settings.defaults, "appearance.theme": "system" }, true),
    "hrig-dark",
  );
  assert.equal(
    theme.themeId(
      { ...settings.defaults, "appearance.theme": "system" },
      false,
    ),
    "light",
  );
  assert.equal(theme.themeColor("#14161b", "hrig-dark", "mint"), "#14161b");
  for (const id of Object.keys(theme.themes))
    for (const color of ["#14161b", "#c9cdd7", "#a0e3c2", "#ffffff0d", "#0003"])
      assert.match(theme.themeColor(color, id, "blue"), /^#[0-9a-f]{3,8}$/i);
  const p = { ...settings.defaults, "terminal.theme": "light" };
  assert.equal(theme.terminalTheme(p, "midnight").background, "#ffffff");
});

test("editor model paths keep Unix and Windows project roots opaque to worker path normalization", () => {
  const { editorModelPath } = bundled("src/editor-uri.ts");
  for (const root of [
    "/tmp/project",
    "C:\\Users\\example",
    "/tmp/project with spaces",
  ]) {
    const result = editorModelPath({
      connection: { id: "native", kind: "local" },
      root,
      path: "src/main.ts",
    });
    assert.ok(!result.includes("//"));
    assert.ok(result.endsWith("/src/main.ts"));
    assert.notEqual(
      result,
      editorModelPath({
        connection: { id: "other", kind: "local" },
        root,
        path: "src/main.ts",
      }),
    );
  }
});
test("terminal.copyOnSelect is an opt-in boolean Terminal setting that rejects non-booleans", () => {
  const key = "terminal.copyOnSelect";
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of [true, false]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of ["true", "yes", 1, 0, null, {}]) {
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  }
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
});
test("terminal.confirmMultilinePaste is an opt-in boolean Terminal setting that rejects non-booleans", () => {
  const key = "terminal.confirmMultilinePaste";
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of [true, false]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of ["true", "yes", 1, 0, null, {}]) {
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  }
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
});
test("terminal.showSizeOnResize is an on-by-default boolean Terminal setting that rejects non-booleans", () => {
  const key = "terminal.showSizeOnResize";
  assert.equal(settings.defaults[key], true);
  assert.equal(settings.resolveSettings()[key], true);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of [true, false]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of ["true", "yes", 1, 0, null, {}]) {
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  }
  assert.equal(settings.resolveSettings({ [key]: false })[key], false);
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
});
const fs = require("node:fs");
const path = require("node:path");
const srcDir = path.join(__dirname, "..", "src");
function readSrc(file) {
  return fs.readFileSync(path.join(srcDir, file), "utf8");
}
function collapsedTerminalPanel() {
  return readSrc("TerminalPanel.tsx").replace(/\s+/g, " ");
}
test("terminal.cursor tracer: defaults keep the blinking bar, a stored override resolves, and TerminalPanel maps the resolved values onto xterm live", () => {
  assert.equal(settings.defaults["terminal.cursorStyle"], "bar");
  assert.equal(settings.defaults["terminal.cursorBlink"], true);
  assert.equal(settings.resolveSettings()["terminal.cursorStyle"], "bar");
  assert.equal(settings.resolveSettings()["terminal.cursorBlink"], true);
  const stored = JSON.parse(
    '{"terminal.cursorStyle":"underline","terminal.cursorBlink":false}',
  );
  const resolved = settings.resolveSettings(settings.safeOverrides(stored));
  assert.equal(resolved["terminal.cursorStyle"], "underline");
  assert.equal(resolved["terminal.cursorBlink"], false);
  const corrupt = JSON.parse('{"terminal.cursorStyle":"beam"}');
  assert.deepEqual(settings.safeOverrides(corrupt), {});
  assert.equal(
    settings.resolveSettings(settings.safeOverrides(corrupt))[
      "terminal.cursorStyle"
    ],
    "bar",
  );
  const source = collapsedTerminalPanel();
  const styleStatement =
    'term.options.cursorStyle = preferences["terminal.cursorStyle"] as "bar" | "block" | "underline";';
  const blinkStatement =
    'term.options.cursorBlink = preferences["terminal.cursorBlink"] && !preferences["appearance.reduceMotion"];';
  assert.ok(
    source.includes(styleStatement),
    "the cursor shape must come from the effective terminal.cursorStyle preference",
  );
  assert.ok(
    source.includes(blinkStatement),
    "the cursor may blink only when terminal.cursorBlink is on and appearance.reduceMotion is off",
  );
  const afterBlink = source.slice(
    source.indexOf(blinkStatement) + blinkStatement.length,
  );
  const deps = /\}, \[([^\]]*)\]\);/.exec(afterBlink);
  assert.ok(deps, "the preferences effect must end with a dependency list");
  assert.ok(
    deps[1]
      .split(",")
      .map((entry) => entry.trim())
      .includes("preferences"),
    "the effect must re-run when the effective preferences change",
  );
});
test("terminal.cursorStyle is a bar-by-default Terminal select of exactly bar, block and underline that rejects anything else", () => {
  const key = "terminal.cursorStyle";
  assert.equal(settings.defaults[key], "bar");
  assert.equal(settings.resolveSettings()[key], "bar");
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.deepEqual(
    rows[0].options.map((option) => option.value),
    ["bar", "block", "underline"],
  );
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of ["bar", "block", "underline"]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of [
    "Bar",
    "BLOCK",
    "beam",
    "line",
    "",
    " ",
    " bar",
    "block ",
    "bar;",
  ]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Unsupported option for terminal\.cursorStyle/,
    );
  }
  for (const value of [true, 1, 0, null, {}, ["bar"]]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Wrong value type for terminal\.cursorStyle/,
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: "beam" }), {});
  assert.equal(settings.resolveSettings({ [key]: "block" })[key], "block");
  assert.equal(
    settings.resolveSettings({ [key]: "block" }, { [key]: "underline" })[key],
    "underline",
  );
  assert.equal(
    settings.resolveSettings({ [key]: "block" }, { [key]: "bar" })[key],
    "bar",
  );
});
test("terminal.cursorBlink is an on-by-default boolean Terminal setting that rejects non-booleans", () => {
  const key = "terminal.cursorBlink";
  assert.equal(settings.defaults[key], true);
  assert.equal(settings.resolveSettings()[key], true);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of [true, false]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of ["true", "false", "yes", "", 1, 0, null, {}, []]) {
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  }
  assert.equal(settings.resolveSettings({ [key]: false })[key], false);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
});
test("terminal.cursor xterm starts at the defaults and TerminalPanel is its only construction site", () => {
  const source = collapsedTerminalPanel();
  assert.ok(
    source.includes(
      `cursorBlink: ${settings.defaults["terminal.cursorBlink"]},`,
    ),
    "xterm must start with the default blink value",
  );
  assert.ok(
    source.includes(
      `cursorStyle: "${settings.defaults["terminal.cursorStyle"]}",`,
    ),
    "xterm must start with the default cursor style",
  );
  const constructors = fs
    .readdirSync(srcDir)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => readSrc(name).includes("new Terminal("));
  assert.deepEqual(constructors, ["TerminalPanel.tsx"]);
});
test("terminal.bellStyle is a none-by-default Terminal select of exactly none and visual that rejects anything else", () => {
  const key = "terminal.bellStyle";
  assert.equal(settings.defaults[key], "none");
  assert.equal(settings.resolveSettings()[key], "none");
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.deepEqual(
    rows[0].options.map((option) => option.value),
    ["none", "visual"],
  );
  assert.equal(rows[0].min, undefined);
  assert.equal(rows[0].max, undefined);
  for (const value of ["none", "visual"]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of [
    "None",
    "VISUAL",
    "notification",
    "sound",
    "audible",
    "",
    " ",
    " none",
    "visual ",
    "visual;",
  ]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Unsupported option for terminal\.bellStyle/,
      `${JSON.stringify(value)} must be rejected`,
    );
  }
  for (const value of [true, 1, 0, null, {}, ["none"]]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Wrong value type for terminal\.bellStyle/,
      `${JSON.stringify(value)} must be rejected`,
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: "notification" }), {});
  assert.equal(settings.resolveSettings({ [key]: "visual" })[key], "visual");
  assert.equal(
    settings.resolveSettings({ [key]: "visual" }, { [key]: "none" })[key],
    "none",
  );
  assert.equal(
    settings.resolveSettings({ [key]: "none" }, { [key]: "visual" })[key],
    "visual",
  );
});
test("terminal.bellStyle leaves the existing bell notification setting alone and both are documented", () => {
  const bellStyle = settings.schema.find(
    (row) => row.key === "terminal.bellStyle",
  );
  const notification = settings.schema.find(
    (row) => row.key === "notifications.terminalBell",
  );
  assert.ok(notification);
  assert.equal(notification.category, "Notifications");
  assert.equal(notification.options, undefined);
  assert.equal(settings.defaults["notifications.terminalBell"], false);
  for (const option of bellStyle.options) {
    assert.doesNotMatch(option.value, /notif/i);
  }
  assert.ok(
    bellStyle.description.includes(notification.label),
    "the bell style description must point to the Terminal bell alerts setting",
  );
  const both = settings.resolveSettings({
    "terminal.bellStyle": "visual",
    "notifications.terminalBell": true,
  });
  assert.equal(both["terminal.bellStyle"], "visual");
  assert.equal(both["notifications.terminalBell"], true);
  const doc = fs.readFileSync(path.join(srcDir, "..", "SETTINGS.md"), "utf8");
  const row = doc
    .split("\n")
    .find((line) => line.startsWith("| `terminal.bellStyle` | `none` |"));
  assert.ok(
    row,
    "SETTINGS.md must have a terminal.bellStyle row with default none",
  );
  assert.ok(row.includes("`visual`"));
  assert.ok(row.includes("`notifications.terminalBell`"));
  assert.ok(
    doc.includes("Terminal bell: `terminal.bellStyle`"),
    "SETTINGS.md must record why notification is not a value of terminal.bellStyle",
  );
});
test("terminal.minimumContrastRatio is a 1-by-default Terminal number from 1 to 21 in steps of 0.5 that rejects anything else", () => {
  const key = "terminal.minimumContrastRatio";
  assert.equal(settings.defaults[key], 1);
  assert.equal(settings.resolveSettings()[key], 1);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Terminal");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].min, 1);
  assert.equal(rows[0].max, 21);
  assert.equal(rows[0].step, 0.5);
  for (const ok of [1, 1.5, 3, 4.5, 7, 12.5, 21]) {
    assert.deepEqual(settings.validateOverrides({ [key]: ok }), { [key]: ok });
  }
  for (const bad of [
    0,
    0.5,
    0.99,
    -1,
    21.01,
    22,
    100,
    NaN,
    Infinity,
    -Infinity,
  ]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: bad }),
      /Value out of range for terminal\.minimumContrastRatio/,
      "the value " + String(bad) + " must be out of range",
    );
  }
  for (const bad of ["4.5", "", true, null, {}, [4.5]]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: bad }),
      /Wrong value type for terminal\.minimumContrastRatio/,
      "the value " + JSON.stringify(bad) + " must be the wrong type",
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: 22 }), {});
  assert.deepEqual(settings.safeOverrides({ [key]: "4.5" }), {});
  assert.equal(settings.resolveSettings({ [key]: 4.5 })[key], 4.5);
  assert.equal(settings.resolveSettings({ [key]: 4.5 }, { [key]: 7 })[key], 7);
  assert.equal(settings.resolveSettings({ [key]: 4.5 }, { [key]: 1 })[key], 1);
});
test("terminal.minimumContrastRatio is one of exactly two numeric settings that accept fractions", () => {
  const accepting = [];
  for (const [key, value] of Object.entries(settings.defaults)) {
    if (typeof value !== "number") continue;
    const row = settings.schema.find((r) => r.key === key);
    assert.ok(row, key + " must have a schema row");
    try {
      settings.validateOverrides({ [key]: (row.min ?? 0) + 0.5 });
      accepting.push(key);
    } catch {}
  }
  assert.deepEqual(
    accepting.sort(),
    ["terminal.lineHeight", "terminal.minimumContrastRatio"],
    "only terminal.lineHeight and terminal.minimumContrastRatio may take non-integer values and every other number must stay an integer",
  );
});
test("terminal.minimumContrastRatio is documented in SETTINGS.md and TERMINALS.md", () => {
  const root = path.join(srcDir, "..");
  const settingsDoc = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  const row = settingsDoc
    .split("\n")
    .find((line) =>
      line.startsWith("| `terminal.minimumContrastRatio` | `1` |"),
    );
  assert.ok(
    row,
    "SETTINGS.md must have a terminal.minimumContrastRatio row with default 1",
  );
  assert.ok(row.includes("from 1 to 21"));
  assert.ok(row.includes("Backgrounds are never changed"));
  const terminalsDoc = fs.readFileSync(path.join(root, "TERMINALS.md"), "utf8");
  const paragraph = terminalsDoc
    .split("\n")
    .find((line) => line.startsWith("The terminal.minimumContrastRatio"));
  assert.ok(
    paragraph,
    "TERMINALS.md must have a paragraph about terminal.minimumContrastRatio",
  );
  for (const fragment of [
    "from 1 to 21",
    "steps of 0.5",
    "the default, 1,",
    "4.5",
    "WCAG",
    "background colors are never changed",
    "no reconnect and no restart",
  ]) {
    assert.ok(
      paragraph.includes(fragment),
      "TERMINALS.md must mention: " + fragment,
    );
  }
});
