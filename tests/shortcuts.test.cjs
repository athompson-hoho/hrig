const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");

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

const shortcuts = load("src/shortcuts.ts");
const { shortcutGroups, isHelpKey, hasOpenDialog } = shortcuts;
const { isReopenPanelKey, reopenShortcutHint } = shortcuts;
const { isMaximizePanelKey, maximizeShortcutHint } = shortcuts;
const { isFocusModeKey, focusModeShortcutHint } = shortcuts;
const { isPanelCycleKey } = shortcuts;
const { classifyTerminalKey, TERMINAL_PANEL_SELECTOR } = load(
  "src/terminal-keys.ts",
);
const { zoomAction } = load("src/terminal-zoom.ts");

const PLATFORMS = ["darwin", "win32", "linux"];

function press(key, extra = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: key === "?",
    ...extra,
  };
}

function element(tagName, extra = {}) {
  return { tagName, isContentEditable: false, closest: () => null, ...extra };
}

function inside(needle) {
  return (selector) => (String(selector).includes(needle) ? {} : null);
}

function byId(platform) {
  const map = {};
  for (const group of shortcutGroups(platform)) {
    for (const entry of group.shortcuts) map[entry.id] = entry.keys;
  }
  return map;
}

function labelOf(platform, id) {
  for (const group of shortcutGroups(platform)) {
    for (const entry of group.shortcuts)
      if (entry.id === id) return entry.label;
  }
  return undefined;
}

