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
const count = (text, part) => text.split(part).length - 1;
const isAscii = (text) => !/[^\n -~]/.test(text);
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// Hidden and astral characters are built from code points, never typed.
const ch = (...codes) => String.fromCodePoint(...codes);
const cps = (text) => Array.from(text).length;
const ELL = ch(0x2026);

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
  mod.require = (id) => require(id);
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const lib = load("src/window-title.ts");
const main = require("../electron/window-title.cjs");
const { buildWindowTitle, projectNameOf } = lib;

// The first forbidden character of a title, by code point, or -1 when there is none.
function forbidden(text) {
  for (const c of text) {
    const n = c.codePointAt(0);
    if (
      n < 32 ||
      (n >= 127 && n <= 159) ||
      (n >= 0xd800 && n <= 0xdfff) ||
      n === 0xad ||
      n === 0x61c ||
      n === 0x180e ||
      n === 0x200b ||
      n === 0x200c ||
      n === 0x200e ||
      n === 0x200f ||
      (n >= 0x202a && n <= 0x202e) ||
      (n >= 0x2060 && n <= 0x206f) ||
      (n >= 0xfff9 && n <= 0xfffb) ||
      (n >= 0xe0000 && n <= 0xe007f)
    )
      return n;
  }
  return -1;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The real preload script run against a fake electron module: it exposes the bridge object the renderer sees as the hrig object on its page.
function realBridge(invoke) {
  let exposed;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        assert.equal(name, "hrig");
        exposed = api;
      },
    },
    ipcRenderer: {
      invoke,
      send() {
        throw new Error("nothing is sent by this test");
      },
      sendSync() {
        throw new Error("nothing is sent by this test");
      },
      on() {},
      removeListener() {},
    },
    webUtils: { getPathForFile: () => "" },
  };
  new Function("require", "process", read("electron/preload.cjs"))(
    (id) => {
      assert.equal(id, "electron");
      return electron;
    },
    { platform: "linux" },
  );
  return exposed;
}

// The real main-process module with a fake window; the page's bridge reaches it through the real preload.
function world() {
  const handlers = {};
  const calls = [];
  const titles = [];
  const wc = {};
  const win = {
    webContents: wc,
    gone: false,
    isDestroyed() {
      return this.gone;
    },
    setTitle: (title) => titles.push(title),
  };
  main.registerWindowTitle({
    handle: (channel, fn) => {
      assert.ok(!(channel in handlers), "one handler per channel");
      handlers[channel] = fn;
    },
    getWindow: () => win,
  });
  const bridge = realBridge(async (channel, ...args) => {
    calls.push([channel, ...args]);
    assert.ok(channel in handlers, "a handler exists for " + channel);
    return handlers[channel]({ sender: wc }, ...args);
  });
  return { handlers, calls, titles, wc, win, bridge };
}

// The real title block of App.tsx, compiled and run over a tiny react: slot-based refs and effects that run after a render when their dependencies changed.
function titleBlock() {
  const app = read("src/App.tsx");
  const start = '  const sentTitle = useRef("hRig");\n';
  const end = "  }, [loaded, model, revision, root, titleDetails]);\n";
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from > 0 && to > from, "the title block is in App.tsx");
  assert.equal(app.indexOf(start, from + 1), -1, "the block is there once");
  return app.slice(from, to + end.length);
}
class FakeTab {
  constructor(name) {
    this.name = name;
  }
  getName() {
    return this.name;
  }
}
const modelOf = (node) => ({
  getActiveTabset: () =>
    node === undefined ? undefined : { getSelectedNode: () => node },
});
function mountTitle(hrig) {
  const code = transformSync(titleBlock(), { loader: "ts" }).code;
  const make = new Function(
    "useRef",
    "useEffect",
    "buildWindowTitle",
    "projectNameOf",
    "TabNode",
    "window",
    "loaded",
    "model",
    "revision",
    "root",
    "preferences",
    code,
  );
  const store = { refs: [], deps: [] };
  return (props) => {
    let refSlot = 0;
    let effectSlot = 0;
    const queue = [];
    const useRef = (initial) => {
      const at = refSlot++;
      if (!store.refs[at]) store.refs[at] = { current: initial };
      return store.refs[at];
    };
    const useEffect = (fn, deps) => {
      const at = effectSlot++;
      const old = store.deps[at];
      if (
        !old ||
        old.length !== deps.length ||
        deps.some((dep, i) => !Object.is(dep, old[i]))
      ) {
        store.deps[at] = deps;
        queue.push(fn);
      }
    };
    make(
      useRef,
      useEffect,
      buildWindowTitle,
      projectNameOf,
      FakeTab,
      { hrig },
      props.loaded,
      props.model,
      props.revision,
      props.root,
      props.preferences,
    );
    for (const fn of queue) fn();
  };
}
const ON = { "appearance.windowTitleDetails": true };
const OFF = { "appearance.windowTitleDetails": false };

