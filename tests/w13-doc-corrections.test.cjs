const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) =>
  fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("W13-11 documentation matches the existing terminal and search behavior", () => {
  const navigation = read("NAVIGATION.md");
  assert.ok(navigation.includes("zero-width joiner stays for joined emoji"),
    "NAVIGATION must say U+200D stays for joined emoji");

  const terminalGuide = read("TERMINALS.md");
  assert.ok(/renderer-supplied text from the current terminal's retained scrollback/i.test(terminalGuide),
    "the canonical terminal guide must identify renderer-supplied scrollback");
  assert.ok(terminalGuide.includes("32 MiB"), "the save limit must be documented");

  const terminalRenderer = read("src/TerminalTools.tsx");
  assert.ok(terminalRenderer.includes("window.hrig.saveTerminalLog({ id: terminalId, text })"),
    "the renderer sends the text to the save channel");
  assert.ok(/text is supplied by the renderer from retained scrollback/i.test(
    read("docs/terminal-file-drop.md"),
  ), "the file-drop guide must retain the renderer provenance note");
  const oscDesign = read("docs/terminal-prompt-scroll.md");
  assert.ok(/returned `IDisposable`.*dispose.*terminal view/i.test(oscDesign),
    "the OSC design must require disposal of each registration");

  const searchView = read("src/content-search-view.ts");
  assert.ok(searchView.includes("options object is always sent"),
    "the UI always sends search options");
  const searchGuide = read("docs/content-search.md");
  assert.ok(!/With every option off/i.test(searchGuide),
    "the guide must not imply the options object is absent");
  assert.ok(/UI sends an options object on every search, including when all optional controls are off/i.test(searchGuide),
    "the guide must describe the always-sent options object");
  assert.ok(/literal and case-insensitive/i.test(searchGuide),
    "default matching remains literal and case-insensitive");
  assert.ok(/time budget, and structured stop status/i.test(searchGuide),
    "the default path still uses its time budget and structured stop status");
});