function chord(text) {
  const parts = text.split("+");
  const event = {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  let key = "";
  for (const part of parts) {
    if (part === "Ctrl") event.ctrlKey = true;
    else if (part === "Cmd") event.metaKey = true;
    else if (part === "Shift") event.shiftKey = true;
    else if (part === "Plus") key = "+";
    else if (part === "minus") key = "-";
    else if (part === "comma") key = ",";
    else key = part;
  }
  event.key =
    key.length === 1 && /[a-z]/i.test(key) && event.shiftKey
      ? key.toUpperCase()
      : key;
  return event;
}

test("shortcuts tracer: a bare question mark on the page opens, in a field or under a modal it does not", () => {
  assert.equal(isHelpKey(press("?"), element("BODY"), false), true);
  assert.equal(isHelpKey(press("?"), element("INPUT"), false), false);
  assert.equal(isHelpKey(press("?"), element("BODY"), true), false);
  assert.deepEqual(byId("linux")["workspace.palette"], ["Ctrl+K"]);
  assert.deepEqual(byId("darwin")["workspace.palette"], ["Cmd+K"]);
  assert.deepEqual(
    shortcutGroups("linux").map((g) => g.title),
    ["Workspace", "Terminal", "Editor"],
  );
  assert.deepEqual(Object.keys(shortcuts).sort(), [
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
  ]);
});

test("shortcuts catalog shape is complete on every platform", () => {
  for (const platform of PLATFORMS) {
    const groups = shortcutGroups(platform);
    assert.equal(groups.length, 3);
    const seen = new Set();
    for (const group of groups) {
      assert.ok(group.id && group.title);
      assert.ok(group.shortcuts.length >= 1);
      for (const entry of group.shortcuts) {
        assert.ok(entry.id.startsWith(group.id + "."), entry.id);
        assert.ok(entry.label.length > 0 && entry.label === entry.label.trim());
        assert.ok(Array.isArray(entry.keys) && entry.keys.length > 0);
        for (const key of entry.keys) {
          assert.ok(
            key.length > 0 && key === key.trim() && !key.includes(" "),
            key,
          );
        }
        assert.ok(!seen.has(entry.id), "duplicate id " + entry.id);
        seen.add(entry.id);
      }
    }
    for (const id of [
      "workspace.palette",
      "workspace.quickOpen",
      "workspace.panels",
      "workspace.cyclePanels",
      "workspace.sidebar",
      "workspace.settings",
      "workspace.newShell",
      "workspace.reopenPanel",
      "workspace.maximizePanel",
      "workspace.focusMode",
      "workspace.shortcuts",
      "terminal.clear",
      "editor.save",
      "editor.gotoLine",
    ]) {
      assert.ok(seen.has(id), platform + " is missing " + id);
    }
  }
});

test("shortcuts labels follow the platform", () => {
  assert.deepEqual(byId("darwin"), {
    "workspace.palette": ["Cmd+K"],
    "workspace.quickOpen": ["Cmd+P"],
    "workspace.panels": ["Cmd+Shift+P"],
    "workspace.cyclePanels": ["Ctrl+Tab", "Ctrl+Shift+Tab"],
    "workspace.settings": ["Cmd+comma"],
    "workspace.openProject": ["Cmd+O"],
    "workspace.sidebar": ["Cmd+B"],
    "workspace.newShell": ["Cmd+Shift+T"],
    "workspace.reopenPanel": ["Cmd+Shift+H"],
    "workspace.maximizePanel": ["Cmd+Shift+M"],
    "workspace.focusMode": ["Cmd+Shift+D"],
    "workspace.shortcuts": ["?"],
    "terminal.find": ["Cmd+F"],
    "terminal.copy": ["Cmd+C"],
    "terminal.paste": ["Cmd+V"],
    "terminal.clear": ["Cmd+K"],
    "terminal.interrupt": ["Ctrl+C"],
    "terminal.zoomIn": ["Cmd+=", "Cmd+Plus"],
    "terminal.zoomOut": ["Cmd+minus"],
    "terminal.zoomReset": ["Cmd+0"],
    "editor.save": ["Cmd+S"],
    "editor.gotoLine": ["Ctrl+G"],
  });
  const linux = {
    "workspace.palette": ["Ctrl+K"],
    "workspace.quickOpen": ["Ctrl+P"],
    "workspace.panels": ["Ctrl+Shift+P"],
    "workspace.cyclePanels": ["Ctrl+Tab", "Ctrl+Shift+Tab"],
    "workspace.settings": ["Ctrl+comma"],
    "workspace.openProject": ["Ctrl+O"],
    "workspace.sidebar": ["Ctrl+B"],
    "workspace.newShell": ["Ctrl+Shift+T"],
    "workspace.reopenPanel": ["Ctrl+Shift+H"],
    "workspace.maximizePanel": ["Ctrl+Shift+M"],
    "workspace.focusMode": ["Ctrl+Shift+D"],
    "workspace.shortcuts": ["?"],
    "terminal.find": ["Ctrl+F"],
    "terminal.copy": ["Ctrl+Shift+C"],
    "terminal.paste": ["Ctrl+V", "Ctrl+Shift+V"],
    "terminal.clear": ["Ctrl+Shift+K"],
    "terminal.interrupt": ["Ctrl+C"],
    "terminal.zoomIn": ["Ctrl+=", "Ctrl+Plus"],
    "terminal.zoomOut": ["Ctrl+minus"],
    "terminal.zoomReset": ["Ctrl+0"],
    "editor.save": ["Ctrl+S"],
    "editor.gotoLine": ["Ctrl+G"],
  };
  assert.deepEqual(byId("linux"), linux);
  for (const platform of ["win32", "freebsd", ""]) {
    assert.deepEqual(byId(platform), linux, platform || "(empty)");
  }
  assert.match(labelOf("darwin", "workspace.palette"), /Cmd\+K clears/);
  assert.ok(!labelOf("linux", "workspace.palette").includes("clears"));
  assert.match(labelOf("linux", "terminal.interrupt"), /Ctrl\+C copies/);
  assert.ok(!labelOf("darwin", "terminal.interrupt").includes("copies"));
});

test("shortcuts have no duplicate key inside a group", () => {
  const repeated = {};
  for (const platform of PLATFORMS) {
    const all = [];
    for (const group of shortcutGroups(platform)) {
      const inGroup = group.shortcuts.flatMap((s) =>
        s.keys.map((k) => k.toLowerCase()),
      );
      assert.equal(
        new Set(inGroup).size,
        inGroup.length,
        platform + " " + group.id,
      );
      all.push(...inGroup);
    }
    repeated[platform] = [
      ...new Set(all.filter((k, i) => all.indexOf(k) !== i)),
    ];
  }
  assert.deepEqual(repeated, { darwin: ["cmd+k"], win32: [], linux: [] });
});

test("shortcuts terminal chords agree with the terminal key classifier", () => {
  const expected = {
    "terminal.find": "find",
    "terminal.copy": "copy",
    "terminal.paste": "paste",
    "terminal.clear": "clear",
    "terminal.interrupt": "pass",
  };
  for (const platform of PLATFORMS) {
    const map = byId(platform);
    for (const [id, action] of Object.entries(expected)) {
      for (const key of map[id]) {
        const selected = id === "terminal.copy";
        assert.equal(
          classifyTerminalKey(chord(key), platform, selected),
          action,
          platform + " " + id + " " + key,
        );
      }
    }
    assert.equal(classifyTerminalKey(chord("Ctrl+K"), platform, false), "pass");
  }
  assert.equal(classifyTerminalKey(chord("Ctrl+C"), "linux", true), "copy");
  assert.equal(classifyTerminalKey(chord("Cmd+C"), "darwin", true), "copy");
  assert.equal(classifyTerminalKey(chord("Ctrl+C"), "darwin", true), "pass");
});

test("shortcuts zoom chords agree with the zoom action", () => {
  for (const platform of PLATFORMS) {
    const map = byId(platform);
    for (const key of map["terminal.zoomIn"])
      assert.equal(zoomAction(chord(key)), "in", key);
    for (const key of map["terminal.zoomOut"])
      assert.equal(zoomAction(chord(key)), "out", key);
    for (const key of map["terminal.zoomReset"]) {
      assert.equal(zoomAction(chord(key)), "reset", key);
    }
  }
});

test("shortcuts isHelpKey accepts a bare question mark on the page", () => {
  for (const target of [
    element("BODY"),
    element("BUTTON"),
    element("DIV"),
    element("A"),
    { querySelector: () => null },
    {},
  ]) {
    assert.equal(isHelpKey(press("?"), target, false), true);
  }
  assert.equal(
    isHelpKey(press("?", { shiftKey: true }), element("BODY"), false),
    true,
  );
  assert.equal(
    isHelpKey(press("?", { shiftKey: false }), element("BODY"), false),
    true,
  );
  const event = Object.freeze(press("?"));
  assert.equal(isHelpKey(event, Object.freeze(element("BODY")), false), true);
});

test("shortcuts isHelpKey is false in fields, the editor, a terminal and under a modal", () => {
  for (const tag of [
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "input",
    "textarea",
    "select",
  ]) {
    assert.equal(isHelpKey(press("?"), element(tag), false), false, tag);
  }
  assert.equal(
    isHelpKey(press("?"), element("DIV", { isContentEditable: true }), false),
    false,
  );
  assert.equal(
    isHelpKey(
      press("?"),
      element("SPAN", { closest: inside("monaco-editor") }),
      false,
    ),
    false,
  );
  assert.equal(
    isHelpKey(
      press("?"),
      element("DIV", { closest: inside("terminal-panel") }),
      false,
    ),
    false,
  );
  assert.equal(TERMINAL_PANEL_SELECTOR, ".terminal-panel");
  assert.equal(isHelpKey(press("?"), element("BUTTON"), true), false);
  assert.equal(isHelpKey(press("?"), element("BODY"), true), false);
  assert.equal(isHelpKey(press("?"), null, false), false);
  assert.equal(isHelpKey(press("?"), undefined, false), false);
  assert.equal(
    isHelpKey(
      press("?"),
      element("DIV", { closest: inside("sidebar") }),
      false,
    ),
    true,
  );
});

test("shortcuts isHelpKey needs the bare question mark key", () => {
  const body = element("BODY");
  for (const extra of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
    { isComposing: true },
    { repeat: true },
    { defaultPrevented: true },
  ]) {
    assert.equal(
      isHelpKey(press("?", extra), body, false),
      false,
      JSON.stringify(extra),
    );
  }
  for (const key of ["/", "？", "Process", ""]) {
    assert.equal(
      isHelpKey(press(key, { shiftKey: false }), body, false),
      false,
      key,
    );
    assert.equal(
      isHelpKey(press(key, { shiftKey: true }), body, false),
      false,
      key,
    );
  }
  assert.equal(
    isHelpKey({ ctrlKey: false, metaKey: false, altKey: false }, body, false),
    false,
  );
});

