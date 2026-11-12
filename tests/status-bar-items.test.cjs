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
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const char = (code) => String.fromCharCode(code);
function isAscii(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 126 || (c < 32 && c !== 10)) return false;
  }
  return true;
}

function bundle(entry) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  }).outputFiles[0].text;
}
function load(entry) {
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod._compile(bundle(entry), mod.filename);
  return mod.exports;
}
const lib = load("src/status-bar-items.ts");
const settings = load("src/settings.ts");
const focus = load("src/focus-mode.ts");

const KEY = "appearance.statusBarHidden";
const IDS = [
  "accounts",
  "connection",
  "source-control",
  "reconnect",
  "sessions",
  "layout",
  "activity",
];

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The real footer of src/App.tsx: its own text is cut out, compiled and run
// over fakes, so what the test sees is what the application draws. Elements
// are recorded as plain objects and printed as an outline.

function footerText() {
  const app = read("src/App.tsx");
  const open = '<footer className="statusbar">';
  const start = app.indexOf(open);
  assert.ok(start > 0, "the footer is in App.tsx");
  assert.equal(app.indexOf(open, start + 1), -1, "exactly one footer");
  const end = app.indexOf("</footer>", start);
  assert.ok(end > start, "the footer closes");
  return app.slice(start, end + "</footer>".length);
}
const FOOTER_NAMES = [
  "AccountStatus",
  "connection",
  "Network",
  "GitBranch",
  "setSection",
  "setSidebar",
  "droppedNow",
  "reconnectDropped",
  "RefreshCw",
  "droppedLabel",
  "tabCount",
  "Check",
  "addPanel",
  "Activity",
  "isVisible",
  "hiddenStatusItems",
  "statusSeparators",
  // The connection menu, the Git info and the rig health items of the long-list chain, which the same
  // visibility rules now wrap or sit beside. They are inert here; their own tests cover them.
  "menu",
  "setMenu",
  "ChevronDown",
  "state",
  "chooseConnection",
  "GitInfoStatus",
  "root",
  "fileRevision",
  "RigHealthStatus",
  "attentionScope",
  "inventory",
  "inventoryHealth",
  "inventoryError",
];
function compileFooter() {
  const source =
    "export default function Footer({ " +
    FOOTER_NAMES.join(", ") +
    " }) { return (" +
    footerText() +
    "); }";
  const out = transformSync(source, {
    loader: "tsx",
    jsx: "automatic",
    format: "cjs",
  }).code;
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(
    (id) => {
      if (id === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      throw new Error("unexpected import in the footer: " + id);
    },
    mod,
    mod.exports,
  );
  return mod.exports.default;
}
const Footer = compileFooter();
function footer({
  hidden = "",
  dropped = [],
  kind = "local",
  tabs = 3,
  calls = [],
} = {}) {
  const hiddenStatusItems = lib.parseHidden(hidden);
  return Footer({
    AccountStatus: function AccountStatus() {},
    connection: { kind, name: "box" },
    Network: "Network",
    GitBranch: "GitBranch",
    setSection: (...args) => calls.push(["setSection", ...args]),
    setSidebar: (...args) => calls.push(["setSidebar", ...args]),
    droppedNow: dropped,
    reconnectDropped: () => calls.push(["reconnectDropped"]),
    RefreshCw: "RefreshCw",
    droppedLabel: (n) => "Reconnect all dropped (" + n + ")",
    tabCount: tabs,
    Check: "Check",
    addPanel: (...args) => calls.push(["addPanel", ...args]),
    Activity: "Activity",
    isVisible: lib.isVisible,
    hiddenStatusItems,
    statusSeparators: lib.statusDividers(hiddenStatusItems),
    menu: null,
    setMenu: () => {},
    ChevronDown: "ChevronDown",
    state: { connections: [], activeRig: "" },
    chooseConnection: () => {},
    GitInfoStatus: function GitInfoStatus() {},
    root: "/synthetic/project",
    fileRevision: 0,
    RigHealthStatus: function RigHealthStatus() {},
    attentionScope: () => ({ ready: false }),
    inventory: null,
    inventoryHealth: { current: null },
    inventoryError: "",
  });
}
function outline(node, depth = 0, out = []) {
  const pad = "  ".repeat(depth);
  if (Array.isArray(node)) {
    node.forEach((n) => outline(n, depth, out));
    return out;
  }
  if (node === null || node === undefined || typeof node === "boolean")
    return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(pad + JSON.stringify(String(node)));
    return out;
  }
  const { children, className, title, ...rest } = node.props || {};
  const name = typeof node.type === "function" ? node.type.name : node.type;
  const attrs =
    (className ? "." + className : "") +
    (title ? " title=" + JSON.stringify(title) : "") +
    Object.keys(rest)
      .map(
        (k) =>
          " " +
          k +
          (typeof rest[k] === "function"
            ? "=fn"
            : "=" + JSON.stringify(rest[k])),
      )
      .join("");
  out.push(pad + name + attrs);
  outline(children, depth + 1, out);
  return out;
}
const lines = (options) => outline(footer(options));
const allNodes = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => allNodes(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    allNodes(node.props && node.props.children, out);
  }
  return out;
};
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : node && typeof node === "object"
      ? textOf(node.props && node.props.children)
      : typeof node === "string" || typeof node === "number"
        ? String(node)
        : "";
