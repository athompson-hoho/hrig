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
    .replace(/, \}/g, " }")
    .replace(/\{ /g, "{")
    .replace(/ \}/g, "}");
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};
const char = (code) => String.fromCharCode(code);
const point = (code) => String.fromCodePoint(code);

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
const pure = () => load("src/terminal-drop-path.ts");

// The real preload script run against a fake electron module: it exposes the bridge object the renderer sees as the hrig object on its page.
function realBridge(platform) {
  let exposed;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        assert.equal(name, "hrig");
        exposed = api;
      },
    },
    ipcRenderer: {
      invoke() {
        throw new Error("no channel is opened by a drop");
      },
      send() {
        throw new Error("nothing is sent by a drop");
      },
      sendSync() {
        throw new Error("nothing is sent by a drop");
      },
      on() {},
      removeListener() {},
    },
    webUtils: {
      getPathForFile(file) {
        if (file.boom) throw new Error("not a file");
        return file.path;
      },
    },
  };
  new Function("require", "process", read("electron/preload.cjs"))(
    (id) => {
      assert.equal(id, "electron");
      return electron;
    },
    { platform },
  );
  return exposed;
}

// A tiny react runtime: slot-based hooks, effects that run after a render, and a jsx runtime that records elements.
const fakeJsx = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: "fragment",
};
let componentCode;
function mountDrop(props, platform = "linux", bridge = undefined) {
  componentCode ??= bundle("src/TerminalFileDrop.tsx", [
    "react",
    "react/jsx-runtime",
  ]);
  const slots = [];
  const timers = [];
  let cursor = 0;
  let pending = [];
  const state = { output: undefined, renders: 0 };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = value;
          render();
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const before = slots[i];
      const same =
        before &&
        before.deps.length === deps.length &&
        deps.every((d, k) => d === before.deps[k]);
      if (!same) pending.push([i, fn, deps]);
    },
  };
  const window = { hrig: bridge ?? realBridge(platform) };
  const fakeSetTimeout = (fn, ms) => {
    timers.push({ fn, ms, live: true });
    return timers.length;
  };
  const fakeClearTimeout = (id) => {
    if (id && timers[id - 1]) timers[id - 1].live = false;
  };
  const mod = { exports: {} };
  const requireFake = (id) =>
    id === "react" ? react : id === "react/jsx-runtime" ? fakeJsx : require(id);
  new Function(
    "require",
    "module",
    "exports",
    "window",
    "setTimeout",
    "clearTimeout",
    componentCode,
  )(requireFake, mod, mod.exports, window, fakeSetTimeout, fakeClearTimeout);
  const Component = mod.exports.default;
  let current = props;
  function render() {
    cursor = 0;
    pending = [];
    state.renders++;
    state.output = Component(current);
    for (const [i, fn, deps] of pending) {
      slots[i]?.cleanup?.();
      slots[i] = { deps, cleanup: fn() };
    }
  }
  render();
  return {
    state,
    window,
    timers,
    rerender(next) {
      current = { ...current, ...next };
      render();
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
    notice() {
      const out = state.output;
      if (out === null) return null;
      assert.equal(out.type, "div");
      assert.equal(out.props.className, "editor-notice");
      assert.equal(out.props.role, "status");
      return out.props.children;
    },
  };
}
function fakeElement() {
  const listeners = {};
  const element = {
    adds: 0,
    removes: 0,
    marks: [],
    classes: new Set(),
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
      element.adds++;
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      element.removes++;
    },
    classList: {
      toggle(name, force) {
        element.marks.push([name, force]);
        if (force) element.classes.add(name);
        else element.classes.delete(name);
        return force;
      },
    },
    fire(type, event) {
      for (const fn of [...(listeners[type] || [])]) fn(event);
      return event;
    },
    listenerCount: () =>
      Object.values(listeners).reduce((sum, list) => sum + list.length, 0),
  };
  return element;
}
const fakeTerminal = () => ({
  pasted: [],
  focused: 0,
  paste(text) {
    this.pasted.push(text);
  },
  focus() {
    this.focused++;
  },
});
const dragEvent = (types, files = []) => ({
  dataTransfer: { types, files, dropEffect: "none" },
  prevented: 0,
  preventDefault() {
    this.prevented++;
  },
});
const local = { id: "local", name: "This computer", kind: "local" };
function dropRig(overrides = {}, platform = "linux", bridge = undefined) {
  const element = fakeElement();
  const terminal = fakeTerminal();
  const props = {
    host: { current: element },
    terminal: { current: terminal },
    connection: local,
    rigControl: false,
    ready: true,
    ended: null,
    localShell: "system",
    ...overrides,
  };
  const rig = mountDrop(props, platform, bridge);
  return { element, terminal, props, ...rig };
}
const filesOf = (...paths) => paths.map((p) => ({ path: p }));
function dropOn(rig, ...paths) {
  const enter = rig.element.fire("dragenter", dragEvent(["Files"]));
  const over = rig.element.fire("dragover", dragEvent(["Files"]));
  const drop = rig.element.fire(
    "drop",
    dragEvent(["Files"], filesOf(...paths)),
  );
  return { enter, over, drop };
}

