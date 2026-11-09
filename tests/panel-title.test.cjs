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
const isAscii = (text) => !/[^\n -~]/.test(text);
// Hidden and astral characters are built from code points, never typed.
const ch = (...codes) => String.fromCodePoint(...codes);

function load(entry, fakes = {}) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    external: Object.keys(fakes),
  });
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const lib = load("src/panel-title.ts");

// The real layout code, the real module and the real flexlayout model in one
// bundle, so Model and Actions share one instance.
const real = (() => {
  const built = buildSync({
    stdin: {
      contents:
        'export * from "./src/layout.ts"; export * from "./src/panel-title.ts"; export * from "./src/undo-toast.ts"; export { Actions, Model, TabNode } from "flexlayout-react";',
      resolveDir: root,
      sourcefile: "panel-title-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = new Module("panel-title-real", module);
  mod.filename = path.join(root, "panel-title-real.js");
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
})();
const { Actions, Model, TabNode } = real;

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// A piece of the real App.tsx between two anchors, each found exactly once.
function cut(text, from, to) {
  const a = text.indexOf(from);
  assert.ok(a >= 0 && text.indexOf(from, a + 1) < 0, "one anchor: " + from);
  const b = text.indexOf(to, a + from.length);
  assert.ok(b > a, "found: " + to);
  return text.slice(a, b);
}
function compile(text, fakes, exported) {
  const js = transformSync(text, { loader: "ts" }).code;
  const names = Object.keys(fakes);
  return new Function(...names, js + "\nreturn { " + exported + " };")(
    ...names.map((name) => fakes[name]),
  );
}

// ---------------------------------------------------------------------------
// The workspace in a box: a real model with a seat, two shells and a file.

const SEAT = { id: "s1", name: "reviewer-1", session: "tmux-1" };
const CONNECTION = { id: "local", name: "This computer", kind: "local" };
function terminalTab(id, name, extra = {}) {
  return {
    type: "tab",
    id,
    name,
    component: "terminal",
    config: {
      connection: CONNECTION,
      root: "/p",
      terminalId: id,
      ...extra,
    },
  };
}
function workspaceJson() {
  return {
    global: real.globalLayout,
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "g1",
          children: [
            terminalTab("seat:local:s1", "reviewer-1", { seat: SEAT }),
            terminalTab("sh1", "Shell"),
            {
              type: "tab",
              id: "file:a",
              name: "a.txt",
              component: "editor",
              config: { connection: CONNECTION, root: "/p", path: "a.txt" },
            },
          ],
        },
        {
          type: "tabset",
          id: "g2",
          children: [terminalTab("sh2", "Shell")],
        },
      ],
    },
  };
}
function tabJson(model, id) {
  return model.getNodeById(id).toJson();
}

// The real title helpers of App.tsx, cut out and run over the real model.
function appWorld(model) {
  const doActions = [];
  const wrapped = {
    getNodeById: (id) => model.getNodeById(id),
    toJson: () => model.toJson(),
    doAction: (action) => {
      doActions.push(action);
      return model.doAction(action);
    },
  };
  const saved = [];
  const app = read("src/App.tsx");
  const text = cut(
    app,
    "const titledTab = (id: string) => {",
    "const savePending = async () => {",
  );
  const out = compile(
    text,
    {
      model: wrapped,
      TabNode,
      Actions,
      applyCustomTitle: real.applyCustomTitle,
      modelChanged: (next) => saved.push(JSON.stringify(next.toJson())),
    },
    "titledTab, retitleTab, renamePanel",
  );
  return { ...out, doActions, saved };
}

// ---------------------------------------------------------------------------
// The real PanelContextMenu over a small react stand-in with a Modal that
// shows as a node.

