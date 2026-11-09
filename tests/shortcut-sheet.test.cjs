"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

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

function bundle(entry, external = []) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
    logLevel: "silent",
  });
  return built.outputFiles[0].text;
}
function load(entry, fakes = {}) {
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const shortcuts = load("src/shortcuts.ts");
const ov = load("src/shortcut-overrides.ts");

const REOPEN = "workspace.reopenPanel";
const MAXIMIZE = "workspace.maximizePanel";
const FOCUS = "workspace.focusMode";
const listeners = [];
globalThis.window = {
  addEventListener: (type, fn) => listeners.push([type, fn]),
  removeEventListener: () => {},
};

// A small react runtime: state slots, an effect that runs on its first render, and a render after every state change.
function sheetHarness(platform = "win32", overrides = "") {
  const slots = [];
  const deps = [];
  let cursor = 0;
  let tree = null;
  const calls = { saved: [], closed: 0 };
  const react = {
    Fragment: "fragment",
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
          render();
        },
      ];
    },
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (!old || list.some((d, k) => d !== old[k])) {
        deps[i] = list;
        fn();
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Sheet = load("src/ShortcutSheet.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": { Search: "Search" },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
  }).default;
  const props = {
    platform,
    overrides,
    onSave: (text) => {
      calls.saved.push(text);
      props.overrides = text;
      render();
    },
    onClose: () => {
      calls.closed++;
    },
  };
  function render() {
    cursor = 0;
    tree = Sheet(props);
  }
  render();
  const all = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((n) => all(n, out));
    else if (node && typeof node === "object") {
      out.push(node);
      all(node.props && node.props.children, out);
    }
    return out;
  };
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : node && typeof node === "object"
        ? text(node.props && node.props.children)
        : typeof node === "string"
          ? node
          : "";
  const label = (node) => node.props["aria-label"] || text(node);
  const button = (name) =>
    all(tree).find(
      (n) => n.type === "button" && (label(n) === name || text(n) === name),
    );
  const rows = () => {
    const dts = all(tree).filter((n) => n.type === "dt");
    const dds = all(tree).filter((n) => n.type === "dd");
    return dts.map((dt, i) => ({
      id: dt.props.children,
      keys: all(dds[i])
        .filter((n) => n.type === "kbd")
        .map((n) => text(n)),
      buttons: all(dds[i])
        .filter((n) => n.type === "button")
        .map((n) => text(n)),
      input: all(dds[i]).find((n) => n.type === "input"),
    }));
  };
  const key = (node, name) => {
    const event = {
      key: name,
      prevented: 0,
      stopped: 0,
      preventDefault() {
        event.prevented++;
      },
      stopPropagation() {
        event.stopped++;
      },
    };
    node.props.onKeyDown(event);
    return event;
  };
  const search = () =>
    all(tree).find(
      (n) => n.type === "input" && n.props["aria-label"] === "Search shortcuts",
    );
  return {
    calls,
    props,
    all: () => all(tree),
    text,
    button,
    rows,
    key,
    search,
    errors: () => all(tree).filter((n) => n.type === "ErrorBox"),
    notes: () =>
      all(tree)
        .filter((n) => n.type === "p" && n.props.className === "field-note")
        .map((n) => text(n)),
    sections: () => all(tree).filter((n) => n.type === "section").length,
    type: (node, value) => node.props.onChange({ target: { value } }),
    modal: () => all(tree).find((n) => n.type === "Modal"),
    edit: (name) => button("Edit keys for " + name).props.onClick(),
  };
}

const labelOf = (platform, id) =>
  shortcuts
    .shortcutGroups(platform)
    .flatMap((g) => g.shortcuts)
    .find((s) => s.id === id).label;

