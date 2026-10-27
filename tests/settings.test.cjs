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
