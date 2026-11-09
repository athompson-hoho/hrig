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

// ---------------------------------------------------------------------------
// Reset name, the title typed on the tab itself, and restoring a damaged workspace.

function resetWorld(model) {
  const doActions = [];
  const wrapped = {
    getNodeById: (id) => model.getNodeById(id),
    toJson: () => model.toJson(),
    doAction: (action) => {
      doActions.push(action);
      return model.doAction(action);
    },
  };
  const text = cut(
    read("src/App.tsx"),
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
      resetTitle: real.resetTitle,
      modelChanged: () => {},
    },
    "titledTab, renamePanel, resetPanelName",
  );
  return { ...out, doActions };
}
// The real onAction of App.tsx over the real model; every close, history and bridge call is recorded.
function actionWorld(model) {
  const log = [];
  const text = cut(
    read("src/App.tsx"),
    "const onAction = (action: Action) => {",
    "const markDirty = useCallback(",
  );
  const out = compile(
    text,
    {
      remember: () => log.push("remember"),
      history: { current: { past: [], future: [] } },
      dirtyTabs: { current: new Set() },
      setPending: () => log.push("pending"),
      setActionError: () => log.push("error"),
      closeTab: () => log.push("closeTab"),
      clearBuffer: () => log.push("clearBuffer"),
      rememberClosed: () => log.push("rememberClosed"),
      window: { hrig: { closeTerminal: () => log.push("closeTerminal") } },
      model,
      TabNode,
      Actions,
      titledTab: resetWorld(model).titledTab,
      canRename: real.canRename,
      applyCustomTitle: real.applyCustomTitle,
    },
    "onAction",
  );
  return { onAction: out.onAction, log };
}
const isHiddenCode = (code) =>
  code < 32 ||
  (code >= 127 && code <= 159) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
const jsonTabs = (json) => {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "tab") found.push(value);
    else Object.values(value).forEach(walk);
  };
  walk(json);
  return found;
};