test("shortcuts hasOpenDialog looks for an aria-modal dialog in the target document", () => {
  const asked = [];
  const doc = (found) => ({
    querySelector: (selector) => {
      asked.push(selector);
      return found ? {} : null;
    },
  });
  assert.equal(hasOpenDialog({ ownerDocument: doc(true) }), true);
  assert.equal(hasOpenDialog({ ownerDocument: doc(false) }), false);
  assert.equal(hasOpenDialog({ ownerDocument: null, ...doc(true) }), true);
  assert.deepEqual([...new Set(asked)], ['[aria-modal="true"]']);
  for (const value of [null, undefined, {}, { ownerDocument: {} }, "x", 7]) {
    assert.equal(hasOpenDialog(value), false);
  }
});

test("shortcuts catalog is rebuilt on every call", () => {
  const first = shortcutGroups("linux");
  first[0].shortcuts[0].keys.push("X");
  first.pop();
  const next = shortcutGroups("linux");
  assert.equal(next.length, 3);
  assert.deepEqual(next[0].shortcuts[0].keys, ["Ctrl+K"]);
  assert.deepEqual(shortcutGroups("linux"), shortcutGroups("linux"));
  assert.notEqual(shortcutGroups("linux"), shortcutGroups("linux"));
  const [help] = byId("linux")["workspace.shortcuts"];
  assert.equal(isHelpKey(press(help), element("DIV"), false), true);
});

function reopenEvent(extra = {}) {
  return {
    key: "H",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    ...extra,
  };
}

