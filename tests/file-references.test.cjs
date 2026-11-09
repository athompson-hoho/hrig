"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const repo = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
const char = (code) => String.fromCharCode(code);

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(repo, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
    logLevel: "silent",
  }).outputFiles[0].text;
}
function load(entry, fakes = {}) {
  const mod = new Module(entry, module);
  mod.filename = path.join(repo, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const lib = load("src/file-references.ts");
// The references as short strings: path, then :line when there is one.
const flat = (list) =>
  list.map((r) => (r.line === undefined ? r.path : r.path + ":" + r.line));
const refs = (text, root) => flat(lib.fileReferences(text, root));
const PROJECT = "/home/me/proj";

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx (and, on its own, the real TaskFileReferences.tsx) over
// a very small react: state, memo, ref and effect slots, function components
// called while the tree is walked, elements recorded as plain objects. The bridge
// is a fake that records every call it gets.

const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [{ name: "dev-a", rigName: "hrig" }];
const ROWS = [
  {
    id: "q1",
    status: "pending",
    title: "Look at the editor",
    destination: "dev-a@hrig",
  },
];
const BODY =
  "Please look at `src/App.tsx:120` and src/missing.ts:3, then src/App.tsx:120 again.";

function runtime(entry, props, bridge) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
  const before = {
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((d, k) => d === b[k]);
  const react = {
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
    useMemo(fn, list) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, list))
        slots[i] = { deps: list, value: fn() };
      return slots[i].value;
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (!old || !same(old, list)) {
        if (cleanups[i]) cleanups[i]();
        deps[i] = list;
        cleanups[i] = fn();
      }
    },
  };
  const jsx = (type, p) => ({ type, props: p });
  const Component = load(entry, {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
      Download: "Download",
    },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    const own = node.props || {};
    if (typeof node.type === "function") return expand(node.type(own));
    if (own.children === undefined) return node;
    return {
      type: node.type,
      props: { ...own, children: expand(own.children) },
    };
  };
  function render() {
    globalThis.window = { hrig: bridge };
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    cursor = 0;
    tree = expand(Component(props));
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
        : typeof node === "string" || typeof node === "number"
          ? String(node)
          : "";
  return {
    text,
    tree: () => tree,
    all: (node = tree) => all(node),
    byLabel: (label) =>
      all(tree).find((n) => n.props && n.props["aria-label"] === label),
    buttons: (node = tree) => all(node).filter((n) => n.type === "button"),
    status: () => all(tree).find((n) => n.props && n.props.role === "status"),
    card: (title) =>
      all(tree).find(
        (n) =>
          n.props &&
          n.props.className === "task-card" &&
          text(all(n).find((c) => c.type === "strong")) === title,
      ),
    rerender(next) {
      props = next;
      render();
    },
    async flush() {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
    unmount() {
      cleanups.forEach((c) => c && c());
      globalThis.window = before.window;
      globalThis.setInterval = before.setInterval;
      globalThis.clearInterval = before.clearInterval;
      if (before.window === undefined) delete globalThis.window;
    },
  };
}

function fakeBridge({ detail, fail = [] } = {}) {
  const calls = { queue: [], rigAction: [], sendMessage: [], edit: [] };
  const bridge = {
    queue: (...a) => {
      calls.queue.push(a);
      return Promise.resolve(ROWS);
    },
    rigAction: (...a) => {
      calls.rigAction.push(a);
      return Promise.resolve(detail);
    },
    sendMessage: (...a) => {
      calls.sendMessage.push(a);
      return Promise.resolve("");
    },
    edit: (connection, request) => {
      calls.edit.push([connection, request]);
      return fail.includes(request.path)
        ? Promise.reject(new Error("ENOENT: no such file or directory"))
        : Promise.resolve({ content: "", revision: "r" });
    },
  };
  return { bridge, calls };
}

// ---------------------------------------------------------------------------
// Task 1: rules, paths and the tracer.

test("file-references rules: every syntax, markdown around a name, duplicates, the cap, lines, labels and text without files", () => {
  assert.deepEqual(refs("see src/App.tsx", PROJECT), ["src/App.tsx"]);
  for (const [text, want] of [
    ["src/App.tsx:120", "src/App.tsx:120"],
    ["src/App.tsx:12:5", "src/App.tsx:12"],
    ["src/App.tsx(12,5)", "src/App.tsx:12"],
    ["src/App.tsx(12)", "src/App.tsx:12"],
    ["src/App.tsx#L12", "src/App.tsx:12"],
    ["src/App.tsx#L12-L20", "src/App.tsx:12"],
    ["src/App.tsx#L12-20", "src/App.tsx:12"],
    ['"src/my file.ts":42', "src/my file.ts:42"],
    ["`src/App.tsx:120`", "src/App.tsx:120"],
    ["**src/App.tsx**", "src/App.tsx"],
    ["*src/App.tsx:3*", "src/App.tsx:3"],
    ["[src/App.tsx:12](https://example.com/page)", "src/App.tsx:12"],
    ["(see src/App.tsx:12)", "src/App.tsx:12"],
    ["Fix src/App.tsx:12, then go.", "src/App.tsx:12"],
    ["at foo (src/App.tsx:12:5)", "src/App.tsx:12"],
    ["./src/App.tsx:9", "src/App.tsx:9"],
    ["e.g. src/a.ts", "src/a.ts"],
  ])
    assert.deepEqual(refs(text, PROJECT), [want], text);
  // A suffix that is not a line leaves no reference.
  assert.deepEqual(refs("src/App.tsx#L12abc", PROJECT), []);
  // Several, in the order of the text; a file at two lines is two entries; a repeat is dropped.
  assert.deepEqual(refs("a src/a.ts:1 then src/b.ts:2 and src/c.ts", PROJECT), [
    "src/a.ts:1",
    "src/b.ts:2",
    "src/c.ts",
  ]);
  assert.deepEqual(
    refs("src/a.ts:1 src/a.ts:1 src/a.ts:2 src/a.ts src/a.ts", PROJECT),
    ["src/a.ts:1", "src/a.ts:2", "src/a.ts"],
  );
  assert.deepEqual(refs("src/a.ts:1 src\\a.ts:1 ./src/a.ts:1", PROJECT), [
    "src/a.ts:1",
  ]);
  // The cap.
  assert.equal(lib.MAX_REFS, 10);
  const many = Array.from({ length: 15 }, (_, i) => "src/file" + i + ".ts");
  assert.deepEqual(refs(many.join(" "), PROJECT), many.slice(0, 10));
  // Lines: a whole number from 1 to 1,000,000 is kept, a bigger one is dropped and the file stays, 0 is no reference.
  assert.equal(lib.MAX_LINE, 1000000);
  assert.deepEqual(refs("src/a.ts:1000000", PROJECT), ["src/a.ts:1000000"]);
  assert.deepEqual(refs("src/a.ts:1000001", PROJECT), ["src/a.ts"]);
  assert.deepEqual(refs("src/a.ts:0", PROJECT), []);
  assert.deepEqual(refs("src/a.ts:99999999999999999999", PROJECT), []);
  // The shape of an entry: a line only when there is one.
  assert.deepEqual(lib.fileReferences("src/a.ts:3 b.ts", PROJECT), [
    { path: "src/a.ts", line: 3, label: "src/a.ts:3" },
    { path: "b.ts", label: "b.ts" },
  ]);
  // A long label is cut at the start and keeps the file name and the line; a path over the cap is not listed.
  assert.equal(lib.MAX_LABEL_CHARS, 80);
  const deep = "a/".repeat(60) + "file.ts";
  const [long] = lib.fileReferences(deep + ":12", PROJECT);
  assert.equal(long.path, deep);
  assert.equal(long.label.length, 80);
  assert.ok(long.label.startsWith(char(0x2026)));
  assert.ok(long.label.endsWith("file.ts:12"));
  assert.equal(lib.MAX_PATH_CHARS, 512);
  assert.deepEqual(refs("a/".repeat(300) + "b.ts", PROJECT), []);
  // Text with no file in it, and values that are not text.
  for (const text of [
    "",
    "   ",
    "no files in this text",
    "Wait, what? Yes.",
    "localhost:3000",
    "http://localhost:3000/a.ts",
    "port 8080",
    "ratio 16:9 at 12:30",
    "v1.2.3",
    "version 2.0 and 3.14.159",
    "1.5",
    "e.g. this, i.e. that, U.S. and a.k.a. other",
  ])
    assert.deepEqual(refs(text, PROJECT), [], JSON.stringify(text));
  for (const value of [undefined, null, 42, {}, [], true])
    assert.deepEqual(lib.fileReferences(value, PROJECT), []);
  // A bare abbreviation followed by a line is a name.
  assert.deepEqual(refs("a.c:5", PROJECT), ["a.c:5"]);
});

test("file-references paths: relative only, no .., absolute only under the project folder, Windows forms, no URL or ~, hidden characters removed", () => {
  // Traversal is refused in every form.
  for (const text of [
    "../a.ts",
    "..\\a.ts",
    "src/../a.ts",
    "a/b/../../c.ts",
    "src\\..\\a.ts",
    "./../a.ts",
    "a/.../b.ts",
    '"../my file.ts"',
    PROJECT + "/../x.ts",
    PROJECT + "/../../etc/passwd.txt",
  ])
    assert.deepEqual(refs(text, PROJECT), [], text);
  // An absolute path counts only under the folder, then it is made relative.
  assert.deepEqual(refs(PROJECT + "/src/a.ts:5", PROJECT), ["src/a.ts:5"]);
  assert.deepEqual(refs(PROJECT + "/a.ts", PROJECT + "/"), ["a.ts"]);
  for (const text of [
    "/home/me/other/a.ts",
    "/home/me/proj2/a.ts",
    "/home/me/proj-x/a.ts",
    "/home/me/projx/src/a.ts",
    "/home/me/pro/a.ts",
    "/HOME/me/proj/a.ts",
    "/a.ts",
    "/etc/passwd.txt",
  ])
    assert.deepEqual(refs(text, PROJECT), [], text);
  // With no usable folder an absolute path is never listed, a relative one still is.
  for (const root of [undefined, null, "", "/", 42, {}])
    assert.deepEqual(refs(PROJECT + "/src/a.ts", root), [], String(root));
  assert.deepEqual(refs("src/a.ts", undefined), ["src/a.ts"]);
  // Windows folders: separators of either kind, the drive and the folder compared without case, other drives refused.
  const win = "C:\\work\\proj";
  assert.deepEqual(refs("C:\\work\\proj\\src\\a.ts:7", win), ["src/a.ts:7"]);
  assert.deepEqual(refs("c:/WORK/Proj/src/a.ts", win), ["src/a.ts"]);
  assert.deepEqual(refs("C:/work/proj/src/a.ts", "C:\\work\\proj\\"), [
    "src/a.ts",
  ]);
  for (const text of [
    "C:\\other\\a.ts",
    "D:\\work\\proj\\a.ts",
    "C:\\work\\proj2\\a.ts",
    "C:\\work\\proj-x\\a.ts",
    "C:\\work\\projx\\src\\a.ts",
    "C:\\work\\proj\\..\\a.ts",
  ])
    assert.deepEqual(refs(text, win), [], text);
  assert.deepEqual(refs("C:\\work\\proj\\a.ts", undefined), []);
  assert.deepEqual(refs("C:\\a.ts", PROJECT), []);
  assert.deepEqual(refs("/home/me/proj/a.ts", win), []);
  // A relative path with Windows separators or dot parts is made plain.
  assert.deepEqual(refs("src\\sub\\a.ts:3", PROJECT), ["src/sub/a.ts:3"]);
  assert.deepEqual(refs(".\\src\\a.ts", PROJECT), ["src/a.ts"]);
  assert.deepEqual(refs("src/./a.ts", PROJECT), ["src/a.ts"]);
  // No home folder, variable or web address.
  for (const text of [
    "~/a.ts",
    "~user/a.ts",
    "$HOME/a.ts",
    "%USERPROFILE%\\a.ts",
    "https://example.com/src/app.ts",
    "http://example.com/src/app.ts:12",
    "ftp://host/a.ts",
    "file:///etc/passwd.txt",
    "vscode://file/a.ts",
    "https://github.com/o/r/blob/main/src/a.ts#L12",
    "https://user:secret@example.com/a.ts",
  ])
    assert.deepEqual(refs(text, PROJECT), [], text);
  assert.deepEqual(
    refs("see https://example.com/x and src/a.ts then ftp://h/b.ts", PROJECT),
    ["src/a.ts"],
  );
  // Hidden characters are removed before the paths are read; line breaks and tabs still separate words.
  for (const code of [
    0, 7, 27, 127, 0x85, 0x9f, 0x61c, 0x200b, 0x200d, 0x200e, 0x2028, 0x202a,
    0x202e, 0x2060, 0x2066, 0x2069, 0xfeff,
  ])
    assert.deepEqual(
      refs("src/a" + char(code) + ".ts:3", PROJECT),
      ["src/a.ts:3"],
      "U+" + code.toString(16),
    );
  assert.deepEqual(refs("src/a.ts\nsrc/b.ts\r\nsrc/c.ts\tsrc/d.ts", PROJECT), [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.ts",
  ]);
});

test("file-references tracer: a task that names src/App.tsx:120 gets a Files mentioned button that reads the file and opens it at line 120; a missing file shows why and opens nothing", async () => {
  const opened = [];
  const { bridge, calls } = fakeBridge({
    detail: { id: "q1", body: BODY },
    fail: ["src/missing.ts"],
  });
  const board = runtime(
    "src/TaskBoard.tsx",
    {
      connection: CONNECTION,
      rigName: undefined,
      seats: SEATS,
      onSeat: () => {},
      root: PROJECT,
      onFile: (file, line) => opened.push([file, line]),
    },
    bridge,
  );
  try {
    await board.flush();
    assert.equal(board.byLabel("Files mentioned"), undefined, "no dialog yet");
    board.card("Look at the editor").props.onClick();
    await board.flush();
    const group = board.byLabel("Files mentioned");
    assert.ok(group, "the list is shown");
    const buttons = board.buttons(group);
    assert.deepEqual(
      buttons.map((b) => board.text(b)),
      ["src/App.tsx:120", "src/missing.ts:3"],
    );
    assert.deepEqual(
      buttons.map((b) => b.props.title),
      ["src/App.tsx", "src/missing.ts"],
    );
    // It sits after the text of the task and before the owner control.
    const order = board.all();
    const at = (pred) => order.findIndex(pred);
    const body = at((n) => n.props && n.props.className === "task-markdown");
    const owner = at(
      (n) => n.props && n.props["aria-label"] === "Task destination",
    );
    assert.ok(
      body >= 0 &&
        body < at((n) => n === group) &&
        at((n) => n === group) < owner,
    );
    // Nothing has been read or opened yet.
    assert.deepEqual(calls.edit, []);
    assert.deepEqual(opened, []);

    // A click reads the file with the terminal's check, then opens it at the line.
    buttons[0].props.onClick();
    await board.flush();
    assert.deepEqual(calls.edit, [
      [CONNECTION, { op: "read", root: PROJECT, path: "src/App.tsx" }],
    ]);
    assert.deepEqual(opened, [["src/App.tsx", 120]]);
    assert.equal(board.status(), undefined);

    // A file that cannot be read shows the reason and opens nothing.
    board.buttons(board.byLabel("Files mentioned"))[1].props.onClick();
    await board.flush();
    assert.equal(calls.edit.length, 2);
    assert.deepEqual(opened, [["src/App.tsx", 120]]);
    const note = board.text(board.status());
    assert.ok(note.startsWith("Could not open src/missing.ts:3: "), note);
    assert.ok(note.includes("ENOENT"), note);

    // The next click clears the line and opens.
    board.buttons(board.byLabel("Files mentioned"))[0].props.onClick();
    await board.flush();
    assert.equal(board.status(), undefined);
    assert.deepEqual(opened, [
      ["src/App.tsx", 120],
      ["src/App.tsx", 120],
    ]);

    // Only the task and file reads went to the bridge: nothing was sent or changed.
    assert.deepEqual(
      calls.rigAction.map((a) => a[1].op),
      ["taskShow"],
    );
    assert.deepEqual(calls.sendMessage, []);
  } finally {
    board.unmount();
  }

  // Without the two props the board is as before: no list, no read.
  for (const extra of [{ onFile: () => {} }, { root: PROJECT }, {}]) {
    const { bridge: quiet, calls: seen } = fakeBridge({
      detail: { id: "q1", body: BODY },
    });
    const plain = runtime(
      "src/TaskBoard.tsx",
      {
        connection: CONNECTION,
        rigName: undefined,
        seats: SEATS,
        onSeat: () => {},
        ...extra,
      },
      quiet,
    );
    try {
      await plain.flush();
      plain.card("Look at the editor").props.onClick();
      await plain.flush();
      assert.ok(
        plain
          .all()
          .some((n) => n.props && n.props.className === "task-markdown"),
      );
      assert.equal(plain.byLabel("Files mentioned"), undefined);
      assert.deepEqual(seen.edit, []);
    } finally {
      plain.unmount();
    }
  }
});

// ---------------------------------------------------------------------------
// Task 2: limits and hostile text, the terminal matcher the module builds on, and the component on its own.

const SAFE_PATH = /^[\w@. -]+(?:\/[\w@. -]+)*$/;
const hasHidden = (text) =>
  [...text].some((c) => {
    const code = c.codePointAt(0);
    return (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x61c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    );
  });
// What every answer must satisfy, whatever the text was.
function check(list, what) {
  assert.ok(Array.isArray(list), what);
  assert.ok(list.length <= lib.MAX_REFS, what);
  const seen = new Set();
  for (const r of list) {
    assert.deepEqual(
      Object.keys(r).sort(),
      r.line === undefined ? ["label", "path"] : ["label", "line", "path"],
    );
    assert.ok(SAFE_PATH.test(r.path), "path " + JSON.stringify(r.path));
    assert.ok(r.path.length <= lib.MAX_PATH_CHARS);
    assert.ok(
      !r.path.split("/").some((part) => /^\.+$/.test(part)),
      "no dot parts: " + r.path,
    );
    assert.ok(!r.path.startsWith("/") && !/^[A-Za-z]:/.test(r.path));
    assert.ok(!hasHidden(r.path) && !hasHidden(r.label));
    assert.ok(r.label.length <= lib.MAX_LABEL_CHARS);
    assert.ok(
      r.line === undefined ||
        (Number.isInteger(r.line) && r.line >= 1 && r.line <= lib.MAX_LINE),
    );
    const key = r.path + ":" + (r.line === undefined ? "" : r.line);
    assert.ok(!seen.has(key), "no repeat: " + key);
    seen.add(key);
  }
}

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

test("file-references limits: only the start of a long text is read, a name the cut would split is not listed, and hostile text stays safe and quick", () => {
  assert.equal(lib.MAX_SCAN_CHARS, 20000);
  // Inside the window, on the edge of it, and beyond it.
  assert.deepEqual(refs(" ".repeat(19980) + "src/in.ts tail", PROJECT), [
    "src/in.ts",
  ]);
  assert.deepEqual(refs(" ".repeat(19991) + "src/ok.ts", PROJECT), [
    "src/ok.ts",
  ]);
  assert.deepEqual(refs(" ".repeat(19991) + "src/ok.ts src/late.ts", PROJECT), [
    "src/ok.ts",
  ]);
  assert.deepEqual(refs(" ".repeat(20001) + "src/late.ts", PROJECT), []);
  // A name the cut would shorten (src/edge.t) is left out, not listed as a shorter file.
  assert.deepEqual(refs(" ".repeat(19990) + "src/edge.ts", PROJECT), []);
  assert.deepEqual(refs("a".repeat(30000) + " src/late.ts", PROJECT), []);
  // Names and prose in the odd places.
  assert.deepEqual(
    refs("__proto__/a.ts constructor.ts toString.js src/__proto__.ts", PROJECT),
    ["__proto__/a.ts", "constructor.ts", "toString.js", "src/__proto__.ts"],
  );

  const began = process.hrtime.bigint();
  // Millions of characters: the first 20,000 are read and nothing more.
  const huge = "src/a.ts:1 ".repeat(500000);
  assert.ok(huge.length > 5000000);
  assert.deepEqual(refs(huge, PROJECT), ["src/a.ts:1"]);
  const distinct = Array.from({ length: 3000 }, (_, i) => "src/f" + i + ".ts");
  assert.deepEqual(refs(distinct.join(" "), PROJECT), distinct.slice(0, 10));
  // Pieces that are hard for a matcher, repeated to fill most of the window.
  const pieces = [
    "a",
    "a.",
    ":1",
    "src/",
    '"',
    "'a ",
    "(",
    ")",
    "`",
    "#L1",
    "../",
    "[",
    "1",
    "a:1:1:1:1",
    "(1,1",
    '"a b.ts" ',
    "x.y.z.",
    "\u2026",
  ];
  for (const piece of pieces) {
    const text =
      piece.repeat(Math.max(1, Math.floor(19000 / piece.length))) +
      " src/ok.ts:3";
    check(lib.fileReferences(text, PROJECT), JSON.stringify(piece));
    check(lib.fileReferences(text, "C:\\work\\proj"), JSON.stringify(piece));
  }
  // A seeded walk over hostile pieces, with three kinds of project folder.
  const hostile = [
    "src/a.ts",
    "src/b/c.tsx",
    "../x.ts",
    "..\\y.ts",
    "C:\\work\\proj\\z.ts",
    "/home/me/proj/w.ts",
    "/etc/passwd.txt",
    ":12",
    ":0",
    ":99999999999",
    "(3,4)",
    "#L7",
    "#L8-L9",
    " ",
    "\n",
    "\t",
    "`",
    "*",
    "[",
    "]",
    "(",
    ")",
    '"',
    "'",
    ",",
    ".",
    "http://x.y/z.ts",
    "~/h.ts",
    char(0x200b),
    char(0x202e),
    char(0),
    char(0xfeff),
    char(0x2028),
    "v1.2.3",
    "e.g.",
    "localhost:3000",
    "a b.ts",
    "__proto__",
    "constructor.ts",
  ];
  const rand = seeded(9112026);
  for (let run = 0; run < 600; run++) {
    let text = "";
    const length = 1 + Math.floor(rand() * 40);
    for (let k = 0; k < length; k++)
      text += hostile[Math.floor(rand() * hostile.length)];
    for (const root of [PROJECT, "C:\\work\\proj", undefined]) {
      const list = lib.fileReferences(text, root);
      check(list, JSON.stringify(text));
      assert.deepEqual(lib.fileReferences(text, root), list, "same answer");
    }
  }
  assert.ok(
    Number(process.hrtime.bigint() - began) / 1e6 < 5000,
    "hostile text stays quick",
  );
});

const paths = load("src/terminal-path-links.ts");

test("file-references terminal: the terminal matcher this phase builds on already gives the line for path:line, path:line:col and path(line,col), and leaves a path without a line alone", () => {
  const found = (text) =>
    paths.matchTerminalPaths(text).map((m) => [m.file, m.line]);
  assert.deepEqual(found("src/a.ts:12"), [["src/a.ts", 12]]);
  assert.deepEqual(found("src/a.ts:12:5"), [["src/a.ts", 12]]);
  assert.deepEqual(found("src/a.ts(12,5)"), [["src/a.ts", 12]]);
  assert.deepEqual(found("src/a.ts(12)"), [["src/a.ts", 12]]);
  assert.deepEqual(found("C:\\w\\a.ts:7:1"), [["C:\\w\\a.ts", 7]]);
  assert.deepEqual(found('"src/my file.ts":42:2'), [["src/my file.ts", 42]]);
  assert.deepEqual(found("src/a.ts"), [["src/a.ts", undefined]]);
  assert.deepEqual(found("src/a.ts:0"), []);
  // The underline covers the whole location suffix.
  const [m] = paths.matchTerminalPaths("go to src/a.ts:12:5 now");
  assert.equal(
    "go to src/a.ts:12:5 now".slice(m.start, m.end),
    "src/a.ts:12:5",
  );
  // The list reads the same line from the same text.
  for (const text of ["src/a.ts:12:5", "src/a.ts(12,5)", "src/a.ts:7"])
    assert.equal(
      lib.fileReferences(text, PROJECT)[0].line,
      paths.matchTerminalPaths(text)[0].line,
    );
});

function mountRefs(detail, { fail = [], hold, root = PROJECT } = {}) {
  const log = [];
  const opened = [];
  const calls = [];
  const bridge = {
    edit: (connection, request) => {
      calls.push([connection, request]);
      log.push("edit");
      if (hold) return hold(request);
      return fail.includes(request.path)
        ? Promise.reject(new Error("The file is outside the project folder."))
        : Promise.resolve({ content: "", revision: "r" });
    },
  };
  const view = runtime(
    "src/TaskFileReferences.tsx",
    {
      detail,
      connection: CONNECTION,
      root,
      onFile: (file, line) => {
        log.push("open");
        opened.push([file, line]);
      },
    },
    bridge,
  );
  return { view, opened, calls, log };
}
const labels = (view) => view.buttons().map((b) => view.text(b));

test("file-references component: reads the same text the dialog shows, lists at most ten files, reads before it opens, shows why a read failed, and never opens after it is gone", async () => {
  // Nothing to list: nothing is drawn and nothing is read.
  for (const detail of [
    null,
    "src/a.ts",
    5,
    [],
    { error: "src/a.ts" },
    { body: "no files here" },
    { body: "no files", summary: "src/b.ts" },
    { id: "q1" },
  ]) {
    const { view, calls } = mountRefs(detail);
    try {
      assert.equal(view.tree(), null, JSON.stringify(detail));
      assert.deepEqual(calls, []);
    } finally {
      view.unmount();
    }
  }
  // The text is the one the dialog picks: body, else bodyPreview, else summary.
  for (const [detail, want] of [
    [
      { body: "src/b.ts", bodyPreview: "src/p.ts", summary: "src/s.ts" },
      ["src/b.ts"],
    ],
    [
      { body: "  ", bodyPreview: "src/p.ts", summary: "src/s.ts" },
      ["src/p.ts"],
    ],
    [{ summary: "see src/s.ts:4" }, ["src/s.ts:4"]],
  ]) {
    const { view } = mountRefs(detail);
    try {
      assert.deepEqual(labels(view), want);
    } finally {
      view.unmount();
    }
  }

  // An absolute path under the project folder is listed relative to it; one outside it, and a .. path, are not.
  const absolute = mountRefs({
    body: PROJECT + "/src/c.ts:3 and /home/me/other/d.ts and ../e.ts",
  });
  try {
    assert.deepEqual(labels(absolute.view), ["src/c.ts:3"]);
  } finally {
    absolute.view.unmount();
  }

  // At most ten buttons, each its label as text and its whole path as the tooltip; mounting reads and opens nothing.
  const many = Array.from(
    { length: 15 },
    (_, i) => "src/file" + i + ".ts:" + (i + 1),
  );
  const first = mountRefs({ body: many.join(" ") });
  try {
    assert.deepEqual(labels(first.view), many.slice(0, 10));
    assert.deepEqual(
      first.view.buttons().map((b) => b.props.title),
      many.slice(0, 10).map((m) => m.split(":")[0]),
    );
    assert.deepEqual(first.calls, []);
    assert.deepEqual(first.opened, []);
    assert.equal(first.view.status(), undefined);
  } finally {
    first.view.unmount();
  }

  // The read comes first, then the open with the path and the line (none for a bare path).
  const order = mountRefs({ body: "src/a.ts:12 and b.ts" });
  try {
    order.view.buttons()[0].props.onClick();
    await order.view.flush();
    order.view.buttons()[1].props.onClick();
    await order.view.flush();
    assert.deepEqual(order.log, ["edit", "open", "edit", "open"]);
    assert.deepEqual(order.calls, [
      [CONNECTION, { op: "read", root: PROJECT, path: "src/a.ts" }],
      [CONNECTION, { op: "read", root: PROJECT, path: "b.ts" }],
    ]);
    assert.deepEqual(order.opened, [
      ["src/a.ts", 12],
      ["b.ts", undefined],
    ]);
  } finally {
    order.view.unmount();
  }

  // A failed read shows the reason in a status line and opens nothing; the next click clears the line.
  const failing = mountRefs(
    { body: "src/gone.ts:3 and src/here.ts" },
    { fail: ["src/gone.ts"] },
  );
  try {
    failing.view.buttons()[0].props.onClick();
    await failing.view.flush();
    assert.deepEqual(failing.opened, []);
    assert.equal(
      failing.view.text(failing.view.status()),
      "Could not open src/gone.ts:3: The file is outside the project folder.",
    );
    failing.view.buttons()[1].props.onClick();
    await failing.view.flush();
    assert.equal(failing.view.status(), undefined);
    assert.deepEqual(failing.opened, [["src/here.ts", undefined]]);
  } finally {
    failing.view.unmount();
  }
  // A reason that is not an error object, and a very long one, are shown as text and cut.
  for (const [reason, want] of [
    ["plain failure", "plain failure"],
    [new Error("x".repeat(500)), "x".repeat(200)],
  ]) {
    const odd = mountRefs(
      { body: "a.ts" },
      { hold: () => Promise.reject(reason) },
    );
    try {
      odd.view.buttons()[0].props.onClick();
      await odd.view.flush();
      assert.equal(
        odd.view.text(odd.view.status()),
        "Could not open a.ts: " + want,
      );
      assert.deepEqual(odd.opened, []);
    } finally {
      odd.view.unmount();
    }
  }

  // A read that finishes after the dialog is gone opens nothing and shows nothing.
  for (const settle of ["resolve", "reject"]) {
    let release;
    const late = mountRefs(
      { body: "src/a.ts:1" },
      {
        hold: () =>
          new Promise((resolve, reject) => {
            release = settle === "resolve" ? resolve : reject;
          }),
      },
    );
    late.view.buttons()[0].props.onClick();
    late.view.unmount();
    release(settle === "resolve" ? {} : new Error("late"));
    await late.view.flush();
    assert.deepEqual(late.opened, [], settle);
    assert.equal(late.view.status(), undefined, settle);
  }

  // Only plain elements and the known classes: hostile text is shown as text, never as markup or a link.
  const hostile = mountRefs({
    body: "<img src=x onerror=alert(1)> <script>alert(1)</script> src/a.ts",
  });
  try {
    hostile.view.buttons()[0].props.onClick();
    await hostile.view.flush();
    const nodes = hostile.view.all();
    assert.deepEqual([...new Set(nodes.map((n) => n.type))].sort(), [
      "button",
      "div",
      "fragment",
    ]);
    const allowed = new Set([
      "children",
      "className",
      "role",
      "aria-label",
      "title",
      "onClick",
    ]);
    for (const n of nodes)
      for (const key of Object.keys(n.props || {}))
        assert.ok(allowed.has(key), "prop " + key);
    assert.deepEqual(
      [
        ...new Set(
          nodes.map((n) => n.props && n.props.className).filter(Boolean),
        ),
      ].sort(),
      ["field-label", "small-button", "task-file-refs"],
    );
    assert.deepEqual(labels(hostile.view), ["src/a.ts"]);
  } finally {
    hostile.view.unmount();
  }
});