test("panel-title reset: Reset name shows only on a renamed terminal and brings the original back exactly, also after a restart, for a title typed on the tab too, and layouts, presets, templates and history keep titles and original together", () => {
  const panels = [
    panelInfo("seat:local:s1", "reviewer-1", "seat"),
    panelInfo("sh1", "Build", "shell"),
    panelInfo("file:a", "a.txt", "file"),
  ];
  // The menu.
  const menu = menuWorld({ x: 400, y: 300, id: "sh1", panels });
  assert.deepEqual(menu.items(), [
    "Close",
    "Close others",
    "Close to the right",
    "Rename...",
  ]);
  menu.props.renamed = true;
  menu.render();
  assert.deepEqual(menu.items(), [
    "Close",
    "Close others",
    "Close to the right",
    "Rename...",
    "Reset name",
  ]);
  const low = menuWorld({ x: 990, y: 790, id: "sh1", panels });
  low.props.renamed = true;
  low.render();
  assert.deepEqual(low.menuNode().props.style, { left: 820, top: 593 });
  menu.click("Reset name");
  assert.equal(menu.calls.dismissed, 1);
  assert.deepEqual(menu.calls.reset, ["sh1"]);
  assert.equal(menu.modal(), undefined, "Reset opens no dialog");
  assert.deepEqual(menu.calls.renamed, []);
  const file = menuWorld({ x: 400, y: 300, id: "file:a", panels });
  file.props.renamed = true;
  file.render();
  assert.deepEqual(file.items(), [
    "Close",
    "Close others",
    "Close to the right",
  ]);
  for (const w of [menu, low, file]) w.done();

  // Reset on the real model gives back the very same layout.
  const model = Model.fromJson(workspaceJson());
  const original = JSON.stringify(model.toJson());
  const world = resetWorld(model);
  world.renamePanel("sh1", "Build");
  assert.notEqual(JSON.stringify(model.toJson()), original);
  world.resetPanelName("sh1");
  assert.equal(JSON.stringify(model.toJson()), original, "byte for byte");
  const dispatched = world.doActions.length;
  for (const id of ["sh1", "sh2", "file:a", "g1", "missing"])
    world.resetPanelName(id);
  assert.equal(
    world.doActions.length,
    dispatched,
    "nothing to reset, nothing done",
  );

  // After a restart the original is still known.
  world.renamePanel("sh1", "Build");
  world.renamePanel("seat:local:s1", "Lead");
  const before = JSON.parse(original).layout.children[0].children;
  const restored = real.restoreModel(
    JSON.parse(JSON.stringify(model.toJson())),
  );
  assert.equal(restored.getNodeById("sh1").getName(), "Build");
  const again = resetWorld(restored);
  again.resetPanelName("sh1");
  again.resetPanelName("seat:local:s1");
  assert.deepEqual(tabJson(restored, "sh1"), before[1]);
  assert.deepEqual(tabJson(restored, "seat:local:s1"), before[0]);

  // A title typed on the tab itself (double-click or F2) is the same rename.
  const tabModel = Model.fromJson(workspaceJson());
  const typed = actionWorld(tabModel);
  const act = typed.onAction(
    Actions.renameTab("sh1", "  Deploy\n now " + ch(7)),
  );
  assert.equal(act.type, Actions.UPDATE_NODE_ATTRIBUTES);
  tabModel.doAction(act);
  assert.equal(tabJson(tabModel, "sh1").name, "Deploy now");
  assert.equal(tabJson(tabModel, "sh1").config.customTitle, "Deploy now");
  assert.equal(tabJson(tabModel, "sh1").config.defaultTitle, "Shell");
  assert.equal(
    typed.onAction(Actions.renameTab("sh1", "Deploy now")),
    undefined,
    "the same title again changes nothing",
  );
  const undone = typed.onAction(Actions.renameTab("sh1", ""));
  tabModel.doAction(undone);
  assert.deepEqual(
    tabJson(tabModel, "sh1"),
    before[1],
    "an empty title resets",
  );
  assert.equal(
    typed.onAction(Actions.renameTab("sh2", "")),
    undefined,
    "an empty title on an untouched tab is cancelled",
  );
  assert.equal(typed.onAction(Actions.renameTab("sh2", "Shell")), undefined);
  // Other panels keep the built-in rename, and every other action passes through.
  for (const action of [
    Actions.renameTab("file:a", "renamed file"),
    Actions.renameTab("missing", "x"),
    Actions.selectTab("sh1"),
  ])
    assert.equal(typed.onAction(action), action);
  assert.deepEqual(typed.log, [], "no close, history or bridge call");
  // The library really sends that action from the tab, and applies what onAction returns.
  const dist = tight(
    fs.readFileSync(
      path.join(root, "node_modules/flexlayout-react/dist/index.js"),
      "utf8",
    ),
  );
  assert.ok(
    dist.includes(
      "controller.doAction(Actions.renameTab(tabNode.getId(), event.target.value));",
    ),
  );
  assert.ok(
    dist.includes(
      "const outcome = this._props.onAction(action); if (outcome !== void 0) return this._props.model.doAction(outcome);",
    ),
  );
  assert.equal(real.globalLayout.tabEnableRename, true);

  // Titles travel with the tab: presets, Open all, templates and history snapshots.
  const m = Model.fromJson(workspaceJson());
  const w = resetWorld(m);
  const snapshotBefore = m.toJson();
  w.renamePanel("sh1", "Build");
  w.renamePanel("seat:local:s1", "Lead");
  const snapshotAfter = m.toJson();
  const tabs = jsonTabs(m.toJson());
  for (const preset of ["Team", "Focus", "Review"]) {
    const arranged = real.arrangement(tabs, preset);
    assert.deepEqual(tabJson(arranged, "sh1"), tabJson(m, "sh1"), preset);
    assert.deepEqual(
      tabJson(arranged, "seat:local:s1"),
      tabJson(m, "seat:local:s1"),
      preset,
    );
  }
  assert.equal(
    Model.fromJson(snapshotBefore, m).getNodeById("sh1").getName(),
    "Shell",
  );
  assert.deepEqual(
    tabJson(Model.fromJson(snapshotBefore), "sh1"),
    before[1],
    "an older snapshot has the old name and no keys",
  );
  assert.equal(
    tabJson(Model.fromJson(snapshotAfter), "sh1").config.customTitle,
    "Build",
    "a newer snapshot has both",
  );
  const template = real.roleSnapshot(m.toJson());
  const made = jsonTabs(
    real.instantiateRoles(template, CONNECTION, "/p", [SEAT]),
  );
  const madeSeat = made.find((t) => t.id === "seat:local:s1");
  assert.equal(
    madeSeat.name,
    "reviewer-1",
    "a seat panel takes its seat name from the template",
  );
  assert.equal("customTitle" in madeSeat.config, false);
  const madeShell = made.find((t) => t.name === "Build");
  assert.equal(madeShell.component, "terminal");
  assert.equal(
    "customTitle" in madeShell.config,
    false,
    "a template keeps the text, not the reset",
  );
  assert.equal(lib.isRenamed(madeShell), false);
  assert.equal(
    lib.applyCustomTitle(madeShell, "Next").config.defaultTitle,
    "Build",
  );
});