test("shortcuts reopen chord is Shift+H with Cmd on macOS or Ctrl elsewhere and nothing else", () => {
  for (const platform of PLATFORMS) {
    const [text, ...more] = byId(platform)["workspace.reopenPanel"];
    assert.equal(more.length, 0);
    assert.equal(text, platform === "darwin" ? "Cmd+Shift+H" : "Ctrl+Shift+H");
    assert.equal(isReopenPanelKey(chord(text), platform), true, platform);
    assert.equal(reopenShortcutHint(platform), text.split("+").join(" "));
    assert.match(
      labelOf(platform, "workspace.reopenPanel"),
      /Reopen the file or seat panel closed last/,
    );
  }
  assert.equal(reopenShortcutHint(""), "Ctrl Shift H");
  assert.equal(reopenShortcutHint("freebsd"), "Ctrl Shift H");
  const lower = { key: "h", metaKey: true, ctrlKey: false };
  assert.equal(isReopenPanelKey(reopenEvent(lower), "darwin"), true);
  assert.equal(isReopenPanelKey(reopenEvent({ key: "h" }), "linux"), true);
  for (const platform of ["win32", "linux", "freebsd", ""]) {
    assert.equal(isReopenPanelKey(reopenEvent(), platform), true, platform);
    for (const extra of [
      { metaKey: true },
      { ctrlKey: false },
      { ctrlKey: false, metaKey: true },
    ])
      assert.equal(
        isReopenPanelKey(reopenEvent(extra), platform),
        false,
        platform + JSON.stringify(extra),
      );
  }
  for (const extra of [
    { ctrlKey: true, metaKey: false },
    { ctrlKey: true, metaKey: true },
    { ctrlKey: false, metaKey: false },
  ])
    assert.equal(
      isReopenPanelKey(reopenEvent(extra), "darwin"),
      false,
      "darwin " + JSON.stringify(extra),
    );
  for (const platform of PLATFORMS) {
    const mod =
      platform === "darwin"
        ? { ctrlKey: false, metaKey: true }
        : { ctrlKey: true, metaKey: false };
    assert.equal(isReopenPanelKey(reopenEvent(mod), platform), true);
    for (const extra of [
      { shiftKey: false },
      { altKey: true },
      { altKey: true, ctrlKey: true },
      { isComposing: true },
      { repeat: true },
      { defaultPrevented: true },
      { key: "T" },
      { key: "E" },
      { key: "G" },
      { key: "" },
      { key: "Process" },
      { key: undefined },
      { key: 72 },
    ])
      assert.equal(
        isReopenPanelKey(reopenEvent({ ...mod, ...extra }), platform),
        false,
        platform + JSON.stringify(extra),
      );
    for (const key of "abcdefgijklmnopqrstuvwxyz0123456789,.-=") {
      assert.equal(
        isReopenPanelKey(reopenEvent({ ...mod, key }), platform),
        false,
        platform + key,
      );
    }
  }
});

test("shortcuts reopen chord is claimed by no terminal, zoom, help, editor or app binding", () => {
  for (const platform of PLATFORMS) {
    const text = byId(platform)["workspace.reopenPanel"][0];
    for (const selected of [false, true])
      assert.equal(
        classifyTerminalKey(chord(text), platform, selected),
        "pass",
        platform + " terminal " + selected,
      );
    assert.equal(zoomAction(chord(text)), null, platform + " zoom");
    assert.equal(isHelpKey(chord(text), element("BODY"), false), false);
    const all = [];
    for (const group of shortcutGroups(platform))
      for (const entry of group.shortcuts)
        for (const key of entry.keys) all.push([entry.id, key]);
    assert.deepEqual(
      all.filter(([, key]) => key.toLowerCase() === text.toLowerCase()),
      [["workspace.reopenPanel", text]],
      platform + " the chord is listed once",
    );
    for (const [id, key] of all) {
      if (id === "workspace.reopenPanel" || !key.includes("+")) continue;
      assert.equal(
        isReopenPanelKey(chord(key), platform),
        false,
        platform + " " + id + " " + key,
      );
    }
  }
  assert.deepEqual(
    classifyTerminalKey(chord("Ctrl+H"), "linux", false),
    "pass",
    "plain Ctrl+H is not the reopen chord",
  );
  assert.equal(isReopenPanelKey(chord("Ctrl+H"), "linux"), false);
  assert.equal(isReopenPanelKey(chord("Ctrl+Shift+H"), "darwin"), false);
  const editor = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "EditorPanel.tsx"),
    "utf8",
  );
  assert.equal(
    editor.split("editor.addCommand(").length - 1,
    1,
    "the editor registers one command of its own",
  );
  assert.ok(
    /editor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,/.test(
      editor,
    ),
    "and it is Save, so Ctrl+Shift+H is never a Monaco command",
  );
});

function maximizeEvent(extra = {}) {
  return {
    key: "M",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    ...extra,
  };
}