test("window-title tracer: with the setting on, the active panel and the project reach the window through the real bridge and handler, with it off nothing is ever sent, and no other window or sender is touched", async () => {
  const w = world();
  const tab = new FakeTab("Build logs");
  const render = mountTitle(w.bridge);
  const props = {
    loaded: true,
    model: modelOf(tab),
    revision: 0,
    root: "/work/hrig/",
    preferences: OFF,
  };

  // Off is the default: any number of renders, tabs and roots send nothing.
  render(props);
  render({ ...props, revision: 1, root: "/work/other" });
  render({ ...props, revision: 2, model: modelOf(new FakeTab("Files")) });
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.titles, []);

  // On: one call, on the one channel, and the window has the title.
  render({ ...props, preferences: ON });
  assert.deepEqual(w.calls, [["window:title", "Build logs - hrig - hRig"]]);
  assert.deepEqual(w.titles, ["Build logs - hrig - hRig"]);

  // A renamed panel and a hostile name: cleaned before it leaves the page, and cleaned again in the main process.
  tab.name =
    "x" + ch(0) + "y" + ch(0x202e) + ch(0x200b) + "z".repeat(500) + "\n\t";
  render({ ...props, preferences: ON, revision: 3 });
  const last = w.titles.at(-1);
  assert.equal(forbidden(last), -1);
  assert.ok(cps(last) <= 100);
  assert.ok(last.endsWith(" - hrig - hRig"));
  assert.equal(last, w.calls.at(-1)[1], "the main process changed nothing");

  // A call that does not come from the main window is refused and changes nothing.
  const before = w.titles.slice();
  assert.throws(
    () => w.handlers["window:title"]({ sender: {} }, "Bank login"),
    /Untrusted application window\./,
  );
  assert.throws(
    () => w.handlers["window:title"](undefined, "Bank login"),
    /Untrusted application window\./,
  );
  assert.deepEqual(w.titles, before);

  // The page can only ask for text: a page that sends anything else, or another application's name, gets hRig at the end.
  await w.bridge.setWindowTitle({ not: "text" });
  await w.bridge.setWindowTitle("Bank login");
  assert.deepEqual(w.titles.slice(-2), ["hRig", "Bank login - hRig"]);

  // Off again: the window goes back to plain hRig.
  render({ ...props, preferences: OFF, revision: 3 });
  assert.equal(w.titles.at(-1), "hRig");
  assert.ok(w.calls.every((call) => call[0] === "window:title"));
});

test("window-title build: only an exactly enabled input gives more than hRig, the parts follow the panel, project, hRig order, missing or odd parts are left out and nothing else enters", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "APP_TITLE",
    "MAX_PANEL_PART",
    "MAX_PROJECT_PART",
    "MAX_WINDOW_TITLE",
    "TITLE_SEPARATOR",
    "buildWindowTitle",
    "projectNameOf",
  ]);
  assert.equal(lib.APP_TITLE, "hRig");
  assert.equal(lib.TITLE_SEPARATOR, " - ");
  assert.equal(buildWindowTitle(), "hRig");
  for (const input of [
    null,
    undefined,
    {},
    [],
    5,
    "x",
    true,
    { project: "p", panel: "q" },
    { enabled: false, project: "p", panel: "q" },
    { enabled: "true", project: "p", panel: "q" },
    { enabled: 1, project: "p", panel: "q" },
    { enabled: undefined, panel: "q" },
    { enabled: null, panel: "q" },
    { enabled: {}, panel: "q" },
  ])
    assert.equal(buildWindowTitle(input), "hRig", JSON.stringify(input));
  const on = (fields) => buildWindowTitle({ enabled: true, ...fields });
  assert.equal(
    on({ project: "hrig", panel: "Build logs" }),
    "Build logs - hrig - hRig",
  );
  assert.equal(on({ project: "hrig" }), "hrig - hRig");
  assert.equal(on({ panel: "Build logs" }), "Build logs - hRig");
  assert.equal(on({}), "hRig");
  assert.equal(on({ project: "  \n\t ", panel: " " }), "hRig");
  assert.equal(on({ project: "", panel: "" }), "hRig");
  for (const odd of [5, null, undefined, {}, [], true, () => "x"]) {
    assert.equal(on({ project: odd, panel: odd }), "hRig");
    assert.equal(on({ project: odd, panel: "Build" }), "Build - hRig");
    assert.equal(on({ project: "hrig", panel: odd }), "hrig - hRig");
  }
  // A renamed panel with an emoji, and an emoji sequence, are kept whole.
  assert.equal(
    on({ project: "hrig", panel: "Deploy " + ch(0x1f680) + " prod" }),
    "Deploy " + ch(0x1f680) + " prod - hrig - hRig",
  );
  const coder = ch(0x1f469, 0x200d, 0x1f4bb);
  assert.equal(on({ panel: coder + " Dev" }), coder + " Dev - hRig");
  // Only the two names are read: other fields, even secret looking ones, never enter.
  const wide = deepFreeze({
    enabled: true,
    project: "B",
    panel: "A",
    host: "secret-host",
    seat: "dev@rig",
    text: "file text",
    token: "tok",
  });
  assert.equal(buildWindowTitle(wide), "A - B - hRig");
  assert.equal(buildWindowTitle(wide), buildWindowTitle({ ...wide }));
  // Markup is only text to a window title.
  assert.equal(on({ panel: '<b>x</b> & "q"' }), '<b>x</b> & "q" - hRig');
  // The module is pure and reads only the panel title cleaner.
  const source = stripComments(read("src/window-title.ts"));
  assert.equal(count(source, " from "), 1);
  assert.equal(count(source, 'from "./panel-title"'), 1);
  assert.ok(
    !/\b(window|document|navigator|localStorage|sessionStorage|fetch|process|require|setTimeout|setInterval|Date|console)\b/.test(
      source,
    ),
  );
  assert.ok(isAscii(read("src/window-title.ts")));
});

