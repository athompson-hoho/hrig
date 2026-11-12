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
test("terminal.macOptionIsMeta tracer: the default is off, a stored true resolves and TerminalPanel assigns it to xterm in the preferences effect without a remount", () => {
  const key = "terminal.macOptionIsMeta";
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const stored = settings.safeOverrides(
    JSON.parse('{"terminal.macOptionIsMeta":true}'),
  );
  assert.deepEqual(stored, { [key]: true });
  assert.equal(settings.resolveSettings(stored)[key], true);
  for (const text of [
    '{"terminal.macOptionIsMeta":"true"}',
    '{"terminal.macOptionIsMeta":1}',
  ]) {
    const corrupt = settings.safeOverrides(JSON.parse(text));
    assert.deepEqual(corrupt, {}, text + " must be dropped");
    assert.equal(
      settings.resolveSettings(corrupt)[key],
      false,
      text + " must fall back to false",
    );
  }
  const source = collapsedTerminalPanel();
  const statement =
    'term.options.macOptionIsMeta = preferences["terminal.macOptionIsMeta"];';
  const at = source.indexOf(statement);
  assert.ok(
    at >= 0 && source.indexOf(statement, at + 1) < 0,
    "the preferences effect must assign the setting to xterm exactly once",
  );
  assert.equal(
    source.split("macOptionIsMeta").length - 1,
    2,
    "xterm starts at its own default of false, which is the setting default, so the preferences effect is the only writer",
  );
  const before = source.slice(0, at);
  const effect = before.slice(before.lastIndexOf("useEffect("));
  assert.ok(
    effect.includes("const term = terminalRef.current; if (!term) return;"),
    "the assignment must sit in the effect that updates the existing terminal",
  );
  assert.ok(
    !effect.includes("new Terminal("),
    "the assignment must not sit in the effect that creates the terminal",
  );
  const after = source.slice(at + statement.length);
  const deps = /\}, \[([^\]]*)\]\);/.exec(after);
  assert.ok(deps, "the preferences effect must end with a dependency list");
  const names = (list) => list.split(",").map((entry) => entry.trim());
  assert.ok(
    names(deps[1]).includes("preferences"),
    "the effect must re-run when the effective preferences change",
  );
  const creation = /new Terminal\([\s\S]*?\}, \[([^\]]*)\]\);/.exec(source);
  assert.ok(creation, "the creation effect must have a dependency list");
  assert.ok(
    names(creation[1]).includes("attempt") &&
      names(creation[1]).includes("config.terminalId"),
  );
  assert.ok(
    !names(creation[1]).includes("preferences"),
    "changing the setting must never rebuild or re-attach the terminal",
  );
});
test("terminal.macOptionIsMeta is an off-by-default boolean Terminal setting, labelled macOS only, that rejects non-booleans and follows project-over-user precedence", () => {
  const key = "terminal.macOptionIsMeta";
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const rows = settings.schema.filter((r) => r.key === key);
  assert.equal(rows.length, 1, "exactly one schema row");
  const row = rows[0];
  assert.equal(row.category, "Terminal");
  for (const field of ["options", "min", "max", "step"]) {
    assert.equal(row[field], undefined, "a boolean row has no " + field);
  }
  assert.ok(row.label.includes("macOS"), "the label must say macOS");
  assert.ok(
    row.description.startsWith("macOS only"),
    "the description must open with macOS only",
  );
  assert.ok(row.description.includes("no effect on Windows or Linux"));
  assert.deepEqual(settings.validateOverrides({ [key]: true }), {
    [key]: true,
  });
  assert.deepEqual(settings.validateOverrides({ [key]: false }), {
    [key]: false,
  });
  for (const value of ["true", "false", "yes", "on", "", 1, 0, null, {}, []]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Wrong value type for terminal\.macOptionIsMeta/,
      JSON.stringify(value) + " must be rejected",
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: "true" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(settings.resolveSettings({ [key]: true }, {})[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  const typings = fs.readFileSync(
    path.join(
      srcDir,
      "..",
      "node_modules",
      "@xterm",
      "xterm",
      "typings",
      "xterm.d.ts",
    ),
    "utf8",
  );
  assert.ok(
    typings.includes("macOptionIsMeta?: boolean;"),
    "the installed xterm must still expose macOptionIsMeta as a boolean option",
  );
  assert.ok(
    typings.includes("Whether to treat option as the meta key."),
    "the installed xterm must still document macOptionIsMeta as Option acting as Meta",
  );
});
test("terminal.macOptionIsMeta is not undermined by the key handlers: Option and Alt chords pass through classifyTerminalKey on macOS and the app and terminal handlers leave them to xterm", () => {
  const keys = bundled("src/terminal-keys.ts");
  const { classifyTerminalKey, terminalOwnsKey } = keys;
  const event = (key, mods = {}) => ({
    type: "keydown",
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  const chars = [
    "b",
    "f",
    "d",
    "B",
    "F",
    "v",
    "c",
    "k",
    "K",
    ".",
    "1",
    "`",
    " ",
    "Backspace",
    "ArrowLeft",
    "ArrowRight",
    "Enter",
    "Escape",
    "Dead",
    "∫",
    "ƒ",
    "∂",
    "å",
  ];
  const modifierSets = [
    {},
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { metaKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, metaKey: true },
  ];
  for (const platform of ["darwin", "win32", "linux"]) {
    for (const hasSelection of [false, true]) {
      for (const key of chars) {
        for (const mods of modifierSets) {
          const chord = { ...mods, altKey: true };
          assert.equal(
            classifyTerminalKey(event(key, chord), platform, hasSelection),
            "pass",
            platform +
              " Option or Alt chord " +
              JSON.stringify(key) +
              " " +
              JSON.stringify(chord) +
              " (selection " +
              hasSelection +
              ") must pass to xterm",
          );
        }
      }
    }
  }
  assert.equal(
    classifyTerminalKey(event("f", { metaKey: true }), "darwin", false),
    "find",
  );
  assert.equal(
    classifyTerminalKey(event("v", { metaKey: true }), "darwin", false),
    "paste",
  );
  assert.equal(
    classifyTerminalKey(event("c", { metaKey: true }), "darwin", true),
    "copy",
  );
  assert.equal(
    classifyTerminalKey(event("k", { metaKey: true }), "darwin", false),
    "clear",
  );
  const target = {
    closest: (selector) =>
      selector === keys.TERMINAL_PANEL_SELECTOR ? {} : null,
  };
  assert.equal(
    terminalOwnsKey(event("k", { metaKey: true }), "darwin", target),
    true,
  );
  assert.equal(
    terminalOwnsKey(
      event("k", { metaKey: true, altKey: true }),
      "darwin",
      target,
    ),
    false,
  );
  assert.equal(
    terminalOwnsKey(event("b", { altKey: true }), "darwin", target),
    false,
  );
  const collapse = (file) => readSrc(file).replace(/\s+/g, " ");
  const tools = collapse("TerminalTools.tsx");
  assert.equal(
    tools.split("attachCustomKeyEventHandler(").length - 1,
    1,
    "TerminalTools.tsx must install exactly one custom key handler",
  );
  assert.ok(
    tools.includes('if (action === "pass") return true;'),
    "a pass result must return true so xterm still receives the key",
  );
  const handlerFiles = fs
    .readdirSync(srcDir)
    .filter(
      (file) =>
        fs.statSync(path.join(srcDir, file)).isFile() &&
        readSrc(file).includes("attachCustomKeyEventHandler("),
    );
  assert.deepEqual(
    handlerFiles,
    ["TerminalTools.tsx"],
    "no other file directly in src may install a custom key handler",
  );
  assert.ok(
    collapse("App.tsx").includes(
      "if (event.defaultPrevented || event.isComposing || event.altKey) return;",
    ),
    "the app shortcut handler must ignore every Alt or Option key press",
  );
});
test("terminal.macOptionIsMeta is documented in SETTINGS.md and TERMINALS.md", () => {
  const root = path.join(srcDir, "..");
  const settingsDoc = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  const row = settingsDoc
    .split("\n")
    .find((line) =>
      line.startsWith("| `terminal.macOptionIsMeta` | `false` |"),
    );
  assert.ok(
    row,
    "SETTINGS.md must have a terminal.macOptionIsMeta row with default false",
  );
  for (const fragment of [
    "macOS only",
    "no effect on Windows or Linux",
    "Option+B and Option+F",
    "special characters",
  ]) {
    assert.ok(
      row.includes(fragment),
      "SETTINGS.md row must mention: " + fragment,
    );
  }
  const terminalsDoc = fs.readFileSync(path.join(root, "TERMINALS.md"), "utf8");
  const paragraph = terminalsDoc
    .split("\n")
    .find((line) => line.startsWith("The terminal.macOptionIsMeta"));
  assert.ok(
    paragraph,
    "TERMINALS.md must have a paragraph about terminal.macOptionIsMeta",
  );
  for (const fragment of [
    "for macOS only",
    "off by default",
    "Option+B and Option+F",
    "no longer types special characters",
    "such as @ and brackets on a German keyboard",
    "On Windows and Linux the setting has no effect",
    "no reconnect and no restart",
    "nothing is typed or sent unless you press a key",
  ]) {
    assert.ok(
      paragraph.includes(fragment),
      "TERMINALS.md must mention: " + fragment,
    );
  }
});
test("terminal.wordSeparator is a Terminal text setting that defaults to xterm's own list and accepts any printable list of up to 64 characters but not empty text, control characters or longer text", () => {
  const key = "terminal.wordSeparator";
  const words = bundled("src/terminal-words.ts");
  const ch = (code) => String.fromCharCode(code);
  const astral = String.fromCodePoint(0x1f600);
  assert.equal(settings.defaults[key], words.DEFAULT_WORD_SEPARATOR);
  assert.equal(settings.resolveSettings()[key], words.DEFAULT_WORD_SEPARATOR);
  const rows = settings.schema.filter((s) => s.key === key);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Terminal");
  assert.equal(row.label, "Word separators");
  assert.equal(row.options, undefined);
  assert.equal(row.min, undefined);
  assert.equal(row.max, undefined);
  assert.equal(row.step, undefined);
  for (const fragment of [
    "double-click",
    "xterm's own",
    "Up to 64 characters",
    "Keep a space in the list",
    "nothing is sent to the shell or the seat",
  ]) {
    assert.ok(
      row.description.includes(fragment),
      "the description must mention: " + fragment,
    );
  }

  const accepted = [
    ["the default", words.DEFAULT_WORD_SEPARATOR],
    ["a lone space", " "],
    ["a dash", "-"],
    ["space, double quote and single quote", " \"'"],
    ["space, comma, semicolon, braces and angle brackets", " ,;{}<>"],
    ["brackets", "()[]{}"],
    ["64 ASCII characters", "x".repeat(64)],
    ["64 astral characters", astral.repeat(64)],
    ["typographic characters", ch(0x2500) + ch(0x2018) + ch(0x2019)],
  ];
  for (const [name, value] of accepted) {
    assert.deepEqual(
      settings.validateOverrides({ [key]: value }),
      { [key]: value },
      "must be accepted: " + name,
    );
  }
  const invalid = [
    ["empty text", ""],
    ["a lone line feed", ch(10)],
    ["a line feed inside", "a" + ch(10) + "b"],
    ["a carriage return inside", "a" + ch(13) + "b"],
    ["a lone tab", ch(9)],
    ["NUL", ch(0)],
    ["DEL", ch(0x7f)],
    ["a C1 control", ch(0x85)],
    ["a line separator", ch(0x2028)],
    ["a paragraph separator", ch(0x2029)],
    ["65 ASCII characters", "x".repeat(65)],
    ["65 astral characters", astral.repeat(65)],
  ];
  for (const [name, value] of invalid) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Invalid text for terminal\.wordSeparator/,
      "must be refused: " + name,
    );
  }
  const wrongType = [1, 0, true, false, null, undefined, {}, [], [" "]];
  for (const value of wrongType) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      /Wrong value type for terminal\.wordSeparator/,
      "must be refused as the wrong type: " + JSON.stringify(value),
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: "" }), {});
  assert.deepEqual(settings.safeOverrides({ [key]: 5 }), {});
  assert.equal(settings.resolveSettings({ [key]: "-" })[key], "-");
  assert.equal(settings.resolveSettings({ [key]: "-" }, {})[key], "-");
  assert.equal(
    settings.resolveSettings({ [key]: "-" }, { [key]: " " })[key],
    " ",
  );
  assert.equal(
    settings.resolveSettings({}, { [key]: words.DEFAULT_WORD_SEPARATOR })[key],
    words.DEFAULT_WORD_SEPARATOR,
  );
});
test("terminal.wordSeparator relaxes the text rule for its own key only, and the Settings page edits it as plain text", () => {
  const key = "terminal.wordSeparator";
  const others = settings.schema.filter(
    (s) =>
      s.key !== key &&
      typeof settings.defaults[s.key] === "string" &&
      !s.options,
  );
  assert.ok(others.length >= 4, "the free-text settings must be found");
  const samples = [
    ["a;b", "a;b"],
    ["a{b}", "a{b}"],
    ["a<b>", "a<b>"],
    ["a lone space", " "],
    ["empty text", ""],
    ["a line feed inside", "a" + String.fromCharCode(10) + "b"],
    ["301 x characters", "x".repeat(301)],
  ];
  for (const other of others) {
    for (const [name, value] of samples) {
      assert.throws(
        () => settings.validateOverrides({ [other.key]: value }),
        (error) => error.message === "Invalid text for " + other.key,
        other.key + " must keep the generic text rule for " + name,
      );
    }
  }
  const page = readSrc("SettingsPage.tsx").replace(/\s+/g, " ");
  assert.ok(
    !page.includes("wordSeparator"),
    "the Settings page must render this setting with the generic text row, with no special case",
  );
  assert.ok(
    page.includes('type={typeof value === "number" ? "number" : "text"}'),
    "a string setting must render as a text input",
  );
  assert.ok(
    page.includes("? Number(draft) : NaN : draft,"),
    "a text draft must be committed exactly as typed because the default list starts with a space",
  );
});
test("terminal.wordSeparator is documented in SETTINGS.md and TERMINALS.md", () => {
  const root = path.join(srcDir, "..");
  const settingsDoc = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  const row = settingsDoc
    .split("\n")
    .find((line) =>
      line.startsWith(
        "| `terminal.wordSeparator` | space, `()[]{}',\"` and backtick |",
      ),
    );
  assert.ok(
    row,
    "SETTINGS.md must have a terminal.wordSeparator row showing the default list",
  );
  for (const fragment of [
    "double-click",
    "the default is xterm's own list",
    "Up to 64 characters",
    "cannot be empty",
    "Keep a space in the list",
    "a space, a double quote and a single quote",
    "Applies at once",
    "nothing is sent to the shell or the seat",
  ]) {
    assert.ok(
      row.includes(fragment),
      "SETTINGS.md row must mention: " + fragment,
    );
  }
  const terminalsDoc = fs.readFileSync(path.join(root, "TERMINALS.md"), "utf8");
  const paragraph = terminalsDoc
    .split("\n")
    .find((line) => line.startsWith("The terminal.wordSeparator"));
  assert.ok(
    paragraph,
    "TERMINALS.md must have a paragraph about terminal.wordSeparator",
  );
  for (const fragment of [
    "double-click",
    "xterm's own list",
    "so nothing changes until you edit it",
    "a space, a double quote and a single quote",
    "up to 64 characters",
    "it cannot be empty",
    "Keep a space in the list",
    "can be set for all projects or overridden for one project",
    "no reconnect and no restart",
    "nothing is typed or sent",
  ]) {
    assert.ok(
      paragraph.includes(fragment),
      "TERMINALS.md must mention: " + fragment,
    );
  }
});
test("terminal.copyTrimTrailingWhitespace is an off-by-default boolean Terminal setting that sits next to Copy on select, rejects non-booleans and follows project-over-user precedence", () => {
  const key = "terminal.copyTrimTrailingWhitespace";
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Terminal");
  assert.equal(row.label, "Trim trailing spaces on copy");
  for (const field of ["options", "min", "max", "step"]) {
    assert.equal(row[field], undefined, field);
  }
  const keys = settings.schema.map((r) => r.key);
  assert.equal(keys.indexOf(key), keys.indexOf("terminal.copyOnSelect") + 1);
  for (const fragment of [
    "spaces and tabs at the end of each line",
    "Copy output",
    "Copy on select",
    "Line breaks",
    "leading spaces",
    "blank lines",
    "Off by default",
    "leave it off when trailing blanks matter",
    "Applies at once",
    "nothing is sent to the shell or the seat",
    "Paste and Export are unchanged",
  ]) {
    assert.ok(
      row.description.includes(fragment),
      "description must mention: " + fragment,
    );
  }
  assert.deepEqual(settings.validateOverrides({ [key]: true }), {
    [key]: true,
  });
  assert.deepEqual(settings.validateOverrides({ [key]: false }), {
    [key]: false,
  });
  for (const bad of ["true", "false", "yes", "on", "", 1, 0, null, {}, []]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: bad }),
      /Wrong value type for terminal\.copyTrimTrailingWhitespace/,
      JSON.stringify(bad),
    );
  }
  assert.deepEqual(settings.safeOverrides({ [key]: "true" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(settings.resolveSettings({ [key]: true }, {})[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  assert.equal(settings.defaults["terminal.copyOnSelect"], false);
  assert.equal(settings.defaults["terminal.confirmMultilinePaste"], false);
  const page = readSrc("SettingsPage.tsx").replace(/\s+/g, " ");
  assert.ok(
    page.includes(
      'typeof value === "boolean" ? ( <label className="setting-toggle">',
    ),
    "a boolean setting renders as a toggle with no UI change",
  );
  assert.ok(
    !page.includes("copyTrim"),
    "SettingsPage.tsx needs no special case for this setting",
  );
});
test("terminal.copyTrimTrailingWhitespace is documented in SETTINGS.md and TERMINALS.md", () => {
  const root = path.join(srcDir, "..");
  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) =>
    line.startsWith("| `terminal.copyTrimTrailingWhitespace` | `false` |"),
  );
  assert.ok(
    at > 0,
    "SETTINGS.md must have a terminal.copyTrimTrailingWhitespace row showing the default false",
  );
  assert.ok(
    lines[at - 1].startsWith("| `terminal.copyOnSelect` |"),
    "the row sits right after terminal.copyOnSelect",
  );
  assert.ok(
    lines[at + 1].startsWith("| `terminal.confirmMultilinePaste` |"),
    "the row sits right before terminal.confirmMultilinePaste",
  );
  for (const fragment of [
    "spaces and tabs at the end of each line",
    "the Copy and Copy output buttons",
    "the keyboard and right-click copy",
    "Copy in the macOS Edit menu",
    "Copy on select",
    "Line breaks, leading spaces, blank lines and spaces inside a line are kept",
    "only spaces and tabs is copied as it is",
    "leave it off when trailing blanks matter",
    "Applies at once",
    "nothing is sent to the shell or the seat",
    "Paste and Export are unchanged",
  ]) {
    assert.ok(
      lines[at].includes(fragment),
      "SETTINGS.md row must mention: " + fragment,
    );
  }
  const terminalsDoc = fs.readFileSync(path.join(root, "TERMINALS.md"), "utf8");
  const paragraph = terminalsDoc
    .split("\n")
    .find((line) =>
      line.startsWith("The terminal.copyTrimTrailingWhitespace setting"),
    );
  assert.ok(
    paragraph,
    "TERMINALS.md must have a paragraph about terminal.copyTrimTrailingWhitespace",
  );
  for (const fragment of [
    "is off by default",
    "exactly as the terminal shows it",
    "remove the spaces and tabs at the end of every line",
    "the Copy button and Copy output in the terminal toolbar",
    "Copy in the right-click menu",
    "Copy in the Edit menu on macOS",
    "Copy on select when terminal.copyOnSelect is on",
    "line breaks, leading spaces, blank lines and spaces inside a line are kept",
    "made only of spaces and tabs is copied as it is",
    "Leave it off when trailing blanks matter, such as a Markdown hard line break",
    "can be set for all projects or overridden for one project",
    "no reconnect and no restart",
    "never what you paste into a terminal",
    "nothing is typed or sent",
    "Exporting terminal output to a file is not changed",
  ]) {
    assert.ok(
      paragraph.includes(fragment),
      "TERMINALS.md must mention: " + fragment,
    );
  }
});
test("shortcuts.overrides is plain text with the generic rule, empty by default, listed once in Workspace and documented in SETTINGS.md", () => {
  const key = "shortcuts.overrides";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], "");
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Workspace");
  assert.equal(rows[0].label, "Shortcut overrides");
  const text =
    "workspace.reopenPanel=Ctrl+Shift+J,workspace.maximizePanel=Ctrl+Shift+Y";
  assert.deepEqual(settings.validateOverrides({ [key]: text }), {
    [key]: text,
  });
  for (const value of ["", "{}", "a;b", "a<b>"]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Invalid text for " + key,
      "the generic text rule for " + JSON.stringify(value),
    );
  }
  assert.equal(settings.resolveSettings({ [key]: text })[key], text);
  assert.equal(settings.resolveSettings()[key], "");
  const doc = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  assert.ok(
    doc.includes("| `" + key + "` | empty |"),
    "SETTINGS.md must have a shortcuts.overrides row with an empty default",
  );
});
test("appearance.statusBarHidden is a text Appearance setting, empty by default, listed once right after Show status bar, under the generic text rule, project over user, and documented in SETTINGS.md", () => {
  const key = "appearance.statusBarHidden";
  const root = path.join(srcDir, "..");
  const items = bundled("src/status-bar-items.ts");
  assert.equal(settings.defaults[key], "");
  assert.equal(settings.defaults["appearance.statusBar"], true);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "appearance.statusBar");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Appearance");
  assert.equal(row.label, "Hidden status bar items");
  assert.equal(row.options, undefined);
  for (const item of items.STATUS_ITEMS)
    assert.ok(row.description.includes(item.id), "the row names " + item.id);
  const text = "sessions, layout";
  assert.deepEqual(settings.validateOverrides({ [key]: text }), {
    [key]: text,
  });
  for (const value of ["", "   ", "a;b", "a<b>", "a{b}", "x".repeat(301)]) {
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Invalid text for " + key,
      "the generic text rule for " + JSON.stringify(value.slice(0, 12)),
    );
  }
  for (const value of [true, 1, null, ["sessions"]])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.equal(
    settings.validateOverrides({ [key]: "x".repeat(300) })[key].length,
    300,
  );
  assert.deepEqual(settings.safeOverrides({ [key]: "" }), {});
  assert.equal(settings.resolveSettings()[key], "");
  assert.equal(
    settings.resolveSettings({ [key]: "sessions" })[key],
    "sessions",
  );
  assert.equal(
    settings.resolveSettings({ [key]: "sessions" }, { [key]: "activity" })[key],
    "activity",
  );
  const doc = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  assert.ok(
    doc.includes("| `" + key + "` | empty |"),
    "SETTINGS.md must have an appearance.statusBarHidden row with an empty default",
  );
});
test("terminal.showOutputCounter is an off-by-default boolean Terminal setting that rejects non-booleans, sits right after terminal.showSizeOnResize and is documented in SETTINGS.md", () => {
  const key = "terminal.showOutputCounter";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "terminal.showSizeOnResize");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Terminal");
  assert.equal(row.label, "Show output counter");
  assert.equal(row.options, undefined);
  assert.equal(row.min, undefined);
  assert.equal(row.max, undefined);
  for (const part of [
    "lines and bytes of output",
    "Off by default",
    "Diagnostics only",
    "never the output text",
    "at most four times a second",
    "sends nothing to the shell or the seat",
  ])
    assert.ok(row.description.includes(part), "the row says: " + part);
  for (const value of [true, false]) {
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  }
  for (const value of ["true", "yes", 1, 0, null, {}]) {
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  }
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) => line.startsWith("| `" + key + "` |"));
  assert.ok(at > 0, "SETTINGS.md must have a terminal.showOutputCounter row");
  assert.ok(lines[at].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at].includes("See TERMINALS.md"));
  assert.ok(
    lines[at - 1].startsWith("| `terminal.showSizeOnResize` | `true` |"),
  );
  assert.ok(lines[at + 1].startsWith("| `terminal.bellStyle` |"));
});
test("notifications.humanItems is an off-by-default Notifications boolean, separate from the desktop notification setting, listed once right after the terminal quiet alerts, resolved user then project, and documented in SETTINGS.md", () => {
  const key = "notifications.humanItems";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Notifications");
  assert.equal(row.label, "Notify about queue items for me");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  for (const part of [
    "addressed to a person",
    "human@host",
    "name@external",
    "Off by default",
    "this setting alone is the opt-in",
    "Read only",
    "never claims, answers or changes an item",
    "sends anything to a seat",
    "80 characters",
    "never an item's text, id or address",
    "do not notify",
  ])
    assert.ok(row.description.includes(part), "the row says: " + part);
  const keys = settings.schema.map((r) => r.key);
  assert.equal(
    keys.indexOf(key),
    keys.indexOf("notifications.terminalQuiet") + 1,
  );
  assert.ok(keys.indexOf(key) < keys.indexOf("shortcuts.overrides"));
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  // Separate from the desktop attention notifications: neither implies the other.
  const only = settings.resolveSettings({ [key]: true });
  assert.equal(only["notifications.desktop"], false);
  const desktop = settings.resolveSettings({ "notifications.desktop": true });
  assert.equal(desktop[key], false);
  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) => line.startsWith("| `" + key + "` |"));
  assert.ok(at > 0, "SETTINGS.md must have a notifications.humanItems row");
  assert.ok(lines[at].startsWith("| `" + key + "` | `false` |"));
  for (const part of [
    "human@host",
    "name@external",
    "separate from `notifications.desktop`",
    "this setting alone is the opt-in",
    "Read only",
    "never claims, answers or changes an item",
    "at most the first item's summary",
    "80 characters",
    "never an item's text, id or address",
    "Items already waiting when you turn the setting on or switch connection do not notify",
    "quiet updates",
    "See TASKS.md",
  ])
    assert.ok(lines[at].includes(part), "SETTINGS.md says: " + part);
  assert.ok(
    lines[at - 1].startsWith("| `notifications.terminalQuiet` | `false` |"),
  );
  assert.ok(lines[at + 1].startsWith("| `shortcuts.overrides` |"));
});
test("appearance.windowTitleDetails is an off-by-default Appearance boolean listed once right after the hidden status bar items, resolved user then project, and documented in SETTINGS.md and NAVIGATION.md", () => {
  const key = "appearance.windowTitleDetails";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Appearance");
  assert.equal(row.label, "Show project and panel in the window title");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  for (const part of [
    "project folder name",
    "active panel's name",
    "Panel - project - hRig",
    "Off by default, so the title stays hRig",
    "100 characters",
    "no file text, seat output, host or secret",
    "Main window only: detached windows keep hRig",
    "The title bar drawn inside HRig does not change",
  ])
    assert.ok(row.description.includes(part), "the row says: " + part);
  const keys = settings.schema.map((r) => r.key);
  assert.equal(keys[keys.indexOf(key) - 1], "appearance.statusBarHidden");
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings()[key], false);
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) => line.startsWith("| `" + key + "` |"));
  assert.ok(
    at > 0,
    "SETTINGS.md must have an appearance.windowTitleDetails row",
  );
  assert.ok(lines[at].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at - 1].startsWith("| `appearance.statusBarHidden` |"));
  for (const part of [
    "`Panel - project - hRig`",
    "Off (the default) keeps the title exactly `hRig`",
    "cut to 100 characters",
    "the main process cleans it again",
    "no file text, seat output, host or secret",
    "detached windows keep `hRig`",
    "the title bar drawn inside HRig is unchanged",
    "See NAVIGATION.md",
  ])
    assert.ok(lines[at].includes(part), "SETTINGS.md says: " + part);
  const doc = lines.join("\n");
  assert.equal(
    doc.split("\nWindow title: `" + key + "` is off by default").length - 1,
    1,
  );
});
test("workspace.restoreLastProject is an off-by-default Workspace boolean listed once right after the refresh interval, read from the user scope, validated as a boolean and documented in SETTINGS.md and NAVIGATION.md", () => {
  const key = "workspace.restoreLastProject";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  const rows = settings.schema.filter((row) => row.key === key);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Workspace");
  assert.equal(row.label, "Reopen the last project on launch");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  for (const part of [
    "most recent project",
    "the same Open project check as a project on the Welcome screen",
    "the folder must exist",
    "Off by default, so HRig starts exactly as before",
    "never reaches a host that launch does not already use",
    "never starts or restarts a seat",
    "never sends anything to a terminal",
    "Read from your user settings only",
  ])
    assert.ok(row.description.includes(part), "the row says: " + part);
  const keys = settings.schema.map((r) => r.key);
  assert.equal(keys[keys.indexOf(key) - 1], "workspace.refreshInterval");
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings()[key], false);
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) => line.startsWith("| `" + key + "` |"));
  assert.ok(at > 0, "SETTINGS.md must have a workspace.restoreLastProject row");
  assert.ok(lines[at].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at - 1].startsWith("| `workspace.refreshInterval` |"));
  for (const part of [
    "open your most recent project if the project it brought back is a different one",
    "Off (the default) starts exactly as before",
    "the Open project check of a project on the Welcome screen",
    "A project on another SSH or WSL connection is not reopened for you",
    "nothing is started, restarted or sent to a terminal",
    "Read from the User scope only; a project override has no effect",
    "See NAVIGATION.md",
  ])
    assert.ok(lines[at].includes(part), "SETTINGS.md says: " + part);
});
test("appearance.seatBadges is an off-by-default Appearance boolean listed once right after the window title setting, validated as a boolean, resolved user then project, and documented in SETTINGS.md and the README", () => {
  const key = "appearance.seatBadges";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "appearance.windowTitleDetails");
  assert.equal(keys[keys.indexOf(key) + 1], "editor.fontSize");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Appearance");
  assert.equal(row.label, "Show runtime and model badges on sessions");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  const claims = [
    "its runtime (Claude, Codex or the name the inventory gives) and its model",
    "Off by default, so the list looks exactly as before",
    "cleaned of control and direction characters",
    "cut to 16 characters for the runtime and 24 for the model",
    "the tooltip keeps up to 80",
    "shows no badge for it",
    "Display only: nothing is sent to the shell or the seat, and nothing is saved",
  ];
  for (const part of claims)
    assert.ok(row.description.includes(part), "the row says: " + part);
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );

  const text = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  assert.ok(!/[^\n -~]/.test(text), "SETTINGS.md is plain ASCII");
  const lines = text.split("\n");
  const rows = lines.filter((line) => line.startsWith("| `" + key + "` |"));
  assert.equal(rows.length, 1);
  const at = lines.indexOf(rows[0]);
  assert.ok(rows[0].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at - 1].startsWith("| `appearance.windowTitleDetails` |"));
  assert.ok(lines[at + 1].startsWith("| `editor.fontSize` |"));
  for (const part of [
    "its runtime (`Claude` or `Codex` for those two, otherwise the name the inventory gives, cut to 16 characters)",
    "its model (cut to 24 characters, with up to 80 in the tooltip)",
    "Off (the default) keeps the list exactly as it was",
    "cleaned of control and direction characters first",
    "only the generic `agent` runtime, shows no badge for it",
    "Display only: nothing is sent to the shell or the seat, and nothing is saved",
  ])
    assert.ok(rows[0].includes(part), "SETTINGS.md row says: " + part);
  // One note paragraph, with the other setting notes: after the Reopen note, directly before the Hide stopped sessions note, before the Terminal bell note.
  const parts = text.split("\n\n");
  const notes = parts.filter((part) =>
    part.startsWith("Seat badges: `appearance.seatBadges`"),
  );
  assert.equal(notes.length, 1);
  const note = notes[0];
  for (const part of [
    "is off by default, and then the sidebar's session list looks exactly as before",
    "up to two small badges: the runtime and the model",
    "`claude-code` is shown as Claude and `codex` as Codex",
    "cut to 16 characters",
    "the generic `agent` runtime, which the inventory fills in when the CLI names none, and an empty model show no badge",
    "The model is cut to 24 characters, and the tooltip of each badge keeps up to 80",
    "it is treated as untrusted",
    "control, zero-width and direction characters are dropped",
    "a very long value is only read in part",
    "drawn as plain text, never as markup",
    "The row's own text (the rig name and the runtime) is unchanged",
    "nothing is sent to the shell or the seat, nothing is saved",
    "User and Project scopes",
  ])
    assert.ok(note.includes(part), "SETTINGS.md says: " + part);
  const place = parts.indexOf(note);
  assert.ok(parts[place - 1].startsWith("Reopen last project: "));
  assert.ok(parts[place + 1].startsWith("Hide stopped sessions: "));
  assert.ok(parts[place + 2].startsWith("Terminal bell: "));
  // The README says it in one clause, and still names TASKS.md once.
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(
    readme.split("show each seat's runtime and model as small badges").length -
      1,
    1,
  );
  assert.equal(readme.split("TASKS.md").length - 1, 1);
});
test("workspace.hideStoppedSeats is an off-by-default Workspace boolean listed once right after the reopen setting, validated as a boolean, read from the user scope, and documented in SETTINGS.md and the README", () => {
  const key = "workspace.hideStoppedSeats";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "workspace.restoreLastProject");
  assert.equal(keys[keys.indexOf(key) + 1], "connections.defaultKind");
  assert.equal(keys[keys.length - 1], "shortcuts.overrides");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Workspace");
  assert.equal(row.label, "Hide stopped sessions in the sidebar");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  const claims = [
    "sessions that have stopped or exited, and the sessions of a rig the inventory calls archived",
    "Off by default, so every session is listed as before",
    "A failed session or one that needs input is never hidden",
    "the count beside SESSIONS reads shown of total",
    "an empty list says how many are hidden, with a button to show them",
    "open panels, the command center, drag and drop and relaunch are as they were",
    "nothing is started, stopped or sent to a seat",
    "Read from your user settings only: a project override has no effect",
  ];
  for (const part of claims)
    assert.ok(row.description.includes(part), "the row says: " + part);
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);

  const text = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  const lines = text.split("\n");
  const rows = lines.filter((line) => line.startsWith("| `" + key + "` |"));
  assert.equal(rows.length, 1);
  const at = lines.indexOf(rows[0]);
  assert.ok(rows[0].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at - 1].startsWith("| `workspace.restoreLastProject` |"));
  assert.ok(lines[at + 1].startsWith("| `connections.defaultKind` |"));
  for (const part of [
    "sessions that have stopped or exited, and the sessions of a rig the inventory calls archived",
    "Off (the default) lists every session as before",
    "A failed session or one that needs input is never hidden",
    "the count beside SESSIONS reads shown of total",
    "has a Show stopped sessions button",
    "open panels, the command center, drag and drop and relaunch are as they were",
    "nothing is started, stopped or sent to a seat",
    "Read from the User scope only; a project override has no effect",
  ])
    assert.ok(rows[0].includes(part), "SETTINGS.md row says: " + part);
  const parts = text.split("\n\n");
  const notes = parts.filter((part) =>
    part.startsWith("Hide stopped sessions: `workspace.hideStoppedSeats`"),
  );
  assert.equal(notes.length, 1);
  const note = notes[0];
  for (const part of [
    "is off by default, and then every session is listed as before",
    "The eye button beside SESSIONS in the sidebar turns it on",
    "the same setting is in Settings under Workspace",
    "a session whose status is stopped or exited",
    "a session of a rig the inventory calls archived",
    "a failed session and one that needs input are never hidden",
    "for example 3 of 5, counted after the rig and the Find a session filter",
    "the list says how many are hidden and has a Show stopped sessions button instead of the empty message",
    "the rig and the filter text stay as they were",
    "panels that are open, the command center, drag and drop and relaunch are as they were",
    "nothing is started, stopped or sent to a seat",
    "the button writes there and a project override has no effect",
  ])
    assert.ok(note.includes(part), "SETTINGS.md says: " + part);
  const place = parts.indexOf(note);
  assert.ok(parts[place - 1].startsWith("Seat badges: "));
  assert.ok(parts[place + 1].startsWith("Terminal bell: "));
  assert.ok(
    place > parts.findIndex((part) => part.startsWith("Window title: ")),
    "after the window title note",
  );
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(
    readme.split(
      "and hide stopped seats from the list; both are off by default",
    ).length - 1,
    1,
  );
});
test("notifications.seatNeedsInputSound is an off-by-default Notifications boolean, separate from the desktop notification setting, listed once right after the queue item setting, validated as a boolean, resolved user then project, and documented in SETTINGS.md", () => {
  const key = "notifications.seatNeedsInputSound";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "notifications.humanItems");
  assert.equal(keys[keys.indexOf(key) + 1], "shortcuts.overrides");
  assert.equal(keys[keys.length - 1], "shortcuts.overrides");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Notifications");
  assert.equal(row.label, "Sound when a seat needs input");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  for (const part of [
    "Play one short, soft tone when a seat newly needs input",
    "Off by default and separate from Desktop attention notifications",
    "this setting alone is the opt-in",
    "whether or not HRig is in front",
    "(no audio file)",
    "lasts under a second",
    "at most once every 10 seconds",
    "already waiting when you turn it on, when HRig starts or when you switch connection",
    "a seat whose session failed with an error",
    "a person's own seat",
    "shows and sends no text and never sends anything to a seat or shell",
  ])
    assert.ok(row.description.includes(part), "the row says: " + part);
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  // Separate from the desktop attention notifications: neither implies the other.
  const only = settings.resolveSettings({ [key]: true });
  assert.equal(only["notifications.desktop"], false);
  assert.equal(
    settings.resolveSettings({ "notifications.desktop": true })[key],
    false,
  );

  // The numbers the documents give are the code's.
  const pure = fs.readFileSync(
    path.join(root, "src/seat-attention.ts"),
    "utf8",
  );
  const tone = fs.readFileSync(
    path.join(root, "src/useSeatNeedsInputSound.ts"),
    "utf8",
  );
  const number = (text, name) =>
    Number(new RegExp("export const " + name + " = ([0-9.]+);").exec(text)[1]);
  const pause = number(pure, "SOUND_COOLDOWN_MS") / 1000;
  const hz = number(tone, "TONE_HZ");
  const seconds = number(tone, "TONE_SECONDS");
  const gain = number(tone, "TONE_GAIN");
  assert.deepEqual([pause, hz, seconds, gain], [10, 880, 0.15, 0.1]);

  const text = fs.readFileSync(path.join(root, "SETTINGS.md"), "utf8");
  assert.ok(!/[^\n -~]/.test(text), "SETTINGS.md is plain ASCII");
  const lines = text.split("\n");
  const rows = lines.filter((line) => line.startsWith("| `" + key + "` |"));
  assert.equal(rows.length, 1);
  const at = lines.indexOf(rows[0]);
  assert.ok(rows[0].startsWith("| `" + key + "` | `false` |"));
  // The row follows the Desktop attention notifications row: tests pin the shortcut overrides row directly after the queue item row.
  assert.ok(lines[at - 1].startsWith("| `notifications.desktop` | `false` |"));
  assert.ok(lines[at + 1].startsWith("| `notifications.terminalBell` |"));
  for (const part of [
    "Play one short, soft tone when a seat newly needs input",
    "Off by default, and separate from `notifications.desktop`: this setting alone is the opt-in",
    "whether or not HRig is in front",
    "(no audio file)",
    "lasts under a second",
    "plays at most once every " + pause + " seconds",
    "already waiting when you turn the setting on, when HRig starts or when you switch connection",
    "a seat whose session failed with an error",
    "a person's own seat",
    "never sends anything to a seat or shell",
    "See Seat sound below.",
  ])
    assert.ok(rows[0].includes(part), "SETTINGS.md row says: " + part);
  // One note paragraph, with the other setting notes: after the window title note, directly before the Reopen last project note.
  const parts = text.split("\n\n");
  const notes = parts.filter((part) =>
    part.startsWith("Seat sound: `notifications.seatNeedsInputSound`"),
  );
  assert.equal(notes.length, 1);
  const note = notes[0];
  assert.ok(!note.includes("\n"), "one line");
  for (const part of [
    "is off by default, and then HRig makes no sound",
    "one short, soft tone when a seat newly needs input",
    "independent of them: either can be on without the other",
    "the attention status, the one the sidebar shows with a seat's status dot",
    "a seat whose startup failed or needs attention, so such a seat can sound too",
    "a session that failed while running (status failed) does not",
    "is only taken in, so seats that are already waiting never sound",
    "a seat that stops waiting and then waits again sounds again",
    "One tone covers any number of seats that change at once",
    "tones are at least " + pause + " seconds apart",
    "sounds at the first refresh after it, if it is still waiting",
    "A person's own seat never sounds",
    "no sound is made while a refresh is failing",
    "one sine tone of " +
      hz +
      " Hz that lasts " +
      seconds +
      " seconds, at a tenth of full volume",
    "there is no audio file and nothing is downloaded",
    "the Activity log says so once",
    "whether or not HRig is in front, as Desktop attention notifications do",
    "so no extra read is made",
    "nothing goes to a seat or shell",
    "User and Project scopes",
  ])
    assert.ok(note.includes(part), "SETTINGS.md says: " + part);
  assert.equal(gain, 0.1, "a tenth of full volume is the gain");
  const place = parts.indexOf(note);
  assert.ok(parts[place - 1].startsWith("Window title: "));
  assert.ok(parts[place + 1].startsWith("Reopen last project: "));
  assert.ok(
    place < parts.findIndex((part) => part.startsWith("Seat badges: ")),
    "with the other setting notes",
  );
});
test("terminal.pasteHistory is an off-by-default Terminal boolean listed once right after the multi-line paste confirmation, resolved user then project, and documented in SETTINGS.md", () => {
  const key = "terminal.pasteHistory";
  const root = path.join(srcDir, "..");
  assert.equal(settings.defaults[key], false);
  assert.equal(settings.resolveSettings()[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "terminal.confirmMultilinePaste");
  const row = settings.schema[keys.indexOf(key)];
  assert.equal(row.category, "Terminal");
  assert.equal(row.label, "Paste history");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  const claims = [
    "Off by default, and then nothing is remembered and the menu item does not exist",
    "last 10 pastes of up to 10,000 characters, in memory only",
    "never saved, logged or exported",
    "never shared with another terminal",
    "gone when you close the terminal, turn this off or close HRig",
    "Pasted text can contain secrets",
    "the clipboard is never read to build the list",
    "Enter is never pressed",
  ];
  for (const part of claims)
    assert.ok(row.description.includes(part), "the row says: " + part);
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [key]: value }), {
      [key]: value,
    });
  for (const value of ["true", "yes", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [key]: value }),
      (error) => error.message === "Wrong value type for " + key,
    );
  assert.deepEqual(settings.safeOverrides({ [key]: "yes" }), {});
  assert.equal(settings.resolveSettings({ [key]: true })[key], true);
  assert.equal(
    settings.resolveSettings({ [key]: true }, { [key]: false })[key],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );

  const lines = fs
    .readFileSync(path.join(root, "SETTINGS.md"), "utf8")
    .split("\n");
  const at = lines.findIndex((line) => line.startsWith("| `" + key + "` |"));
  assert.ok(at > 0, "SETTINGS.md must have a terminal.pasteHistory row");
  assert.equal(
    lines.filter((line) => line.startsWith("| `" + key + "` |")).length,
    1,
  );
  assert.ok(lines[at].startsWith("| `" + key + "` | `false` |"));
  assert.ok(lines[at - 1].startsWith("| `terminal.confirmMultilinePaste` |"));
  assert.ok(lines[at + 1].startsWith("| `terminal.showSizeOnResize` |"));
  for (const part of [...claims, "See TERMINALS.md"])
    assert.ok(lines[at].includes(part), "SETTINGS.md says: " + part);
  assert.ok(!/[^\n -~]/.test(lines[at]), "the row is printable ASCII");
});