test("shortcut-sheet edit: the real sheet lists today's keys, edits one of three shortcuts through the pure checks, shows the new keys and puts them back", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const h = sheetHarness(platform);
    const catalog = shortcuts.shortcutGroups(platform);
    const flat = catalog.flatMap((g) => g.shortcuts);
    assert.deepEqual(
      h.rows().map((r) => [r.id, r.keys]),
      flat.map((s) => [s.label, s.keys]),
      platform + " the rows are the catalog, byte for byte",
    );
    assert.equal(h.sections(), catalog.length);
    assert.deepEqual(
      h
        .all()
        .filter((n) => n.type === "h3")
        .map((n) => n.props.children),
      catalog.map((g) => g.title.toUpperCase()),
    );
    // Only the three rebindable rows have Edit; nothing else changes, no Reset and no Reset all yet.
    const withEdit = h
      .rows()
      .filter((r) => r.buttons.length > 0)
      .map((r) => [r.id, r.buttons]);
    assert.deepEqual(withEdit, [
      [labelOf(platform, REOPEN), ["Edit"]],
      [labelOf(platform, MAXIMIZE), ["Edit"]],
      [labelOf(platform, FOCUS), ["Edit"]],
    ]);
    assert.equal(h.button("Reset all"), undefined);
    assert.deepEqual(h.errors(), []);
    assert.deepEqual(h.calls, { saved: [], closed: 0 });
  }

  const h = sheetHarness("win32");
  const name = labelOf("win32", FOCUS);
  // Edit opens a field with today's keys; nothing is saved by opening it.
  h.edit(name);
  let row = h.rows().find((r) => r.id === name);
  assert.equal(row.input.props.value, "Ctrl+Shift+D");
  assert.equal(row.input.props.placeholder, "Ctrl+Shift+D");
  assert.deepEqual(row.buttons, ["Save", "Cancel"]);
  assert.deepEqual(h.calls.saved, []);
  // Typing then Save writes the canonical text once and the row now shows the new keys.
  h.type(row.input, "cmd+shift+y");
  assert.deepEqual(h.calls.saved, [], "typing saves nothing");
  h.button("Save").props.onClick();
  assert.deepEqual(h.calls.saved, ["workspace.focusMode=Ctrl+Shift+Y"]);
  row = h.rows().find((r) => r.id === name);
  assert.deepEqual(row.keys, ["Ctrl+Shift+Y"]);
  assert.deepEqual(row.buttons, ["Edit", "Reset"]);
  assert.equal(row.input, undefined, "the field closed");
  assert.equal(h.button("Reset " + name).props.title, "Back to Ctrl+Shift+D");
  assert.ok(h.button("Reset all"));
  assert.deepEqual(h.errors(), []);
  // Every other row is exactly as before.
  const others = h
    .rows()
    .filter((r) => r.id !== name)
    .map((r) => [r.id, r.keys]);
  assert.deepEqual(
    others,
    shortcuts
      .shortcutGroups("win32")
      .flatMap((g) => g.shortcuts)
      .filter((s) => s.id !== FOCUS)
      .map((s) => [s.label, s.keys]),
  );
  // A second shortcut keeps the first; a clash is refused with the reason and saves nothing.
  const reopen = labelOf("win32", REOPEN);
  h.edit(reopen);
  h.type(h.rows().find((r) => r.id === reopen).input, "Ctrl+Shift+P");
  h.button("Save").props.onClick();
  assert.equal(h.calls.saved.length, 1, "a clash saves nothing");
  assert.equal(h.errors().length, 1);
  assert.equal(
    h.errors()[0].props.error,
    "Ctrl/Cmd+Shift+P is already used by: Find open panels.",
  );
  assert.ok(
    h.rows().find((r) => r.id === reopen).input,
    "the field stays open",
  );
  h.type(h.rows().find((r) => r.id === reopen).input, "Ctrl+Shift+Y");
  h.button("Save").props.onClick();
  assert.equal(h.calls.saved.length, 1);
  assert.equal(
    h.errors()[0].props.error,
    "Ctrl/Cmd+Shift+Y is already used by: Hide or show the sidebar and status bar (focus mode).",
  );
  h.type(h.rows().find((r) => r.id === reopen).input, "Ctrl+Shift+J");
  h.button("Save").props.onClick();
  assert.deepEqual(
    h.calls.saved[1],
    "workspace.reopenPanel=Ctrl+Shift+J,workspace.focusMode=Ctrl+Shift+Y",
  );
  assert.deepEqual(h.errors(), [], "the message is cleared by a good save");
  // Reset puts one back and keeps the other; Reset all clears the text.
  h.button("Reset " + name).props.onClick();
  assert.equal(h.calls.saved[2], "workspace.reopenPanel=Ctrl+Shift+J");
  assert.deepEqual(h.rows().find((r) => r.id === name).keys, ["Ctrl+Shift+D"]);
  h.button("Reset all").props.onClick();
  assert.equal(h.calls.saved[3], "");
  assert.equal(h.button("Reset all"), undefined);
  assert.deepEqual(
    h.rows().map((r) => [r.id, r.keys]),
    shortcuts
      .shortcutGroups("win32")
      .flatMap((g) => g.shortcuts)
      .map((s) => [s.label, s.keys]),
    "back to the catalog exactly",
  );
  assert.equal(h.calls.closed, 0, "saving never closes the sheet");
});