test("window-title caps: the panel is cut to 50 characters with an end ellipsis, the project to 40 around a middle ellipsis, the whole title never passes 100, and no character is cut in half", () => {
  const on = (fields) => buildWindowTitle({ enabled: true, ...fields });
  assert.equal(lib.MAX_PANEL_PART, 50);
  assert.equal(lib.MAX_PROJECT_PART, 40);
  assert.equal(lib.MAX_WINDOW_TITLE, 100);
  assert.equal(
    lib.MAX_PANEL_PART +
      lib.MAX_PROJECT_PART +
      2 * lib.TITLE_SEPARATOR.length +
      lib.APP_TITLE.length,
    lib.MAX_WINDOW_TITLE,
    "the parts add up to the whole",
  );
  assert.equal(on({ panel: "a".repeat(50) }), "a".repeat(50) + " - hRig");
  assert.equal(on({ panel: "a".repeat(51) }), "a".repeat(49) + ELL + " - hRig");
  assert.equal(on({ project: "q".repeat(40) }), "q".repeat(40) + " - hRig");
  assert.equal(
    on({ project: "q".repeat(41) }),
    "q".repeat(20) + ELL + "q".repeat(19) + " - hRig",
  );
  // The middle cut keeps the start and the end of a project name.
  assert.equal(
    on({ project: "abcdefghij".repeat(5) }),
    "abcdefghijabcdefghij" + ELL + "bcdefghijabcdefghij" + " - hRig",
  );
  // The longest title there can be is exactly 100 characters.
  const longest = on({ panel: "p".repeat(300), project: "q".repeat(300) });
  assert.equal(
    longest,
    "p".repeat(49) +
      ELL +
      " - " +
      "q".repeat(20) +
      ELL +
      "q".repeat(19) +
      " - hRig",
  );
  assert.equal(cps(longest), 100);
  assert.equal(
    cps(on({ panel: "p".repeat(50), project: "q".repeat(40) })),
    100,
  );
  // Astral characters count as one and are never split.
  const rocket = ch(0x1f680);
  const rockets = on({ panel: rocket.repeat(60), project: rocket.repeat(60) });
  assert.equal(
    rockets,
    rocket.repeat(49) +
      ELL +
      " - " +
      rocket.repeat(20) +
      ELL +
      rocket.repeat(19) +
      " - hRig",
  );
  assert.ok(!/[\ud800-\udfff]/u.test(rockets), "no lone surrogate");
  // A cut that ends on a joiner, or starts on one, leaves no dangling joiner.
  const zwj = ch(0x200d);
  assert.equal(
    on({ project: "a".repeat(19) + zwj + "b".repeat(30) }),
    "a".repeat(19) + ELL + "b".repeat(19) + " - hRig",
  );
  assert.equal(
    on({ project: "a".repeat(31) + zwj + "b".repeat(18) }),
    "a".repeat(20) + ELL + "b".repeat(18) + " - hRig",
  );
  // A cut that ends on a space drops it.
  assert.equal(
    on({ panel: "a".repeat(48) + " " + "b".repeat(10) }),
    "a".repeat(48) + ELL + " - hRig",
  );
});

test("window-title project: the name is the last part of the path with either slash, a trailing slash ignored, a drive root keeps its backslash and nothing odd gives a name", () => {
  const cases = [
    ["/home/dev/hrig", "hrig"],
    ["/home/dev/hrig/", "hrig"],
    ["/home/dev/hrig///", "hrig"],
    ["/home/dev/my project", "my project"],
    ["C:\\Users\\dev\\hrig", "hrig"],
    ["C:\\Users\\dev\\hrig\\", "hrig"],
    ["C:/Users/dev/hrig", "hrig"],
    ["C:\\", "C:\\"],
    ["C:/", "C:\\"],
    ["c:", "c:\\"],
    ["~", "~"],
    ["~/", "~"],
    ["~/code", "code"],
    ["/", "/"],
    ["///", "/"],
    ["\\", "\\"],
    ["\\\\server\\share", "share"],
    ["\\\\server\\share\\", "share"],
    ["/a\\b", "b"],
    ["  /x/y  ", "y"],
    ["relative/name", "name"],
    ["name", "name"],
    [".", "."],
    ["", ""],
    ["   ", ""],
  ];
  for (const [input, expected] of cases)
    assert.equal(projectNameOf(input), expected, JSON.stringify(input));
  for (const odd of [undefined, null, 5, true, {}, [], () => "/x"])
    assert.equal(projectNameOf(odd), "");
  // A very long path gives its last part.
  assert.equal(projectNameOf("/a".repeat(5000) + "/tail"), "tail");
  assert.equal(projectNameOf("x".repeat(100000)), "x".repeat(4096));
  // The name goes through the same title rules.
  assert.equal(
    buildWindowTitle({
      enabled: true,
      project: projectNameOf("/w/" + "n".repeat(60)),
    }),
    "n".repeat(20) + ELL + "n".repeat(19) + " - hRig",
  );
  assert.equal(
    buildWindowTitle({ enabled: true, project: projectNameOf("C:\\") }),
    "C:\\ - hRig",
  );
});