function menuWorld(initial) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  const calls = { dismissed: 0, renamed: [], reset: [] };
  const win = { innerWidth: 1000, innerHeight: 800 };
  globalThis.window = {
    ...win,
    addEventListener() {},
    removeEventListener() {},
  };
  const react = {
    useState(start) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = start;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
          render();
        },
      ];
    },
    useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const Menu = load("src/PanelContextMenu.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal" },
  }).default;
  const props = {
    menu: initial,
    onDismiss: () => {
      calls.dismissed++;
      props.menu = null;
      render();
    },
    onClosePanels: () => {},
    onRenamePanel: (id, text) => calls.renamed.push([id, text]),
    onResetPanel: (id) => calls.reset.push(id),
  };
  function render() {
    cursor = 0;
    tree = Menu(props);
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
  const world = {
    calls,
    props,
    render,
    all: () => all(tree),
    text,
    items: () =>
      all(tree)
        .filter((n) => n.type === "button" && n.props.role === "menuitem")
        .map((n) => text(n)),
    menuNode: () => all(tree).find((n) => n.props && n.props.role === "menu"),
    modal: () => all(tree).find((n) => n.type === "Modal"),
    input: () => all(tree).find((n) => n.type === "input"),
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n) === name),
    click: (name) => world.button(name).props.onClick(),
    type: (value) => world.input().props.onChange({ target: { value } }),
    key: (key, composing = false) =>
      world
        .input()
        .props.onKeyDown({ key, nativeEvent: { isComposing: composing } }),
    done: () => {
      delete globalThis.window;
    },
  };
  return world;
}
const panelInfo = (id, name, kind) => ({
  id,
  name,
  kind,
  dirty: false,
  locked: false,
});

