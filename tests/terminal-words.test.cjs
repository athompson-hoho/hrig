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
const words = load("src/terminal-words.ts");
const {
  sanitizeWordSeparator,
  isValidWordSeparator,
  DEFAULT_WORD_SEPARATOR,
  MAX_WORD_SEPARATOR_LENGTH,
} = words;

const KEY = "terminal.wordSeparator";
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
function ch(code) {
  return String.fromCharCode(code);
}
const astral = String.fromCodePoint(0x1f600);

test("terminal.words tracer: the default is xterm's own, a stored list with braces and a semicolon resolves, and TerminalPanel assigns it through sanitizeWordSeparator in the preferences effect without a remount", () => {
  assert.equal(settings.defaults[KEY], DEFAULT_WORD_SEPARATOR);
  assert.equal(settings.resolveSettings()[KEY], DEFAULT_WORD_SEPARATOR);
  const custom = " \"'{}<>;-";
  const stored = JSON.parse(JSON.stringify({ [KEY]: custom }));
  const safe = settings.safeOverrides(stored);
  assert.deepEqual(
    safe,
    { [KEY]: custom },
    "braces, angle brackets and a semicolon must pass the validator (the key-scoped branch replaces the generic text rule)",
  );
  assert.equal(settings.resolveSettings(safe)[KEY], custom);
  assert.equal(sanitizeWordSeparator(custom), custom);
  assert.deepEqual(
    settings.safeOverrides({ [KEY]: DEFAULT_WORD_SEPARATOR }),
    { [KEY]: DEFAULT_WORD_SEPARATOR },
    "typing the default list back into Settings must not be an error",
  );
  const corrupt = {
    "the number 5": 5,
    "the boolean true": true,
    "empty text": "",
    "text with a line feed": "a" + ch(10) + "b",
  };
  for (const [name, value] of Object.entries(corrupt)) {
    const result = settings.safeOverrides({ [KEY]: value });
    assert.deepEqual(
      result,
      {},
      "a corrupt stored value must be dropped: " + name,
    );
    assert.equal(settings.resolveSettings(result)[KEY], DEFAULT_WORD_SEPARATOR);
  }

  const panel = tight(read("src/TerminalPanel.tsx"));
  const importStatement =
    'import { sanitizeWordSeparator } from "./terminal-words";';
  assert.ok(
    panel.includes(importStatement),
    "TerminalPanel must import sanitizeWordSeparator from ./terminal-words",
  );
  const statement =
    'term.options.wordSeparator = sanitizeWordSeparator(preferences["terminal.wordSeparator"]);';
  const at = panel.indexOf(statement);
  assert.ok(
    at >= 0,
    "TerminalPanel must assign the sanitized setting to term.options.wordSeparator",
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

test("terminal.words sanitizeWordSeparator keeps printable text, drops control characters and line breaks, caps at 64 characters and falls back to the default", () => {
  const notStrings = [
    ["undefined", undefined],
    ["null", null],
    ["5", 5],
    ["0", 0],
    ["NaN", NaN],
    ["true", true],
    ["false", false],
    ["an empty object", {}],
    ["an array", [" "]],
    ["a bigint", 7n],
    ["a symbol", Symbol("x")],
    ["a function", () => " "],
    ["a String object", new String(" ")],
  ];
  for (const [name, value] of notStrings) {
    assert.equal(
      sanitizeWordSeparator(value),
      DEFAULT_WORD_SEPARATOR,
      "not a string gives the default: " + name,
    );
  }

  const unchanged = [
    ["a lone space", " "],
    ["a dash", "-"],
    ["dot and slash", "./"],
    ["space, double quote and single quote", " \"'"],
    ["the default", DEFAULT_WORD_SEPARATOR],
    ["the default plus extras", DEFAULT_WORD_SEPARATOR + "-./:@="],
    ["braces, angle brackets and a semicolon", "{};<>"],
    [
      "the default plus typographic characters",
      DEFAULT_WORD_SEPARATOR + ch(0x2500) + ch(0x2018) + ch(0x2019),
    ],
    ["one astral character", astral],
    ["64 ASCII characters", "x".repeat(64)],
    ["64 astral characters", astral.repeat(64)],
  ];
  for (const [name, value] of unchanged) {
    assert.equal(sanitizeWordSeparator(value), value, "unchanged: " + name);
  }

  const stripped = [
    ["a line feed inside", "a" + ch(10) + "b", "ab"],
    ["CR and LF between a space and a dash", " " + ch(13) + ch(10) + "-", " -"],
    ["tabs around a dot", ch(9) + "." + ch(9), "."],
    ["NUL around x", ch(0) + "x" + ch(0), "x"],
    ["DEL around a dot", ch(0x7f) + "." + ch(0x7f), "."],
    ["C1 controls around a dot", ch(0x85) + "." + ch(0x9f), "."],
    [
      "line and paragraph separators around a dot",
      ch(0x2028) + "." + ch(0x2029),
      ".",
    ],
  ];
  for (const [name, value, expected] of stripped) {
    assert.equal(sanitizeWordSeparator(value), expected, "stripped: " + name);
  }

  const emptied = [
    ["only tab, CR and LF", ch(9) + ch(13) + ch(10)],
    ["only line and paragraph separators", ch(0x2028) + ch(0x2029)],
    ["empty text", ""],
  ];
  for (const [name, value] of emptied) {
    assert.equal(
      sanitizeWordSeparator(value),
      DEFAULT_WORD_SEPARATOR,
      "nothing left gives the default: " + name,
    );
  }

  assert.equal(sanitizeWordSeparator("x".repeat(65)), "x".repeat(64));
  assert.equal(sanitizeWordSeparator("x".repeat(1000)), "x".repeat(64));
  assert.equal(sanitizeWordSeparator(astral.repeat(70)), astral.repeat(64));
  assert.equal(
    sanitizeWordSeparator(ch(10).repeat(100) + "y".repeat(64)),
    "y".repeat(64),
    "control characters are dropped before the cap is counted",
  );

  const mixed = [
    "",
    " ",
    DEFAULT_WORD_SEPARATOR,
    "a" + ch(10) + "b",
    "x".repeat(200),
    astral.repeat(100),
    ch(0) + astral + ch(0x2028) + "q".repeat(80),
    ch(0xd83d),
    ch(9),
  ];
  for (const value of mixed) {
    const once = sanitizeWordSeparator(value);
    assert.equal(sanitizeWordSeparator(once), once, "idempotent for a mix");
    const count = Array.from(once).length;
    assert.ok(count >= 1 && count <= 64, "between 1 and 64 code points");
  }

  assert.equal(isValidWordSeparator(DEFAULT_WORD_SEPARATOR), true);
  assert.equal(isValidWordSeparator(" "), true);
  assert.equal(isValidWordSeparator("x".repeat(64)), true);
  assert.equal(isValidWordSeparator(astral.repeat(64)), true);
  assert.equal(isValidWordSeparator(""), false);
  assert.equal(isValidWordSeparator("a" + ch(10) + "b"), false);
  assert.equal(isValidWordSeparator("x".repeat(65)), false);
  assert.equal(isValidWordSeparator(astral.repeat(65)), false);
  assert.equal(isValidWordSeparator(5), false);
  assert.equal(isValidWordSeparator(null), false);

  for (let code = 0; code <= 0xffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const refused =
      (code >= 0 && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029;
    assert.equal(
      isValidWordSeparator(ch(code)),
      !refused,
      "validity of the single character 0x" + code.toString(16),
    );
  }
});

test("terminal.words default matches the installed xterm, empty text cannot mean no separators there, and the module stays pure", () => {
  assert.equal(MAX_WORD_SEPARATOR_LENGTH, 64);
  const expected = [
    0x20, 0x28, 0x29, 0x5b, 0x5d, 0x7b, 0x7d, 0x27, 0x2c, 0x22, 0x60,
  ]
    .map((code) => ch(code))
    .join("");
  assert.equal(DEFAULT_WORD_SEPARATOR, expected);

  const xterm = read("node_modules/@xterm/xterm/lib/xterm.mjs");
  const literal = /wordSeparator:("(?:[^"\\]|\\.)*")/.exec(xterm);
  assert.ok(
    literal,
    "the installed xterm must still declare a wordSeparator default",
  );
  assert.equal(
    JSON.parse(literal[1]),
    DEFAULT_WORD_SEPARATOR,
    "the setting default must equal the installed xterm default so behavior is unchanged",
  );
  assert.ok(
    /case\s*"wordSeparator"\s*:\s*(\w+)\s*\|\|\s*\(\s*\1\s*=\s*\w+\[/.test(
      xterm,
    ),
    "the installed xterm must still replace empty text with its default, which is why empty text is never a valid setting",
  );
  const typings = read("node_modules/@xterm/xterm/typings/xterm.d.ts");
  assert.ok(typings.includes("wordSeparator?: string;"));
  assert.ok(/double click to select/.test(typings));

  const source = stripComments(read("src/terminal-words.ts"));
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

test("terminal.words has exactly one application site, leaves the xterm construction alone and sends nothing", () => {
  const files = sourceFiles();
  const text = (name) => read("src/" + name);
  assert.deepEqual(
    files.filter((f) => text(f).includes("options.wordSeparator")),
    ["TerminalPanel.tsx"],
  );
  const panelRaw = text("TerminalPanel.tsx");
  assert.equal(panelRaw.split("options.wordSeparator").length - 1, 1);
  assert.deepEqual(
    files.filter((f) => text(f).includes('"./terminal-words"')).sort(),
    ["TerminalPanel.tsx", "settings.ts"],
  );
  assert.deepEqual(
    files.filter((f) => text(f).includes('"terminal.wordSeparator"')).sort(),
    ["TerminalPanel.tsx", "settings.ts"],
  );
  assert.ok(
    tight(text("settings.ts")).includes(
      'key === "terminal.wordSeparator" ? !isValidWordSeparator(v)',
    ),
    "the validator must hand this one key to isValidWordSeparator instead of the generic text rule",
  );
  const panel = collapse(panelRaw);
  const start = panel.indexOf("new Terminal(");
  assert.ok(start >= 0);
  const block = panel.slice(start, panel.indexOf("});", start));
  assert.ok(block.length > 100, "the xterm construction block must be found");
  assert.ok(
    !block.includes("wordSeparator"),
    "xterm starts at its own default, which is the setting default, and the preferences effect is the only writer",
  );
});