test("window-title clean: control, zero-width, direction and tag characters are dropped, white space collapses, emoji stay, and huge or hostile text finishes at once", () => {
  const on = (fields) => buildWindowTitle({ enabled: true, ...fields });
  assert.equal(
    on({
      panel: "fi" + ch(0) + "le" + ch(10) + "name" + ch(0x202e) + "txt",
    }),
    "file nametxt - hRig",
  );
  const invisible = [
    0x07, 0x1b, 0x7f, 0x85, 0x9f, 0xad, 0x61c, 0x180e, 0x200b, 0x200c, 0x200e,
    0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2064,
    0x2065, 0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x206f, 0xfff9, 0xfffa,
    0xfffb, 0xe0001, 0xe0041, 0xe007f,
  ];
  for (const code of invisible) {
    const title = on({ panel: "A" + ch(code) + "B", project: "C" + ch(code) });
    assert.equal(title, "AB - C - hRig", "U+" + code.toString(16));
    assert.equal(forbidden(title), -1);
  }
  assert.equal(
    on({ panel: "A" + invisible.map((c) => ch(c)).join("") + "B" }),
    "AB - hRig",
  );
  // White space of every kind becomes one space.
  assert.equal(on({ panel: "  a \t\t b \n\n c  " }), "a b c - hRig");
  for (const space of [0xa0, 0x1680, 0x2003, 0x2028, 0x2029, 0x3000, 0xfeff])
    assert.equal(
      on({ panel: "a" + ch(space) + ch(space) + "b" }),
      "a b - hRig",
      "U+" + space.toString(16),
    );
  // Lone surrogates are dropped; pairs and emoji sequences stay.
  assert.equal(
    on({
      panel:
        "a" + String.fromCharCode(0xd83d) + "b" + String.fromCharCode(0xdc00),
    }),
    "ab - hRig",
  );
  const flag = ch(0x1f1fa, 0x1f1f8);
  const keycap = ch(0x31, 0xfe0f, 0x20e3);
  assert.equal(on({ panel: flag + keycap }), flag + keycap + " - hRig");
  // Only invisible text gives no name at all.
  assert.equal(
    on({ panel: ch(0x200b).repeat(10), project: ch(0x202e) }),
    "hRig",
  );
  // Huge text is read in part and finishes at once.
  const started = Date.now();
  assert.equal(
    on({ panel: "a".repeat(1000000) }),
    "a".repeat(49) + ELL + " - hRig",
  );
  assert.equal(on({ panel: ch(0x200b).repeat(1000000) }), "hRig");
  assert.equal(
    on({ project: "x ".repeat(500000) }),
    "x ".repeat(9) + "x" + ELL + "x ".repeat(9) + "x" + " - hRig",
  );
  assert.ok(Date.now() - started < 5000, "finishes at once");
});

test("window-title fuzz: random names and paths always give a title of at most 100 characters that ends with hRig, holds no forbidden character, and the main process changes none of them", () => {
  const next = rng(20260511);
  const pieces = [
    "a",
    "B",
    "z",
    "0",
    " ",
    "  ",
    "\t",
    "\n",
    "-",
    " - ",
    ".",
    "/",
    "\\",
    "~",
    ":",
    "hRig",
    " - hRig",
    "x".repeat(30),
    ch(0x1f680),
    ch(0x1f469, 0x200d, 0x1f4bb),
    ch(0x301),
    ch(0x2026),
    ch(0),
    ch(7),
    ch(0x7f),
    ch(0x85),
    ch(0xad),
    ch(0x61c),
    ch(0x180e),
    ch(0x200b),
    ch(0x200c),
    ch(0x200d),
    ch(0x200e),
    ch(0x200f),
    ch(0x202e),
    ch(0x2065),
    ch(0x2066),
    ch(0x2069),
    ch(0x206a),
    ch(0xfeff),
    ch(0xfff9),
    ch(0xe0041),
    String.fromCharCode(0xd800),
    String.fromCharCode(0xdc00),
  ];
  const text = () => {
    let out = "";
    const n = Math.floor(next() * 40);
    for (let i = 0; i < n; i++)
      out += pieces[Math.floor(next() * pieces.length)];
    return next() < 0.1 ? out.repeat(5) : out;
  };
  let longer = 0;
  let plain = 0;
  for (let i = 0; i < 600; i++) {
    // Every 50th round has no names at all, so the plain outcome is always covered.
    const bare = i % 50 === 0;
    const project = bare ? "" : next() < 0.3 ? projectNameOf(text()) : text();
    const panel = bare ? "" : text();
    const title = buildWindowTitle({ enabled: true, project, panel });
    assert.ok(cps(title) <= 100, "at most 100: " + JSON.stringify(title));
    assert.ok(title.endsWith("hRig"));
    assert.equal(forbidden(title), -1, JSON.stringify(title));
    assert.ok(!/ {2}/.test(title) && title === title.trim());
    assert.ok(!/[\n\r\t]/.test(title));
    assert.equal(title, buildWindowTitle({ enabled: true, project, panel }));
    assert.equal(buildWindowTitle({ enabled: false, project, panel }), "hRig");
    assert.equal(main.windowTitle(title), title, "the main process agrees");
    if (title === "hRig") plain++;
    else longer++;
    const raw = main.windowTitle(text());
    assert.ok(cps(raw) <= 100);
    assert.ok(raw.endsWith("hRig"));
    assert.equal(forbidden(raw), -1);
    assert.equal(main.windowTitle(raw), raw, "cleaning twice changes nothing");
  }
  assert.ok(longer > 100 && plain > 0, "the run covers both outcomes");
});