test("terminal-drop-path tracer: a file dropped on a local terminal flows from the drop event through the real component and the pure helpers to one quoted terminal paste with no Enter, and every other drag is left alone", () => {
  const mod = pure();
  const rig = dropRig();
  assert.equal(rig.element.adds, 4, "four listeners, attached once");
  assert.equal(rig.notice(), null, "no notice before a drop");

  // One local file with a space and an apostrophe: the real component calls the bridge and the pure quoting.
  const first = rig.element.fire("dragenter", dragEvent(["Files"]));
  assert.deepEqual(rig.element.marks, [["file-drop-active", true]]);
  const over = rig.element.fire("dragover", dragEvent(["Files"]));
  assert.equal(over.prevented, 1, "dragover is cancelled so the drop can fire");
  assert.equal(over.dataTransfer.dropEffect, "copy");
  const file = "/home/me/My Notes/it's here.txt";
  const drop = rig.element.fire("drop", dragEvent(["Files"], filesOf(file)));
  assert.equal(drop.prevented, 1, "the browser never navigates to the file");
  assert.deepEqual(rig.terminal.pasted, [
    "'/home/me/My Notes/it'\\''s here.txt' ",
  ]);
  assert.equal(
    rig.terminal.pasted[0],
    mod.dropInsertText([file], "posix").text,
    "the paste is exactly the pure helper's text",
  );
  assert.ok(!/[\r\n]/.test(rig.terminal.pasted[0]), "never a line break");
  assert.equal(rig.terminal.focused, 1);
  assert.equal(rig.element.classes.has("file-drop-active"), false);
  assert.equal(rig.notice(), "Inserted 1 path at the prompt. Nothing was run.");
  assert.equal(first.prevented, 0, "dragenter is not cancelled");
  // The notice clears itself.
  assert.equal(rig.timers.filter((t) => t.live).length, 1);
  assert.equal(rig.timers.find((t) => t.live).ms, 6000);
  rig.timers.find((t) => t.live).fn();
  assert.equal(rig.notice(), null);

  // Two files: joined by a space, one paste.
  dropOn(rig, "/a/one.txt", "/a/two words.txt");
  assert.deepEqual(rig.terminal.pasted.slice(1), [
    "'/a/one.txt' '/a/two words.txt' ",
  ]);
  assert.equal(
    rig.notice(),
    "Inserted 2 paths at the prompt. Nothing was run.",
  );
  assert.equal(
    rig.timers.filter((t) => t.live).length,
    1,
    "a newer notice replaces the older timer",
  );

  // A tab drag or a text drag is never touched: nothing cancelled, marked or pasted.
  const before = rig.terminal.pasted.length;
  const marks = rig.element.marks.length;
  for (const types of [["text/plain"], ["text/uri-list", "text/html"], []]) {
    for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
      const event = rig.element.fire(type, dragEvent(types, filesOf("/x")));
      assert.equal(event.prevented, 0, type + " " + types);
      assert.equal(event.dataTransfer.dropEffect, "none");
    }
  }
  assert.equal(rig.terminal.pasted.length, before);
  assert.equal(rig.element.marks.length, marks);
  const bare = rig.element.fire("drop", {
    preventDefault() {
      throw Error("x");
    },
  });
  assert.equal(bare.dataTransfer, undefined);

  // The highlight follows the drag through child elements and clears when it leaves.
  rig.element.fire("dragenter", dragEvent(["Files"]));
  rig.element.fire("dragenter", dragEvent(["Files"]));
  rig.element.fire("dragleave", dragEvent(["Files"]));
  assert.equal(rig.element.classes.has("file-drop-active"), true);
  rig.element.fire("dragleave", dragEvent(["Files"]));
  assert.equal(rig.element.classes.has("file-drop-active"), false);

  // A stray leave with no enter before it does not break the next drag's highlight.
  rig.element.fire("dragleave", dragEvent(["Files"]));
  rig.element.fire("dragenter", dragEvent(["Files"]));
  assert.equal(rig.element.classes.has("file-drop-active"), true);
  rig.element.fire("dragleave", dragEvent(["Files"]));
  assert.equal(rig.element.classes.has("file-drop-active"), false);

  // The listeners read the latest render: a terminal that was not ready now accepts.
  const late = dropRig({ ready: false });
  dropOn(late, "/a/b");
  assert.deepEqual(late.terminal.pasted, []);
  assert.equal(
    late.notice(),
    "Terminal is not connected. Nothing was inserted.",
  );
  late.rerender({ ready: true });
  dropOn(late, "/a/b");
  assert.deepEqual(late.terminal.pasted, ["'/a/b' "]);
  assert.equal(late.element.adds, 4, "no listener was re-attached");

  // Every refusal: nothing pasted, the drop is still cancelled, the notice says why.
  const refusals = [
    [
      { connection: { id: "s", kind: "ssh" } },
      "Dropped paths are local; remote upload is not supported. Nothing was inserted.",
    ],
    [
      { connection: { id: "w", kind: "wsl" } },
      "Dropped paths are local; remote upload is not supported. Nothing was inserted.",
    ],
    [
      { connection: { id: "z", kind: "other" } },
      "Dropped paths are local; remote upload is not supported. Nothing was inserted.",
    ],
    [
      { rigControl: true },
      "Dropped paths are not inserted into OpenRig action terminals. Nothing was inserted.",
    ],
    [
      { rigControl: true, connection: { id: "s", kind: "ssh" } },
      "Dropped paths are not inserted into OpenRig action terminals. Nothing was inserted.",
    ],
    [{ ended: 0 }, "Terminal is not connected. Nothing was inserted."],
    [
      { ended: 1, ready: true },
      "Terminal is not connected. Nothing was inserted.",
    ],
    [{ ready: false }, "Terminal is not connected. Nothing was inserted."],
  ];
  for (const [override, text] of refusals) {
    const refused = dropRig(override);
    const events = dropOn(refused, "/a/b");
    assert.deepEqual(refused.terminal.pasted, [], JSON.stringify(override));
    assert.equal(refused.notice(), text, JSON.stringify(override));
    assert.equal(events.over.prevented, 1);
    assert.equal(events.drop.prevented, 1);
    assert.deepEqual(
      refused.element.marks.filter(([, on]) => on),
      [],
      "no highlight on a terminal that refuses",
    );
    assert.equal(refused.terminal.focused, 0);
  }
  const gone = dropRig();
  gone.element.fire("drop", dragEvent(["Files"], filesOf("/a/b")));
  gone.unmount();
  assert.equal(
    gone.element.listenerCount(),
    0,
    "unmount detaches every listener",
  );
  assert.equal(gone.element.removes, 4);
  assert.equal(
    gone.timers.filter((t) => t.live).length,
    0,
    "unmount stops the notice timer",
  );
  const mid = dropRig();
  mid.element.fire("dragenter", dragEvent(["Files"]));
  assert.equal(mid.element.classes.has("file-drop-active"), true);
  mid.unmount();
  assert.equal(
    mid.element.classes.has("file-drop-active"),
    false,
    "unmount clears the highlight",
  );
  const detached = dropRig();
  detached.terminal.pasted.length = 0;
  const holder = detached.terminal;
  detached.props.terminal.current = null;
  detached.element.fire("drop", dragEvent(["Files"], filesOf("/a/b")));
  assert.deepEqual(holder.pasted, []);
  assert.equal(
    detached.notice(),
    "Terminal is not connected. Nothing was inserted.",
  );

  // Unsafe or unreadable drops insert nothing and say so.
  for (const bad of [
    ["/a/b\nrm -rf ~"],
    ["/a/b\r"],
    [""],
    ["/ok", "/bad" + char(7)],
    ["/a/" + char(0x202e) + "gpj.exe"],
  ]) {
    const unsafe = dropRig();
    dropOn(unsafe, ...bad);
    assert.deepEqual(unsafe.terminal.pasted, [], JSON.stringify(bad));
    assert.match(unsafe.notice(), /Nothing was inserted\.$/);
  }
  const notDisk = dropRig();
  notDisk.element.fire("drop", dragEvent(["Files"], [{ path: 5 }]));
  assert.deepEqual(notDisk.terminal.pasted, []);
  assert.match(notDisk.notice(), /Nothing was inserted\.$/);
  const boom = dropRig();
  boom.element.fire("drop", dragEvent(["Files"], [{ boom: true }]));
  assert.deepEqual(boom.terminal.pasted, []);
  assert.match(boom.notice(), /^A dropped path cannot be inserted safely/);
  // A bridge that throws (an older preload without the helper) is also explained, never silent.
  const unreadable = dropRig({}, "linux", { platform: "linux" });
  unreadable.element.fire("dragenter", dragEvent(["Files"]));
  unreadable.element.fire("drop", dragEvent(["Files"], filesOf("/a/b")));
  assert.deepEqual(unreadable.terminal.pasted, []);
  assert.equal(
    unreadable.notice(),
    "The dropped file's path could not be read. Nothing was inserted.",
  );
  const noFiles = dropRig();
  noFiles.element.fire("drop", dragEvent(["Files"], []));
  assert.equal(
    noFiles.notice(),
    "Drop a file from this computer to insert its path.",
  );

  // The shell dialect follows the platform and the local shell the terminal was started with.
  const cmd = dropRig({ localShell: "cmd" }, "win32");
  dropOn(cmd, "C:\\Users\\me\\My Files\\a.txt");
  assert.deepEqual(cmd.terminal.pasted, ['"C:\\Users\\me\\My Files\\a.txt" ']);
  const ps = dropRig({ localShell: "system" }, "win32");
  dropOn(ps, "C:\\Users\\me\\It's.txt");
  assert.deepEqual(ps.terminal.pasted, ["'C:\\Users\\me\\It''s.txt' "]);
  const mac = dropRig({ localShell: "zsh" }, "darwin");
  dropOn(mac, "/Users/me/a b.png");
  assert.deepEqual(mac.terminal.pasted, ["'/Users/me/a b.png' "]);

  // The real panel mounts the component once with the live state of the terminal.
  const panel = tight(stripComments(read("src/TerminalPanel.tsx")));
  assert.equal(
    count(panel, 'import TerminalFileDrop from "./TerminalFileDrop";'),
    1,
  );
  assert.equal(
    count(
      panel,
      "<TerminalFileDrop host={host} terminal={terminalRef} connection={config.connection} rigControl={!!config.rigControlToken} ready={ready} ended={ended} localShell={localShell} />",
    ),
    1,
  );
});