test("panel-title restore: a damaged or hostile stored workspace opens with clean titles, a clean one opens exactly as before, and only an unreadable one is refused", () => {
  const stored = workspaceJson();
  const [seatTab, shellTabJson, fileTab] = stored.layout.children[0].children;
  seatTab.name = "evil" + ch(0x202e, 0x2066) + "name" + "z".repeat(5000);
  seatTab.config.customTitle = "line1\nline2" + ch(7);
  seatTab.config.defaultTitle = "o".repeat(900);
  shellTabJson.name = 42;
  shellTabJson.config.customTitle = { a: 1 };
  shellTabJson.config.defaultTitle = "stale";
  fileTab.name = "f" + ch(0) + "ile" + ch(0x200b) + ".txt";
  fileTab.config.customTitle = "x".repeat(100000);
  stored.layout.children[1].children[0].name = "   ";
  deepFreeze(stored);
  const model = real.restoreModel(stored);
  const seat = tabJson(model, "seat:local:s1");
  assert.equal(seat.name, "line1 line2");
  assert.equal(seat.config.customTitle, "line1 line2");
  assert.equal(seat.config.defaultTitle, "o".repeat(200));
  assert.deepEqual(seat.config.seat, SEAT, "the seat is untouched");
  assert.equal(seat.config.terminalId, "seat:local:s1");
  const shell = tabJson(model, "sh1");
  assert.equal(shell.name, "Shell");
  assert.equal(
    "customTitle" in shell.config || "defaultTitle" in shell.config,
    false,
  );
  const file = tabJson(model, "file:a");
  assert.equal(file.name, "file.txt");
  assert.equal("customTitle" in file.config, false);
  assert.equal(tabJson(model, "sh2").name, "Shell");
  // What is saved next is clean too.
  const saved = JSON.stringify(model.toJson());
  const saveTabs = jsonTabs(JSON.parse(saved));
  assert.equal(saveTabs.length, 4);
  for (const tab of saveTabs)
    for (const text of [
      tab.name,
      tab.config.customTitle,
      tab.config.defaultTitle,
    ])
      if (text !== undefined)
        assert.ok(
          Array.from(text).every((c) => !isHiddenCode(c.codePointAt(0))),
          "no hidden character is saved: " + JSON.stringify(text),
        );
  assert.ok(saved.length < 20000, "no huge text is saved");
  assert.equal(
    JSON.stringify(real.restoreModel(JSON.parse(saved)).toJson()),
    saved,
    "a second restore changes nothing",
  );

  // A clean workspace opens exactly as the library would open it.
  const clean = workspaceJson();
  clean.layout.id = "root";
  clean.layout.children[0].children[1].name = "Build";
  clean.layout.children[0].children[1].config.customTitle = "Build";
  clean.layout.children[0].children[1].config.defaultTitle = "Shell";
  assert.deepEqual(
    plain(real.restoreModel(plain(clean)).toJson()),
    plain(
      Model.fromJson({
        ...plain(clean),
        global: { ...real.globalLayout },
      }).toJson(),
    ),
  );

  // Only an unreadable layout is refused: it falls back to the welcome tab like any other.
  const nest = (levels) => {
    let node = {
      type: "tabset",
      children: [{ type: "tab", id: "t", name: "t", component: "editor" }],
    };
    for (let i = 0; i < levels; i++) node = { type: "row", children: [node] };
    return { global: real.globalLayout, layout: node };
  };
  assert.equal(
    real.restoreModel(nest(100)).getNodeById("welcome") !== undefined,
    true,
    "100 levels is refused",
  );
  const huge = workspaceJson();
  huge.layout.children[0].children = Array.from({ length: 20001 }, (_, i) => ({
    type: "tab",
    id: "t" + i,
    name: "t",
    component: "editor",
  }));
  assert.ok(
    real.restoreModel(huge).getNodeById("welcome"),
    "20001 nodes is refused",
  );
  for (const junk of [
    undefined,
    null,
    5,
    "text",
    true,
    [],
    {},
    { layout: 5 },
    { layout: { type: "row", children: "x" } },
  ]) {
    const out = real.restoreModel(junk);
    assert.ok(
      out.getNodeById,
      "a model comes back for " + JSON.stringify(junk),
    );
  }
  assert.ok(real.restoreModel(undefined).getNodeById("welcome"));
});