test("window-title main: the main process cleans, cuts and ends every title with hRig itself, accepts only the main window and returns nothing", () => {
  assert.deepEqual(Object.keys(main).sort(), [
    "APP_TITLE",
    "MAX_TITLE",
    "registerWindowTitle",
    "windowTitle",
  ]);
  assert.equal(main.APP_TITLE, "hRig");
  assert.equal(main.MAX_TITLE, 100);
  assert.equal(main.MAX_TITLE, lib.MAX_WINDOW_TITLE);
  const t = main.windowTitle;
  for (const odd of [undefined, null, 5, true, {}, [], () => "x", Symbol("s")])
    assert.equal(t(odd), "hRig");
  for (const empty of ["", "   ", "\n\t", ch(0x200b), "hRig", " hRig "])
    assert.equal(t(empty), "hRig");
  assert.equal(t("Build logs - hrig - hRig"), "Build logs - hrig - hRig");
  assert.equal(t("Bank login"), "Bank login - hRig");
  assert.equal(t("hRig - hRig"), "hRig - hRig");
  assert.equal(t("a" + ch(0) + "b\nc"), "ab c - hRig");
  assert.equal(
    t("a" + ch(0xad, 0x180e, 0x206a, 0xfff9, 0xe0041, 0x202e) + "b"),
    "ab - hRig",
  );
  assert.equal(t("a" + String.fromCharCode(0xd800) + "b"), "ab - hRig");
  const coder = ch(0x1f469, 0x200d, 0x1f4bb);
  assert.equal(t(coder), coder + " - hRig", "the joiner stays");
  // The cut: 100 characters in all, the ending included, never half an emoji.
  assert.equal(t("x".repeat(500)), "x".repeat(93) + " - hRig");
  assert.equal(cps(t("x".repeat(500))), 100);
  assert.equal(t(ch(0x1f680).repeat(200)), ch(0x1f680).repeat(93) + " - hRig");
  assert.equal(
    t("a".repeat(92) + ch(0x200d) + "b"),
    "a".repeat(92) + " - hRig",
    "no dangling joiner",
  );
  const started = Date.now();
  assert.equal(t("x".repeat(1000000)), "x".repeat(93) + " - hRig");
  assert.ok(Date.now() - started < 5000);

  // The handler: one channel, the main window only, nothing returned.
  const handlers = {};
  const titles = [];
  const win = {
    webContents: {},
    gone: false,
    isDestroyed() {
      return this.gone;
    },
    setTitle: (title) => titles.push(title),
  };
  let current = win;
  main.registerWindowTitle({
    handle: (channel, fn) => (handlers[channel] = fn),
    getWindow: () => current,
  });
  assert.deepEqual(Object.keys(handlers), ["window:title"]);
  const handler = handlers["window:title"];
  assert.equal(
    handler({ sender: win.webContents }, "Panel - proj - hRig"),
    undefined,
  );
  assert.equal(handler({ sender: win.webContents }, "Evil"), undefined);
  assert.deepEqual(titles, ["Panel - proj - hRig", "Evil - hRig"]);
  const refused = /Untrusted application window\./;
  assert.throws(() => handler({ sender: {} }, "x"), refused);
  assert.throws(() => handler({ sender: undefined }, "x"), refused);
  assert.throws(() => handler({}, "x"), refused);
  assert.throws(() => handler(undefined, "x"), refused);
  assert.throws(() => handler(null, "x"), refused);
  win.gone = true;
  assert.throws(() => handler({ sender: win.webContents }, "x"), refused);
  win.gone = false;
  current = null;
  assert.throws(() => handler({ sender: win.webContents }, "x"), refused);
  // The window is looked up at every call, and only that window is ever touched.
  const other = {
    ...win,
    webContents: {},
    setTitle: (title) => titles.push("other:" + title),
  };
  current = other;
  assert.throws(() => handler({ sender: win.webContents }, "x"), refused);
  handler({ sender: other.webContents }, "Second");
  assert.deepEqual(titles.slice(2), ["other:Second - hRig"]);

  // The source: no electron, no other channel, one place that sets a title.
  const raw = read("electron/window-title.cjs");
  const source = stripComments(raw);
  assert.ok(isAscii(raw));
  assert.equal(count(source, "require("), 0);
  assert.ok(
    !/ipcMain|ipcRenderer|webContents\.send|BrowserWindow/.test(source),
  );
  assert.equal(count(source, ".setTitle("), 1);
  assert.equal(count(source, 'handle("window:title"'), 1);
  assert.equal(count(source, "handle("), 1);
});

