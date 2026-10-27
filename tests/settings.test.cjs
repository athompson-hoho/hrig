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