test("shortcut-sheet states: search, the question mark, Escape and Enter in the field, ignored text, macOS labels and Cancel", () => {
  const h = sheetHarness("win32");
  const all = h.rows().length;
  // Search filters by words in the name or the keys and says so when nothing matches.
  h.type(h.search(), "zoom");
  assert.deepEqual(
    h.rows().map((r) => r.keys),
    [["Ctrl+=", "Ctrl+Plus"], ["Ctrl+minus"], ["Ctrl+0"]],
  );
  assert.equal(h.sections(), 1);
  h.type(h.search(), "ctrl+shift+h");
  assert.equal(h.rows().length, 1);
  assert.deepEqual(
    h.rows()[0].buttons,
    ["Edit"],
    "a filtered row can still be edited",
  );
  h.type(h.search(), "no such shortcut anywhere");
  assert.equal(h.rows().length, 0);
  assert.equal(h.sections(), 0);
  assert.deepEqual(h.notes(), ["No shortcut matches."]);
  h.type(h.search(), "");
  assert.equal(h.rows().length, all);
  assert.deepEqual(h.notes(), []);

  // A bare question mark in the empty search box closes the sheet; with text it is just text.
  const closed = h.key(h.search(), "?");
  assert.equal(h.calls.closed, 1);
  assert.equal(closed.prevented, 1);
  h.type(h.search(), "a");
  assert.equal(h.key(h.search(), "?").prevented, 0);
  assert.equal(h.calls.closed, 1);
  assert.equal(h.key(h.search(), "x").prevented, 0);
  // The page-level question mark still closes it from outside a field and not from inside one.
  assert.ok(listeners.length >= 1);
  const press = (target) => {
    const event = {
      key: "?",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      target,
      prevented: 0,
      preventDefault() {
        event.prevented++;
      },
    };
    listeners[listeners.length - 1][1](event);
    return event.prevented;
  };
  const before = h.calls.closed;
  assert.equal(press({ tagName: "INPUT", closest: () => null }), 0);
  assert.equal(h.calls.closed, before);
  assert.equal(press({ tagName: "BODY", closest: () => null }), 1);
  assert.equal(h.calls.closed, before + 1);
  assert.equal(listeners[listeners.length - 1][0], "keydown");

  // Enter in the field saves, Escape cancels only the edit and does not reach the dialog, Cancel closes the field.
  const g = sheetHarness("win32");
  const maximize = labelOf("win32", MAXIMIZE);
  g.edit(maximize);
  let input = g.rows().find((r) => r.id === maximize).input;
  g.type(input, "Ctrl+Shift+Y");
  const enter = g.key(g.rows().find((r) => r.id === maximize).input, "Enter");
  assert.equal(enter.prevented, 1);
  assert.deepEqual(g.calls.saved, ["workspace.maximizePanel=Ctrl+Shift+Y"]);
  g.edit(maximize);
  input = g.rows().find((r) => r.id === maximize).input;
  g.type(input, "Ctrl+Shift+J");
  const escape = g.key(g.rows().find((r) => r.id === maximize).input, "Escape");
  assert.equal(escape.stopped, 1);
  assert.equal(g.rows().find((r) => r.id === maximize).input, undefined);
  assert.equal(g.calls.saved.length, 1, "Escape saves nothing");
  assert.equal(g.calls.closed, 0);
  g.edit(maximize);
  g.type(g.rows().find((r) => r.id === maximize).input, "Ctrl+Y");
  g.button("Save").props.onClick();
  assert.equal(
    g.errors()[0].props.error,
    "Add Shift: Ctrl or Cmd with a letter alone belongs to terminals and the editor.",
  );
  g.button("Cancel").props.onClick();
  assert.equal(g.rows().find((r) => r.id === maximize).input, undefined);
  assert.deepEqual(g.errors(), [], "Cancel clears the message");
  assert.deepEqual(g.rows().find((r) => r.id === maximize).keys, [
    "Ctrl+Shift+Y",
  ]);
  g.edit(maximize);
  assert.equal(
    g.rows().find((r) => r.id === maximize).input.props.value,
    "Ctrl+Shift+Y",
    "the field starts from the keys in use",
  );
  g.type(g.rows().find((r) => r.id === maximize).input, "ctrl+shift+m");
  g.button("Save").props.onClick();
  assert.equal(
    g.calls.saved[1],
    "",
    "typing the default keys removes the override",
  );

  // Saved text that cannot be used is ignored, listed with its reason, and Reset all clears it.
  const bad = sheetHarness(
    "win32",
    "garbage,workspace.reopenPanel=Ctrl+Shift+C,workspace.focusMode=Ctrl+Shift+Y",
  );
  assert.deepEqual(
    bad.rows().find((r) => r.id === labelOf("win32", FOCUS)).keys,
    ["Ctrl+Shift+Y"],
  );
  assert.deepEqual(
    bad.rows().find((r) => r.id === labelOf("win32", REOPEN)).keys,
    ["Ctrl+Shift+H"],
  );
  assert.deepEqual(bad.notes(), [
    "Saved shortcut text that is ignored: garbage (Not in the form id=keys.) workspace.reopenPanel=Ctrl+Shift+C (Ctrl/Cmd+Shift+C is a terminal key (find, copy, paste or clear).)",
  ]);
  bad.button("Reset all").props.onClick();
  assert.deepEqual(bad.calls.saved, [""]);
  assert.deepEqual(bad.notes(), []);
  const junk = sheetHarness("win32", "a,b,c,d,e");
  assert.match(junk.notes()[0], / And 2 more\.$/);
  assert.ok(junk.button("Reset all"), "garbage text can be cleared");

  // macOS shows Cmd and accepts either spelling.
  const mac = sheetHarness("darwin");
  const focus = labelOf("darwin", FOCUS);
  mac.edit(focus);
  assert.equal(
    mac.rows().find((r) => r.id === focus).input.props.value,
    "Cmd+Shift+D",
  );
  mac.type(mac.rows().find((r) => r.id === focus).input, "Ctrl+Shift+Y");
  mac.button("Save").props.onClick();
  assert.deepEqual(mac.calls.saved, ["workspace.focusMode=Ctrl+Shift+Y"]);
  assert.deepEqual(mac.rows().find((r) => r.id === focus).keys, [
    "Cmd+Shift+Y",
  ]);
  assert.equal(mac.button("Reset " + focus).props.title, "Back to Cmd+Shift+D");

  // Reset on one row closes a field open on another row and clears its message.
  const r = sheetHarness("win32", "workspace.focusMode=Ctrl+Shift+Y");
  const reopenName = labelOf("win32", REOPEN);
  const focusName = labelOf("win32", FOCUS);
  r.edit(reopenName);
  r.type(r.rows().find((x) => x.id === reopenName).input, "Ctrl+Shift+P");
  r.button("Save").props.onClick();
  assert.equal(r.errors().length, 1);
  r.button("Reset " + focusName).props.onClick();
  assert.deepEqual(r.calls.saved, [""]);
  assert.equal(r.rows().find((x) => x.id === reopenName).input, undefined);
  assert.deepEqual(r.errors(), []);
});