test("shortcuts maximize chord is Shift+M with Cmd on macOS or Ctrl elsewhere and nothing else", () => {
  for (const platform of PLATFORMS) {
    const [text, ...more] = byId(platform)["workspace.maximizePanel"];
    assert.equal(more.length, 0);
    assert.equal(text, platform === "darwin" ? "Cmd+Shift+M" : "Ctrl+Shift+M");
    assert.equal(isMaximizePanelKey(chord(text), platform), true, platform);
    assert.equal(maximizeShortcutHint(platform), text.split("+").join(" "));
    assert.match(
      labelOf(platform, "workspace.maximizePanel"),
      /Maximize or restore the focused panel group/,
    );
    const reopen = byId(platform)["workspace.reopenPanel"][0];
    assert.equal(isMaximizePanelKey(chord(reopen), platform), false);
    assert.equal(isReopenPanelKey(chord(text), platform), false);
  }
  assert.equal(maximizeShortcutHint(""), "Ctrl Shift M");
  assert.equal(maximizeShortcutHint("freebsd"), "Ctrl Shift M");
  const lower = { key: "m", metaKey: true, ctrlKey: false };
  assert.equal(isMaximizePanelKey(maximizeEvent(lower), "darwin"), true);
  assert.equal(isMaximizePanelKey(maximizeEvent({ key: "m" }), "linux"), true);
  for (const platform of ["win32", "linux", "freebsd", ""]) {
    assert.equal(isMaximizePanelKey(maximizeEvent(), platform), true, platform);
    for (const extra of [
      { metaKey: true },
      { ctrlKey: false },
      { ctrlKey: false, metaKey: true },
    ])
      assert.equal(
        isMaximizePanelKey(maximizeEvent(extra), platform),
        false,
        platform + JSON.stringify(extra),
      );
  }
  for (const extra of [
    { ctrlKey: true, metaKey: false },
    { ctrlKey: true, metaKey: true },
    { ctrlKey: false, metaKey: false },
  ])
    assert.equal(
      isMaximizePanelKey(maximizeEvent(extra), "darwin"),
      false,
      "darwin " + JSON.stringify(extra),
    );
  for (const platform of PLATFORMS) {
    const mod =
      platform === "darwin"
        ? { ctrlKey: false, metaKey: true }
        : { ctrlKey: true, metaKey: false };
    assert.equal(isMaximizePanelKey(maximizeEvent(mod), platform), true);
    for (const extra of [
      { shiftKey: false },
      { altKey: true },
      { altKey: true, ctrlKey: true },
      { isComposing: true },
      { repeat: true },
      { defaultPrevented: true },
      { key: "H" },
      { key: "T" },
      { key: "Escape" },
      { key: "" },
      { key: "Process" },
      { key: undefined },
      { key: 77 },
    ])
      assert.equal(
        isMaximizePanelKey(maximizeEvent({ ...mod, ...extra }), platform),
        false,
        platform + JSON.stringify(extra),
      );
    for (const key of "abcdefghijklnopqrstuvwxyz0123456789,.-=") {
      assert.equal(
        isMaximizePanelKey(maximizeEvent({ ...mod, key }), platform),
        false,
        platform + key,
      );
    }
  }
});

test("shortcuts maximize chord is claimed by no terminal, zoom, help, editor, app or Monaco binding", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const platform of PLATFORMS) {
    const text = byId(platform)["workspace.maximizePanel"][0];
    for (const selected of [false, true])
      assert.equal(
        classifyTerminalKey(chord(text), platform, selected),
        "pass",
        platform + " terminal " + selected,
      );
    assert.equal(zoomAction(chord(text)), null, platform + " zoom");
    assert.equal(isHelpKey(chord(text), element("BODY"), false), false);
    const all = [];
    for (const group of shortcutGroups(platform))
      for (const entry of group.shortcuts)
        for (const key of entry.keys) all.push([entry.id, key]);
    assert.deepEqual(
      all.filter(([, key]) => key.toLowerCase() === text.toLowerCase()),
      [["workspace.maximizePanel", text]],
      platform + " the chord is listed once",
    );
    for (const [id, key] of all) {
      if (id === "workspace.maximizePanel" || !key.includes("+")) continue;
      assert.equal(
        isMaximizePanelKey(chord(key), platform),
        false,
        platform + " " + id + " " + key,
      );
    }
  }
  assert.deepEqual(
    classifyTerminalKey(chord("Ctrl+M"), "linux", false),
    "pass",
    "plain Ctrl+M is not the maximize chord",
  );
  assert.equal(isMaximizePanelKey(chord("Ctrl+M"), "linux"), false);
  assert.equal(isMaximizePanelKey(chord("Ctrl+Shift+M"), "darwin"), false);
  assert.equal(isMaximizePanelKey(chord("Cmd+M"), "darwin"), false);
  const editor = fs.readFileSync(
    path.join(__dirname, "..", "src", "EditorPanel.tsx"),
    "utf8",
  );
  assert.equal(
    editor.split("editor.addCommand(").length - 1,
    1,
    "the editor registers one command of its own",
  );
  assert.ok(
    /editor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,/.test(
      editor,
    ),
    "and it is Save, so Ctrl+Shift+M is never a Monaco command of the app",
  );

  // Monaco's own bindings, read from the installed package: re-audit on an upgrade.
  const monaco = path.join(__dirname, "..", "node_modules", "monaco-editor");
  const version = JSON.parse(
    fs.readFileSync(path.join(monaco, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.56\./,
    "Monaco changed to " + version + ": audit Shift+M again",
  );
  const KEY_M = "43 /\\* KeyCode\\.KeyM \\*/";
  const CTRL_CMD = "2048 /\\* KeyMod\\.CtrlCmd \\*/";
  const WIN_CTRL = "256 /\\* KeyMod\\.WinCtrl \\*/";
  const SHIFT = "1024 /\\* KeyMod\\.Shift \\*/";
  const cmdShiftM = [
    new RegExp(CTRL_CMD + " \\| " + SHIFT + " \\| " + KEY_M),
    new RegExp(SHIFT + " \\| " + CTRL_CMD + " \\| " + KEY_M),
  ];
  const controlShiftM = new RegExp(
    WIN_CTRL + " \\| " + SHIFT + " \\| " + KEY_M,
  );
  const plainCtrlM = new RegExp(CTRL_CMD + " \\| " + KEY_M);
  const found = { cmdShiftM: [], controlShiftM: [], plainCtrlM: [] };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(file, "utf8");
        if (!source.includes("KeyCode.KeyM")) continue;
        const name = path.relative(monaco, file);
        if (cmdShiftM.some((re) => re.test(source))) found.cmdShiftM.push(name);
        if (controlShiftM.test(source)) found.controlShiftM.push(name);
        if (plainCtrlM.test(source)) found.plainCtrlM.push(name);
      }
    }
  };
  walk(path.join(monaco, "esm", "vs", "editor"));
  const toggle = path.join(
    "esm",
    "vs",
    "editor",
    "contrib",
    "toggleTabFocusMode",
    "browser",
    "toggleTabFocusMode.js",
  );
  assert.deepEqual(
    found.cmdShiftM,
    [],
    "no Monaco command is Ctrl or Cmd with Shift+M",
  );
  assert.deepEqual(
    found.controlShiftM,
    [toggle],
    "macOS Control+Shift+M is the only Shift+M, and the chord there is Cmd",
  );
  assert.deepEqual(
    found.plainCtrlM,
    [toggle],
    "plain Ctrl+M is the only other M binding",
  );
});