const dividers = (options) =>
  allNodes(footer(options)).filter(
    (n) => n.props && n.props.className === "status-divider",
  ).length;

// What each id draws, found in the footer tree.
const MARKERS = {
  accounts: (tree) =>
    allNodes(tree).some((n) => n.type && n.type.name === "AccountStatus"),
  connection: (tree) =>
    allNodes(tree).some((n) => n.props && n.props.className === "status-brand"),
  "source-control": (tree) =>
    allNodes(tree).some(
      (n) => n.type === "button" && textOf(n).trim() === "Source control",
    ),
  reconnect: (tree) =>
    allNodes(tree).some(
      (n) =>
        n.type === "button" && textOf(n).startsWith("Reconnect all dropped"),
    ),
  sessions: (tree) =>
    allNodes(tree).some((n) => n.type === "span" && /open$/.test(textOf(n))),
  layout: (tree) =>
    allNodes(tree).some(
      (n) => n.type === "span" && textOf(n) === "Layout autosaved",
    ),
  activity: (tree) => allNodes(tree).some((n) => n.type === "Activity"),
};

// The outlines the footer printed at the base commit 66da441 (before this
// item), for the three shapes a person sees by default.
const GOLDEN_LOCAL = [
  "footer.statusbar",
  '  AccountStatus connection={"kind":"local","name":"box"}',
  "  div",
  "    span.status-brand",
  "      Network size=11",
  '      "Local workspace"',
  "    button onClick=fn",
  "      GitBranch size=11",
  '      "Source control"',
  "  div",
  "    span",
  '      "3"',
  '      " "',
  '      "sessions"',
  '      " open"',
  "    span.status-divider",
  "    span",
  "      Check size=11",
  '      "Layout autosaved"',
  "    button onClick=fn",
  "      Activity size=12",
];
const GOLDEN_DROPPED = [
  "footer.statusbar",
  '  AccountStatus connection={"kind":"ssh","name":"box"}',
  "  div",
  "    span.status-brand",
  "      Network size=11",
  '      "SSH: box"',
  "    button onClick=fn",
  "      GitBranch size=11",
  '      "Source control"',
  "  div",
  "    fragment",
  '      button title="Re-attach every ended or errored terminal. Connected terminals are not touched." onClick=fn',
  "        RefreshCw size=11",
  '        "Reconnect all dropped (2)"',
  "      span.status-divider",
  "    span",
  '      "3"',
  '      " "',
  '      "sessions"',
  '      " open"',
  "    span.status-divider",
  "    span",
  "      Check size=11",
  '      "Layout autosaved"',
  "    button onClick=fn",
  "      Activity size=12",
];