test("panel-title tracer: Rename on a terminal tab opens a small dialog, the typed title is cleaned and saved on the tab only, and it comes back after a restart", () => {
  const model = Model.fromJson(workspaceJson());
  const before = JSON.parse(JSON.stringify(model.toJson()));
  const panels = [
    panelInfo("seat:local:s1", "reviewer-1", "seat"),
    panelInfo("sh1", "Shell", "shell"),
    panelInfo("file:a", "a.txt", "file"),
  ];

  // The menu: Rename... for a shell or a seat panel only, after the close items.
  const onShell = menuWorld({ x: 400, y: 300, id: "sh1", panels });
  assert.deepEqual(onShell.items(), [
    "Close",
    "Close others",
    "Close to the right",
    "Rename...",
  ]);
  assert.ok(
    onShell
      .all()
      .some((n) => n.props && n.props.className === "menu-separator"),
    "the existing separator line sits between the close items and Rename",
  );
  assert.deepEqual(onShell.menuNode().props.style, { left: 400, top: 300 });
  const lowDown = menuWorld({ x: 990, y: 790, id: "sh1", panels });
  assert.deepEqual(lowDown.menuNode().props.style, { left: 820, top: 626 });
  const onSeat = menuWorld({ x: 400, y: 300, id: "seat:local:s1", panels });
  assert.ok(onSeat.items().includes("Rename..."));
  const onFile = menuWorld({ x: 400, y: 300, id: "file:a", panels });
  assert.deepEqual(onFile.items(), [
    "Close",
    "Close others",
    "Close to the right",
  ]);
  assert.deepEqual(
    menuWorld({ x: 990, y: 790, id: "file:a", panels }).menuNode().props.style,
    { left: 820, top: 670 },
    "a file tab keeps the old menu height",
  );

  // The dialog: starts with the current name, Enter saves what was typed, as typed.
  assert.equal(onShell.modal(), undefined);
  onShell.click("Rename...");
  assert.equal(onShell.calls.dismissed, 1, "the menu closes");
  assert.equal(onShell.menuNode(), undefined);
  const dialog = onShell.modal();
  assert.equal(dialog.props.title, "Rename panel");
  assert.equal(onShell.input().props.value, "Shell");
  assert.equal(onShell.input().props["aria-label"], "Panel name");
  const typed = "  Build\n logs" + ch(7) + "  ";
  onShell.type(typed);
  assert.equal(onShell.input().props.value, typed);
  onShell.key("a");
  onShell.key("Enter", true);
  assert.deepEqual(onShell.calls.renamed, [], "an IME confirm is not Enter");
  assert.ok(onShell.modal());
  onShell.key("Enter");
  assert.deepEqual(onShell.calls.renamed, [["sh1", typed]]);
  assert.equal(onShell.modal(), undefined, "the dialog closes");

  // Escape and Cancel change nothing.
  onShell.props.menu = { x: 1, y: 1, id: "sh1", panels };
  onShell.render();
  onShell.click("Rename...");
  onShell.type("never saved");
  dialog.props.onClose();
  assert.equal(onShell.modal(), undefined);
  onShell.props.menu = { x: 1, y: 1, id: "sh1", panels };
  onShell.render();
  onShell.click("Rename...");
  onShell.click("Cancel");
  assert.equal(onShell.modal(), undefined);
  assert.equal(onShell.calls.renamed.length, 1, "only the Enter saved");
  for (const w of [onShell, lowDown, onSeat, onFile]) w.done();

  // The real App code over the real model: the title is cleaned and stored.
  const world = appWorld(model);
  world.renamePanel("sh1", typed);
  const renamed = tabJson(model, "sh1");
  assert.equal(renamed.name, "Build logs");
  assert.equal(renamed.config.customTitle, "Build logs");
  assert.equal(renamed.config.defaultTitle, "Shell");
  // Label only: the id, the component, the terminal id, the connection and the seat are exactly as they were, and so is every other tab.
  const was = before.layout.children[0].children[1];
  assert.equal(renamed.id, was.id);
  assert.equal(renamed.component, was.component);
  assert.deepEqual(
    { ...renamed.config, customTitle: undefined, defaultTitle: undefined },
    { ...was.config, customTitle: undefined, defaultTitle: undefined },
  );
  assert.deepEqual(
    tabJson(model, "seat:local:s1"),
    before.layout.children[0].children[0],
  );
  assert.deepEqual(
    tabJson(model, "sh2"),
    before.layout.children[1].children[0],
  );
  assert.deepEqual(
    tabJson(model, "file:a"),
    before.layout.children[0].children[2],
  );
  assert.deepEqual(
    world.doActions.map((a) => [a.type, a.data.node]),
    [[Actions.UPDATE_NODE_ATTRIBUTES, "sh1"]],
    "one action, on the renamed tab, and nothing else is dispatched",
  );
  assert.equal(world.saved.length, 1, "the layout is saved once");
  // A seat panel renames too and keeps its seat.
  world.renamePanel("seat:local:s1", "Lead reviewer");
  assert.equal(tabJson(model, "seat:local:s1").name, "Lead reviewer");
  assert.deepEqual(tabJson(model, "seat:local:s1").config.seat, SEAT);
  assert.equal(
    tabJson(model, "seat:local:s1").config.defaultTitle,
    "reviewer-1",
  );
  // A file keeps its name: the helpers refuse anything but a terminal.
  world.renamePanel("file:a", "Not a terminal");
  assert.equal(tabJson(model, "file:a").name, "a.txt");
  assert.equal(world.doActions.length, 2);
  // An id that is not a tab does nothing.
  world.renamePanel("g1", "x");
  world.renamePanel("missing", "x");
  assert.equal(world.doActions.length, 2);

  // Saved and restored: the stored JSON gives the same titles after a restart.
  const stored = JSON.parse(world.saved.at(-1));
  assert.equal(stored.layout.children[0].children[1].name, "Build logs");
  const restored = real.restoreModel(
    JSON.parse(JSON.stringify(model.toJson())),
  );
  assert.deepEqual(tabJson(restored, "sh1"), tabJson(model, "sh1"));
  assert.deepEqual(
    tabJson(restored, "seat:local:s1"),
    tabJson(model, "seat:local:s1"),
  );
  assert.equal(restored.getNodeById("sh2").getName(), "Shell");

  // A rename is a layout change the Undo notice must not undo behind its back: the shape includes titles, so it withdraws the offer.
  const shapeBefore = real.layoutShape(before);
  assert.notEqual(shapeBefore, null);
  assert.notEqual(real.layoutShape(model.toJson()), shapeBefore);
});

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const shellTab = (name, config = {}) => ({
  component: "terminal",
  name,
  config: { connection: CONNECTION, root: "/p", terminalId: "sh1", ...config },
});