function focusEvent(extra = {}) {
  return {
    key: "D",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
    ...extra,
  };
}

test("shortcuts focus mode chord is Shift+D with Cmd on macOS or Ctrl elsewhere and nothing else", () => {
  for (const platform of PLATFORMS) {
    const [text, ...more] = byId(platform)["workspace.focusMode"];
    assert.equal(more.length, 0);
    assert.equal(text, platform === "darwin" ? "Cmd+Shift+D" : "Ctrl+Shift+D");
    assert.equal(isFocusModeKey(chord(text), platform), true, platform);
    assert.equal(focusModeShortcutHint(platform), text.split("+").join(" "));
    assert.match(
      labelOf(platform, "workspace.focusMode"),
      /Hide or show the sidebar and status bar \(focus mode\)/,
    );
    for (const id of ["workspace.reopenPanel", "workspace.maximizePanel"]) {
      const other = byId(platform)[id][0];
      assert.equal(isFocusModeKey(chord(other), platform), false, id);
    }
    assert.equal(isReopenPanelKey(chord(text), platform), false);
    assert.equal(isMaximizePanelKey(chord(text), platform), false);
  }
  assert.equal(focusModeShortcutHint(""), "Ctrl Shift D");
  assert.equal(focusModeShortcutHint("freebsd"), "Ctrl Shift D");
  const lower = { key: "d", metaKey: true, ctrlKey: false };
  assert.equal(isFocusModeKey(focusEvent(lower), "darwin"), true);
  assert.equal(isFocusModeKey(focusEvent({ key: "d" }), "linux"), true);
  for (const platform of ["win32", "linux", "freebsd", ""]) {
    assert.equal(isFocusModeKey(focusEvent(), platform), true, platform);
    for (const extra of [
      { metaKey: true },
      { ctrlKey: false },
      { ctrlKey: false, metaKey: true },
    ])
      assert.equal(
        isFocusModeKey(focusEvent(extra), platform),
        false,
        platform + JSON.stringify(extra),
      );
  }
  for (const extra of [
    { ctrlKey: true, metaKey: false },
    { ctrlKey: true, metaKey: true },
    { ctrlKey: false, metaKey: false },
  ])
    assert.equal(
      isFocusModeKey(focusEvent(extra), "darwin"),
      false,
      "darwin " + JSON.stringify(extra),
    );
  for (const platform of PLATFORMS) {
    const mod =
      platform === "darwin"
        ? { ctrlKey: false, metaKey: true }
        : { ctrlKey: true, metaKey: false };
    assert.equal(isFocusModeKey(focusEvent(mod), platform), true);
    for (const extra of [
      { shiftKey: false },
      { altKey: true },
      { altKey: true, ctrlKey: true },
      { isComposing: true },
      { repeat: true },
      { defaultPrevented: true },
      { key: "H" },
      { key: "M" },
      { key: "T" },
      { key: "Escape" },
      { key: "" },
      { key: "Process" },
      { key: undefined },
      { key: 68 },
    ])
      assert.equal(
        isFocusModeKey(focusEvent({ ...mod, ...extra }), platform),
        false,
        platform + JSON.stringify(extra),
      );
    for (const key of "abcefghijklmnopqrstuvwxyz0123456789,.-=") {
      assert.equal(
        isFocusModeKey(focusEvent({ ...mod, key }), platform),
        false,
        platform + key,
      );
    }
  }
});