test("seat sort settings validate three modes and preserve scope through serialization and reset", () => {
  assert.equal(settings.resolveSettings()["rig.seatSort"], "name");
  const row = settings.schema.find(row => row.key === "rig.seatSort");
  assert.ok(row, "Seat sort order is exposed by the real settings schema");
  assert.equal(row.category, "Connections & rigs");
  assert.equal(row.label, "Seat sort order");
  assert.equal(row.description, "Choose the default sidebar seat order. Activity puts working seats first; it does not use an activity timestamp.");
  assert.deepEqual(row.options, [
    { value: "name", label: "Name" },
    { value: "activity", label: "Activity (working first)" },
    { value: "attention-first", label: "Attention first" },
  ]);
  for (const mode of ["name", "activity", "attention-first"]) {
    const overrides = { "rig.seatSort": mode };
    assert.deepEqual(settings.validateOverrides(overrides), overrides);
    const serialized = JSON.parse(JSON.stringify({ user: overrides, project: { "rig.seatSort": "name" } }));
    const user = settings.safeOverrides(serialized.user);
    const project = settings.safeOverrides(serialized.project);
    assert.equal(settings.resolveSettings(user, project)["rig.seatSort"], "name");
    delete project["rig.seatSort"];
    assert.equal(settings.resolveSettings(user, project)["rig.seatSort"], mode);
  }
});