test("status-bar-items tracer: the real footer of App.tsx draws exactly what it drew before when nothing is hidden, drops each listed item and its divider, keeps the reconnect button tied to dropped terminals, and the setting travels through the real settings with project over user", () => {
  // Layer 1, the setting: empty by default, one text value, project beats user.
  assert.equal(settings.defaults[KEY], "");
  assert.equal(settings.resolveSettings()[KEY], "");
  assert.deepEqual(settings.validateOverrides({ [KEY]: "sessions, layout" }), {
    [KEY]: "sessions, layout",
  });
  const resolved = settings.resolveSettings(
    { [KEY]: "sessions" },
    { [KEY]: "layout, activity" },
  )[KEY];
  assert.equal(resolved, "layout, activity");
  assert.deepEqual([...lib.parseHidden(resolved)], ["layout", "activity"]);
  assert.deepEqual([...lib.parseHidden(settings.resolveSettings()[KEY])], []);

  // Layer 2, nothing hidden: the same tree as before, in three shapes.
  assert.deepEqual(lines(), GOLDEN_LOCAL);
  assert.deepEqual(lines({ kind: "ssh", dropped: ["a", "b"] }), GOLDEN_DROPPED);
  const wsl = lines({ kind: "wsl", tabs: 1 });
  assert.ok(wsl.includes('      "WSL: box"'));
  assert.ok(wsl.includes('      "session"'), "one session is singular");
  assert.deepEqual(
    lines({ hidden: "unknown, SESSIONSX, ;, <>" }),
    GOLDEN_LOCAL,
    "unknown words hide nothing",
  );

  // Layer 3, the footer: hide one id at a time, with two dropped terminals
  // so the reconnect button exists. Only that item goes; every other stays.
  for (const id of IDS) {
    const tree = footer({ hidden: id, dropped: ["a", "b"] });
    for (const other of IDS)
      assert.equal(
        MARKERS[other](tree),
        other !== id,
        id + " hidden: " + other + " is " + (other !== id ? "shown" : "gone"),
      );
  }
  // Without dropped terminals the reconnect button is never drawn, listed or not.
  assert.equal(MARKERS.reconnect(footer({ dropped: [] })), false);
  assert.equal(MARKERS.reconnect(footer({ hidden: "reconnect" })), false);
  // With dropped terminals it is drawn until it is listed (D-02).
  assert.equal(MARKERS.reconnect(footer({ dropped: ["a"] })), true);
  assert.equal(
    MARKERS.reconnect(footer({ dropped: ["a"], hidden: "reconnect" })),
    false,
  );

  // Dividers: only between two shown items.
  assert.equal(dividers(), 1);
  assert.equal(dividers({ dropped: ["a"] }), 2);
  assert.equal(dividers({ hidden: "sessions" }), 0);
  assert.equal(dividers({ hidden: "layout" }), 0);
  assert.equal(dividers({ hidden: "activity" }), 1);
  assert.equal(dividers({ hidden: "sessions", dropped: ["a"] }), 1);
  assert.equal(dividers({ hidden: "sessions, layout", dropped: ["a"] }), 1);
  assert.equal(
    dividers({ hidden: "sessions, layout, activity", dropped: ["a"] }),
    0,
  );
  assert.equal(dividers({ hidden: "reconnect", dropped: ["a"] }), 1);

  // Every id hidden: an empty strip with the footer and its two groups.
  const empty = lines({ hidden: IDS.join(" "), dropped: ["a"] });
  assert.deepEqual(empty, ["footer.statusbar", "  div", "  div"]);

  // Clicks still do what they did: the handlers are the app's own.
  const calls = [];
  const tree = footer({ dropped: ["a"], calls });
  const press = (match) =>
    allNodes(tree)
      .find((n) => n.type === "button" && match(n))
      .props.onClick();
  press((n) => textOf(n).trim() === "Source control");
  press((n) => textOf(n).startsWith("Reconnect"));
  press((n) => allNodes(n.props.children).some((c) => c.type === "Activity"));
  assert.deepEqual(calls, [
    ["setSection", "changes"],
    ["setSidebar", true],
    ["reconnectDropped"],
    ["addPanel", "activity", "Activity"],
  ]);

  // The master switch keeps its meaning: the setting never turns the bar on.
  assert.equal(focus.showStatusBar(focus.FOCUS_OFF, true), true);
  assert.equal(focus.showStatusBar(focus.FOCUS_OFF, false), false);
  assert.equal(
    focus.showStatusBar(
      { on: true, prev: { sidebar: true, statusBar: true } },
      true,
    ),
    false,
  );
});

// An independent model of parseHidden: a character scan, not a split.
function modelHidden(text) {
  const found = new Set();
  if (typeof text !== "string") return found;
  const chars = Array.from(text.slice(0, 300).toLowerCase());
  const words = [];
  let word = "";
  for (const c of chars) {
    if (c === "," || /\s/.test(c)) {
      if (word) words.push(word);
      word = "";
    } else word += c;
  }
  if (word) words.push(word);
  for (const w of words.slice(0, 32)) if (IDS.includes(w)) found.add(w);
  return found;
}

