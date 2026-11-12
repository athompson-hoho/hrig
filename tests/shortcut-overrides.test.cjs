"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync, transformSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;

function load(entry) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
}

const ov = load("src/shortcut-overrides.ts");
const catalog = load("src/shortcuts.ts");
const terminalKeys = load("src/terminal-keys.ts");
const settings = load("src/settings.ts");

const REOPEN = "workspace.reopenPanel";
const MAXIMIZE = "workspace.maximizePanel";
const FOCUS = "workspace.focusMode";
const PLATFORMS = ["darwin", "win32", "linux"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function press(text, extra = {}) {
  const event = {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
    ...extra,
  };
  for (const part of text.split("+")) {
    if (part === "Ctrl" || part === "Control") event.ctrlKey = true;
    else if (part === "Cmd") event.metaKey = true;
    else if (part === "Shift") event.shiftKey = true;
    else {
      const named = ["Tab", "Escape", "Enter", "Space", "Comma", "Period", "Slash", "Backslash", "Minus", "Equal", "Plus", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Backquote"];
      event.key = named.find((key) => key.toLowerCase() === part.toLowerCase()) || (event.shiftKey ? part.toUpperCase() : part);
    }
  }
  event.key = ({ Space: " ", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Minus: "-", Equal: "=", Plus: "+", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backquote: "`" })[event.key] || event.key;
  if (!event.code) {
    const keyToken = text.split("+").find((part) => !["Ctrl", "Control", "Cmd", "Meta", "Command", "Mod", "Shift"].includes(part));
    const namedCode = { Space: "Space", Comma: "Comma", Period: "Period", Slash: "Slash", Backslash: "Backslash", Minus: "Minus", Equal: "Equal", Plus: "Equal", Semicolon: "Semicolon", Quote: "Quote", BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backquote: "Backquote" };
    event.code = /^\d$/.test(keyToken || "") ? "Digit" + keyToken : /^[A-Za-z]$/.test(keyToken || "") ? "Key" + keyToken.toUpperCase() : namedCode[keyToken] || keyToken || "";
  }
  if (extra.key !== undefined) event.key = extra.key;
  if (extra.code !== undefined) event.code = extra.code;
  return event;
}

// The real key handler text of src/App.tsx, cut out, stripped of its types and
// run over fakes, with the real classifiers behind it.
function handlerHarness(platform, overridesText) {
  const source = read("src/App.tsx");
  const from = source.indexOf("const handler = (event: KeyboardEvent) => {");
  const to = source.indexOf("const windows = [", from);
  assert.ok(from > 0 && to > from, "the key handler is found");
  const js = transformSync(source.slice(from, to), { loader: "ts" }).code;
  const calls = [];
  const state = { modal: null, dialog: false };
  const fakes = {
    terminalOwnsKey: terminalKeys.terminalOwnsKey,
    isHelpKey: catalog.isHelpKey,
    hasOpenDialog: () => state.dialog,
    isReopenPanelKey: catalog.isReopenPanelKey,
    isMaximizePanelKey: catalog.isMaximizePanelKey,
    isFocusModeKey: catalog.isFocusModeKey,
    isPanelCycleKey: catalog.isPanelCycleKey,
    cyclePanel: () => calls.push("cycle"),
    routeOverriddenKey: ov.routeOverriddenKey,
    runShortcut: (id) => {
      const actions = {
        "workspace.palette": "palette",
        "workspace.quickOpen": "quickOpen",
        "workspace.sidebar": "sidebar",
        "workspace.newShell": "shell",
        "workspace.focusTerminal": "focusTerminal",
        "workspace.focusEditor": "focusEditor",
        "workspace.focusTasks": "focusTasks",
        "workspace.closePanel": "close",
        "workspace.cyclePanelsNext": "cycle",
        "workspace.cyclePanelsPrevious": "cycle",
        "workspace.reopenPanel": "reopen",
        "workspace.maximizePanel": "maximize:toggle",
        "workspace.focusMode": "focus",
      };
      const action = actions[id];
      if (action) calls.push(action);
    },
    window: { hrig: { platform } },
    shortcutOverrides: ov.parseOverrideText(overridesText, platform).map,
    openShortcuts: () => calls.push("shortcuts"),
    reopenClosedPanel: () => calls.push("reopen"),
    toggleMaximize: (mode) => calls.push("maximize:" + mode),
    toggleFocusMode: () => calls.push("focus"),
    openPanelNavigator: () => calls.push("panels"),
    openQuickOpen: () => calls.push("quickOpen"),
    openSettings: () => calls.push("settings"),
    openPalette: () => calls.push("palette"),
    openProject: () => calls.push("project"),
    setSidebar: () => calls.push("sidebar"),
    openShell: () => calls.push("shell"),
  };
  const names = Object.keys(fakes);
  const make = new Function(...names, "modal", js + "\nreturn handler;");
  return {
    calls,
    state,
    key(text, extra = {}) {
      const handler = make(...names.map((n) => fakes[n]), state.modal);
      const event = press(text, extra);
      let prevented = 0;
      let stopped = 0;
      event.preventDefault = () => prevented++;
      event.stopPropagation = () => stopped++;
      event.target = {
        tagName: "DIV",
        isContentEditable: false,
        closest: () => null,
        ownerDocument: { querySelector: () => null },
      };
      const before = calls.length;
      handler(event);
      return {
        ran: calls.slice(before),
        claimed: prevented > 0 && stopped > 0,
        touched: prevented + stopped,
      };
    },
  };
}

test("shortcut-overrides tracer: a saved override text moves one chord in the real App key handler, the old keys are released, and an empty text changes nothing", () => {
  // Defaults, empty text: every chord does what it did and nothing else is claimed.
  const plain = handlerHarness("linux", "");
  assert.deepEqual(plain.key("Ctrl+Shift+H"), {
    ran: ["reopen"],
    claimed: true,
    touched: 2,
  });
  assert.deepEqual(plain.key("Ctrl+Shift+M").ran, ["maximize:toggle"]);
  assert.deepEqual(plain.key("Ctrl+Shift+D").ran, ["focus"]);
  assert.deepEqual(plain.key("Ctrl+B").ran, ["sidebar"]);
  assert.deepEqual(plain.key("Ctrl+P").ran, ["quickOpen"]);
  assert.deepEqual(plain.key("Ctrl+Shift+P").ran, ["panels"]);
  assert.deepEqual(plain.key("Ctrl+Shift+T").ran, ["shell"]);
  assert.deepEqual(plain.key("Ctrl+Shift+Y"), {
    ran: [],
    claimed: false,
    touched: 0,
  });
  const expanded = handlerHarness("linux", "workspace.palette=Ctrl+Shift+9");
  assert.deepEqual(expanded.key("Ctrl+Shift+9"), {
    ran: ["palette"], claimed: true, touched: 2,
  });
  assert.deepEqual(expanded.key("Ctrl+K"), {
    ran: [], claimed: false, touched: 0,
  }, "the moved default chord is released");

  // The text goes through the real setting rules, then the real parser, then the handler.
  const text = "workspace.reopenPanel=Ctrl+Shift+Y";
  assert.deepEqual(
    settings.validateOverrides({ "shortcuts.overrides": text }),
    {
      "shortcuts.overrides": text,
    },
  );
  const resolved = settings.resolveSettings({ "shortcuts.overrides": text });
  assert.equal(resolved["shortcuts.overrides"], text);
  const moved = handlerHarness("linux", resolved["shortcuts.overrides"]);
  assert.deepEqual(moved.key("Ctrl+Shift+Y"), {
    ran: ["reopen"],
    claimed: true,
    touched: 2,
  });
  assert.deepEqual(
    moved.key("Ctrl+Shift+H"),
    { ran: [], claimed: false, touched: 0 },
    "the released keys reach the terminal untouched",
  );
  assert.deepEqual(moved.key("Ctrl+Shift+M").ran, ["maximize:toggle"]);
  assert.deepEqual(moved.key("Ctrl+Shift+D").ran, ["focus"]);
  assert.deepEqual(moved.key("Ctrl+B").ran, ["sidebar"]);
  assert.deepEqual(moved.key("Ctrl+Y"), {
    ran: [],
    claimed: false,
    touched: 0,
  });
  assert.deepEqual(moved.calls, [
    "reopen",
    "maximize:toggle",
    "focus",
    "sidebar",
  ]);

  // A dialog or a modal claims the chord but runs nothing; a held key, Alt and composing do nothing.
  moved.state.dialog = true;
  assert.deepEqual(moved.key("Ctrl+Shift+Y"), {
    ran: [],
    claimed: true,
    touched: 2,
  });
  moved.state.dialog = false;
  moved.state.modal = "settings";
  assert.deepEqual(moved.key("Ctrl+Shift+Y"), {
    ran: [],
    claimed: true,
    touched: 2,
  });
  moved.state.modal = null;
  assert.deepEqual(moved.key("Ctrl+Shift+Y", { repeat: true }).ran, []);
  assert.deepEqual(moved.key("Ctrl+Shift+Y", { altKey: true }).ran, []);
  assert.deepEqual(moved.key("Ctrl+Shift+Y", { isComposing: true }).ran, []);
  assert.deepEqual(
    moved.key("Ctrl+Shift+Y", { defaultPrevented: true }).ran,
    [],
  );

  // macOS: Cmd is the main key; Ctrl alone is not.
  const mac = handlerHarness("darwin", "workspace.focusMode=Cmd+Shift+Y");
  assert.deepEqual(mac.key("Cmd+Shift+Y").ran, ["focus"]);
  assert.deepEqual(mac.key("Ctrl+Shift+Y").ran, []);
  assert.deepEqual(mac.key("Cmd+Shift+D"), {
    ran: [],
    claimed: false,
    touched: 0,
  });
  assert.deepEqual(mac.key("Cmd+Shift+H").ran, ["reopen"]);

  // A damaged or clashing text is dropped: the defaults keep working.
  for (const bad of [
    "garbage",
    "workspace.reopenPanel=Ctrl+Shift+C",
    "workspace.reopenPanel=Ctrl+Shift+P",
    "workspace.sidebar=Ctrl+Shift+P",
    "workspace.reopenPanel=",
    ",,=,",
  ]) {
    const h = handlerHarness("linux", bad);
    assert.deepEqual(h.key("Ctrl+Shift+H").ran, ["reopen"], bad);
    assert.deepEqual(h.key("Ctrl+Shift+Y").ran, [], bad);
    assert.deepEqual(h.key("Ctrl+Shift+P").ran, ["panels"], bad);
  }
});

test("shortcut-overrides key events: shifted digits, normalized modifiers, bare-letter protection, and legacy dialog routing use real App events", () => {
  for (const [key, code, action] of [["!", "Digit1", "focusTerminal"], ["@", "Digit2", "focusEditor"], ["#", "Digit3", "focusTasks"]]) {
    const h = handlerHarness("linux", "");
    assert.deepEqual(h.key("Ctrl+Shift+1", { key, code }).ran, [action]);
  }
  assert.equal(ov.saveOverride("", FOCUS, "Control+Shift+Y", "linux").text, `${FOCUS}=Ctrl+Shift+Y`);
  assert.equal(ov.saveOverride("", FOCUS, "Meta+Shift+Y", "linux").text, `${FOCUS}=Ctrl+Shift+Y`);
  const aliased = handlerHarness("linux", `${FOCUS}=Meta+Shift+Y`);
  assert.deepEqual(aliased.key("Ctrl+Shift+Y").ran, ["focus"]);
  const controlAlias = handlerHarness("linux", `${FOCUS}=Control+Shift+Y`);
  assert.deepEqual(controlAlias.key("Ctrl+Shift+Y").ran, ["focus"]);
  const macAlias = handlerHarness("darwin", `${FOCUS}=Meta+Shift+Y`);
  assert.deepEqual(macAlias.key("Cmd+Shift+Y").ran, ["focus"]);
  const punctuation = handlerHarness("linux", `${FOCUS}=Ctrl+Shift+Period`);
  assert.deepEqual(punctuation.key("Ctrl+Shift+Period", { key: ">", code: "Period" }).ran, ["focus"]);
  for (const chord of ["Control+C", "Control+Shift+C", "Control+K", "Control+Q"]) {
    assert.equal(ov.saveOverride("", "workspace.closePanel", chord, "linux").ok, false, chord);
  }
  for (const letter of ["A", "D", "Z", "X", "Y", "T", "N"]) {
    const result = ov.saveOverride("", FOCUS, "Ctrl+" + letter, "linux");
    assert.equal(result.ok, false, "Ctrl+" + letter);
    assert.match(result.error, /needs Shift/);
  }
  const bare = handlerHarness("linux", `${FOCUS}=Ctrl+D`);
  assert.deepEqual(bare.key("Ctrl+D"), { ran: [], claimed: false, touched: 0 });
  const modal = handlerHarness("linux", "");
  modal.state.modal = "settings";
  assert.deepEqual(modal.key("Ctrl+K").ran, ["palette"]);
  assert.deepEqual(modal.key("Ctrl+P").ran, ["quickOpen"]);
  assert.deepEqual(modal.key("Ctrl+B").ran, ["sidebar"]);
  assert.deepEqual(modal.key("Ctrl+Shift+P").ran, ["panels"]);
  assert.deepEqual(modal.key("Ctrl+Shift+K").ran, ["palette"]);
  assert.deepEqual(modal.key("Ctrl+Shift+B").ran, ["sidebar"]);
  const explicitDefaults = handlerHarness("linux", "workspace.palette=Ctrl+K,workspace.sidebar=Ctrl+B");
  assert.deepEqual(explicitDefaults.key("Ctrl+Shift+K").ran, ["palette"]);
  assert.deepEqual(explicitDefaults.key("Ctrl+Shift+B").ran, ["sidebar"]);
});

test("shortcut-overrides chord: supported keys and physical Control are canonical, malformed chords never throw", () => {
  const ok = [
    ["Ctrl+Shift+Y", "Ctrl+Shift+Y"],
    ["ctrl+shift+y", "Ctrl+Shift+Y"],
    ["CTRL+SHIFT+Y", "Ctrl+Shift+Y"],
    ["Cmd+Shift+Y", "Ctrl+Shift+Y"],
    ["command+shift+y", "Ctrl+Shift+Y"],
    ["Mod+Shift+j", "Ctrl+Shift+J"],
    ["control+Shift+b", "Ctrl+Shift+B"],
    ["Meta+Shift+Y", "Ctrl+Shift+Y"],
    ["Control+Tab", "Control+Tab"],
    ["Ctrl+Tab", "Ctrl+Tab"],
    ["Ctrl+1", "Ctrl+1"],
    ["Ctrl+Shift+F5", "Ctrl+Shift+F5"],
    ["Ctrl+Shift+Period", "Ctrl+Shift+Period"],
    ["Shift+Ctrl+j", "Ctrl+Shift+J"],
    ["Y+Shift+Ctrl", "Ctrl+Shift+Y"],
    ["  Ctrl + Shift + y  ", "Ctrl+Shift+Y"],
    ["Ctrl+Shift+Y" + " ".repeat(40), "Ctrl+Shift+Y"],
  ];
  for (const [input, chord] of ok) {
    assert.deepEqual(ov.parseChord(input), { ok: true, chord }, input);
    assert.equal(ov.normalizeChord(input), chord, input);
  }
  const bad = [
    ["", "Type a shortcut such as Ctrl+Shift+Y."],
    ["   ", "Type a shortcut such as Ctrl+Shift+Y."],
    [null, "Type a shortcut such as Ctrl+Shift+Y."],
    [undefined, "Type a shortcut such as Ctrl+Shift+Y."],
    [42, "Type a shortcut such as Ctrl+Shift+Y."],
    [{}, "Type a shortcut such as Ctrl+Shift+Y."],
    ["Y", "Start with Ctrl, Cmd, Meta or Control, for example Ctrl+Shift+Y."],
    ["Shift+Y", "Start with Ctrl, Cmd, Meta or Control, for example Ctrl+Shift+Y."],
    ["Ctrl+Shift", "Use exactly one key, for example Ctrl+Shift+Y."],
    ["Ctrl+Shift+Y+Z", "Use exactly one key, for example Ctrl+Shift+Y."],
    ["Ctrl+Cmd+Shift+Y", "Use the main modifier or physical Control once."],
    ["Ctrl+Shift+Shift+Y", "Use Shift once."],
    [
      "Ctrl+Alt+Shift+Y",
      "Alt, Option and Windows combinations cannot be used here.",
    ],
    [
      "Option+Ctrl+Shift+Y",
      "Alt, Option and Windows combinations cannot be used here.",
    ],
    [
      "Ctrl+Shift+",
      "Write modifiers and one letter joined with +, for example Ctrl+Shift+Y.",
    ],
    [
      "Ctrl++Y",
      "Write modifiers and one letter joined with +, for example Ctrl+Shift+Y.",
    ],
    [
      "+",
      "Write modifiers and one letter joined with +, for example Ctrl+Shift+Y.",
    ],
    ["Ctrl+Shift+NotAKey", "Use a letter, number, Tab, Enter, Escape, Space, punctuation key or F1-F12."],
    ["Ctrl+Shift+?", "Use a letter, number, Tab, Enter, Escape, Space, punctuation key or F1-F12."],
    [
      "Ctrl+Shift+" + String.fromCharCode(233),
      "Use a letter, number, Tab, Enter, Escape, Space, punctuation key or F1-F12.",
    ],
    ["Ctrl+Shift+" + "Y".repeat(40), "That shortcut is too long."],
  ];
  for (const [input, error] of bad) {
    assert.deepEqual(ov.parseChord(input), { ok: false, error }, String(input));
    assert.equal(ov.normalizeChord(input), null, String(input));
  }
  assert.equal(ov.chordLabel("Ctrl+Shift+Y", "darwin"), "Cmd+Shift+Y");
  for (const platform of ["win32", "linux", "freebsd", ""])
    assert.equal(ov.chordLabel("Ctrl+Shift+Y", platform), "Ctrl+Shift+Y");
  assert.equal(ov.chordHint("Ctrl+Shift+Y", "darwin"), "Cmd Shift Y");
  assert.equal(ov.chordHint("Ctrl+Shift+Y", "win32"), "Ctrl Shift Y");

  // A seeded walk of hostile pieces: never throws, answers a canonical chord or an error, and re-reads to itself.
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pieces = [
    "Ctrl",
    "Cmd",
    "Shift",
    "Alt",
    "y",
    "Y",
    "+",
    "++",
    " ",
    "",
    "1",
    "F5",
    "Mod",
    "control",
    "?",
    "\n",
  ];
  for (let run = 0; run < 400; run++) {
    const length = 1 + rand(6);
    let input = "";
    for (let i = 0; i < length; i++)
      input += pieces[rand(pieces.length)] + (rand(3) === 0 ? "" : "+");
    const result = ov.parseChord(input);
    if (result.ok) {
      assert.match(result.chord, /^(Ctrl|Control)\+(Shift\+)?([A-Z]|\d|Tab|Enter|Escape|Space|Comma|Period|Slash|Backslash|Minus|Equal|Plus|Semicolon|Quote|BracketLeft|BracketRight|Backquote|F(?:[1-9]|1[0-2]))$/, input);
      assert.deepEqual(ov.parseChord(result.chord), result, input);
    } else {
      assert.equal(typeof result.error, "string", input);
      assert.ok(result.error.length > 0, input);
    }
  }
});

function monacoShiftLetters() {
  const monaco = path.join(root, "node_modules", "monaco-editor");
  const version = JSON.parse(
    fs.readFileSync(path.join(monaco, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.56\./,
    "Monaco changed to " + version + ": audit the Shift chords again",
  );
  const found = new Set();
  const forward =
    /2048 \/\* KeyMod\.CtrlCmd \*\/ \| 1024 \/\* KeyMod\.Shift \*\/ \| \d+ \/\* KeyCode\.Key([A-Z]) \*\//g;
  const reverse =
    /1024 \/\* KeyMod\.Shift \*\/ \| 2048 \/\* KeyMod\.CtrlCmd \*\/ \| \d+ \/\* KeyCode\.Key([A-Z]) \*\//g;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) {
        const text = fs.readFileSync(file, "utf8");
        for (const re of [forward, reverse])
          for (const match of text.matchAll(re)) found.add(match[1]);
      }
    }
  };
  walk(path.join(monaco, "esm", "vs", "editor"));
  return [...found].sort();
}

test("shortcut-overrides collisions: terminal, editor, fixed and other shortcut keys are refused, a vacated default is free, and the lists are audited against the real sources", () => {
  // Terminal keys come from the real classifier, not from a copy of its rules.
  const terminal = [];
  for (const letter of LETTERS) {
    const claimed = ["darwin", "win32"].some((platform) =>
      [false, true].some(
        (selected) =>
          terminalKeys.classifyTerminalKey(
            {
              key: letter,
              ctrlKey: platform !== "darwin",
              metaKey: platform === "darwin",
              altKey: false,
              shiftKey: true,
            },
            platform,
            selected,
          ) !== "pass",
      ),
    );
    if (claimed) terminal.push(letter);
  }
  assert.deepEqual(terminal, ["C", "F", "K", "V"]);
  for (const letter of terminal)
    assert.match(
      ov.reservedReason("Ctrl+Shift+" + letter),
      /^Ctrl\/Cmd\+Shift\+[A-Z] is a terminal key \(find, copy, paste or clear\)\.$/,
      letter,
    );

  // The editor list equals the Shift chords the installed Monaco binds with Ctrl or Cmd.
  assert.deepEqual(monacoShiftLetters(), [...ov.EDITOR_SHIFT_LETTERS].sort());
  assert.deepEqual(
    [...ov.EDITOR_SHIFT_LETTERS],
    ["A", "G", "I", "K", "L", "O", "R", "Z"],
  );
  for (const letter of ov.EDITOR_SHIFT_LETTERS) {
    const reason = ov.reservedReason("Ctrl+Shift+" + letter);
    if (letter === "K") assert.match(reason, /terminal key/);
    else assert.match(reason, /is used by the code editor\.$/, letter);
  }

  // What is left, per shortcut, with every other shortcut at its default.
  const groups = catalog.shortcutGroups("linux");
  const free = (id) =>
    LETTERS.filter(
      (letter) =>
        ov.findCollisions(groups, { [id]: "Ctrl+Shift+" + letter }).length ===
        0,
    );
  assert.deepEqual(free(REOPEN), [
    "B",
    "E",
    "H",
    "J",
    "N",
    "Q",
    "S",
    "U",
    "X",
    "Y",
  ]);
  assert.deepEqual(free(MAXIMIZE), [
    "B",
    "E",
    "J",
    "M",
    "N",
    "Q",
    "S",
    "U",
    "X",
    "Y",
  ]);
  assert.deepEqual(free(FOCUS), [
    "B",
    "D",
    "E",
    "J",
    "N",
    "Q",
    "S",
    "U",
    "X",
    "Y",
  ]);

  // Messages name what holds the keys.
  const reasons = (map) => ov.findCollisions(groups, map).map((c) => c.reason);
  assert.deepEqual(reasons({ [REOPEN]: "Ctrl+Shift+P" }), [
    "Ctrl/Cmd+Shift+P is already used by: Find open panels.",
  ]);
  assert.deepEqual(reasons({ [REOPEN]: "Ctrl+Shift+T" }), [
    "Ctrl/Cmd+Shift+T is already used by: Open a new shell.",
  ]);
  assert.deepEqual(reasons({ [REOPEN]: "Ctrl+Shift+M" }), [
    "Ctrl/Cmd+Shift+M is already used by: Maximize or restore the focused panel group.",
  ]);
  assert.deepEqual(
    reasons({ [REOPEN]: "Ctrl+Shift+Y", [FOCUS]: "Ctrl+Shift+Y" }),
    [
      "Ctrl/Cmd+Shift+Y is already used by: Hide or show the sidebar and status bar (focus mode).",
      "Ctrl/Cmd+Shift+Y is already used by: Reopen the file or seat panel closed last.",
    ],
  );
  assert.deepEqual(reasons({ [REOPEN]: "Ctrl+Y" }), [
    "Ctrl/Cmd+Y needs Shift; unshifted Ctrl/Cmd letters belong to terminals and the editor.",
  ]);
  assert.deepEqual(
    reasons({ [REOPEN]: "Ctrl+Shift+H" }),
    [],
    "its own default is not a clash",
  );
  for (const chord of ["Ctrl+Q", "Ctrl+W", "Ctrl+Tab", "Ctrl+Shift+Escape"])
    assert.ok(ov.reservedReason(chord).includes("reserved by the operating system"), chord);
  assert.equal(ov.reservedReason("Control+Tab"), "", "physical Control+Tab is the panel switch default");
  assert.equal(ov.reservedReason("Control+Shift+Tab"), "", "physical Control+Shift+Tab is the reverse panel switch default");

  // validateOverrideMap: clean map plus errors, unknown ids and junk values dropped.
  const checked = ov.validateOverrideMap(groups, {
    [REOPEN]: "cmd+shift+j",
    [MAXIMIZE]: "Ctrl+Shift+C",
    "workspace.sidebar": "Ctrl+Shift+P",
    constructor: "Ctrl+Shift+Y",
    [FOCUS]: 5,
  });
  assert.deepEqual(checked.map, { [REOPEN]: "Ctrl+Shift+J" });
  assert.deepEqual(
    checked.errors.map((e) => e.id).sort(),
    ["constructor", FOCUS, MAXIMIZE, "workspace.sidebar"].sort(),
  );
  for (const junk of [null, undefined, 7, "x", [], [REOPEN]])
    assert.deepEqual(ov.validateOverrideMap(groups, junk), {
      map: {},
      errors: [],
    });

  // A moved shortcut frees its default keys; two shortcuts on one chord are both dropped.
  const text = (value) => ov.parseOverrideText(value, "linux");
  assert.deepEqual(
    text(REOPEN + "=Ctrl+Shift+Y," + MAXIMIZE + "=Ctrl+Shift+H").map,
    {
      [REOPEN]: "Ctrl+Shift+Y",
      [MAXIMIZE]: "Ctrl+Shift+H",
    },
  );
  assert.deepEqual(
    text(REOPEN + "=Ctrl+Shift+M," + MAXIMIZE + "=Ctrl+Shift+H").map,
    {
      [REOPEN]: "Ctrl+Shift+M",
      [MAXIMIZE]: "Ctrl+Shift+H",
    },
  );
  assert.deepEqual(
    text(REOPEN + "=Ctrl+Shift+Y," + FOCUS + "=Ctrl+Shift+Y").map,
    {},
  );
  assert.equal(
    text(REOPEN + "=Ctrl+Shift+Y," + FOCUS + "=Ctrl+Shift+Y").ignored.length,
    2,
  );

  // Defensive reading: every kind of damage is dropped with a reason and nothing throws.
  const parsed = text(
    [
      "garbage",
      "=Ctrl+Shift+Y",
      REOPEN + "=",
      REOPEN + "=Ctrl+Shift+Y=Z",
      "workspace.sidebar=Ctrl+Shift+P",
      "__proto__=Ctrl+Shift+Y",
      FOCUS + "=Ctrl+Shift+Y",
      FOCUS + "=Ctrl+Shift+J",
      "",
      " , ",
    ].join(","),
  );
  assert.deepEqual(parsed.map, { [FOCUS]: "Ctrl+Shift+Y" });
  assert.deepEqual(
    parsed.ignored.map((i) => i.reason),
    [
      "Not in the form id=keys.",
      "Not in the form id=keys.",
      "Not in the form id=keys.",
      "That shortcut cannot be rebound.",
      "That shortcut is set twice.",
      "Type a shortcut such as Ctrl+Shift+Y.",
      "Ctrl/Cmd+Shift+P is already used by: Find open panels.",
    ],
  );
  for (const value of [undefined, null, 0, {}, [], "", "   "])
    assert.deepEqual(text(value), { map: {}, ignored: [] });
  const tooLong = text(
    REOPEN + "=Ctrl+Shift+Y," + "x".repeat(ov.MAX_OVERRIDES_TEXT),
  );
  assert.deepEqual(tooLong.map, {});
  assert.equal(tooLong.ignored.length, 1);
  assert.equal(ov.MAX_OVERRIDES_TEXT, 1000);

  // The text round trip and the edit helpers.
  const map = { [FOCUS]: "Ctrl+Shift+Y", [REOPEN]: "Ctrl+Shift+J" };
  assert.equal(
    ov.formatOverrideText(map),
    REOPEN + "=Ctrl+Shift+J," + FOCUS + "=Ctrl+Shift+Y",
  );
  assert.deepEqual(
    ov.parseOverrideText(ov.formatOverrideText(map), "win32").map,
    map,
  );
  assert.equal(ov.formatOverrideText({}), "");
  assert.deepEqual(ov.saveOverride("", REOPEN, "cmd+shift+j", "darwin"), {
    ok: true,
    text: REOPEN + "=Ctrl+Shift+J",
  });
  assert.deepEqual(
    ov.saveOverride(REOPEN + "=Ctrl+Shift+J", FOCUS, "Ctrl+Shift+Y", "win32"),
    {
      ok: true,
      text: REOPEN + "=Ctrl+Shift+J," + FOCUS + "=Ctrl+Shift+Y",
    },
  );
  assert.deepEqual(
    ov.saveOverride(REOPEN + "=Ctrl+Shift+J", REOPEN, "Ctrl+Shift+H", "win32"),
    {
      ok: true,
      text: "",
    },
  );
  assert.deepEqual(ov.saveOverride("", REOPEN, "Ctrl+Shift+P", "win32"), {
    ok: false,
    error: "Ctrl/Cmd+Shift+P is already used by: Find open panels.",
  });
  assert.deepEqual(
    ov.saveOverride("", REOPEN, "Ctrl+Shift+C", "win32").ok,
    false,
  );
  assert.deepEqual(ov.saveOverride("", REOPEN, "Ctrl+Y", "win32").ok, false);
  assert.deepEqual(
    ov.saveOverride("", "workspace.sidebar", "Ctrl+Shift+Y", "win32"),
    {
      ok: true,
      text: "workspace.sidebar=Ctrl+Shift+Y",
    },
  );
  assert.deepEqual(
    ov.saveOverride("", "constructor", "Ctrl+Shift+Y", "win32").ok,
    false,
  );
  assert.equal(
    ov.resetOverride(ov.formatOverrideText(map), FOCUS, "linux"),
    REOPEN + "=Ctrl+Shift+J",
  );
  assert.equal(
    ov.resetOverride(ov.formatOverrideText(map), "workspace.sidebar", "linux"),
    ov.formatOverrideText(map),
  );
  assert.equal(ov.resetOverride("garbage", REOPEN, "linux"), "");
  assert.equal(ov.defaultChord(REOPEN), "Ctrl+Shift+H");
  assert.equal(ov.defaultChord(MAXIMIZE), "Ctrl+Shift+M");
  assert.equal(ov.defaultChord(FOCUS), "Ctrl+Shift+D");
  assert.deepEqual([...ov.OVERRIDABLE_IDS], [
    "workspace.palette", "workspace.quickOpen", "workspace.cyclePanelsNext", "workspace.cyclePanelsPrevious",
    "workspace.sidebar", "workspace.newShell", "workspace.closePanel",
    "workspace.focusTerminal", "workspace.focusEditor", "workspace.focusTasks",
    REOPEN, MAXIMIZE, FOCUS, "terminal.find",
  ]);
  assert.equal(ov.OVERRIDES_SETTING, "shortcuts.overrides");
});

test("shortcut-overrides apply: an empty map leaves the catalog exactly as it is, an override changes only its own keys, and the key router agrees with a model", () => {
  for (const platform of [...PLATFORMS, "freebsd", ""]) {
    const groups = catalog.shortcutGroups(platform);
    const before = JSON.stringify(groups);
    for (const empty of [
      {},
      { [REOPEN]: undefined },
      { [REOPEN]: "Ctrl+Shift+C" },
      { nope: "Ctrl+Shift+Y" },
      null,
      "x",
    ]) {
      const applied = ov.applyOverrides(groups, empty, platform);
      assert.equal(applied, groups, platform + " the same groups come back");
      assert.equal(JSON.stringify(applied), before, platform);
    }
    assert.equal(JSON.stringify(catalog.shortcutGroups(platform)), before);
  }
  const frozen = JSON.parse(JSON.stringify(catalog.shortcutGroups("win32")));
  for (const group of frozen) {
    Object.freeze(group);
    Object.freeze(group.shortcuts);
    for (const s of group.shortcuts) (Object.freeze(s.keys), Object.freeze(s));
  }
  const map = { [REOPEN]: "Ctrl+Shift+J", [FOCUS]: "Ctrl+Shift+Y" };
  const win = ov.applyOverrides(frozen, map, "win32");
  const flat = (groups) => groups.flatMap((g) => g.shortcuts);
  const byId = (groups) =>
    Object.fromEntries(flat(groups).map((s) => [s.id, s]));
  assert.deepEqual(byId(win)[REOPEN].keys, ["Ctrl+Shift+J"]);
  assert.deepEqual(byId(win)[FOCUS].keys, ["Ctrl+Shift+Y"]);
  for (const [id, entry] of Object.entries(byId(frozen))) {
    if (id === REOPEN || id === FOCUS) {
      assert.equal(byId(win)[id].label, entry.label, "the label is kept");
    } else assert.deepEqual(byId(win)[id], entry, id + " is untouched");
  }
  assert.deepEqual(
    win.map((g) => [g.id, g.title]),
    frozen.map((g) => [g.id, g.title]),
  );
  assert.deepEqual(
    flat(win).map((s) => s.id),
    flat(frozen).map((s) => s.id),
  );
  const mac = ov.applyOverrides(
    catalog.shortcutGroups("darwin"),
    map,
    "darwin",
  );
  assert.deepEqual(byId(mac)[REOPEN].keys, ["Cmd+Shift+J"]);
  assert.deepEqual(byId(mac)[MAXIMIZE].keys, ["Cmd+Shift+M"]);

  // Search keeps rows whose group, label or keys hold every word.
  const groups = catalog.shortcutGroups("win32");
  assert.equal(ov.filterShortcutGroups(groups, ""), groups);
  assert.equal(ov.filterShortcutGroups(groups, "   "), groups);
  const ids = (query) =>
    flat(ov.filterShortcutGroups(groups, query)).map((s) => s.id);
  assert.deepEqual(ids("zoom"), [
    "terminal.zoomIn",
    "terminal.zoomOut",
    "terminal.zoomReset",
  ]);
  assert.deepEqual(ids("CTRL+Shift+m"), [MAXIMIZE]);
  assert.ok(
    ids("SHIFT").includes(MAXIMIZE) &&
      ids("shift").length === ids("SHIFT").length,
  );
  assert.deepEqual(ids("ctrl+shift+h"), [REOPEN]);
  assert.deepEqual(ids("nothing matches this"), []);
  assert.deepEqual(
    ov.filterShortcutGroups(groups, "editor save").map((g) => g.id),
    ["editor"],
  );
  assert.deepEqual(ids("save"), ["editor.save"]);

  // Hints: one pass per command, so a swap never chains; with no override the text is unchanged.
  const DOT = String.fromCharCode(183);
  const commands = [
    {
      name: "Toggle focus mode",
      hint: "Hide the sidebar " + DOT + " Ctrl Shift D",
      icon: 1,
    },
    { name: "Reopen closed panel", hint: "Latest " + DOT + " Ctrl Shift H" },
    { name: "Maximize panel", hint: "Fill " + DOT + " Ctrl Shift M" },
    { name: "New shell", hint: "Ctrl Shift T" },
  ];
  const same = ov.withEffectiveHints(commands, "linux", {});
  assert.deepEqual(same, commands);
  assert.notEqual(same, commands);
  const swapped = ov.withEffectiveHints(commands, "linux", {
    [REOPEN]: "Ctrl+Shift+M",
    [MAXIMIZE]: "Ctrl+Shift+H",
  });
  assert.deepEqual(
    swapped.map((c) => c.hint),
    [
      commands[0].hint,
      "Latest " + DOT + " Ctrl Shift M",
      "Fill " + DOT + " Ctrl Shift H",
      "Ctrl Shift T",
    ],
  );
  assert.equal(
    swapped[0],
    commands[0],
    "an untouched command is the same object",
  );
  assert.equal(swapped[0].icon, 1);
  assert.equal(
    ov.withEffectiveHints(commands, "darwin", { [FOCUS]: "Ctrl+Shift+Y" })[0]
      .hint,
    commands[0].hint,
    "a mac hint is looked up with Cmd, so this linux text is left",
  );
  assert.equal(
    ov.withEffectiveHints([{ hint: "x " + DOT + " Cmd Shift D" }], "darwin", {
      [FOCUS]: "Ctrl+Shift+Y",
    })[0].hint,
    "x " + DOT + " Cmd Shift Y",
  );

  // The router: empty map answers null for every key; guards; release; and a seeded model walk.
  for (const letter of LETTERS)
    for (const platform of PLATFORMS) {
      const routed = ov.routeOverriddenKey(press((platform === "darwin" ? "Cmd" : "Ctrl") + "+Shift+" + letter), platform, {});
      const expected = ov.OVERRIDABLE_IDS.find((id) => ov.defaultChord(id) === "Ctrl+Shift+" + letter)
        || (letter === "K" ? "workspace.palette" : letter === "B" ? "workspace.sidebar" : null);
      assert.deepEqual(routed, expected ? { id: expected } : null);
    }
  const router = (event, platform, m) =>
    ov.routeOverriddenKey(event, platform, m);
  const one = { [MAXIMIZE]: "Ctrl+Shift+Y" };
  assert.deepEqual(router(press("Ctrl+Shift+Y"), "linux", one), {
    id: MAXIMIZE,
  });
  assert.deepEqual(router(press("Ctrl+Shift+y"), "win32", one), {
    id: MAXIMIZE,
  });
  assert.deepEqual(router(press("Ctrl+Shift+M"), "linux", one), { id: null });
  assert.deepEqual(
    router(press("Ctrl+Shift+M", { repeat: true }), "linux", one),
    { id: null },
  );
  assert.deepEqual(
    router(press("Ctrl+Shift+Y", { repeat: true }), "linux", one),
    { id: MAXIMIZE },
  );
  assert.equal(
    router(press("Ctrl+Shift+Y", { altKey: true }), "linux", one),
    null,
  );
  assert.equal(
    router(press("Ctrl+Shift+Y", { isComposing: true }), "linux", one),
    null,
  );
  assert.equal(
    router(press("Ctrl+Shift+Y", { defaultPrevented: true }), "linux", one),
    null,
  );
  assert.equal(router(press("Ctrl+Y"), "linux", one), null);
  assert.deepEqual(
    router(press("Ctrl+Shift+H"), "linux", one),
    { id: REOPEN },
    "an unmoved default action is routed as well",
  );
  assert.equal(router(press("Cmd+Shift+Y"), "linux", one), null);
  assert.equal(router(press("Ctrl+Shift+Y"), "darwin", one), null);
  assert.deepEqual(router(press("Cmd+Shift+Y"), "darwin", one), {
    id: MAXIMIZE,
  });
  assert.deepEqual(router(press("Control+Tab"), "darwin", {}), {
    id: "workspace.cyclePanelsNext",
  });
  assert.deepEqual(router(press("Control+Shift+Tab"), "darwin", {}), {
    id: "workspace.cyclePanelsPrevious",
  });
  assert.deepEqual(
    router(press("Ctrl+Shift+Period"), "linux", { [MAXIMIZE]: "Ctrl+Shift+Period" }),
    { id: MAXIMIZE },
    "named punctuation routes to KeyboardEvent.key",
  );
  assert.equal(router(press("Ctrl+Cmd+Shift+Y"), "darwin", one), null);
  assert.equal(router(press("Ctrl+Cmd+Shift+Y"), "linux", one), null);
  assert.deepEqual(
    router(press("Ctrl+Shift+Y"), "linux", {
      ...one,
      [MAXIMIZE]: "not a chord",
    }),
    null,
  );
  let seed = 11;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const maps = [
    {},
    one,
    { [REOPEN]: "Ctrl+Shift+Y", [FOCUS]: "Ctrl+Shift+J" },
    { [REOPEN]: "Ctrl+Shift+M", [MAXIMIZE]: "Ctrl+Shift+H" },
  ];
  const defaultsOf = Object.fromEntries(ov.OVERRIDABLE_IDS.map((id) => [id, ov.defaultChord(id).split("+").at(-1)]));
  for (let run = 0; run < 600; run++) {
    const m = maps[rand(maps.length)];
    const platform = PLATFORMS[rand(3)];
    const letter = "HMDYJBP".charAt(rand(7));
    const event = {
      key: rand(2) ? letter : letter.toLowerCase(),
      ctrlKey: rand(2) === 1,
      metaKey: rand(2) === 1,
      shiftKey: rand(4) !== 0,
      altKey: rand(6) === 0,
      isComposing: rand(8) === 0,
      repeat: rand(5) === 0,
      defaultPrevented: rand(8) === 0,
    };
    const primary =
      platform === "darwin"
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
    const base = primary && event.shiftKey && !event.altKey;
    let expected = null;
    if (Object.keys(m).length > 0 && base) {
      const l = event.key.toUpperCase();
      const hit = Object.keys(m).find((id) => m[id].slice(-1) === l);
      if (!event.isComposing && !event.defaultPrevented && hit) expected = { id: hit };
      else if (Object.keys(m).some((id) => defaultsOf[id] === l))
        expected = { id: null };
    }
    assert.deepEqual(
      router(event, platform, m),
      expected,
      JSON.stringify([m, platform, event]),
    );
  }
});

test("shortcut-overrides wiring: the setting is plain text with the generic rules, the module is pure, and App.tsx adds one block and the effective hints", () => {
  // The setting.
  assert.equal(settings.defaults["shortcuts.overrides"], "");
  const rows = settings.schema.filter((r) => r.key === "shortcuts.overrides");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Workspace");
  assert.equal(rows[0].label, "Shortcut overrides");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(rows[0][field], undefined, field);
  assert.equal(
    settings.schema[settings.schema.length - 1].key,
    "shortcuts.overrides",
  );
  assert.ok(
    !/focus-?mode|focusMode/i.test(read("src/settings.ts")),
    "the focus mode pin of the settings module still holds",
  );
  const good = [
    "workspace.reopenPanel=Ctrl+Shift+J",
    "workspace.reopenPanel=Ctrl+Shift+J,workspace.maximizePanel=Ctrl+Shift+Y,workspace.focusMode=Ctrl+Shift+B",
    "garbage",
  ];
  for (const value of good)
    assert.deepEqual(
      settings.validateOverrides({ "shortcuts.overrides": value }),
      { "shortcuts.overrides": value },
    );
  for (const value of [
    "",
    "   ",
    "{}",
    "a;b",
    "a<b>",
    "a" + String.fromCharCode(10) + "b",
    "x".repeat(1001),
  ])
    assert.throws(
      () => settings.validateOverrides({ "shortcuts.overrides": value }),
      (error) => error.message === "Invalid text for shortcuts.overrides",
      JSON.stringify(value),
    );
  assert.throws(
    () => settings.validateOverrides({ "shortcuts.overrides": 5 }),
    /Wrong value type/,
  );
  assert.deepEqual(
    settings.safeOverrides({ "shortcuts.overrides": "a;b" }),
    {},
  );
  assert.equal(
    settings.resolveSettings({ "shortcuts.overrides": good[0] })[
      "shortcuts.overrides"
    ],
    good[0],
  );
  assert.equal(
    settings.resolveSettings(
      { "shortcuts.overrides": good[0] },
      { "shortcuts.overrides": good[1] },
    )["shortcuts.overrides"],
    good[1],
  );
  assert.equal(settings.resolveSettings()["shortcuts.overrides"], "");
  // The longest text the module writes still passes the generic rule.
  const everything = ov.formatOverrideText({
    [REOPEN]: "Ctrl+Shift+J",
    [MAXIMIZE]: "Ctrl+Shift+Y",
    [FOCUS]: "Ctrl+Shift+B",
  });
  assert.ok(everything.length < ov.MAX_OVERRIDES_TEXT);
  settings.validateOverrides({ "shortcuts.overrides": everything });

  // The module: ASCII, imports only the catalog and the terminal classifier, no DOM, clock, storage or bridge.
  const source = read("src/shortcut-overrides.ts");
  assert.ok(/^[\n\x20-\x7e]*$/.test(source), "ASCII only");
  const code = stripComments(source);
  assert.ok(
    !code.includes(String.fromCharCode(92) + "u"),
    "no backslash-u escape",
  );
  const imports = code
    .split("\n")
    .filter((l) => /^\s*import\b|\bfrom "/.test(l));
  assert.deepEqual(
    imports.map((l) => l.trim()),
    [
      'import { classifyTerminalKey } from "./terminal-keys";',
      'import { shortcutGroups, type Shortcut, type ShortcutGroup } from "./shortcuts";',
    ],
  );
  for (const word of [
    "require",
    "document",
    "React",
    "hrig",
    "Date",
    "performance",
    "setTimeout",
    "fetch",
    "localStorage",
    "sessionStorage",
    "Math.random",
    "export default",
    "async",
    "await",
    "isReopenPanelKey(",
    "isMaximizePanelKey(",
    "isFocusModeKey(",
  ])
    assert.ok(!code.includes(word), "the module mentions " + word);
  assert.ok(!/\bwindow\b/.test(code), "the module mentions window");
  assert.deepEqual(Object.keys(ov).sort(), [
    "EDITOR_SHIFT_LETTERS",
    "MAX_OVERRIDES_TEXT",
    "OVERRIDABLE_IDS",
    "OVERRIDES_SETTING",
    "applyOverrides",
    "chordHint",
    "chordLabel",
    "defaultChord",
    "filterShortcutGroups",
    "findCollisions",
    "formatOverrideText",
    "normalizeChord",
    "parseChord",
    "parseOverrideText",
    "reservedReason",
    "resetOverride",
    "routeOverriddenKey",
    "saveOverride",
    "validateOverrideMap",
    "withEffectiveHints",
  ]);
  assert.equal(
    JSON.stringify(Object.keys(catalog).sort()),
    JSON.stringify([
      "focusModeShortcutHint",
      "hasOpenDialog",
      "isFocusModeKey",
      "isHelpKey",
      "isMaximizePanelKey",
      "isPanelCycleKey",
      "isReopenPanelKey",
      "maximizeShortcutHint",
      "reopenShortcutHint",
      "shortcutGroups",
    ]),
    "the catalog module exports only its known names",
  );

  // App.tsx: one import, one memo, and one map-driven block after terminal-owned controls.
  const app = tight(stripComments(read("src/App.tsx")));
  const has = (text, part) => text.includes(tight(part));
  assert.ok(
    has(
      app,
      'import { chordHint, defaultChord, parseOverrideText, routeOverriddenKey, withEffectiveHints, type OverridableId } from "./shortcut-overrides";',
    ),
  );
  assert.ok(
    has(
      app,
      'const overridesText = preferences["shortcuts.overrides"]; const shortcutOverrides = useMemo( () => parseOverrideText(overridesText, window.hrig?.platform || "unknown").map, [overridesText], );',
    ),
  );
  const handler = app.slice(
    app.indexOf(tight("const handler = (event: KeyboardEvent) => {")),
    app.indexOf(tight("const windows = [")),
  );
  const order = [
    "if (isHelpKey(",
    "if (terminalOwnsKey(",
    "const rebound = routeOverriddenKey(",
    "if (event.ctrlKey || event.metaKey) {",
  ].map((needle) => handler.indexOf(tight(needle)));
  assert.ok(
    order.every((at, i) => at >= 0 && (i === 0 || order[i - 1] < at)),
    "claim order: " + order,
  );
  assert.ok(
    has(
      handler,
      'const rebound = routeOverriddenKey(event, window.hrig.platform, shortcutOverrides); if (rebound !== null) { if (rebound.id === null) return; event.preventDefault(); event.stopPropagation(); const worksWithDialogs = [ "workspace.palette", "workspace.quickOpen", "workspace.sidebar", ].includes(rebound.id); if (!event.repeat && (worksWithDialogs || (modal === null && !hasOpenDialog(event.target)))) runShortcut(rebound.id, event.target); return; }',
    ),
    "the whole block",
  );
  assert.ok(
    has(
      handler,
      "if (event.defaultPrevented || event.isComposing || event.altKey) return;",
    ),
  );
  assert.equal(count(app, "routeOverriddenKey("), 1);
  assert.ok(
    has(
      app,
      "const shownCommands = withEffectiveHints(commands, window.hrig.platform, shortcutOverrides);",
    ),
    "the hints are rebuilt from the effective keys",
  );
  assert.equal(count(app, "withEffectiveHints("), 1);
  assert.ok(has(app, "const item = pickFirst(shownCommands, search);"));
  assert.ok(has(app, "{filterCommands(shownCommands, search)"));
  assert.equal(count(app, "pickFirst(commands"), 0);
  assert.equal(count(app, "filterCommands(commands"), 0);
  assert.equal(count(app, "parseOverrideText("), 1);
  const actions = app.slice(app.indexOf("const runShortcut = (id:"), app.indexOf("useEffect(() => {", app.indexOf("const runShortcut = (id:")));
  for (const id of ov.OVERRIDABLE_IDS)
    assert.ok(actions.includes('case "' + id + '":') || actions.includes('case "' + id + '":{'), "App action for " + id);
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((n) => /\.(ts|tsx)$/.test(n))
    .sort();
  assert.deepEqual(
    files.filter((n) =>
      stripComments(read("src/" + n)).includes("routeOverriddenKey("),
    ),
    ["App.tsx", "shortcut-overrides.ts"],
  );
  assert.deepEqual(
    files.filter((n) => stripComments(read("src/" + n)).includes("isReopenPanelKey(")),
    ["shortcuts.ts"],
  );
  assert.equal(
    count(app, 'addEventListener("keydown"'),
    2,
    "no second handler",
  );
});

test("shortcut-overrides docs: SETTINGS.md has the row and one paragraph that say what can be rebound, the rules and the limits", () => {
  const raw = read("SETTINGS.md");
  assert.ok(!raw.includes("\r"), "no carriage return");
  assert.ok(raw.endsWith("\n") && !raw.endsWith("\n\n"), "one final line feed");
  const lines = raw.split("\n");
  const rows = lines.filter((l) => l.startsWith("| `shortcuts.overrides` |"));
  assert.equal(rows.length, 1);
  assert.ok(/^[\n\x20-\x7e]*$/.test(rows[0]));
  assert.equal(
    lines.indexOf(rows[0]),
    lines.findIndex((l) => l.startsWith("| `notifications.humanItems` |")) + 1,
    "right after the last row",
  );
  for (const part of [
    "| empty |",
    "up to 14 app shortcuts that can be rebound",
    "`workspace.reopenPanel=Ctrl+Shift+J`",
    "Empty (the default) keeps every shortcut as it is",
    "see Shortcut overrides below",
    "nothing is sent to the shell or the seat",
  ])
    assert.ok(rows[0].includes(part), "row: " + part);
  const at = lines.findIndex((l) =>
    l.startsWith(
      "Shortcut overrides: `shortcuts.overrides` keeps the saved key changes as one line of text",
    ),
  );
  assert.ok(at > 0);
  assert.equal(
    lines.filter((l) => l.startsWith("Shortcut overrides:")).length,
    1,
  );
  assert.ok(lines[at - 1] === "" && lines[at + 1] === "");
  assert.ok(lines[at + 2].startsWith("Saved snippet transfer:"));
  assert.equal(lines[at + 3], "");
  assert.ok(lines[at + 4].startsWith("Terminal zoom: Ctrl/Cmd"));
  assert.ok(lines[at - 2] === rows[0], "directly after the table row");
  assert.ok(/^[\x20-\x7e]*$/.test(lines[at]), "printable ASCII on one line");
  for (const part of [
    "comma-separated `id=keys` pairs",
    "a setting holds a single value and the settings checks refuse braces, semicolons and angle brackets",
    "The app shortcut rows with Edit buttons listed in NAVIGATION.md under Shortcut overrides can be rebound",
    "terminal and editor commands remain fixed",
    "Use Ctrl, Cmd, Meta or Mod for the main modifier of your computer",
    "Custom letter chords require Shift",
    "The old keys of a moved shortcut are released to the focused panel",
    "ignored, never an error, and the sheet lists it",
    "Empty (the default) leaves every key and label exactly as before",
    "in the user scope or, when the project already has its own value, in the project scope",
    "there is no separate keymap file",
    "nothing is sent to the shell or the seat",
  ])
    assert.ok(lines[at].includes(part), "paragraph: " + part);
  assert.ok(lines.some((l) => l.startsWith("Saved snippet transfer:")));
  assert.equal(
    lines[0].replace(String.fromCharCode(0xfeff), ""),
    "# HRig settings",
  );
});