test("window-title channels: the bridge and the channel list are pinned, the new channel is one invoke handled through the main process's trusted handler, and the guards that keep hRig as the title stay", async () => {
  const expectedChannels = [
    // Channels of the long-list chain (diagnostics export, inventory cache, read-only seat views, update frequency).
    "diagnostics:export",
    "inventory:cache",
    "seat:message",
    "seat:notify-attention",
    "seat:prompt",
    "seat:transcript",
    "spellcheck:set",
    "updates:frequency",
    "attention:notify",
    "connection:doctor",
    "connection:resume",
    "connections:detect",
    "drafts:operation",
    "editor:operation",
    "files:git",
    "files:operation",
    "files:pick",
    "integrations:open",
    "integrations:operation",
    "mobile:operation",
    "ports:list",
    "preview:close",
    "preview:open",
    "rig:action",
    "rig:assess",
    "rig:control",
    "rig:design",
    "rig:inventory",
    "rig:projects",
    "rig:queue",
    "rig:send",
    "state:flush",
    "state:load",
    "state:save",
    "terminal:clipboard-image",
    "terminal:close",
    "terminal:create",
    "terminal:data",
    "terminal:export",
    "terminal:log",
    "terminal:log-state",
    "terminal:open-link",
    "terminal:paste-image",
    "terminal:read-clipboard",
    "terminal:resize",
    "terminal:write",
    "updates:operation",
    "updates:prepare-restart",
    "updates:restart-ready",
    "updates:state",
    "window:action",
    "window:title",
  ].sort();
  const preload = stripComments(read("electron/preload.cjs"));
  const used = new Set();
  for (const match of preload.matchAll(
    /(?:invoke|ipcRenderer\.(?:invoke|send|sendSync|on|removeListener))\(\s*["']([^"']+)["']/g,
  ))
    used.add(match[1]);
  assert.deepEqual([...used].sort(), expectedChannels);
  assert.equal(count(preload, "window:title"), 1);
  assert.equal(
    count(preload, '  setWindowTitle: invoke("window:title"),\n'),
    1,
  );

  const expectedMembers = [
    // Bridge members of the long-list chain.
    "exportDiagnostics",
    "inventoryCache",
    "notifySeatAttention",
    "seatMessage",
    "seatPrompt",
    "seatTranscript",
    "updateFrequency",
    "assessTeam",
    "clipboardHasImage",
    "closePreview",
    "closeTerminal",
    "createTerminal",
    "designRig",
    "detectConnections",
    "doctor",
    "drafts",
    "edit",
    "exportTerminal",
    "file",
    "flushState",
    "git",
    "integrate",
    "inventory",
    "loadState",
    "mobile",
    "notifyAttention",
    "onPrepareUpdate",
    "onResume",
    "onTerminal",
    "onTerminalLog",
    "onUpdates",
    "openPreview",
    "openTerminalLink",
    "openWorkLink",
    "pasteClipboardImage",
    "pathForFile",
    "pickFolder",
    "platform",
    "ports",
    "projects",
    "queue",
    "readClipboardText",
    "resizeTerminal",
    "rigAction",
    "rigControl",
    "saveState",
    "sendMessage",
    "setSpellcheck",
    "setWindowTitle",
    "terminalLog",
    "updates",
    "window",
    "writeTerminal",
  ].sort();
  const sent = [];
  const bridge = realBridge(async (channel, ...args) => {
    sent.push([channel, ...args]);
  });
  assert.deepEqual(Object.keys(bridge).sort(), expectedMembers);
  assert.equal(typeof bridge.setWindowTitle, "function");
  await bridge.setWindowTitle("A - B - hRig");
  {
    assert.deepEqual(sent, [["window:title", "A - B - hRig"]]);
    assert.equal(bridge.setWindowTitle.length, 0, "a plain pass-through");

    // The types describe the one new member.
    const types = read("src/types.ts");
    assert.equal(
      count(types, "setWindowTitle(title: string): Promise<void>;"),
      1,
    );
    assert.equal(
      count(
        types.slice(
          types.indexOf("export interface HrigAPI {"),
          types.indexOf("declare global"),
        ),
        "setWindowTitle(title: string): Promise<void>;",
      ),
      1,
    );

    // The main process: one registration through the module, behind the trusted handler.
    const mainText = collapse(read("electron/main.cjs"));
    assert.equal(
      count(
        mainText,
        "require('./window-title.cjs').registerWindowTitle({handle,getWindow:()=>mainWindow});",
      ),
      1,
    );
    assert.equal(count(mainText, "window-title.cjs"), 1);
    assert.equal(
      count(
        mainText,
        "function handle(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { trusted(event); return fn(event, ...args); }); }",
      ),
      1,
    );
    assert.equal(
      count(
        mainText,
        'const trusted = (event) => { if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Untrusted application window."); };',
      ),
      1,
    );
    assert.equal(count(mainText, 'ipcMain.on("window:action"'), 1);
    assert.equal(
      count(mainText, "window:title"),
      0,
      "the channel name lives in the module",
    );
    for (const name of fs.readdirSync(path.join(root, "electron"))) {
      if (!/\.(cjs|mjs)$/.test(name)) continue;
      const text = read("electron/" + name);
      if (name !== "preload.cjs" && name !== "window-title.cjs")
        assert.ok(!text.includes("window:title"), name);
      if (name !== "main.cjs" && name !== "window-title.cjs")
        assert.ok(!text.includes("setTitle("), name);
    }

    // The guards that make every title hRig stay as they were: the page's own title never reaches the window.
    assert.equal(
      count(
        mainText,
        'mainWindow.on("page-title-updated", (event) => event.preventDefault());',
      ),
      1,
    );
    assert.equal(
      count(
        mainText,
        'child.on("page-title-updated", (event) => event.preventDefault());',
      ),
      1,
    );
    assert.equal(count(mainText, 'child.setTitle("hRig");'), 1);
    assert.equal(count(mainText, 'title: "hRig"'), 4);
    assert.equal(count(read("index.html"), "<title>hRig</title>"), 1);
    for (const name of fs.readdirSync(path.join(root, "src")))
      if (/\.(ts|tsx)$/.test(name))
        assert.ok(
          !/document\.title/.test(stripComments(read("src/" + name))),
          name + " never sets the document title",
        );
  }
});

test("window-title app: the App sends a title only when the setting is on and the text changed, follows the active panel, a rename, the project and the setting, and uses the builder alone", async () => {
  const sent = [];
  const hrig = {
    setWindowTitle: (title) => {
      sent.push(title);
      return Promise.resolve();
    },
  };
  const render = mountTitle(hrig);
  const tab = new FakeTab("Build logs");
  const base = {
    loaded: false,
    model: modelOf(tab),
    revision: 0,
    root: "/work/hrig",
    preferences: ON,
  };
  render(base);
  assert.deepEqual(sent, [], "nothing before the workspace has loaded");
  render({ ...base, loaded: true });
  assert.deepEqual(sent, ["Build logs - hrig - hRig"]);
  render({ ...base, loaded: true });
  render({ ...base, loaded: true, revision: 1 });
  assert.equal(sent.length, 1, "the same title is not sent twice");
  tab.name = "Deploy " + ch(0x1f680);
  render({ ...base, loaded: true, revision: 2 });
  assert.equal(sent.at(-1), "Deploy " + ch(0x1f680) + " - hrig - hRig");
  const files = modelOf(new FakeTab("Files"));
  render({ ...base, loaded: true, revision: 3, model: files });
  assert.equal(sent.at(-1), "Files - hrig - hRig");
  render({
    ...base,
    loaded: true,
    revision: 3,
    model: files,
    root: "C:\\Work\\other\\",
  });
  assert.equal(sent.at(-1), "Files - other - hRig");
  const nothing = modelOf(undefined);
  render({ ...base, loaded: true, revision: 4, model: nothing, root: "~" });
  assert.equal(sent.at(-1), "~ - hRig", "no active panel leaves it out");
  const odd = modelOf({ getName: () => "not a tab" });
  const before = sent.length;
  render({ ...base, loaded: true, revision: 5, model: odd, root: "~" });
  assert.equal(
    sent.length,
    before,
    "a selection that is not a tab is not used",
  );
  render({
    ...base,
    loaded: true,
    revision: 6,
    model: files,
    root: "/w/p",
    preferences: OFF,
  });
  assert.equal(sent.at(-1), "hRig", "off goes back to hRig");
  const count0 = sent.length;
  render({
    ...base,
    loaded: true,
    revision: 7,
    model: files,
    root: "/w/q",
    preferences: OFF,
  });
  render({
    ...base,
    loaded: true,
    revision: 8,
    model: odd,
    root: "/w/q",
    preferences: {},
  });
  assert.equal(sent.length, count0, "off sends nothing more");
  render({
    ...base,
    loaded: true,
    revision: 9,
    model: files,
    root: "/w/q",
    preferences: ON,
  });
  assert.equal(sent.at(-1), "Files - q - hRig");

  // Never on by default: a fresh page with the default preferences never calls the bridge.
  const fresh = [];
  const renderFresh = mountTitle({
    setWindowTitle: (title) => {
      fresh.push(title);
      return Promise.resolve();
    },
  });
  for (let i = 0; i < 5; i++)
    renderFresh({
      loaded: true,
      model: modelOf(new FakeTab("Tab " + i)),
      revision: i,
      root: "/w/" + i,
      preferences: {},
    });
  assert.deepEqual(fresh, []);

  // A refused or failing call is swallowed, never an unhandled rejection.
  let unhandled = 0;
  const onUnhandled = () => unhandled++;
  process.on("unhandledRejection", onUnhandled);
  const failing = mountTitle({
    setWindowTitle: () => Promise.reject(new Error("refused")),
  });
  failing({ ...base, loaded: true });
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, 0);

  // The source: one builder call fed by the two names and the setting, one bridge call, no other title code.
  const app = read("src/App.tsx");
  const block = collapse(titleBlock());
  assert.ok(
    block.includes(
      'buildWindowTitle({ enabled: titleDetails, project: projectNameOf(root), panel: selected instanceof TabNode ? selected.getName() : "", });',
    ),
  );
  assert.equal(
    count(
      block,
      'const titleDetails = preferences["appearance.windowTitleDetails"];',
    ),
    1,
  );
  assert.equal(
    count(block, "window.hrig.setWindowTitle(title).catch(() => {});"),
    1,
  );
  assert.equal(count(app, "setWindowTitle("), 1);
  assert.equal(count(app, "buildWindowTitle("), 1);
  assert.equal(count(app, "projectNameOf("), 1);
  assert.equal(count(app, 'from "./window-title"'), 1);
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => /window-title|setWindowTitle/.test(read("src/" + name)))
    .sort();
  assert.deepEqual(users, ["App.tsx", "types.ts"]);
  // The in-app title bar is untouched.
  assert.equal(count(app, "OPENRIG WORKSPACE"), 1);
  assert.ok(isAscii(titleBlock()));
});