test("panel-title rules: normalizeTitle cleans, cuts and refuses as specified, and the tab helpers rename, reset and restore without changing their input or throwing", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "MAX_DEPTH",
    "MAX_NODES",
    "MAX_ORIGINAL",
    "MAX_TITLE",
    "applyCustomTitle",
    "canRename",
    "customTitleOf",
    "isRenamed",
    "normalizeTabTitles",
    "normalizeTitle",
    "resetTitle",
    "titleOf",
  ]);
  assert.equal(lib.MAX_TITLE, 60);
  assert.equal(lib.MAX_ORIGINAL, 200);
  assert.equal(lib.MAX_NODES, 20000);
  assert.equal(lib.MAX_DEPTH, 64);
  const n = lib.normalizeTitle;

  // Text that stays, and text that is cleaned.
  const rocket = ch(0x1f680);
  const tech = ch(0x1f469, 0x200d, 0x1f4bb);
  const heart = ch(0x2764, 0xfe0f);
  for (const [input, want] of [
    ["Build logs", "Build logs"],
    ["  padded  ", "padded"],
    ["a   b\t\tc", "a b c"],
    ["line1\nline2\r\nline3", "line1 line2 line3"],
    [ch(0x2028) + "x" + ch(0x2029) + "y", "x y"],
    [ch(0xa0) + "x" + ch(0x3000) + "y", "x y"],
    [
      "a" +
        ch(0) +
        "b" +
        ch(7) +
        "c" +
        ch(0x1b) +
        "d" +
        ch(0x7f) +
        "e" +
        ch(0x85) +
        "f",
      "abcdef",
    ],
    ["a" + ch(0x200b, 0x200c, 0x200e, 0x200f) + "b", "ab"],
    ["a" + ch(0x202a, 0x202b, 0x202c, 0x202d, 0x202e) + "b", "ab"],
    ["a" + ch(0x2066, 0x2067, 0x2068, 0x2069) + "b", "ab"],
    ["a" + ch(0x2060, 0x2064, 0x061c) + "b", "ab"],
    ["a" + ch(0xfeff) + "b", "a b"],
    ["tag" + ch(0xe0041, 0xe007f) + "ged", "tagged"],
    ["a " + ch(0x200b) + " b", "a b"],
    [
      "caf" + ch(0xe9) + " " + ch(0x65e5, 0x672c, 0x8a9e),
      "caf" + ch(0xe9) + " " + ch(0x65e5, 0x672c, 0x8a9e),
    ],
    [rocket + " deploy", rocket + " deploy"],
    ["dev " + tech, "dev " + tech],
    ["love " + heart, "love " + heart],
    [ch(0xd83d) + "x" + ch(0xdc00) + "y", "xy"],
    ["<b>bold</b> & more", "<b>bold</b> & more"],
  ])
    assert.equal(n(input), want, JSON.stringify(input));

  // Nothing visible left means no custom title.
  for (const input of [
    "",
    " ",
    "\n\t ",
    ch(0x200b).repeat(5),
    ch(0x200d),
    ch(0x200d, 0xfe0f),
    ch(0xfe0e),
    ch(0xe0041, 0xe0042),
    ch(0x202e) + ch(0x2066),
    ch(0) + ch(7),
    ch(0xd800),
  ])
    assert.equal(n(input), null, JSON.stringify(input));
  for (const junk of [
    undefined,
    null,
    5,
    true,
    {},
    [],
    ["a"],
    () => "a",
    Symbol("a"),
    10n,
  ])
    assert.equal(n(junk), null);

  // The cut: 60 characters, never inside an astral character, never ending on a space or a joiner.
  assert.equal(n("x".repeat(60)), "x".repeat(60));
  assert.equal(n("x".repeat(61)), "x".repeat(60));
  assert.equal(n("x".repeat(5000)), "x".repeat(60));
  assert.equal(n(rocket.repeat(61)), rocket.repeat(60));
  assert.equal(Array.from(n(rocket.repeat(61))).length, 60);
  assert.equal(n("x".repeat(59) + " y"), "x".repeat(59));
  assert.equal(n("x".repeat(58) + tech), "x".repeat(58) + ch(0x1f469));
  assert.equal(n("x".repeat(59) + tech), "x".repeat(59) + ch(0x1f469));
  assert.equal(n("x".repeat(60) + tech), "x".repeat(60));
  assert.equal(
    n("x".repeat(2000000)),
    "x".repeat(60),
    "a 2 MB input is cut at once",
  );
  assert.equal(
    n(" ".repeat(3000) + "x"),
    null,
    "only the first 2048 units are read",
  );
  assert.equal(n("abcdef", 3), "abc");
  assert.equal(n("x".repeat(300), lib.MAX_ORIGINAL), "x".repeat(200));
  for (const bad of [0, -1, 1.5, NaN, Infinity, "5", null, undefined])
    assert.equal(n("x".repeat(100), bad), "x".repeat(60), String(bad));

  // A seeded walk of 400 strings: whatever comes out is clean, short, idempotent and made of the input.
  const pool = [
    "a",
    "B",
    "7",
    " ",
    "\t",
    "\n",
    "-",
    "<",
    "&",
    ch(0xe9),
    ch(0x65e5),
    rocket,
    ch(0x200d),
    ch(0xfe0f),
    ch(0),
    ch(7),
    ch(0x7f),
    ch(0x85),
    ch(0x200b),
    ch(0x200e),
    ch(0x202e),
    ch(0x2066),
    ch(0x2060),
    ch(0x061c),
    ch(0xfeff),
    ch(0xe0041),
    ch(0xd83d),
    ch(0xdc00),
    ch(0x2028),
    ch(0xa0),
  ];
  const next = seeded(20260511);
  const hiddenNow = (code) =>
    code < 32 ||
    (code >= 127 && code <= 159) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    [0x61c, 0x200b, 0x200c, 0x200e, 0x200f].includes(code) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0xe0000 && code <= 0xe007f);
  let nulls = 0;
  let kept = 0;
  for (let i = 0; i < 400; i++) {
    const length = Math.floor(next() * 90);
    let input = "";
    for (let k = 0; k < length; k++)
      input += pool[Math.floor(next() * pool.length)];
    const out = n(input);
    if (out === null) {
      nulls++;
      assert.ok(
        !/[a-zA-Z0-9]/.test(input),
        "a letter always survives: " + JSON.stringify(input),
      );
      continue;
    }
    kept++;
    const chars = Array.from(out);
    assert.ok(chars.length >= 1 && chars.length <= 60);
    assert.ok(chars.every((c) => !hiddenNow(c.codePointAt(0))));
    assert.ok(
      !out.startsWith(" ") && !out.endsWith(" ") && !out.includes("  "),
    );
    assert.ok(
      chars.some((c) => ![" ", ch(0x200d), ch(0xfe0f), ch(0xfe0e)].includes(c)),
    );
    assert.equal(n(out), out, "idempotent");
    const source = new Set(Array.from(input));
    assert.ok(
      chars.every((c) => c === " " || source.has(c)),
      "nothing is invented",
    );
  }
  assert.ok(
    nulls >= 15 && kept >= 150,
    "both outcomes were met: " + nulls + "/" + kept,
  );

  // Rename, reset and the helpers on a terminal tab.
  const cfg = { connection: CONNECTION, root: "/p", terminalId: "sh1" };
  const plainShell = shellTab("Shell");
  const first = lib.applyCustomTitle(plainShell, "  Build\n logs ");
  assert.deepEqual(first, {
    name: "Build logs",
    config: { ...cfg, customTitle: "Build logs", defaultTitle: "Shell" },
  });
  const renamed = { ...plainShell, name: first.name, config: first.config };
  assert.equal(lib.isRenamed(plainShell), false);
  assert.equal(lib.isRenamed(renamed), true);
  assert.equal(lib.customTitleOf(renamed), "Build logs");
  assert.equal(lib.titleOf(renamed), "Build logs");
  assert.equal(lib.titleOf(plainShell), "Shell");
  // A second rename keeps the first original.
  assert.deepEqual(lib.applyCustomTitle(renamed, "Deploy"), {
    name: "Deploy",
    config: { ...cfg, customTitle: "Deploy", defaultTitle: "Shell" },
  });
  // Empty, unusable or the original itself is a reset; nothing to change gives null.
  for (const input of ["", "   ", ch(0x200b), null, undefined, 7, " Shell "])
    assert.deepEqual(
      lib.applyCustomTitle(renamed, input),
      { name: "Shell", config: cfg },
      JSON.stringify(input),
    );
  assert.equal(lib.applyCustomTitle(plainShell, ""), null);
  assert.equal(lib.applyCustomTitle(plainShell, "Shell"), null);
  assert.equal(lib.applyCustomTitle(renamed, "Build logs"), null);
  assert.deepEqual(lib.resetTitle(renamed), { name: "Shell", config: cfg });
  assert.equal(lib.resetTitle(plainShell), null);
  // The original may be longer than a title, and is never cut below 200.
  const longName = "n".repeat(150);
  const longFirst = lib.applyCustomTitle(shellTab(longName), "x");
  assert.equal(longFirst.config.defaultTitle, longName);
  assert.equal(
    lib.resetTitle({
      ...shellTab(longName),
      name: "x",
      config: longFirst.config,
    }).name,
    longName,
  );
  assert.equal(
    lib.applyCustomTitle(shellTab("n".repeat(300)), "x").config.defaultTitle,
    "n".repeat(200),
  );
  // A seat panel keeps its seat; a lost original falls back to the seat name, then to Shell.
  const seatTab = {
    component: "terminal",
    name: "reviewer-1",
    config: { ...cfg, seat: SEAT },
  };
  const seatFirst = lib.applyCustomTitle(seatTab, "Lead");
  assert.deepEqual(seatFirst.config.seat, SEAT);
  assert.equal(seatFirst.config.defaultTitle, "reviewer-1");
  const lostSeat = {
    ...seatTab,
    name: "Lead",
    config: { ...seatFirst.config, defaultTitle: 42 },
  };
  assert.equal(lib.resetTitle(lostSeat).name, "reviewer-1");
  const lostShell = shellTab("Lead", {
    customTitle: "Lead",
    defaultTitle: ch(0x200b),
  });
  assert.equal(lib.resetTitle(lostShell).name, "Shell");
  assert.equal(lib.titleOf(shellTab(ch(0x200b))), "Shell");
  assert.equal(
    lib.titleOf({ component: "editor", name: ch(7), config: {} }),
    "",
  );
  // A dirty current name is cleaned when the title is set back to it.
  assert.deepEqual(lib.applyCustomTitle(shellTab("bad" + ch(7) + "name"), ""), {
    name: "badname",
    config: cfg,
  });
  // Only terminal panels with a config that is a record rename.
  for (const tab of [
    { component: "editor", name: "a.txt", config: { path: "a.txt" } },
    { component: "diff", name: "d", config: {} },
    { component: "welcome", name: "Workspace" },
    { component: "terminal", name: "x" },
    { component: "terminal", name: "x", config: [] },
    { component: "terminal", name: "x", config: "c" },
    null,
    undefined,
    5,
    "tab",
    [],
  ]) {
    assert.equal(lib.canRename(tab), false, JSON.stringify(tab));
    assert.equal(lib.applyCustomTitle(tab, "x"), null);
    assert.equal(lib.resetTitle(tab), null);
    assert.equal(lib.isRenamed(tab), false);
    assert.equal(lib.customTitleOf(tab), null);
  }
  assert.equal(
    lib.isRenamed({
      component: "editor",
      name: "a",
      config: { customTitle: "x" },
    }),
    false,
  );
  assert.equal(lib.isRenamed(shellTab("a", { customTitle: "  " })), false);
  assert.equal(lib.isRenamed(shellTab("a", { customTitle: 5 })), false);
  // Frozen input is only read; the patch is made of new objects.
  const frozen = deepFreeze(plain(renamed));
  const patch = lib.applyCustomTitle(frozen, "Other");
  assert.notEqual(patch.config, frozen.config);
  assert.equal(patch.config.connection.id, "local");
  assert.deepEqual(frozen, renamed);
  assert.equal(lib.resetTitle(frozen).config.customTitle, undefined);

  // The restore pass: a copy with clean titles; the input is never changed.
  const hostile = (layout) => plain(layout);
  const stored = workspaceJson();
  stored.layout.children[0].children[1].name =
    "x" + ch(0x202e) + "y" + ch(7) + "z";
  stored.layout.children[0].children[0].name = "s".repeat(300);
  stored.layout.children[0].children[2].name = "a" + ch(0) + ".txt";
  stored.layout.children[1].children[0].name = ch(0x200b);
  deepFreeze(stored);
  const copy = lib.normalizeTabTitles(stored);
  assert.notEqual(copy, stored);
  const tabs = copy.layout.children.flatMap((g) => g.children);
  assert.deepEqual(
    tabs.map((t) => t.name),
    ["s".repeat(200), "xyz", "a.txt", "Shell"],
  );
  assert.deepEqual(copy.global, stored.global);
  assert.equal(copy.layout.children[0].id, "g1");
  assert.deepEqual(tabs[0].config.seat, SEAT);
  assert.equal(
    stored.layout.children[0].children[1].name.length,
    5,
    "the input is untouched",
  );
  assert.deepEqual(lib.normalizeTabTitles(copy), copy, "idempotent");
  // A terminal's titles agree with its name: the custom title wins and the original is repaired.
  const messy = hostile(workspaceJson());
  const [a, b, c] = messy.layout.children[0].children;
  a.name = "different";
  a.config.customTitle = "  My " + ch(7) + "seat  ";
  a.config.defaultTitle = ch(0x200b);
  b.config.customTitle = "t".repeat(90);
  b.config.defaultTitle = "Shell";
  c.config.customTitle = "x";
  c.config.defaultTitle = "y";
  messy.layout.children[1].children[0].config.customTitle = 5;
  messy.layout.children[1].children[0].config.defaultTitle = "stale";
  const clean = lib.normalizeTabTitles(messy);
  const [ca, cb, cc] = clean.layout.children[0].children;
  assert.equal(ca.name, "My seat");
  assert.equal(ca.config.customTitle, "My seat");
  assert.equal(ca.config.defaultTitle, "reviewer-1");
  assert.equal(cb.name, "t".repeat(60));
  assert.equal(cb.config.customTitle, "t".repeat(60));
  assert.equal(cb.config.defaultTitle, "Shell");
  assert.equal(
    "customTitle" in cc.config || "defaultTitle" in cc.config,
    false,
    "a file never carries them",
  );
  assert.equal(cc.name, "a.txt");
  const sh2 = clean.layout.children[1].children[0];
  assert.equal(
    "customTitle" in sh2.config || "defaultTitle" in sh2.config,
    false,
  );
  assert.equal(sh2.name, "Shell");
  // Tabs in borders, separate windows and old-style popouts are reached too.
  const wide = {
    global: {},
    layout: { type: "row", children: [{ type: "tabset", children: [] }] },
    borders: [
      {
        type: "border",
        location: "left",
        children: [{ type: "tab", name: "b" + ch(7), component: "editor" }],
      },
    ],
    subLayouts: {
      w1: {
        layout: {
          type: "row",
          children: [
            {
              type: "tabset",
              children: [
                {
                  type: "tab",
                  name: "w" + ch(7),
                  component: "terminal",
                  config: {},
                },
              ],
            },
          ],
        },
      },
    },
    popouts: {
      p1: {
        layout: {
          type: "row",
          children: [
            {
              type: "tabset",
              children: [
                { type: "tab", name: "p" + ch(7), component: "editor" },
              ],
            },
          ],
        },
      },
    },
  };
  const wideOut = lib.normalizeTabTitles(wide);
  assert.equal(wideOut.borders[0].children[0].name, "b");
  assert.equal(wideOut.subLayouts.w1.layout.children[0].children[0].name, "w");
  assert.equal(wideOut.popouts.p1.layout.children[0].children[0].name, "p");
  // A tab with no name stays without one unless it is a terminal.
  const bare = lib.normalizeTabTitles({ type: "tab", component: "editor" });
  assert.equal("name" in bare, false);
  assert.equal(
    lib.normalizeTabTitles({ type: "tab", component: "terminal", config: {} })
      .name,
    "Shell",
  );
  // Bounds: 64 nesting steps read, 65 refused (a row and its list of children are two steps); 20000 nodes read, 20001 refused.
  const nest = (levels) => {
    let node = { type: "tab", name: "deep", component: "editor" };
    for (let i = 0; i < levels; i++) node = { type: "row", children: [node] };
    return node;
  };
  assert.notEqual(lib.normalizeTabTitles(nest(32)), null);
  assert.equal(
    lib.normalizeTabTitles(nest(33)),
    null,
    "each level is an object and an array",
  );
  const flat = (items) => ({
    type: "row",
    children: Array.from({ length: items }, () => ({
      type: "tab",
      name: "t",
      component: "editor",
    })),
  });
  assert.notEqual(lib.normalizeTabTitles(flat(19998)), null);
  assert.equal(lib.normalizeTabTitles(flat(19999)), null);
  const cycle = { type: "row", children: [] };
  cycle.children.push(cycle);
  assert.equal(
    lib.normalizeTabTitles(cycle),
    null,
    "a cycle is cut by the depth bound",
  );
  // Junk never throws.
  for (const junk of [
    undefined,
    null,
    0,
    7,
    "text",
    true,
    [],
    [1, "a", null],
    {},
    { type: "tab" },
    { type: "tab", config: 5, component: "terminal" },
  ]) {
    assert.doesNotThrow(() => lib.normalizeTabTitles(junk));
  }
  assert.equal(lib.normalizeTabTitles(undefined), undefined);
  assert.equal(lib.normalizeTabTitles(7), 7);
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error("no");
      },
      ownKeys() {
        throw new Error("no");
      },
    },
  );
  assert.equal(
    lib.normalizeTabTitles(trap),
    null,
    "a reading error is refused, not thrown",
  );
  const proto = lib.normalizeTabTitles(
    JSON.parse('{"type":"row","__proto__":{"polluted":1},"children":[]}'),
  );
  assert.equal(proto.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(proto).includes("__proto__"), false);
});
