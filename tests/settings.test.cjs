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