test("shortcut-sheet wiring: the sheet reads the pure module only, writes through one callback, and App passes the effective text and saves at the scope in use", () => {
  const source = read("src/ShortcutSheet.tsx");
  assert.ok(/^[\n\x20-\x7e]*$/.test(source), "ASCII only");
  const code = stripComments(source);
  assert.ok(
    !code.includes(String.fromCharCode(92) + "u"),
    "no backslash-u escape",
  );
  const modules = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(modules, [
    "react",
    "lucide-react",
    "./components",
    "./shortcuts",
    "./shortcut-overrides",
  ]);
  for (const word of [
    "hrig",
    "localStorage",
    "sessionStorage",
    "fetch(",
    "clipboard",
    "writeTerminal",
    "sendTerminalCommand",
    "setTimeout",
    "document.",
    "Date.",
  ])
    assert.ok(!code.includes(word), "the sheet mentions " + word);
  assert.equal(count(code, "onSave("), 3, "reset one, reset all and save");
  assert.equal(count(code, "saveOverride("), 1);
  assert.equal(count(code, "resetOverride("), 1);
  assert.equal(
    count(code, "isHelpKey("),
    1,
    "the page-level question mark handler is kept",
  );
  assert.equal(count(code, "useEffect("), 1);
  assert.equal(
    count(code, 'addEventListener("keydown"'),
    1,
    "no second listener",
  );
  assert.ok(tight(code).includes('if (event.key === "?" && query === "") {'));

  const app = tight(stripComments(read("src/App.tsx")));
  const has = (text, part) => text.includes(tight(part));
  assert.ok(
    has(
      app,
      "<ShortcutSheet platform={window.hrig.platform} overrides={overridesText} onSave={saveShortcutOverrides} onClose={() => setModal(null)} />",
    ),
  );
  assert.ok(
    has(
      app,
      'const saveShortcutOverrides = (text: string) => { const scope = Object.hasOwn(projectPreferences, "shortcuts.overrides") ? "project" : "user"; if (text === "") settingsContext.reset(scope, "shortcuts.overrides"); else settingsContext.update(scope, "shortcuts.overrides", text); };',
    ),
  );
  assert.equal(count(app, "saveShortcutOverrides"), 2);
  assert.equal(count(app, "<ShortcutSheet"), 1);
  assert.equal(count(app, 'setModal("shortcuts")'), 1);
});