// ---------------------------------------------------------------------------
// Wiring and documentation.

const srcFiles = fs
  .readdirSync(path.join(root, "src"))
  .filter((name) => /\.(ts|tsx)$/.test(name))
  .sort();
const filesWith = (needle) =>
  srcFiles.filter((name) =>
    stripComments(read("src/" + name)).includes(needle),
  );

test("panel-title wiring: the module is pure, the menu only passes text, App changes the tab title and nothing else, no effect of the terminal depends on its whole config, and only the title code knows the two keys", () => {
  // The pure module.
  const source = read("src/panel-title.ts");
  assert.ok(isAscii(source), "ASCII only");
  const code = stripComments(source);
  assert.ok(!/^import /m.test(code), "no import");
  assert.ok(!/export default/.test(code), "named exports only");
  assert.ok(
    !/\b(document|window|hrig|React|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|fetch|Date|Math|performance|eval|require|console|process|structuredClone|crypto)\b/.test(
      code,
    ),
    "no browser, storage, clock, timer, network or bridge word",
  );
  const lines = source.split("\n");
  const exported = lines
    .map((line, i) => ({ line, i }))
    .filter((x) => x.line.startsWith("export "));
  assert.deepEqual(
    exported.map((x) =>
      x.line.replace(/^export (const|function|interface) (\w+).*$/, "$2"),
    ),
    [
      "MAX_TITLE",
      "MAX_ORIGINAL",
      "MAX_NODES",
      "MAX_DEPTH",
      "TitledTab",
      "TitlePatch",
      "normalizeTitle",
      "canRename",
      "customTitleOf",
      "isRenamed",
      "titleOf",
      "applyCustomTitle",
      "resetTitle",
      "normalizeTabTitles",
    ],
    "the exports, in order",
  );
  for (const x of exported)
    assert.ok(
      lines[x.i - 1].startsWith("/** ") && lines[x.i - 1].endsWith(" */"),
      "a one-line doc comment above: " + x.line,
    );
  for (const line of [
    "export const MAX_TITLE = 60;",
    "export const MAX_ORIGINAL = 200;",
    "export const MAX_NODES = 20000;",
    "export const MAX_DEPTH = 64;",
  ])
    assert.ok(lines.includes(line), line);

  // The menu: the same three imports, only the existing look, and no title logic of its own.
  const menuText = read("src/PanelContextMenu.tsx");
  assert.ok(isAscii(menuText), "ASCII only");
  const menu = tight(stripComments(menuText));
  assert.deepEqual(stripComments(menuText).match(/from "[^"]+";/g), [
    'from "react";',
    'from "./components";',
    'from "./panel-close-targets";',
  ]);
  assert.equal(count(menu, "<span>Rename...</span>"), 1);
  assert.equal(count(menu, "<span>Reset name</span>"), 1);
  assert.equal(count(menu, 'title="Rename panel"'), 1);
  assert.equal(
    count(
      menu,
      'subtitle="Only the tab title changes. The session and the seat are not touched."',
    ),
    1,
    "the dialog says it is a label only",
  );
  assert.ok(
    menu.includes(
      "Up to " +
        lib.MAX_TITLE +
        " characters. Leave it empty to restore the original name.",
    ),
    "the dialog note quotes the limit of the module",
  );
  assert.ok(
    menu.includes(
      'const titled = clicked?.kind === "seat" || clicked?.kind === "shell";',
    ),
  );
  assert.ok(
    menu.includes(
      'if (event.key === "Enter" && !event.nativeEvent.isComposing)',
    ),
  );
  const css = read("src/styles.css");
  for (const name of [
    "menu-separator",
    "field-label",
    "field-note",
    "modal-actions",
    "secondary-button",
    "primary-button",
  ]) {
    assert.ok(menu.includes(name), name + " is used");
    assert.ok(
      css.includes("." + name),
      name + " already has a rule: the look is reused",
    );
  }
  assert.ok(
    !/style=\{\{[^}]*\}\}/.test(menu.replace(/style=\{\{ left:[^}]*\}\}/, "")),
    "only the position is styled",
  );
  assert.deepEqual(filesWith("Rename..."), ["PanelContextMenu.tsx"]);
  assert.deepEqual(filesWith("Reset name"), ["PanelContextMenu.tsx"]);

  // App.tsx: the exact text of every title edit.
  const app = tight(stripComments(read("src/App.tsx")));
  const has = (part) => assert.ok(app.includes(tight(part)), part);
  has(
    'import { applyCustomTitle, canRename, isRenamed, resetTitle, type TitlePatch } from "./panel-title";',
  );
  has(
    `const titledTab = (id: string) => { const node = model.getNodeById(id); return node instanceof TabNode ? { component: node.getComponent(), name: node.getName(), config: node.getConfig(), } : null; };`,
  );
  has(
    `const retitleTab = (id: string, patch: TitlePatch | null) => { if (!patch) return; model.doAction(Actions.updateNodeAttributes(id, patch)); modelChanged(model); };`,
  );
  has(
    "const renamePanel = (id: string, text: string) => retitleTab(id, applyCustomTitle(titledTab(id), text));",
  );
  has(
    "const resetPanelName = (id: string) => retitleTab(id, resetTitle(titledTab(id)));",
  );
  has(
    `if (action.type === Actions.RENAME_TAB) { const tab = titledTab(action.data.node); if (!canRename(tab)) return action; const patch = applyCustomTitle(tab, action.data.text); return patch ? Actions.updateNodeAttributes(action.data.node, patch) : undefined; }`,
  );
  has(
    "<PanelContextMenu menu={tabMenu} renamed={!!tabMenu && isRenamed(titledTab(tabMenu.id))} onDismiss={() => setTabMenu(null)} onClosePanels={closePanels} onRenamePanel={renamePanel} onResetPanel={resetPanelName} />",
  );
  assert.equal(count(app, "<PanelContextMenu "), 1);
  assert.equal(count(app, "Actions.RENAME_TAB"), 1);
  assert.equal(
    count(app, "Actions.updateNodeAttributes("),
    5,
    "the arranger, a file line, the dirty flag and the two title edits",
  );
  assert.equal(count(app, "applyCustomTitle("), 2);
  assert.equal(count(app, "resetTitle("), 1);
  assert.equal(count(app, "titledTab("), 4);
  assert.equal(
    count(app, "remember();"),
    9,
    "a title change is not an arrangement and adds no history step",
  );
  assert.equal(
    count(app, "announceLayout("),
    3,
    "only the three arrangements announce a layout change",
  );
  const edits = tight(
    stripComments(
      cut(
        read("src/App.tsx"),
        "const titledTab = (id: string) => {",
        "const savePending = async () => {",
      ) +
        cut(
          read("src/App.tsx"),
          "if (action.type === Actions.RENAME_TAB) {",
          "return action;\n  };\n  const markDirty",
        ),
    ),
  );
  for (const word of [
    "window.",
    "hrig",
    "terminalId",
    "seat",
    "createTerminal",
    "writeTerminal",
    "closeTerminal",
    "sendTerminalCommand",
    "rigControl",
    "sendMessage",
    "localStorage",
    "setPending",
    "remember(",
    "setModel(",
    "Model.fromJson",
    "deleteTab",
    "moveNode",
    "setTimeout",
  ])
    assert.ok(!edits.includes(word), "the title edits never use " + word);
  const layout = tight(stripComments(read("src/layout.ts")));
  assert.ok(
    layout.includes('import { normalizeTabTitles } from "./panel-title";'),
  );
  assert.ok(
    layout.includes(
      "export function restoreModel(stored?: IJsonModel) { try { const json = normalizeTabTitles(stored); if (json)",
    ),
  );
  assert.equal(count(layout, "...withoutMaximized(json),"), 1);
  assert.equal(
    count(layout, "tabEnableRename: true,"),
    1,
    "the built-in rename stays on",
  );
  assert.equal(
    count(app, "restoreModel("),
    3,
    "every stored layout, saved layout and role template is cleaned by the one restore",
  );
  assert.deepEqual(filesWith('"./panel-title"'), ["App.tsx", "layout.ts"]);

  // Label only: the terminal never reads its whole config in a dependency list, and nothing outside the title code knows the two keys.
  const terminal = stripComments(read("src/TerminalPanel.tsx"));
  assert.ok(
    !/\[\s*config\s*[,\]]|,\s*config\s*[,\]]/.test(terminal),
    "no effect depends on the whole config",
  );
  assert.deepEqual(filesWith("customTitle"), ["panel-title.ts", "types.ts"]);
  assert.deepEqual(filesWith("defaultTitle"), ["panel-title.ts", "types.ts"]);
  const types = tight(read("src/types.ts"));
  assert.ok(types.includes("customTitle?: string;"));
  assert.ok(types.includes("defaultTitle?: string;"));
  for (const dir of ["electron", "mobile"]) {
    const walk = (folder) =>
      fs
        .readdirSync(path.join(root, folder), { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? walk(folder + "/" + entry.name)
            : [folder + "/" + entry.name],
        );
    for (const file of walk(dir).filter((f) => /\.(c?js|mjs|ts|tsx)$/.test(f)))
      assert.ok(
        !/customTitle|defaultTitle/.test(read(file)),
        file + " does not know the titles",
      );
  }
});