test("terminal-drop-path quoting: a bounded POSIX, PowerShell and Command Prompt quoter that round-trips, refuses control, invisible and oversized paths and never builds a line break", () => {
  const mod = pure();
  assert.equal(mod.MAX_DROP_FILES, 20);
  assert.equal(mod.MAX_DROP_PATH, 4096);
  assert.equal(mod.MAX_DROP_TEXT, 32768);

  const posix = (p) => mod.quote(p, "posix");
  const cmd = (p) => mod.quote(p, "cmd");
  const ps = (p) => mod.quote(p, "powershell");
  assert.equal(posix("/home/me/a.txt"), "'/home/me/a.txt'");
  assert.equal(
    posix("/home/me/My Notes/a b.txt"),
    "'/home/me/My Notes/a b.txt'",
  );
  assert.equal(posix("/tmp/it's"), "'/tmp/it'\\''s'");
  assert.equal(posix("/tmp/''"), "'/tmp/'\\'''\\'''");
  assert.equal(
    posix('/tmp/say "hi" $HOME `id` \\ ; | & * ? ( ) # ~ !'),
    "'/tmp/say \"hi\" $HOME `id` \\ ; | & * ? ( ) # ~ !'",
  );
  assert.equal(
    posix("/tmp/caf" + char(0xe9) + ".txt"),
    "'/tmp/caf" + char(0xe9) + ".txt'",
  );
  assert.equal(
    posix("/tmp/" + point(0x1f600) + point(0x4e2d)),
    "'/tmp/" + point(0x1f600) + point(0x4e2d) + "'",
  );
  assert.equal(ps("C:\\Users\\me\\a b.txt"), "'C:\\Users\\me\\a b.txt'");
  assert.equal(ps("C:\\Users\\me\\It's.txt"), "'C:\\Users\\me\\It''s.txt'");
  assert.equal(
    ps("C:\\x\\" + char(0x2018) + char(0x2019) + char(0x201a) + char(0x201b)),
    "'C:\\x\\" +
      char(0x2018).repeat(2) +
      char(0x2019).repeat(2) +
      char(0x201a).repeat(2) +
      char(0x201b).repeat(2) +
      "'",
    "PowerShell reads the typographic single quotes as quotes, so each is doubled",
  );
  assert.equal(ps("C:\\x\\$env:A `n & ; ( )"), "'C:\\x\\$env:A `n & ; ( )'");
  assert.equal(cmd("C:\\Users\\me\\a b.txt"), '"C:\\Users\\me\\a b.txt"');
  assert.equal(cmd("C:\\x\\a&b (1).txt"), '"C:\\x\\a&b (1).txt"');
  for (const risky of [
    "C:\\x\\%PATH%",
    "C:\\x\\a!b",
    "C:\\x\\a^b",
    'C:\\x\\a"b',
  ]) {
    assert.equal(cmd(risky), null, "Command Prompt refuses " + risky);
    assert.notEqual(ps(risky), null);
    assert.notEqual(posix(risky), null);
  }
  assert.equal(mod.quote("/a", "fish"), null, "an unknown shell fails closed");
  assert.equal(mod.quote("/a", undefined), null);

  // Refused for every shell: control, line-separator, invisible, lone-surrogate characters, empty, blank, oversized and non-strings.
  const hostile = [];
  for (let code = 0; code < 32; code++) hostile.push(char(code));
  for (let code = 127; code <= 159; code++) hostile.push(char(code));
  hostile.push(
    char(0x2028),
    char(0x2029),
    char(0xad),
    char(0x200b),
    char(0x200c),
    char(0x200d),
    char(0x200e),
    char(0x200f),
  );
  hostile.push(
    char(0x202a),
    char(0x202b),
    char(0x202c),
    char(0x202d),
    char(0x202e),
    char(0x2060),
    char(0x2066),
    char(0x2067),
    char(0x2068),
    char(0x2069),
    char(0xfeff),
  );
  hostile.push(char(0xd800), char(0xdc00), point(0xe0001));
  for (const bad of hostile) {
    for (const shell of ["posix", "cmd", "powershell"]) {
      assert.equal(
        mod.quote("/a/b" + bad + "c", shell),
        null,
        shell + " " + bad.charCodeAt(0).toString(16),
      );
      assert.equal(mod.quote(bad, shell), null);
    }
  }
  assert.equal(posix("/a/b\nrm -rf ~"), null);
  assert.equal(posix("/a/b\r\n"), null);
  assert.equal(posix("/a/\tb"), null);
  for (const kept of [" ", "~", char(0xa0), char(0xa1), char(0x7e)])
    assert.notEqual(
      posix("/a/b" + kept + "c"),
      null,
      "kept " + kept.charCodeAt(0),
    );
  assert.notEqual(
    posix(point(0x1f600) + point(0x10000)),
    null,
    "a well-formed surrogate pair is kept",
  );
  for (const value of ["", " ", "   "]) assert.equal(posix(value), null);
  for (const value of [
    undefined,
    null,
    5,
    true,
    {},
    [],
    ["/a"],
    () => "/a",
    Symbol.iterator,
  ]) {
    for (const shell of ["posix", "cmd", "powershell"])
      assert.equal(mod.quote(value, shell), null);
  }
  assert.notEqual(posix("/" + "a".repeat(4095)), null);
  assert.equal(posix("/" + "a".repeat(4096)), null);
  assert.notEqual(mod.quote("/" + "a".repeat(4095), "cmd"), null);

  // The consistency with the image-paste channel: the same quote for the same safe path.
  const images = require("../electron/terminal-images.cjs");
  for (const safe of [
    "/tmp/a b/c's.png",
    "C:\\Users\\me\\My Pics\\a b.png",
    "/x/" + point(0x1f600),
    "/a/$HOME/`x`",
  ]) {
    assert.equal(posix(safe), images.quotedImagePath(safe, "posix"), safe);
    assert.equal(ps(safe), images.quotedImagePath(safe, "powershell"), safe);
    assert.equal(cmd(safe), images.quotedImagePath(safe, "cmd"), safe);
  }

  // The file-drag gate: only a real Files drag, never a tab (text) drag, whatever shape the type list has.
  assert.equal(mod.isFileDrag(["Files"]), true);
  assert.equal(mod.isFileDrag(["text/uri-list", "Files"]), true);
  assert.equal(
    mod.isFileDrag({ length: 2, 0: "text/plain", 1: "Files" }),
    true,
  );
  assert.equal(
    mod.isFileDrag({ length: 1, 0: "Files", item: () => "x" }),
    true,
  );
  for (const value of [
    ["text/plain"],
    ["files"],
    ["FILES"],
    ["Files "],
    [],
    {},
    { length: 0 },
    { 0: "Files" },
    { length: "1", 0: "Files" },
    "Files",
    null,
    undefined,
    1,
    true,
  ]) {
    assert.equal(mod.isFileDrag(value), false, JSON.stringify(value));
  }

  // The dialect per platform and local shell.
  for (const [platform, shell, expected] of [
    ["linux", "system", "posix"],
    ["linux", "cmd", "posix"],
    ["darwin", "zsh", "posix"],
    ["darwin", undefined, "posix"],
    ["win32", "cmd", "cmd"],
    ["win32", "system", "powershell"],
    ["win32", "powershell", "powershell"],
    ["win32", undefined, "powershell"],
    ["win32", "bash", "powershell"],
    [undefined, "cmd", "posix"],
    [null, null, "posix"],
  ]) {
    assert.equal(
      mod.dropShell(platform, shell),
      expected,
      platform + " " + shell,
    );
  }

  // Many files: joined by single spaces, one trailing space, no line break; one bad path refuses all; the caps.
  assert.deepEqual(mod.dropInsertText(["/a", "/b c"], "posix"), {
    text: "'/a' '/b c' ",
    count: 2,
  });
  assert.deepEqual(mod.dropInsertText(["C:\\a"], "cmd"), {
    text: '"C:\\a" ',
    count: 1,
  });
  assert.deepEqual(mod.dropInsertText(["/a", "/b" + char(10)], "posix"), {
    error:
      "A dropped path cannot be inserted safely (empty, too long, or with a control, invisible or shell-special character). Nothing was inserted.",
  });
  for (const empty of [[], undefined, null, "/a", {}]) {
    assert.deepEqual(mod.dropInsertText(empty, "posix"), {
      error: "Drop a file from this computer to insert its path.",
    });
  }
  const twenty = Array.from({ length: 20 }, (_, i) => "/f/" + i);
  assert.equal(mod.dropInsertText(twenty, "posix").count, 20);
  assert.deepEqual(mod.dropInsertText([...twenty, "/f/20"], "posix"), {
    error: "Drop at most 20 files at a time. Nothing was inserted.",
  });
  const long = "/" + "x".repeat(2000);
  assert.equal(
    mod.dropInsertText(
      Array.from({ length: 8 }, () => long),
      "posix",
    ).count,
    8,
  );
  assert.deepEqual(
    mod.dropInsertText(
      Array.from({ length: 17 }, () => long),
      "posix",
    ),
    {
      error: "The dropped paths are too long to insert. Nothing was inserted.",
    },
  );
  // The text cap: eight 4001-character paths are 32032 characters, so a ninth that brings the text to exactly 32768 fits and one more character does not.
  const big = Array.from({ length: 8 }, () => "/" + "y".repeat(4000));
  const fits = mod.dropInsertText([...big, "/" + "z".repeat(732)], "posix");
  assert.equal(fits.text.length, 32768);
  assert.equal(fits.count, 9);
  assert.deepEqual(
    mod.dropInsertText([...big, "/" + "z".repeat(733)], "posix"),
    {
      error: "The dropped paths are too long to insert. Nothing was inserted.",
    },
  );

  // The refusal table against an independent model of the rules.
  const kinds = ["local", "ssh", "wsl", "", undefined, null, 7, "LOCAL"];
  for (const kind of kinds) {
    for (const rigControl of [false, true]) {
      for (const ready of [false, true]) {
        for (const ended of [null, 0, 1, 137]) {
          const expected = rigControl
            ? "Dropped paths are not inserted into OpenRig action terminals. Nothing was inserted."
            : kind !== "local"
              ? "Dropped paths are local; remote upload is not supported. Nothing was inserted."
              : ended !== null || !ready
                ? "Terminal is not connected. Nothing was inserted."
                : "";
          assert.equal(
            mod.dropRefusal({ kind, rigControl, ready, ended }),
            expected,
            JSON.stringify({ kind, rigControl, ready, ended }),
          );
        }
      }
    }
  }
  assert.equal(
    mod.dropNotice(1),
    "Inserted 1 path at the prompt. Nothing was run.",
  );
  assert.equal(
    mod.dropNotice(2),
    "Inserted 2 paths at the prompt. Nothing was run.",
  );
  assert.equal(
    mod.dropNotice(20),
    "Inserted 20 paths at the prompt. Nothing was run.",
  );

  // A seeded random walk against independent unquoters: every accepted path reads back exactly as dropped, no result holds a line break, and the refusals match a model.
  const unquote = {
    posix(text) {
      let out = "";
      let i = 0;
      while (i < text.length) {
        if (text[i] === "'") {
          const end = text.indexOf("'", i + 1);
          assert.ok(end > i, "closed quote");
          out += text.slice(i + 1, end);
          i = end + 1;
        } else if (text[i] === "\\" && text[i + 1] === "'") {
          out += "'";
          i += 2;
        } else assert.fail("unquoted character " + text[i]);
      }
      return out;
    },
    powershell(text) {
      assert.ok(text.length >= 2 && text[0] === "'" && text.endsWith("'"));
      const quotes = [
        "'",
        char(0x2018),
        char(0x2019),
        char(0x201a),
        char(0x201b),
      ];
      const inner = text.slice(1, -1);
      let out = "";
      for (let i = 0; i < inner.length; i++) {
        if (quotes.includes(inner[i])) {
          assert.equal(inner[i + 1], inner[i], "a quote is always doubled");
          i++;
        }
        out += inner[i];
      }
      return out;
    },
    cmd(text) {
      assert.ok(text.length >= 2 && text[0] === '"' && text.endsWith('"'));
      const inner = text.slice(1, -1);
      assert.ok(!inner.includes('"'));
      return inner;
    },
  };
  const pieces = [
    "a",
    "B",
    "7",
    " ",
    " ",
    "/",
    "\\",
    "'",
    '"',
    "$",
    "`",
    "%",
    "!",
    "^",
    "&",
    ";",
    "|",
    "(",
    ")",
    "*",
    "?",
    "#",
    "~",
    "-",
    ".",
    char(0xe9),
    point(0x1f600),
    char(0x2018),
    char(0x2019),
    char(0x4e2d),
    "\n",
    "\r",
    "\t",
    char(0),
    char(27),
    char(127),
    char(0x85),
    char(0x2028),
    char(0x200b),
    char(0x202e),
    char(0xfeff),
    char(0xd800),
  ];
  const hostileCodes = new Set([0x2028, 0x200b, 0x202e, 0xfeff]);
  const hostilePiece = (piece) => {
    const code = piece.codePointAt(0);
    return (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      hostileCodes.has(code) ||
      (code >= 0xd800 && code <= 0xdfff)
    );
  };
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  let accepted = 0;
  let refused = 0;
  for (let run = 0; run < 4000; run++) {
    const parts = Array.from(
      { length: 1 + Math.floor(next() * 12) },
      () => pieces[Math.floor(next() * pieces.length)],
    );
    const text = parts.join("");
    for (const shell of ["posix", "cmd", "powershell"]) {
      const result = mod.quote(text, shell);
      const blank = text.trim() === "";
      const bad =
        parts.some(hostilePiece) ||
        blank ||
        (shell === "cmd" && /[%!^"]/.test(text));
      assert.equal(result === null, bad, shell + " " + JSON.stringify(text));
      if (result === null) {
        refused++;
        continue;
      }
      accepted++;
      assert.equal(
        unquote[shell](result),
        text,
        shell + " round trip " + JSON.stringify(text),
      );
      for (let at = 0; at < result.length; at++)
        assert.ok(result.charCodeAt(at) >= 32, "no control character");
    }
    const insert = mod.dropInsertText([text, text], "posix");
    if (!("error" in insert)) assert.ok(!/[\r\n]/.test(insert.text));
  }
  assert.ok(
    accepted > 500 && refused > 500,
    "the walk covers both outcomes: " + accepted + "/" + refused,
  );
});

test("terminal-drop-path wiring: the drop lives in one pure module, one component and one preload helper, inserts only through the terminal paste, and leaves tab drags, the settings, the main process and the terminal write path alone", () => {
  // The pure module: ASCII, no imports, no clock, bridge or storage, the exact exports.
  const moduleSource = read("src/terminal-drop-path.ts");
  assert.ok(!/[^\n -~]/.test(moduleSource), "module is printable ASCII");
  assert.ok(!moduleSource.includes("\\" + "u"), "no unicode escape");
  const code = stripComments(moduleSource);
  for (const forbidden of [
    /\bimport\b/,
    /\brequire\b/,
    /\bwindow\b/,
    /\bdocument\b/,
    /\bReact\b/,
    /\bhrig\b/,
    /\bDate\b/,
    /\bperformance\b/,
    /Math\.random/,
    /\bsetTimeout\b/,
    /\bfetch\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\basync\b|\bawait\b/,
    /writeTerminal|createTerminal|sendTerminalCommand/,
    /export default/,
  ])
    assert.ok(!forbidden.test(code), "the module must stay pure: " + forbidden);
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|type) (\w+)/gm)]
      .map((m) => m[1])
      .sort(),
    [
      "DROP_ACTION_NOTICE",
      "DROP_ENDED_NOTICE",
      "DROP_REMOTE_NOTICE",
      "DropInsert",
      "DropShell",
      "DropTarget",
      "MAX_DROP_FILES",
      "MAX_DROP_PATH",
      "MAX_DROP_TEXT",
      "dropInsertText",
      "dropNotice",
      "dropRefusal",
      "dropShell",
      "isFileDrag",
      "quote",
    ].sort(),
  );

  // The component: the guards, the single paste, no write path, no propagation stop.
  const componentSource = read("src/TerminalFileDrop.tsx");
  assert.ok(!/[^\n -~]/.test(componentSource), "component is printable ASCII");
  assert.ok(!componentSource.includes("\\" + "u"));
  const component = tight(stripComments(componentSource));
  assert.deepEqual(
    [...component.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ["react", "@xterm/xterm", "./types", "./terminal-drop-path"],
  );
  assert.equal(count(component, "term.paste(result.text);"), 1);
  assert.equal(count(component, ".paste("), 1);
  assert.equal(count(component, "term.focus();"), 1);
  assert.equal(count(component, "window.hrig."), 2);
  assert.equal(count(component, "window.hrig.pathForFile(file)"), 1);
  assert.equal(
    count(component, "preventDefault()"),
    2,
    "only dragover and drop are cancelled",
  );
  assert.equal(
    count(component, "if (!isFileDrag(event.dataTransfer?.types)) return;"),
    4,
    "every handler returns first for a drag that is not files",
  );
  for (const handler of ["enter", "over", "leave", "drop"])
    assert.ok(
      component.includes(
        "const " +
          handler +
          " = (event: DragEvent) => {if (!isFileDrag(event.dataTransfer?.types)) return;",
      ),
      handler + " is gated first",
    );
  assert.equal(count(component, "addEventListener("), 4);
  assert.equal(count(component, "removeEventListener("), 4);
  assert.ok(
    !/writeTerminal|createTerminal|closeTerminal|resizeTerminal|sendTerminalCommand|snippet|stopPropagation|stopImmediatePropagation|localStorage|sessionStorage|document\.|\.write\(|\.input\(|"\\r"|\\r\b/.test(
      component,
    ),
    "the component only pastes",
  );
  assert.equal(count(component, '"file-drop-active"'), 1);

  // The panel mounts it once and adds no other terminal code.
  const panelRaw = read("src/TerminalPanel.tsx");
  // The import line names it twice (binding and path) and the element once.
  assert.equal(count(stripComments(panelRaw), "TerminalFileDrop"), 3);
  assert.ok(
    !/terminal-drop-path/.test(panelRaw),
    "the panel does not use the pure module directly",
  );

  // The preload helper reads a path from a File and does nothing else.
  const preload = read("electron/preload.cjs");
  assert.equal(
    count(
      preload,
      'const { contextBridge, ipcRenderer, webUtils } = require("electron");',
    ),
    1,
  );
  assert.equal(count(preload, "webUtils.getPathForFile(file)"), 1);
  assert.equal(count(preload, "pathForFile:"), 1);
  const bridge = realBridge("linux");
  assert.equal(bridge.pathForFile({ path: "/a/b c" }), "/a/b c");
  assert.equal(bridge.pathForFile({ path: "" }), "");
  assert.equal(
    bridge.pathForFile({ boom: true }),
    "",
    "not a File gives no path",
  );
  assert.equal(
    bridge.pathForFile({ path: 5 }),
    "",
    "a non-string answer gives no path",
  );
  assert.equal(
    bridge.pathForFile(undefined),
    "",
    "nothing at all gives no path",
  );
  assert.equal(bridge.platform, "linux");
  const helper = between(preload, "pathForFile:", "platform:");
  assert.ok(
    !/ipcRenderer|invoke|send|require/.test(helper),
    "the helper opens no channel",
  );
  assert.ok(
    /catch/.test(helper) && /return "";/.test(helper),
    "a non-file or a file that is not on disk gives an empty path",
  );
  const types = stripComments(read("src/types.ts"));
  assert.equal(count(types, "pathForFile(file: File): string;"), 1);
  assert.equal(
    count(
      between(types, "export interface HrigAPI {", "declare global"),
      "pathForFile(file: File): string;",
    ),
    1,
  );
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs)$/.test(file) && file !== "preload.cjs")
      assert.ok(
        !/pathForFile|getPathForFile|webUtils|terminal:drop|file-drop/.test(
          read("electron/" + file),
        ),
        "the main process has no drop code: " + file,
      );

  // One CSS rule: an outline that is painted over the terminal and takes no space.
  const css = read("src/styles.css");
  assert.equal(count(css, "file-drop-active"), 1);
  const rule = collapse(between(css, ".terminal-host.file-drop-active {", "}"));
  assert.equal(
    rule,
    ".terminal-host.file-drop-active { outline: 2px dashed var(--color-86cdb0); outline-offset: -3px;",
  );
  assert.ok(
    !/position|width|height|margin|padding|background|transform|display|border/.test(
      rule,
    ),
  );

  // Tab drags: flexlayout reads a drag only when one of its own tabs started it, and never looks for Files.
  const dist = collapse(
    fs.readFileSync(
      path.join(root, "node_modules", "flexlayout-react", "dist", "index.js"),
      "utf8",
    ),
  );
  assert.ok(
    count(
      dist,
      "if (this._mainController !== DragDropManager.dragState?.mainLayoutController) return;",
    ) >= 3,
    "enter, over and leave ignore a drag with no flexlayout drag state",
  );
  assert.ok(
    dist.includes(
      "onDrop = (event) => { if (this._mainController !== DragDropManager.dragState?.mainLayoutController) { this.clearDragLocal(); return; }",
    ),
    "a drop with no flexlayout drag state only clears its own visuals",
  );
  assert.ok(
    dist.includes(
      'event.dataTransfer.setData("text/plain", "--flexlayout--");',
    ),
    "a tab drag carries text, not files",
  );
  assert.ok(!dist.includes('"Files"'), "flexlayout never looks for files");
  assert.ok(
    !/onExternalDrag/.test(read("src/App.tsx") + read("src/layout.ts")),
    "no external drag handler is registered",
  );

  // Not a setting: the settings module, page, context and the shortcut catalog do not know it.
  for (const file of [
    "src/settings.ts",
    "src/SettingsPage.tsx",
    "src/SettingsContext.tsx",
    "src/shortcuts.ts",
  ])
    assert.ok(
      !/fileDrop|file-drop|dropPath|terminal\.drop/i.test(
        stripComments(read(file)),
      ),
      file + " does not mention drop",
    );
});