test("status-bar-items rules: the catalog, parsing (separators, case, caps, hostile text), isVisible, serialize and the dividers", () => {
  // Catalog: seven items in drawing order, frozen, ids that fit the setting text rule.
  assert.deepEqual(
    lib.STATUS_ITEMS.map((item) => item.id),
    IDS,
  );
  assert.ok(Object.isFrozen(lib.STATUS_ITEMS));
  for (const item of lib.STATUS_ITEMS) {
    assert.ok(Object.isFrozen(item));
    assert.deepEqual(Object.keys(item).sort(), ["id", "label"]);
    assert.match(item.id, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(item.label.length > 0 && item.label.length <= 40);
  }
  assert.equal(new Set(IDS).size, IDS.length);
  assert.equal(lib.MAX_HIDDEN_TEXT, 300);
  assert.equal(lib.MAX_HIDDEN_WORDS, 32);

  const hide = (text) => [...lib.parseHidden(text)].sort();
  // Separators: commas, spaces, tabs, line breaks, mixed, doubled, leading, trailing.
  assert.deepEqual(hide("sessions"), ["sessions"]);
  assert.deepEqual(hide("sessions,layout"), ["layout", "sessions"]);
  assert.deepEqual(hide("sessions layout"), ["layout", "sessions"]);
  assert.deepEqual(hide("  sessions ,, layout ,  "), ["layout", "sessions"]);
  assert.deepEqual(hide("sessions\tlayout\nactivity\r\naccounts"), [
    "accounts",
    "activity",
    "layout",
    "sessions",
  ]);
  assert.deepEqual(hide("sessions" + char(160) + "layout"), [
    "layout",
    "sessions",
  ]);
  assert.deepEqual(hide("source-control"), ["source-control"]);
  // Case is ignored; repeats count once; unknown words are dropped.
  assert.deepEqual(hide("SESSIONS, Layout, sessions, SeSsIoNs"), [
    "layout",
    "sessions",
  ]);
  for (const word of [
    "session",
    "sessionsx",
    "source",
    "control",
    "source_control",
    "sourcecontrol",
    "-sessions",
    "sessions-",
    "all",
    "*",
    "true",
    "1",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "layout;activity",
    "<sessions>",
    "{sessions}",
  ])
    assert.deepEqual(hide(word), [], word);
  assert.deepEqual(
    hide("sessions; layout"),
    ["layout"],
    "a semicolon is not a separator, so sessions; is unknown",
  );
  // Not text: nothing hidden, never a throw.
  for (const junk of [
    undefined,
    null,
    0,
    1,
    NaN,
    true,
    false,
    {},
    { sessions: true },
    [],
    ["sessions"],
    () => "sessions",
    Symbol("sessions"),
    new Date(0),
    new Set(["sessions"]),
  ])
    assert.deepEqual(hide(junk), []);
  assert.ok(lib.parseHidden("sessions") instanceof Set);
  assert.notEqual(
    lib.parseHidden(""),
    lib.parseHidden(""),
    "a new set each call",
  );
  // Caps: first 300 characters, first 32 words.
  const pad = " ".repeat(299);
  assert.deepEqual(hide(pad + "a"), []);
  assert.deepEqual(hide(" ".repeat(299) + "layout"), [], "cut inside the word");
  assert.deepEqual(hide(" ".repeat(294) + "layout"), ["layout"], "ends at 300");
  assert.deepEqual(hide(" ".repeat(295) + "layout"), [], "one character over");
  const many = Array.from({ length: 32 }, () => "x").join(" ");
  assert.deepEqual(hide(many + " sessions"), [], "word 33 is not read");
  const almost = Array.from({ length: 31 }, () => "x").join(" ");
  assert.deepEqual(hide(almost + " sessions"), ["sessions"], "word 32 is read");
  assert.deepEqual(
    hide(", " + almost + " sessions"),
    ["sessions"],
    "a leading separator is not a word",
  );
  assert.deepEqual(
    hide(" , ".repeat(60) + "layout"),
    ["layout"],
    "separators are not words",
  );
  const huge = "sessions ".repeat(1000000);
  const started = process.hrtime.bigint();
  assert.deepEqual(hide(huge), ["sessions"]);
  assert.ok(
    Number(process.hrtime.bigint() - started) / 1e6 < 1000,
    "a megabyte of text is read in bounded time",
  );
  // Control, bidi and zero-width characters never make an id.
  assert.deepEqual(hide("ses" + char(0x200b) + "sions"), []);
  assert.deepEqual(hide("sessions" + char(0x202e)), []);
  assert.deepEqual(hide(char(0) + "sessions"), []);

  // isVisible: hidden means in the set; anything odd means shown.
  const set = new Set(["sessions"]);
  assert.equal(lib.isVisible("sessions", set), false);
  assert.equal(lib.isVisible("layout", set), true);
  assert.equal(lib.isVisible("nope", set), true);
  assert.equal(lib.isVisible("sessions", new Set()), true);
  for (const odd of [undefined, null, 0, "sessions", {}, [], { has: 1 }])
    assert.equal(lib.isVisible("sessions", odd), true);
  assert.equal(
    lib.isVisible("sessions", { has: (id) => id === "sessions" }),
    false,
  );

  // serialize: catalog order, ", " joined, unknown dropped, empty for nothing.
  assert.equal(lib.serialize(new Set()), "");
  assert.equal(lib.serialize([]), "");
  assert.equal(
    lib.serialize(new Set(["layout", "accounts"])),
    "accounts, layout",
  );
  assert.equal(
    lib.serialize([
      "activity",
      "layout",
      "sessions",
      "reconnect",
      "source-control",
      "connection",
      "accounts",
    ]),
    IDS.join(", "),
  );
  assert.equal(
    lib.serialize(["layout", "layout", "nope", "__proto__"]),
    "layout",
  );
  for (const odd of [undefined, null, "sessions", 5, {}, true])
    assert.equal(lib.serialize(odd), "");
  // The canonical text is always a valid setting value, and reads back the same.
  for (const id of IDS)
    assert.deepEqual(
      settings.validateOverrides({ [KEY]: lib.serialize([id]) }),
      {
        [KEY]: id,
      },
    );
  const all = lib.serialize(IDS);
  assert.equal(settings.validateOverrides({ [KEY]: all })[KEY], all);
  assert.ok(all.length <= 300);

  // statusDividers: a truth table over every subset of the three items that matter.
  const names = ["sessions", "layout", "activity"];
  for (let mask = 0; mask < 8; mask++) {
    const hiddenSet = new Set(names.filter((_, i) => mask & (1 << i)));
    const show = (id) => !hiddenSet.has(id);
    assert.deepEqual(lib.statusDividers(hiddenSet), {
      afterReconnect: show("sessions") || show("layout") || show("activity"),
      betweenSessionsAndLayout: show("sessions") && show("layout"),
    });
  }
  assert.deepEqual(
    lib.statusDividers(
      new Set(["accounts", "connection", "reconnect", "source-control"]),
    ),
    {
      afterReconnect: true,
      betweenSessionsAndLayout: true,
    },
  );
  assert.deepEqual(lib.statusDividers(undefined), {
    afterReconnect: true,
    betweenSessionsAndLayout: true,
  });

  // A seeded walk of 400 random texts against the model.
  const rand = seeded(20241108);
  const pieces = [
    ...IDS,
    ...IDS.map((id) => id.toUpperCase()),
    "foo",
    "sess",
    "source control",
    "layout;",
    "x".repeat(40),
  ];
  const seps = [
    " ",
    ", ",
    ",",
    "  ",
    "\t",
    "\n",
    ",,",
    " , ",
    char(160),
    ";",
    "|",
  ];
  let walked = 0;
  for (let i = 0; i < 400; i++) {
    walked++;
    let text = "";
    const n = Math.floor(rand() * 60);
    for (let k = 0; k < n; k++)
      text +=
        pieces[Math.floor(rand() * pieces.length)] +
        seps[Math.floor(rand() * seps.length)];
    assert.deepEqual(
      [...lib.parseHidden(text)].sort(),
      [...modelHidden(text)].sort(),
      JSON.stringify(text),
    );
    // Whatever was parsed, the canonical text of it parses back to the same set.
    const parsed = lib.parseHidden(text);
    assert.deepEqual(
      [...lib.parseHidden(lib.serialize(parsed))].sort(),
      [...parsed].sort(),
    );
  }
  assert.equal(walked, 400, "all 400 random texts were checked");
});

test("status-bar-items wiring: the module is pure with named exports, App.tsx imports it once and gates every item, the setting sits once in the Appearance schema, and nothing else changed shape", () => {
  const source = read("src/status-bar-items.ts");
  const code = stripComments(source);
  assert.equal(isAscii(source), true, "the module is ASCII");
  assert.equal(count(code, "import "), 0, "no import");
  assert.equal(count(code, "export default"), 0);
  for (const word of [
    "document.",
    "window.",
    "globalThis",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator",
    "process.",
    "require(",
    "fetch(",
    "XMLHttpRequest",
    "setTimeout",
    "setInterval",
    "eval(",
    "new Function",
    "Math.random",
    "Date",
    "performance.",
    "rigAction",
    "sendMessage",
  ])
    assert.equal(count(code, word), 0, "the module has no " + word);
  const exported = [
    ...source.matchAll(/^export (?:const|function|interface) (\w+)/gm),
  ].map((m) => m[1]);
  assert.deepEqual(exported, [
    "StatusItem",
    "STATUS_ITEMS",
    "MAX_HIDDEN_TEXT",
    "MAX_HIDDEN_WORDS",
    "StatusDividers",
    "parseHidden",
    "isVisible",
    "serialize",
    "statusDividers",
  ]);
  // A doc comment line directly above every export.
  const rows = source.split("\n");
  rows.forEach((row, i) => {
    if (/^export /.test(row))
      assert.ok(
        /\*\/\s*$/.test(rows[i - 1]) || /^\/\*\*.*\*\/$/.test(rows[i - 1]),
        "doc comment above: " + row,
      );
  });
  assert.ok(source.includes("export const MAX_HIDDEN_TEXT = 300;"));
  assert.ok(source.includes("export const MAX_HIDDEN_WORDS = 32;"));

  // App.tsx: one import, one hidden-set computation, one gate per item.
  const app = collapse(read("src/App.tsx"));
  assert.equal(
    count(
      app,
      'import { isVisible, parseHidden, statusDividers } from "./status-bar-items";',
    ),
    1,
  );
  assert.equal(count(app, 'from "./status-bar-items"'), 1);
  assert.equal(
    count(
      app,
      'const statusHiddenText = preferences["appearance.statusBarHidden"]; const hiddenStatusItems = useMemo( () => parseHidden(statusHiddenText), [statusHiddenText], ); const statusSeparators = statusDividers(hiddenStatusItems);',
    ),
    1,
  );
  assert.equal(count(app, "parseHidden("), 1);
  assert.equal(count(app, "statusDividers("), 1);
  for (const id of IDS)
    assert.equal(
      count(app, 'isVisible("' + id + '", hiddenStatusItems)'),
      1,
      "one gate for " + id,
    );
  assert.equal(count(app, "isVisible("), IDS.length);
  assert.equal(count(app, "statusSeparators.afterReconnect"), 1);
  assert.equal(count(app, "statusSeparators.betweenSessionsAndLayout"), 1);
  assert.equal(
    count(
      app,
      '{droppedNow.length > 0 && isVisible("reconnect", hiddenStatusItems) && (',
    ),
    1,
    "the reconnect button keeps its dropped-terminals condition and adds the gate",
  );
  // The master switch and the footer element are exactly as they were.
  assert.equal(
    count(
      app,
      '{showStatusBar(focusMode, preferences["appearance.statusBar"]) && ( <footer className="statusbar">',
    ),
    1,
  );
  assert.equal(count(app, '<footer className="statusbar">'), 1);
  assert.equal(count(app, '"appearance.statusBarHidden"'), 1);
  assert.equal(
    count(app, 'preferences["appearance.statusBar"]'),
    3,
    "the master switch is still read in exactly the three places it was",
  );
  // The footer's own text still holds every original element exactly once.
  const text = collapse(footerText());
  for (const part of [
    "<AccountStatus connection={connection} />",
    '<span className="status-brand">',
    "Source control",
    "onClick={reconnectDropped}",
    "{droppedLabel(droppedNow.length)}",
    '{tabCount} {tabCount === 1 ? "session" : "sessions"} open',
    "Layout autosaved",
    'addPanel("activity", "Activity")',
  ])
    assert.equal(count(text, part), 1, part);

  // settings.ts: one default, one Appearance row right after Show status bar, text only.
  const rows2 = settings.schema.map((row) => row.key);
  const at = rows2.indexOf(KEY);
  assert.equal(rows2.filter((key) => key === KEY).length, 1);
  assert.equal(rows2[at - 1], "appearance.statusBar");
  const row = settings.schema[at];
  assert.equal(row.category, "Appearance");
  assert.equal(row.label, "Hidden status bar items");
  assert.equal(row.options, undefined);
  assert.equal(row.min, undefined);
  for (const id of IDS)
    assert.ok(row.description.includes(id), "the row names " + id);
  assert.ok(row.description.includes("Empty (the default) shows every item"));
  const sets = read("src/settings.ts");
  assert.equal(
    count(sets, 'import { STATUS_ITEMS } from "./status-bar-items";'),
    1,
  );
  assert.equal(count(sets, '"appearance.statusBarHidden": "",'), 1);

  // Nothing else uses the module, and no bridge, IPC or main-process file knows it.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => read("src/" + name).includes("status-bar-items"))
    .sort();
  assert.deepEqual(users, ["App.tsx", "settings.ts"]);
  for (const dir of ["electron", "mobile"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base))
      if (fs.statSync(path.join(base, name)).isFile())
        assert.ok(
          !fs
            .readFileSync(path.join(base, name), "utf8")
            .includes("statusBarHidden"),
          dir + "/" + name,
        );
  }
});