test("window-title docs: SETTINGS.md and NAVIGATION.md say what the title holds, where it shows, how it is cleaned and cut, that the main process checks it again and that detached windows and the in-app title bar do not change", () => {
  const settings = read("SETTINGS.md");
  assert.ok(isAscii(settings), "plain ASCII");
  const paragraph = settings
    .split("\n\n")
    .filter((part) =>
      part.startsWith("Window title: `appearance.windowTitleDetails`"),
    );
  assert.equal(paragraph.length, 1);
  const text = paragraph[0];
  for (const part of [
    "is off by default, and then every HRig window is titled `hRig`",
    "the active panel's name, the project folder's name and `hRig`, joined by ` - `",
    "`Build logs - hrig - hRig`",
    "a part that does not exist",
    "left out",
    "the taskbar, the window switcher and the window list",
    "HRig draws its own title bar, which does not change",
    "detached windows keep `hRig`",
    "a panel you renamed",
    "one narrow channel, `window:title`",
    "carries only the title text",
    "accepts it only from the main window",
    "drops control, zero-width and direction characters",
    "cuts the title to 100 characters",
    "the panel name to 50 and the project name to 40, with an ellipsis",
    "always ends it with `hRig`",
    "never a file's content, a seat's output, a host name or a secret",
    "User and Project scopes",
  ])
    assert.ok(text.includes(part), "SETTINGS.md says: " + part);
  assert.ok(text.includes("to " + lib.MAX_WINDOW_TITLE + " characters"));
  assert.ok(text.includes("panel name to " + lib.MAX_PANEL_PART));
  assert.ok(text.includes("project name to " + lib.MAX_PROJECT_PART));
  const parts = settings.split("\n\n");
  const at = parts.indexOf(text);
  const where = (start) => parts.findIndex((part) => part.startsWith(start));
  assert.ok(
    at > where("Status bar items: "),
    "after the Status bar items paragraph",
  );
  assert.ok(
    at < where("Terminal bell: `terminal.bellStyle`"),
    "before the Terminal bell paragraph",
  );
  assert.ok(at > where("## Settings catalog"), "after the catalog");

  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark stays");
  const nav = raw.slice(1);
  assert.ok(!/[^\n -~…↑↓·→–]/.test(nav), "plain ASCII (plus the symbols the Git info docs use)");
  assert.ok(nav.endsWith("\n") && !nav.endsWith("\n\n"));
  const mine = nav
    .split("\n")
    .filter((line) => line.startsWith("Window title: "));
  assert.equal(mine.length, 1);
  for (const part of [
    "Show project and panel in the window title",
    "(Appearance, off by default)",
    "the name of the panel you are in, the name of the project folder and hRig",
    "Build logs - hrig - hRig",
    "a renamed panel shows its new name",
    "with the setting off the title stays hRig",
    "the taskbar, the window switcher and the window list",
    "the title bar inside HRig does not change",
    "detached windows keep hRig",
    "control, zero-width and direction characters are dropped",
    "the panel name is cut to 50 characters and the project name to 40 around an ellipsis",
    "never has more than 100 characters",
    "the main process checks it again and always ends it with hRig",
    "never file text, seat output, a host name or a secret",
  ])
    assert.ok(mine[0].includes(part), "NAVIGATION.md says: " + part);
  assert.equal(count(nav, "\nWindow title: "), 1);
});