test("seat sort imports reject unsupported modes and wrong types without applying them", () => {
  for (const value of ["recent", "NAME", "Activity", "attention", "", 1, null, {}, [], true]) {
    assert.throws(() => settings.validateOverrides({ "rig.seatSort": value }));
    assert.deepEqual(settings.safeOverrides({ "rig.seatSort": value }), {});
  }
  assert.throws(() => settings.validateOverrides({ "rig.seatSort": "name", "unknown.sort": "activity" }));
});

test("seat sort Preferences Overrides and SettingKey have a narrow compiler checked contract", () => {
  const ts = require("typescript");
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve("src");
  const fixture = path.join(root, "__seat_sort_contract__.ts");
  const dependencies = path.join(root, "__seat_sort_dependencies__.ts");
  // Compile the real settings contract (and real sorter if present), with only
  // unrelated theme/platform and broad app Seat dependencies substituted. No
  // app program, files emitted, repository tsc, or disk fixture is involved.
  const sources = new Map([[dependencies, `
    export const themes: Record<string, { name: string }> = {};
    export const isWindows: boolean = false;
    export interface Seat { name: string; status: string; }
  `]]);
  const options = { noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  function check(source) {
    sources.set(fixture, source);
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.readFile = file => sources.get(file) ?? readFile(file);
    host.fileExists = file => sources.has(file) || fileExists(file);
    host.resolveModuleNames = (names, containingFile) => names.map(name => {
      let resolvedFileName;
      if (name === "./settings") resolvedFileName = path.join(root, "settings.ts");
      else if (name === "./seat-sort") resolvedFileName = path.join(root, "seat-sort.ts");
      else if (["./theme-catalog", "./platform", "./types"].includes(name)) resolvedFileName = dependencies;
      else return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
      return host.fileExists(resolvedFileName) ? { resolvedFileName, extension: ts.Extension.Ts } : undefined;
    });
    const program = ts.createProgram([fixture], options, host);
    return ts.getPreEmitDiagnostics(program);
  }
  const legal = `import type { Preferences, Overrides, SettingKey } from './settings';
    const key: SettingKey = 'rig.seatSort';
    const modes: Preferences['rig.seatSort'][] = ['name', 'activity', 'attention-first'];
    const overrides: Overrides[] = modes.map(value => ({ 'rig.seatSort': value }));
  `;
  const legalDiagnostics = check(legal);
  assert.deepEqual(legalDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [],
    "all three modes must compile against real Preferences/Overrides/SettingKey");
  const invalid = check(legal + "\nconst unsupported: Preferences['rig.seatSort'] = 'recent';");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].code, 2322, "unsupported mode must fail assignability, not module loading");
  assert.equal(invalid[0].file.fileName, fixture);
  assert.match(ts.flattenDiagnosticMessageText(invalid[0].messageText, "\n"), /recent/);
  assert.equal(fs.existsSync(fixture), false);
  assert.equal(fs.existsSync(dependencies), false);
});