test("panel-title docs: NAVIGATION.md and TERMINALS.md each have one paragraph that says how to rename and reset, what is cleaned and kept, that it is a label only and what it never touches", () => {
  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark is kept");
  assert.ok(raw.endsWith(".\n") && !raw.endsWith("\n\n"));
  assert.ok(!raw.includes("\r"));
  const lines = raw.split("\n");
  const mine = lines.filter((l) => l.startsWith("Rename a terminal panel:"));
  assert.equal(mine.length, 1);
  const para = mine[0];
  assert.ok(isAscii(para), "plain ASCII");
  const at = lines.indexOf(para);
  assert.ok(
    lines[at - 1] === "" && lines[at + 1] === "",
    "a paragraph of its own",
  );
  const index = (start) => lines.findIndex((l) => l.startsWith(start));
  assert.ok(at > index("Layout undo notice:"));
  assert.ok(at < index("The command center entry Toggle focus mode"));
  assert.ok(at > index("Right-click a panel's tab for Close"));
  assert.equal(count(raw, "Rename a terminal panel:"), 1);
  for (const part of [
    "right-click the tab of a shell or a seat panel and choose Rename...",
    "Type the title and press Enter to save it; Escape or Cancel leaves the name as it was",
    "A title typed on the tab itself (double-click it, or press F2) follows the same rules",
    "line breaks and runs of spaces become one space",
    "control, zero-width and direction-override characters are removed",
    "it is cut at " + lib.MAX_TITLE + " characters",
    "An empty title, or the original name, puts the original name back",
    "the same menu also offers Reset name, which puts the original name back",
    "the original is saved with the panel, so this works after a restart too",
    "The title is saved with the workspace and with saved layouts",
    "cleaned again whenever a workspace, a saved layout or a role template is loaded",
    "Only terminals are renamed this way: files, diffs and other panels keep their names",
    "A title is only a label on the tab, in Find open panels and in the panel navigator",
    "the terminal header still shows the seat name and host",
    "the session, the seat and the panel id are not touched",
    "nothing is typed or sent to a terminal or seat",
    "starts with the seat's own name",
    "A rename takes away the Undo button of the layout notice",
    "Undo arrangement puts back the titles the panels had in the earlier layout",
  ])
    assert.ok(para.includes(part), "NAVIGATION.md must say: " + part);
  assert.ok(!/future|later|for now|v1|placeholder/i.test(para));

  const doc = read("TERMINALS.md");
  assert.ok(
    doc.charCodeAt(0) !== 0xfeff && doc.endsWith("\n") && !doc.endsWith("\n\n"),
  );
  assert.ok(!doc.includes("\r"));
  const rows = doc.split("\n");
  const own = rows.filter((l) => l.startsWith("Rename a terminal: "));
  assert.equal(own.length, 1);
  const where = rows.indexOf(own[0]);
  assert.ok(isAscii(own[0]), "plain ASCII");
  assert.ok(
    rows[where - 1] === "" && rows[where + 1] === "",
    "a paragraph of its own",
  );
  assert.ok(
    rows[where - 2].startsWith(
      "Command center lists Focus, Clear, Find, Reconnect",
    ),
    "right after the command center paragraph",
  );
  assert.ok(
    rows[where + 2].startsWith("Snippet placeholders: "),
    "right before the snippet paragraphs",
  );
  for (const part of [
    "choose Rename..., type a title and press Enter",
    "Reset name in the same menu puts the original name back",
    "NAVIGATION.md has the full rules: the title is cleaned, cut at " +
      lib.MAX_TITLE +
      " characters and saved with the workspace",
    "The title is only the label of the terminal's tab",
    "Find open panels, the panel navigator and the command center entries for that terminal",
    "the terminal header still shows the seat name, runtime and host",
    "the command center and Saved snippets still show the host and the terminal ID",
    "Renaming never touches the session",
    "nothing is typed or sent to the shell or the seat",
    "the terminal is not restarted or reconnected",
    "the seat and the terminal ID, which are what OpenRig actions and these controls use to find a terminal, stay as they are",
    "Only terminals can be renamed.",
  ])
    assert.ok(own[0].includes(part), "TERMINALS.md must say: " + part);
  assert.ok(!/future|later|for now|v1|placeholder/i.test(own[0]));
});