test("shortcut-sheet docs: NAVIGATION.md describes the editable sheet and its limits in one paragraph after the go to line one, and the sheet sentence no longer says read-only", () => {
  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark is kept");
  assert.ok(raw.endsWith(".\n") && !raw.endsWith("\n\n"));
  assert.ok(!raw.includes("\r"));
  const lines = raw.split("\n");
  const mine = lines.filter((l) => l.startsWith("Shortcut overrides:"));
  assert.equal(mine.length, 1);
  const paragraph = mine[0];
  assert.ok(/^[\x20-\x7e]+$/.test(paragraph), "plain ASCII only");
  const at = lines.indexOf(paragraph);
  assert.ok(lines[at - 1] === "" && lines[at + 1] === "");
  const goTo = lines.findIndex((l) =>
    l.startsWith("Ctrl+G opens the go-to-line prompt"),
  );
  assert.ok(goTo >= 0 && at > goTo, "after the go to line paragraph");
  assert.ok(
    paragraph.startsWith(
      "Shortcut overrides: three shortcuts can be given other keys from the Keyboard shortcuts sheet: Reopen closed panel, Maximize panel and Toggle focus mode.",
    ),
  );
  for (const part of [
    "Type in the search box to filter the list by words in a name or its keys",
    "A row with an Edit button takes typed keys such as Ctrl+Shift+Y",
    "Ctrl and Cmd both mean the main modifier of your computer, Shift is required and the key is one letter A to Z",
    "Save checks them before anything is stored",
    "(Shift with F, C, V or K)",
    "(Shift with A, G, I, K, L, O, R or Z)",
    "refused with the reason and nothing changes",
    "Reset puts one shortcut back and Reset all removes every change, so the defaults always return",
    "The sheet and the command center hints then show the keys now in use",
    "the old keys of a moved shortcut stop running it and reach the terminal again",
    "with no changes saved every key, label and hint is exactly what it was",
    "Every other shortcut in the list is fixed",
    "the command center, Quick Open, the panel finder, settings, project, sidebar, new shell and help keys and every terminal and editor key",
    "This is a typed text field and not a key recorder, and nothing is typed or sent to a terminal or seat",
    "the shortcuts.overrides text setting described in SETTINGS.md",
    "See docs/shortcut-rebinding.md for what rebinding the fixed shortcuts would need.",
  ])
    assert.ok(paragraph.includes(part), "paragraph: " + part);
  const sheet = lines.find((l) =>
    l.startsWith("Press ? when focus is not in a text field"),
  );
  assert.ok(
    sheet.includes(
      "a list of the app, terminal and editor shortcuts with Cmd or Ctrl labels for your platform and the keys now in use; Escape, ? again while the search box is empty, or a click outside closes it.",
    ),
  );
  assert.ok(!raw.includes("read-only list"));
  assert.ok(sheet.includes("The sheet sends nothing to a terminal or seat"));
});