test("status-bar-items docs: SETTINGS.md has the setting's row with an empty default and one Status bar items paragraph with every claim", () => {
  const doc = read("SETTINGS.md");
  assert.equal(isAscii(doc), true, "SETTINGS.md is ASCII");
  const rowLines = doc
    .split("\n")
    .filter((line) => line.startsWith("| `" + KEY + "` | empty |"));
  assert.equal(rowLines.length, 1, "one catalog row with an empty default");
  const rowText = rowLines[0];
  for (const id of IDS)
    assert.ok(rowText.includes("`" + id + "`"), "row names " + id);
  assert.ok(rowText.includes("shows every item, exactly as before"));
  assert.ok(rowText.includes("an empty box is not accepted"));
  const order = doc.split("\n").map((line) => line.split("|")[1]);
  const statusBar = order.indexOf(" `appearance.statusBar` ");
  assert.equal(
    order[statusBar + 1],
    " `" + KEY + "` ",
    "the row follows Show status bar",
  );

  const paragraphs = doc
    .split("\n\n")
    .filter((p) => p.startsWith("Status bar items:"));
  assert.equal(paragraphs.length, 1, "one Status bar items paragraph");
  const p = collapse(paragraphs[0]);
  for (const claim of [
    "`appearance.statusBarHidden` lists the status bar items to hide",
    "separated by commas or spaces",
    "`sessions, layout`",
    "`accounts` (the Accounts button)",
    "`connection` (the Local workspace, WSL or SSH label)",
    "`source-control` (the Source control button)",
    "`reconnect` (the Reconnect all dropped button)",
    "`sessions` (the count of open sessions)",
    "`layout` (the Layout autosaved note)",
    "`activity` (the Activity button)",
    "not case sensitive",
    "a repeated id counts once",
    "unknown ids are ignored",
    "first 300 characters and 32 words",
    "Empty text, the default, hides nothing",
    "exactly what it was",
    "drawn only while terminals are dropped",
    "stays visible then unless `reconnect` is listed",
    "the action, which stays in the command center as Terminal: Reconnect all dropped",
    "A thin divider is drawn only between two shown items",
    "user and the project scope",
    "`appearance.statusBar` (Show status bar), which still hides the whole bar",
    "focus mode still hides for the session",
    "empty strip",
    "not empty, at most 300 characters",
    "Display only; nothing is sent to the shell or the seat.",
  ])
    assert.ok(p.includes(claim), "SETTINGS.md must say: " + claim);
  // It sits with the other setting notes, before the follow-up ideas.
  assert.ok(
    doc.indexOf("Status bar items:") < doc.indexOf("## Follow-up ideas"),
  );
  assert.ok(
    doc.indexOf("Status bar items:") > doc.indexOf("## Settings catalog"),
  );
});
