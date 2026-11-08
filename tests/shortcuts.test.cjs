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
    "hasOpenDialog",
    "isHelpKey",
    "isReopenPanelKey",
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
      "workspace.sidebar",
      "workspace.settings",
      "workspace.newShell",
      "workspace.reopenPanel",
      "workspace.shortcuts",
      "terminal.clear",
      "editor.save",
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
    "workspace.settings": ["Cmd+comma"],
    "workspace.openProject": ["Cmd+O"],
    "workspace.sidebar": ["Cmd+B"],
    "workspace.newShell": ["Cmd+Shift+T"],
    "workspace.reopenPanel": ["Cmd+Shift+H"],
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
  });
  const linux = {
    "workspace.palette": ["Ctrl+K"],
    "workspace.quickOpen": ["Ctrl+P"],
    "workspace.panels": ["Ctrl+Shift+P"],
    "workspace.settings": ["Ctrl+comma"],
    "workspace.openProject": ["Ctrl+O"],
    "workspace.sidebar": ["Ctrl+B"],
    "workspace.newShell": ["Ctrl+Shift+T"],
    "workspace.reopenPanel": ["Ctrl+Shift+H"],
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
