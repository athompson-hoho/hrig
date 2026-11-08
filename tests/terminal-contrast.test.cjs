const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
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

const settings = load("src/settings.ts");
const contrast = load("src/terminal-contrast.ts");
const {
  normalizeContrastRatio,
  MIN_CONTRAST_RATIO,
  MAX_CONTRAST_RATIO,
  DEFAULT_CONTRAST_RATIO,
} = contrast;

const KEY = "terminal.minimumContrastRatio";
const root = path.join(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function collapse(text) {
  return text.replace(/\s+/g, " ");
}
function tight(text) {
  return collapse(text)
    .replace(/\( /g, "(")
    .replace(/(?:, )? ?\)/g, ")");
}
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function sourceFiles() {
  return fs
    .readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => e.name);
}

test("terminal.contrast tracer: the default is 1, a stored 4.5 resolves and reaches xterm through normalizeContrastRatio in the preferences effect without a remount", () => {
  assert.equal(settings.defaults[KEY], 1);
  assert.equal(settings.resolveSettings()[KEY], 1);
  const stored = JSON.parse('{"terminal.minimumContrastRatio":4.5}');
  const safe = settings.safeOverrides(stored);
  assert.deepEqual(
    safe,
    { [KEY]: 4.5 },
    "a fractional ratio must pass the validator (the integer rule needs the exemption for this key)",
  );
  assert.equal(settings.resolveSettings(safe)[KEY], 4.5);
  assert.equal(normalizeContrastRatio(4.5), 4.5);
  assert.equal(normalizeContrastRatio(settings.defaults[KEY]), 1);
  for (const text of [
    '{"terminal.minimumContrastRatio":22}',
    '{"terminal.minimumContrastRatio":0.5}',
    '{"terminal.minimumContrastRatio":"4.5"}',
  ]) {
    const corrupt = settings.safeOverrides(JSON.parse(text));
    assert.deepEqual(
      corrupt,
      {},
      "a corrupt stored value must be dropped: " + text,
    );
    assert.equal(settings.resolveSettings(corrupt)[KEY], 1);
  }

  const panel = tight(read("src/TerminalPanel.tsx"));
  const importStatement =
    'import { normalizeContrastRatio } from "./terminal-contrast";';
  assert.ok(
    panel.includes(importStatement),
    "TerminalPanel must import normalizeContrastRatio from ./terminal-contrast",
  );
  const statement =
    'term.options.minimumContrastRatio = normalizeContrastRatio(preferences["terminal.minimumContrastRatio"]);';
  const at = panel.indexOf(statement);
  assert.ok(
    at >= 0,
    "TerminalPanel must assign the normalized setting to term.options.minimumContrastRatio",
  );
  const before = panel.slice(0, at);
  const cut = before.slice(before.lastIndexOf("useEffect("), at);
  assert.ok(
    cut.includes("const term = terminalRef.current; if (!term) return;"),
    "the assignment must live in the effect that updates the existing terminal",
  );
  assert.ok(
    !cut.includes("new Terminal("),
    "the assignment must not live in the effect that creates the terminal",
  );
  const after = panel.slice(at + statement.length);
  const deps = /\}, \[([^\]]*)\]\);/.exec(after);
  assert.ok(deps, "the update effect must have a dependency list");
  assert.ok(
    deps[1]
      .split(",")
      .map((s) => s.trim())
      .includes("preferences"),
    "the update effect must depend on preferences so the setting applies live",
  );
  const creation = /new Terminal\([\s\S]*?\}, \[([^\]]*)\]\);/.exec(panel);
  assert.ok(creation, "the creation effect must have a dependency list");
  const creationDeps = creation[1].split(",").map((s) => s.trim());
  assert.ok(creationDeps.includes("attempt"));
  assert.ok(creationDeps.includes("config.terminalId"));
  assert.ok(
    !creationDeps.includes("preferences"),
    "changing the setting must never rebuild or re-attach the terminal",
  );
});

