const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const settings = (() => {
  const entry = "src/settings.ts";
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(entry, module);
  mod._compile(built.outputFiles[0].text, path.join(root, entry));
  return mod.exports;
})();

// T18 is PARTIAL on purpose: the paragraph is the whole deliverable, so these tests pin what it says, that what it says about the repository is true, and that nothing else was added behind it.
test("terminal-ligatures note: TERMINALS.md has one design note paragraph that says what a ligature toggle would need, its risks and that nothing is implemented, and every fact it states about the repository is true", () => {
  const doc = read("TERMINALS.md");
  assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"));
  const lines = doc.split("\n");
  const at = lines.findIndex((line) =>
    line.startsWith(
      "Font ligatures in terminals are not available as a setting",
    ),
  );
  assert.ok(at > 0, "TERMINALS.md has the paragraph");
  assert.equal(
    lines.filter((line) => /ligature/i.test(line)).length,
    1,
    "exactly one paragraph is about ligatures",
  );
  const para = lines[at];
  assert.ok(!/[^ -~]/.test(para), "ASCII on one line");
  assert.ok(lines[at - 1] === "" && lines[at + 1] === "", "blank lines around");
  assert.ok(
    lines[at - 2].startsWith(
      "The terminal.minimumContrastRatio setting keeps terminal text readable",
    ),
    "right after the minimum contrast paragraph",
  );
  assert.ok(
    lines[at + 2].startsWith(
      "The terminal.macOptionIsMeta setting is for macOS only",
    ),
    "right before the Option key paragraph",
  );
  for (const part of [
    "this paragraph is a design note, not a feature",
    "nothing about terminal text changes",
    "there is no ligature setting on purpose",
    "a switch with nothing behind it would only mislead",
    "editor.fontLigatures applies to code editors and diffs only and has no effect in a terminal",
    "Cascadia Code, the first font of the default terminal.fontFamily",
    "has not been checked on screen",
    "HRig neither promises it nor changes it",
    "(1) the @xterm/addon-ligatures package, which is not installed",
    "the terminal dependencies are @xterm/xterm, @xterm/addon-fit, @xterm/addon-search and @xterm/addon-web-links",
    "a new dependency that needs approval, a lockfile and audit review and a check of the signed packages",
    "(2) loading it on each terminal after the terminal is opened, again after every reconnect",
    "removing it when the switch is turned off",
    "(3) keeping it away from a GPU renderer: HRig loads no renderer addon today",
    "adding a WebGL renderer later would mean testing or skipping the addon",
    "(4) a way for the addon to read the font",
    "locates and parses the font file on disk with Node APIs",
    "Node integration off, context isolation on and the sandbox on (electron/main.cjs)",
    "a reviewed bridge through the preload or the main process, or another method, has to be designed first",
    "(5) a font that really contains ligatures and is installed on the computer",
    "Cascadia Code, Fira Code and JetBrains Mono do; Cascadia Mono and Consolas do not",
    "the switch would silently do nothing",
    "Risks to settle before any of that",
    "xterm 4 and later with the default canvas renderer, so support for xterm 6 must be proven first",
    "whether the cursor, the selection and the search highlights stay aligned across a ligature",
    "the extra cost of every repaint",
    "Status: partial, documented only; enabling ligatures in terminals waits for a dependency decision.",
  ])
    assert.ok(para.includes(part), "the note must say: " + part);

  // The facts it states about the repository.
  const pkg = JSON.parse(read("package.json"));
  const deps = Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  });
  for (const name of [
    "@xterm/xterm",
    "@xterm/addon-fit",
    "@xterm/addon-search",
    "@xterm/addon-web-links",
  ])
    assert.ok(deps.includes(name), name + " is a dependency");
  assert.deepEqual(
    deps.filter((name) => name.startsWith("@xterm/")).sort(),
    [
      "@xterm/addon-fit",
      "@xterm/addon-search",
      "@xterm/addon-web-links",
      "@xterm/xterm",
    ],
    "the xterm packages are exactly the four the note lists",
  );
  assert.ok(
    settings.defaults["terminal.fontFamily"].startsWith('"Cascadia Code"'),
    "Cascadia Code is the first default terminal font",
  );
  const editorRow = settings.schema.find(
    (r) => r.key === "editor.fontLigatures",
  );
  assert.equal(editorRow.category, "Editor");
  assert.equal(settings.defaults["editor.fontLigatures"], false);
  const main = read("electron/main.cjs");
  assert.ok(main.includes("nodeIntegration: false"));
  assert.ok(main.includes("contextIsolation: true"));
  assert.ok(main.includes("sandbox: true"));
  assert.ok(
    !/nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false/.test(
      main,
    ),
  );
  const srcDir = path.join(root, "src");
  for (const name of fs.readdirSync(srcDir).filter((n) => /\.tsx?$/.test(n)))
    assert.ok(
      !/addon-webgl|addon-canvas|WebglAddon|CanvasAddon/.test(
        read("src/" + name),
      ),
      name + " loads no renderer addon",
    );
});

test("terminal-ligatures guard: no ligature dependency, no terminal ligature setting and no code behind the note", () => {
  const pkgText = read("package.json");
  assert.ok(
    !/ligature/i.test(pkgText),
    "package.json names no ligature package",
  );
  const lock = fs.existsSync(path.join(root, "package-lock.json"))
    ? read("package-lock.json")
    : "";
  assert.ok(
    !/addon-ligatures|font-ligatures|font-finder/.test(lock),
    "the lockfile has no ligature package",
  );
  // The only ligature setting is the editor one.
  const names = [
    ...Object.keys(settings.defaults),
    ...settings.schema.map((row) => row.key),
  ].filter((key) => /ligature/i.test(key));
  assert.deepEqual([...new Set(names)], ["editor.fontLigatures"]);
  assert.ok(
    !settings.schema.some(
      (row) =>
        row.category === "Terminal" &&
        /ligature/i.test(row.key + row.label + row.description),
    ),
    "no Terminal row mentions ligatures",
  );
  const doc = read("SETTINGS.md");
  assert.ok(
    !doc
      .split("\n")
      .some(
        (line) => line.startsWith("| `terminal.") && /ligature/i.test(line),
      ),
    "SETTINGS.md has no terminal ligature row",
  );
  // Nothing in the code that draws terminals refers to ligatures.
  const srcDir = path.join(root, "src");
  const mentioning = fs
    .readdirSync(srcDir)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => /ligature/i.test(read("src/" + name)))
    .sort();
  assert.deepEqual(mentioning, ["EditorPanel.tsx", "settings.ts"]);
  assert.ok(!/ligature/i.test(read("src/TerminalPanel.tsx")));
  assert.ok(!/ligature/i.test(read("src/TerminalTools.tsx")));
  assert.ok(
    !/addon-ligatures|LigaturesAddon/.test(read("src/TerminalPanel.tsx")),
  );
});