test("shortcuts focus mode chord is claimed by no terminal, zoom, help, editor, app or Monaco binding", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const platform of PLATFORMS) {
    const text = byId(platform)["workspace.focusMode"][0];
    for (const selected of [false, true])
      assert.equal(
        classifyTerminalKey(chord(text), platform, selected),
        "pass",
        platform + " terminal " + selected,
      );
    assert.equal(zoomAction(chord(text)), null, platform + " zoom");
    assert.equal(isHelpKey(chord(text), element("BODY"), false), false);
    const all = [];
    for (const group of shortcutGroups(platform))
      for (const entry of group.shortcuts)
        for (const key of entry.keys) all.push([entry.id, key]);
    assert.deepEqual(
      all.filter(([, key]) => key.toLowerCase() === text.toLowerCase()),
      [["workspace.focusMode", text]],
      platform + " the chord is listed once",
    );
    for (const [id, key] of all) {
      if (id === "workspace.focusMode" || !key.includes("+")) continue;
      assert.equal(
        isFocusModeKey(chord(key), platform),
        false,
        platform + " " + id + " " + key,
      );
    }
  }
  assert.equal(
    classifyTerminalKey(chord("Ctrl+D"), "linux", false),
    "pass",
    "plain Ctrl+D is not the focus mode chord",
  );
  assert.equal(isFocusModeKey(chord("Ctrl+D"), "linux"), false);
  assert.equal(isFocusModeKey(chord("Ctrl+Shift+D"), "darwin"), false);
  assert.equal(isFocusModeKey(chord("Cmd+D"), "darwin"), false);
  const editor = fs.readFileSync(
    path.join(__dirname, "..", "src", "EditorPanel.tsx"),
    "utf8",
  );
  assert.equal(
    editor.split("editor.addCommand(").length - 1,
    1,
    "the editor registers one command of its own",
  );
  assert.ok(
    /editor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,/.test(
      editor,
    ),
    "and it is Save, so Ctrl+Shift+D is never a Monaco command of the app",
  );

  // Monaco's own bindings, read from the installed package: re-audit on an upgrade.
  const monaco = path.join(__dirname, "..", "node_modules", "monaco-editor");
  const version = JSON.parse(
    fs.readFileSync(path.join(monaco, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.56\./,
    "Monaco changed to " + version + ": audit Shift+D again",
  );
  const found = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) {
        const lines = fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.includes("KeyCode.KeyD */"));
        if (lines.length > 0) found[path.relative(monaco, file)] = lines;
      }
    }
  };
  walk(path.join(monaco, "esm", "vs", "editor"));
  const names = Object.keys(found).sort();
  assert.deepEqual(
    names.map((name) => path.basename(name)),
    ["coreCommands.js", "multicursor.js"],
    "only these Monaco files bind the D key",
  );
  for (const lines of Object.values(found))
    for (const line of lines)
      assert.ok(
        !line.includes("KeyMod.Shift"),
        "a Monaco D binding uses Shift: " + line.trim(),
      );
  const multicursor = found[names.find((n) => n.endsWith("multicursor.js"))];
  assert.equal(multicursor.length, 2, "add next match and its K D chord");
  const core = found[names.find((n) => n.endsWith("coreCommands.js"))];
  assert.equal(core.length, 1);
  assert.ok(
    core[0].includes("256 /* KeyMod.WinCtrl */ | 34 /* KeyCode.KeyD */"),
    "macOS Control+D (delete right) is the only other D binding",
  );
});

test("shortcuts go to line is Monaco's Ctrl+G, listed once after Save in the Editor group, and no terminal, zoom, help or app chord claims it", () => {
  for (const platform of [...PLATFORMS, "freebsd", ""]) {
    const group = shortcutGroups(platform).find((g) => g.id === "editor");
    assert.deepEqual(
      group.shortcuts.map((s) => s.id),
      ["editor.save", "editor.gotoLine"],
      platform,
    );
    assert.deepEqual(byId(platform)["editor.gotoLine"], ["Ctrl+G"], platform);
    const all = [];
    for (const entry of shortcutGroups(platform).flatMap((g) => g.shortcuts))
      for (const key of entry.keys) all.push([entry.id, key]);
    assert.deepEqual(
      all.filter(([, key]) => key.toLowerCase() === "ctrl+g"),
      [["editor.gotoLine", "Ctrl+G"]],
      platform + " the chord is listed once",
    );
    for (const text of ["Ctrl+G", "Cmd+G", "Ctrl+Shift+G", "Cmd+Shift+G"]) {
      for (const selected of [false, true])
        assert.equal(
          classifyTerminalKey(chord(text), platform, selected),
          "pass",
          platform + " " + text,
        );
      assert.equal(zoomAction(chord(text)), null, platform + " " + text);
      assert.equal(isHelpKey(chord(text), element("BODY"), false), false);
      assert.equal(isReopenPanelKey(chord(text), platform), false);
      assert.equal(isMaximizePanelKey(chord(text), platform), false);
      assert.equal(isFocusModeKey(chord(text), platform), false);
    }
  }
  assert.match(
    labelOf("darwin", "editor.gotoLine"),
    /^Go to a line and column \(the Control key; Cmd\+G finds the next match\)$/,
  );
  for (const platform of ["win32", "linux", "freebsd", ""])
    assert.equal(
      labelOf(platform, "editor.gotoLine"),
      "Go to a line and column",
      platform,
    );
});