test("shortcut-sheet design note: docs/shortcut-rebinding.md says it is partial by design, why only three shortcuts can be rebound and what a fuller version needs", () => {
  const raw = read("docs/shortcut-rebinding.md");
  assert.ok(/^[\n\x20-\x7e]*$/.test(raw), "ASCII only");
  assert.ok(raw.endsWith(".\n") && !raw.endsWith("\n\n"));
  const lines = raw.split("\n");
  assert.equal(lines[0], "# Rebinding shortcuts");
  assert.deepEqual(
    lines.filter((l) => l.startsWith("## ")),
    [
      "## What exists",
      "## Why only these three",
      "## What keeps the three safe",
      "## What a fuller version would need",
    ],
  );
  assert.ok(
    lines.includes(
      "Status: partial by design. Three shortcuts can be rebound; every other shortcut is fixed. A fuller version is a design note only. Not implemented.",
    ),
  );
  for (const part of [
    "`shortcuts.overrides`",
    "`src/shortcut-overrides.ts`",
    "`isReopenPanelKey`, `isMaximizePanelKey`, `isFocusModeKey`",
    "inline comparisons that also claim the key in a separate block",
    "`src/terminal-keys.ts` and `src/terminal-zoom.ts`",
    "never a bare letter, Ctrl plus a letter alone, an Alt chord or a function key",
    "The terminal ones come from running the real `classifyTerminalKey`",
    "checked by a test against the Monaco package that is installed",
    "The old keys of a moved shortcut are released",
    "A per-platform map",
    "A key recorder",
    "Export and import of key maps",
  ])
    assert.ok(raw.includes(part), "the note says: " + part);
  assert.ok(
    stripComments(read("src/shortcut-overrides.ts")).includes(
      "classifyTerminalKey(",
    ),
    "the claim about the real classifier is true",
  );
});