test("terminal.contrast normalizeContrastRatio clamps to 1 to 21 and treats anything that is not a finite number as 1", () => {
  for (const v of [1, 1.5, 2, 4.5, 7, 10.25, 20.9, 21]) {
    assert.equal(
      normalizeContrastRatio(v),
      v,
      "in range stays unchanged: " + v,
    );
  }
  for (const v of [
    0.99,
    0.5,
    0,
    -0,
    -1,
    -21,
    -1e9,
    Number.MIN_VALUE,
    -Number.MAX_VALUE,
  ]) {
    assert.equal(normalizeContrastRatio(v), 1, "below range gives 1: " + v);
  }
  for (const v of [21.0000001, 21.5, 22, 100, 1e9, Number.MAX_VALUE]) {
    assert.equal(normalizeContrastRatio(v), 21, "above range gives 21: " + v);
  }
  const garbage = [
    NaN,
    Infinity,
    -Infinity,
    "4.5",
    "7",
    "",
    " ",
    null,
    undefined,
    true,
    false,
    {},
    [],
    [4.5],
    7n,
    new Number(4.5),
  ];
  for (const v of garbage) {
    assert.equal(
      normalizeContrastRatio(v),
      1,
      "a " + typeof v + " value must give 1: " + String(v),
    );
  }
  let previous = -Infinity;
  for (let v = -5; v <= 30; v += 0.25) {
    const out = normalizeContrastRatio(v);
    assert.ok(Number.isFinite(out) && out >= 1 && out <= 21, "range for " + v);
    assert.equal(normalizeContrastRatio(out), out, "idempotent for " + v);
    assert.ok(out >= previous, "monotonic at " + v);
    previous = out;
  }
});

test("terminal.contrast constants match the schema row and xterm's documented range, and the module stays pure", () => {
  assert.equal(MIN_CONTRAST_RATIO, 1);
  assert.equal(MAX_CONTRAST_RATIO, 21);
  assert.equal(DEFAULT_CONTRAST_RATIO, 1);
  assert.equal(settings.defaults[KEY], DEFAULT_CONTRAST_RATIO);
  const rows = settings.schema.filter((s) => s.key === KEY);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.category, "Terminal");
  assert.equal(row.options, undefined);
  assert.equal(row.min, MIN_CONTRAST_RATIO);
  assert.equal(row.max, MAX_CONTRAST_RATIO);
  assert.equal(row.step, 0.5);

  const typings = read("node_modules/@xterm/xterm/typings/xterm.d.ts");
  assert.ok(
    typings.includes("minimumContrastRatio?: number;"),
    "the installed xterm must still expose the minimumContrastRatio option",
  );
  assert.ok(
    typings.includes("- 1: The default, do nothing."),
    "the installed xterm default must still equal the setting default",
  );
  assert.ok(
    typings.includes("- 21: White on black or black on white."),
    "the installed xterm maximum must still equal the setting maximum",
  );

  const source = stripComments(read("src/terminal-contrast.ts"));
  for (const [name, pattern] of [
    ["import", /\bimport\b/],
    ["require", /\brequire\b/],
    ["window", /window/],
    ["document", /document/],
    ["React", /React/],
    ["xterm", /xterm/i],
    ["Terminal", /\bTerminal\b/],
    ["Date", /Date/],
    ["performance", /performance/],
    ["Math.random", /Math\.random/],
    ["export default", /export default/],
  ]) {
    assert.ok(
      !pattern.test(source),
      "the module must stay pure: it must not use " + name,
    );
  }
});

test("terminal.contrast has exactly one application site, leaves the xterm construction alone and sends nothing", () => {
  const files = sourceFiles();
  const text = (name) => read("src/" + name);
  assert.deepEqual(
    files.filter((f) => text(f).includes("options.minimumContrastRatio")),
    ["TerminalPanel.tsx"],
  );
  const panelRaw = text("TerminalPanel.tsx");
  assert.equal(panelRaw.split("options.minimumContrastRatio").length - 1, 1);
  assert.deepEqual(
    files.filter((f) => text(f).includes('"./terminal-contrast"')),
    ["TerminalPanel.tsx"],
  );
  assert.deepEqual(
    files
      .filter((f) => text(f).includes('"terminal.minimumContrastRatio"'))
      .sort(),
    ["TerminalPanel.tsx", "settings.ts"],
  );
  const panel = collapse(panelRaw);
  const start = panel.indexOf("new Terminal(");
  assert.ok(start >= 0);
  const block = panel.slice(start, panel.indexOf("});", start));
  assert.ok(block.length > 100, "the xterm construction block must be found");
  assert.ok(
    !block.includes("minimumContrastRatio"),
    "xterm starts at its own default of 1, which is the setting default, and the preferences effect is the only writer",
  );
});