test("shortcuts panel switch chord is Ctrl+Tab with or without Shift, the Control key on every platform and nothing else, listed once after Find open panels", () => {
  const platforms = [...PLATFORMS, "freebsd", ""];
  for (const platform of platforms) {
    assert.equal(isPanelCycleKey(chord("Ctrl+Tab")), true, platform);
    assert.equal(isPanelCycleKey(chord("Ctrl+Shift+Tab")), true, platform);
    assert.equal(isPanelCycleKey({ ...chord("Ctrl+Tab"), repeat: true }), true);
    for (const text of ["Tab", "Shift+Tab", "Cmd+Tab", "Cmd+Shift+Tab"])
      assert.equal(isPanelCycleKey(chord(text)), false, platform + " " + text);
    for (const extra of [
      { altKey: true },
      { metaKey: true },
      { isComposing: true },
      { defaultPrevented: true },
      { key: "tab" },
      { key: "Dead" },
      { key: "" },
    ])
      assert.equal(
        isPanelCycleKey({ ...chord("Ctrl+Tab"), ...extra }),
        false,
        JSON.stringify(extra),
      );
    for (const text of ["Ctrl+K", "Ctrl+Shift+P", "Ctrl+Shift+H", "Ctrl+P"])
      assert.equal(isPanelCycleKey(chord(text)), false, platform + " " + text);
    const keys = byId(platform)["workspace.cyclePanels"];
    assert.deepEqual(keys, ["Ctrl+Tab", "Ctrl+Shift+Tab"], platform);
    for (const key of keys)
      assert.equal(isPanelCycleKey(chord(key)), true, key);
    const group = shortcutGroups(platform).find((g) => g.id === "workspace");
    const ids = group.shortcuts.map((s) => s.id);
    assert.equal(
      ids[ids.indexOf("workspace.panels") + 1],
      "workspace.cyclePanels",
      platform + " listed right after Find open panels",
    );
    assert.equal(ids.filter((id) => id === "workspace.cyclePanels").length, 1);
    // No terminal, zoom, help or other app chord claims it.
    for (const key of keys) {
      for (const selected of [false, true])
        assert.equal(
          classifyTerminalKey(chord(key), platform, selected),
          "pass",
          platform + " terminal " + key,
        );
      assert.equal(zoomAction(chord(key)), null, platform + " zoom " + key);
      assert.equal(isHelpKey(chord(key), element("BODY"), false), false);
      assert.equal(isReopenPanelKey(chord(key), platform), false);
      assert.equal(isMaximizePanelKey(chord(key), platform), false);
      assert.equal(isFocusModeKey(chord(key), platform), false);
    }
    const all = [];
    for (const entry of shortcutGroups(platform).flatMap((g) => g.shortcuts))
      for (const key of entry.keys) all.push([entry.id, key]);
    assert.deepEqual(
      all.filter(([, key]) => /tab$/i.test(key)),
      [
        ["workspace.cyclePanels", "Ctrl+Tab"],
        ["workspace.cyclePanels", "Ctrl+Shift+Tab"],
      ],
      platform + " the only Tab chords",
    );
    for (const [id, key] of all) {
      if (id === "workspace.cyclePanels") continue;
      assert.equal(isPanelCycleKey(chord(key)), false, id + " " + key);
    }
  }
  assert.equal(
    labelOf("darwin", "workspace.cyclePanels"),
    "Switch panels in most recently used order (the Control key; Shift goes back)",
  );
  for (const platform of ["win32", "linux", "freebsd", ""])
    assert.equal(
      labelOf(platform, "workspace.cyclePanels"),
      "Switch panels in most recently used order (Shift goes back)",
      platform,
    );

  // The terminal would get a plain Tab from xterm and Monaco binds no Control Tab: read from the installed packages, so an upgrade re-audits this.
  const fs = require("node:fs");
  const path = require("node:path");
  const modules = path.join(__dirname, "..", "node_modules");
  const xterm = fs.readFileSync(
    path.join(modules, "@xterm", "xterm", "lib", "xterm.js"),
    "utf8",
  );
  assert.match(
    xterm,
    /case 9:if\(\w+\.shiftKey\)\{\w+\.key=\w+\.C0\.ESC\+"\[Z";break\}\w+\.key=\w+\.C0\.HT,\w+\.cancel=!0;break;/,
    "xterm sends Tab for Ctrl+Tab and Shift+Tab for Ctrl+Shift+Tab: the handler must claim them",
  );
  const monaco = path.join(modules, "monaco-editor");
  const version = JSON.parse(
    fs.readFileSync(path.join(monaco, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.56\./,
    "Monaco changed to " + version + ": audit Ctrl+Tab again",
  );
  const tabLines = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js"))
        for (const line of fs.readFileSync(file, "utf8").split("\n"))
          if (line.includes("KeyCode.Tab */")) tabLines.push(line);
    }
  };
  walk(path.join(monaco, "esm", "vs"));
  assert.ok(tabLines.length > 20, "the scan finds Monaco's Tab bindings");
  for (const line of tabLines)
    assert.ok(
      !/KeyMod\.(CtrlCmd|WinCtrl|Alt) \*\/ \| 2 \/\* KeyCode\.Tab/.test(line),
      "a Monaco binding uses Control or Alt with Tab: " + line.trim(),
    );
});
