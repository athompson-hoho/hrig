"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync, transformSync } = require("esbuild");
const core = require("../electron/core.cjs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const char = (code) => String.fromCharCode(code);
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
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
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const lib = load("src/seat-notes.ts");

// The text of one place of src/App.tsx, cut between two anchors and compiled, so the test runs the App's own code.
const appSource = read("src/App.tsx");
function cut(head, tail, name) {
  const from = appSource.indexOf(head);
  assert.ok(from >= 0, "missing " + name);
  const to = appSource.indexOf(tail, from + head.length);
  assert.ok(to > from, "unterminated " + name);
  return {
    text: appSource.slice(from, to + tail.length),
    body: appSource.slice(from + head.length, to),
  };
}
function compile(code, params, result) {
  return new Function(
    ...params,
    transformSync(code, { loader: "ts" }).code + "\nreturn " + result + ";",
  );
}
// The boot effect's load callback, as the sidebar width test cuts it.
const loadCut = cut(
  "\n      .then(async ([saved, found]) => {\n",
  "\n      })\n      .catch((e) => setBootError(e.message));",
  "the workspace load callback",
);
const loadFactory = compile(
  "const load = async ([saved, found]) => {" + loadCut.body + "\n};",
  [
    "setDetected",
    "defaultState",
    "normalizeHistory",
    "setState",
    "setLoaded",
    "log",
    "normalizeSidebarWidth",
    "normalizeReviewChecks",
    "normalizeSeatNotes",
  ],
  "load",
);
// The sidebar's onNote handler, exactly as the App passes it.
const handlerCut = cut(
  "onNote={(seat, text) => {",
  "\n                }}",
  "the onNote handler",
);
const handlerFactory = compile(
  "const onNote = (seat, text) => {" + handlerCut.body + "\n};",
  ["connection", "setState", "normalizeSeatNotes", "setNote", "noteKey"],
  "onNote",
);

const CONNECTION = {
  id: "c1",
  name: "This computer",
  kind: "local",
  root: ".",
};
const K = lib.noteKey("c1", "rig-1:dev-impl");

// The saved workspace file and the App around it: setState keeps the state, a restart goes through JSON text and the real load callback.
function appWorld(connection = CONNECTION) {
  const w = {
    state: {
      version: 1,
      connections: [connection],
      activeConnection: connection.id,
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
    },
    writes: 0,
  };
  const setState = (update) => {
    const next = update(w.state);
    if (next !== w.state) w.writes++;
    w.state = next;
  };
  w.onNote = handlerFactory(
    connection,
    setState,
    lib.normalizeSeatNotes,
    lib.setNote,
    lib.noteKey,
  );
  w.restart = (edit = (saved) => saved) => {
    const saved = edit(JSON.parse(JSON.stringify(w.state)));
    const out = [];
    loadFactory(
      () => {},
      {
        version: 1,
        connections: [connection],
        activeConnection: connection.id,
      },
      (history) => history,
      (value) => out.push(value),
      () => {},
      () => {},
      (width) => width,
      (value) => value,
      lib.normalizeSeatNotes,
    )([saved, []]);
    w.state = out[0];
    return w.state;
  };
  return w;
}

// A small react runtime: useState keeps slots and a state change renders again at once.
function dialogHarness(initialProps) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  let props = initialProps;
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
  };
  const jsx = (type, p) => ({ type, props: p });
  const Component = load("src/SeatNotes.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": { StickyNote: "StickyNote" },
    "./components": { Modal: "Modal" },
  }).default;
  function render() {
    cursor = 0;
    tree = Component(props);
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
  const find = (pick) => all(tree).find(pick);
  const h = {
    tree: () => tree,
    all: () => all(tree),
    setProps(patch) {
      props = { ...props, ...patch };
      render();
    },
    notesButton: () =>
      find(
        (n) =>
          n.type === "button" &&
          typeof n.props["aria-label"] === "string" &&
          n.props["aria-label"].startsWith("Notes for"),
      ),
    modal: () => find((n) => n.type === "Modal"),
    textarea: () => find((n) => n.type === "textarea"),
    counter: () =>
      find((n) => n.type === "p" && n.props.id === "seat-note-count"),
    button: (text) =>
      find((n) => n.type === "button" && n.props.children === text),
    type: (value) => h.textarea().props.onChange({ target: { value } }),
    json: () => JSON.stringify(tree),
  };
  return h;
}

// Runs a function while the page, the network and the shared storage refuse every access.
function withoutPage(fn) {
  const names = ["window", "document", "fetch", "XMLHttpRequest", "WebSocket"];
  const before = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const refuse = (name) => () => {
    throw new Error("the feature touched " + name);
  };
  names.forEach((name) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: refuse(name),
    }),
  );
  try {
    return fn();
  } finally {
    names.forEach((name, i) => {
      if (before[i]) Object.defineProperty(globalThis, name, before[i]);
      else delete globalThis[name];
    });
  }
}

const inventory = () =>
  core.normalizeInventory(
    [{ rigId: "rig-1", name: "build", status: "running", nodeCount: 2 }],
    [
      {
        rigId: "rig-1",
        rigName: "build",
        logicalId: "dev-impl",
        runtime: "codex",
        canonicalSessionName: "dev-impl@build",
        sessionStatus: "running",
      },
      {
        rigId: "rig-1",
        rigName: "build",
        logicalId: "dev-qa",
        runtime: "claude-code",
        canonicalSessionName: "dev-qa@build",
        sessionStatus: "running",
      },
    ],
  );

test("seat-notes keys: the module's exports and limits are exactly these, a key is the connection id, a bar and the seat id, hidden or oversize or ambiguous input gives no key, and the key of a real seat survives a relaunch and a rig rename that keeps its rig id", () => {
  assert.deepEqual(
    Object.keys(lib).sort(),
    [
      "MAX_NOTES",
      "MAX_NOTE_CHARS",
      "MAX_NOTE_KEY",
      "cleanNote",
      "countNoteChars",
      "hasNote",
      "noteFor",
      "noteKey",
      "normalizeSeatNotes",
      "notePreview",
      "setNote",
    ].sort(),
  );
  assert.equal(lib.MAX_NOTES, 200);
  assert.equal(lib.MAX_NOTE_CHARS, 2000);
  assert.equal(lib.MAX_NOTE_KEY, 200);

  assert.equal(lib.noteKey("c1", "rig-1:dev-impl"), "c1|rig-1:dev-impl");
  // The seat id may hold the bar; the connection id may not, so one key is one pair.
  assert.equal(lib.noteKey("c1", "a|b"), "c1|a|b");
  assert.equal(lib.noteKey("c|1", "a"), "");
  for (const bad of [undefined, null, 1, {}, [], true, ""]) {
    assert.equal(lib.noteKey(bad, "a"), "");
    assert.equal(lib.noteKey("c", bad), "");
  }
  for (const code of [
    0, 7, 10, 13, 127, 0x85, 0x200b, 0x202e, 0x2066, 0xfeff, 0xd800,
  ])
    assert.equal(
      lib.noteKey("c", "a" + char(code) + "b"),
      "",
      "hidden " + code,
    );
  // The longest key is 200 characters.
  assert.equal(lib.noteKey("c", "x".repeat(198)).length, 200);
  assert.equal(lib.noteKey("c", "x".repeat(199)), "");
  // Names that are object keys are ordinary ids, and add nothing to Object.prototype.
  assert.equal(lib.noteKey("c", "__proto__"), "c|__proto__");
  assert.equal(lib.noteKey("__proto__", "a"), "__proto__|a");
  assert.equal({}.polluted, undefined);

  // What a real seat is keyed by: the id the real inventory gives it.
  const rigs = (rigId, rigName, session) => [
    {
      rigId,
      rigName,
      logicalId: "dev-impl",
      runtime: "codex",
      canonicalSessionName: session,
      sessionStatus: "running",
    },
  ];
  const keyOf = (rows) =>
    lib.noteKey("c1", core.normalizeInventory([], rows).seats[0].id);
  const first = keyOf(rigs("rig-1", "build", "dev-impl@build"));
  assert.equal(first, "c1|rig-1:dev-impl");
  assert.equal(
    keyOf(rigs("rig-1", "build", "dev-impl@build-2")),
    first,
    "a new session name",
  );
  assert.equal(
    keyOf(rigs("rig-1", "renamed", "dev-impl@renamed")),
    first,
    "a rig rename that keeps the rig id",
  );
  assert.notEqual(
    keyOf(rigs("rig-2", "build", "dev-impl@build")),
    first,
    "a recreated rig has a new id",
  );
  // Without a rig id the id uses the rig name, so a rename gives a new key: the documented limit.
  assert.notEqual(
    keyOf(rigs(undefined, "renamed", "x")),
    keyOf(rigs(undefined, "build", "x")),
  );
});

test("seat-notes clean: line breaks become line feeds, control, zero-width, bidirectional and separator characters and unpaired surrogates are dropped, tabs and line feeds stay, the text is cut to 2000 code points and trailing white space trimmed, and the counter and the tooltip line follow", () => {
  const c = lib.cleanNote;
  assert.equal(c("hello"), "hello");
  assert.equal(c("a\nb\tc"), "a\nb\tc");
  assert.equal(c("a\r\nb\rc"), "a\nb\nc");
  assert.equal(c("a\u0000b\u0007c\u001bd\u007fe\u0085f"), "abcdef");
  assert.equal(
    c("a\u200bb\u200cc\u200dd\u200ee\u200ff\ufeffg\u2060h"),
    "abcdefgh",
  );
  assert.equal(c("\u202eevil\u202c \u2066x\u2069 \u061c"), "evil x");
  assert.equal(c("a\u2028b\u2029c"), "abc");
  assert.equal(c("a" + char(0xd800) + "b" + char(0xdc00) + "c"), "abc");
  assert.equal(c("ok \ud83d\ude00"), "ok \ud83d\ude00");
  assert.equal(c("text  \n\n\t "), "text");
  assert.equal(c("  indented"), "  indented");
  assert.equal(c("   \n\t"), "");
  assert.equal(c("\u200b\u202e"), "");
  for (const bad of [
    undefined,
    null,
    5,
    true,
    {},
    [],
    ["a"],
    () => "a",
    Symbol("a"),
  ])
    assert.equal(c(bad), "", String(typeof bad));
  // The cut counts code points and never splits an emoji; trailing white space after the cut is trimmed.
  assert.equal(c("x".repeat(2500)).length, 2000);
  const emoji = c("\ud83d\ude00".repeat(2500));
  assert.equal(Array.from(emoji).length, 2000);
  assert.equal(emoji.length, 4000);
  assert.equal(c("a".repeat(1999) + " " + "b".repeat(10)), "a".repeat(1999));
  // Idempotent.
  for (const sample of [
    "a\r\nb  ",
    "\u202ex",
    "x".repeat(3000),
    "\ud83d\ude00".repeat(2100),
    "  ",
  ])
    assert.equal(c(c(sample)), c(sample));
  // Only the first 20000 UTF-16 units are read.
  assert.equal(c("\u200b".repeat(30000) + "real"), "");
  assert.equal(c("real" + "\u200b".repeat(30000)), "real");
  assert.equal(c("a".repeat(19999) + "bcd"), "a".repeat(2000));

  assert.equal(lib.countNoteChars(""), 0);
  assert.equal(lib.countNoteChars("abc"), 3);
  assert.equal(lib.countNoteChars("a\ud83d\ude00b"), 3);
  assert.equal(lib.countNoteChars("x".repeat(2500)), 2500);
  for (const bad of [undefined, null, 5, {}, []])
    assert.equal(lib.countNoteChars(bad), 0);

  const p = lib.notePreview;
  assert.equal(p(undefined), "");
  assert.equal(p("   "), "");
  assert.equal(p("a\n\n b\t\tc"), "a b c");
  assert.equal(p("x".repeat(80)), "x".repeat(80));
  assert.equal(p("x".repeat(81)), "x".repeat(80) + "...");
  assert.equal(p("\ud83d\ude00".repeat(90)), "\ud83d\ude00".repeat(80) + "...");
  assert.equal(p("a".repeat(79) + " " + "b".repeat(5)), "a".repeat(79) + "...");
  assert.equal(p("a\u202eb\u0000c"), "abc");
  assert.ok(!/[\r\n\t]/.test(p("a\r\nb\tc" + "d".repeat(200))));
});

test("seat-notes normalize: junk gives no notes, hostile and malformed entries are dropped, prototype keys never reach an object, texts are cleaned, at most 200 notes are kept (the newest) and the result survives a file round trip", () => {
  const n = lib.normalizeSeatNotes;
  const key = (i) => "c1|rig:seat-" + i;
  for (const junk of [undefined, null, 0, 7, "text", true, [], [{}], () => 1])
    assert.deepEqual(n(junk), {}, String(typeof junk));
  const good = {
    [key(1)]: { text: "one", updatedAt: 5 },
    [key(2)]: { text: "two\nlines", updatedAt: 6 },
  };
  assert.deepEqual(n(good), good);
  assert.notEqual(n(good), good, "a new object");
  assert.deepEqual(Object.keys(n(good)), [key(1), key(2)], "stored order kept");

  const bad = {
    nokey: { text: "x", updatedAt: 1 },
    "|x": { text: "x", updatedAt: 1 },
    "x|": { text: "x", updatedAt: 1 },
    "a|b": null,
    "a|c": "text",
    "a|d": [],
    "a|e": { text: 5, updatedAt: 1 },
    "a|f": { text: "  \n", updatedAt: 1 },
    "a|g": { text: "\u200b\u202e", updatedAt: 1 },
    "a|h": { text: "no time" },
    "a|i": { text: "negative", updatedAt: -5 },
    "a|j": { text: "text time", updatedAt: "7" },
    "a|k": { text: "nan", updatedAt: NaN },
    "a|l": { text: "infinite", updatedAt: Infinity },
    "a|m": { text: "fraction", updatedAt: 1.9 },
    ["a|n\u202e"]: { text: "hidden key", updatedAt: 1 },
    ["a|" + "x".repeat(199)]: { text: "long key", updatedAt: 1 },
    ["a|" + "x".repeat(198)]: { text: "longest key", updatedAt: 2 },
  };
  assert.deepEqual(n(bad), {
    "a|h": { text: "no time", updatedAt: 0 },
    "a|i": { text: "negative", updatedAt: 0 },
    "a|j": { text: "text time", updatedAt: 0 },
    "a|k": { text: "nan", updatedAt: 0 },
    "a|l": { text: "infinite", updatedAt: 0 },
    "a|m": { text: "fraction", updatedAt: 1 },
    ["a|" + "x".repeat(198)]: { text: "longest key", updatedAt: 2 },
  });
  assert.deepEqual(n({ [key(1)]: { text: "a\u202eb\r\nc  ", updatedAt: 1 } }), {
    [key(1)]: { text: "ab\nc", updatedAt: 1 },
  });
  assert.equal(
    n({ [key(1)]: { text: "y".repeat(5000), updatedAt: 1 } })[key(1)].text
      .length,
    2000,
  );

  // Keys read from a file: names that are object keys are dropped, and nothing reaches Object.prototype.
  const hostile = JSON.parse(
    '{"__proto__":{"text":"x","updatedAt":1},"constructor":{"text":"x","updatedAt":1},"prototype":{"text":"x","updatedAt":1},"toString":{"text":"x","updatedAt":1},"hasOwnProperty":{"text":"x","updatedAt":1},"c|__proto__":{"text":"ok","updatedAt":1},"c|x":{"__proto__":{"text":"p"},"text":"fine","updatedAt":2}}',
  );
  const clean = n(hostile);
  assert.deepEqual(Object.keys(clean), ["c|__proto__", "c|x"]);
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  assert.equal(
    Object.prototype.hasOwnProperty.call(clean, "c|__proto__"),
    true,
  );
  assert.equal(clean["c|x"].text, "fine");
  assert.equal({}.text, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(Object.prototype, "text"),
    false,
  );

  // At most 200 notes: the newest are kept, equal times keep the later ones, and the stored order stays.
  const many = {};
  for (let i = 0; i < 250; i++) many[key(i)] = { text: "n" + i, updatedAt: i };
  const kept = n(many);
  assert.equal(Object.keys(kept).length, 200);
  assert.deepEqual(
    Object.keys(kept),
    Array.from({ length: 200 }, (_, i) => key(i + 50)),
  );
  const equal = {};
  for (let i = 0; i < 250; i++) equal[key(i)] = { text: "n" + i, updatedAt: 1 };
  assert.deepEqual(
    Object.keys(n(equal)),
    Array.from({ length: 200 }, (_, i) => key(i + 50)),
  );
  const shuffled = {};
  for (let i = 0; i < 250; i++) {
    const j = (i * 97) % 250;
    shuffled[key(j)] = { text: "n" + j, updatedAt: j };
  }
  assert.deepEqual(
    Object.keys(n(shuffled))
      .map((k) => Number(k.split("-")[1]))
      .sort((a, b) => a - b),
    Array.from({ length: 200 }, (_, i) => i + 50),
  );
  // At most 1000 keys are read, so a hostile file cannot make a load slow.
  const flood = {};
  for (let i = 0; i < 1000; i++) flood["junk" + i] = 1;
  flood[key(1)] = { text: "after the bound", updatedAt: 1 };
  assert.deepEqual(n(flood), {});
  const edge = {};
  for (let i = 0; i < 999; i++) edge["junk" + i] = 1;
  edge[key(1)] = { text: "at the bound", updatedAt: 1 };
  assert.deepEqual(Object.keys(n(edge)), [key(1)]);

  // A file round trip changes nothing, and a second pass is a no-op.
  assert.deepEqual(n(JSON.parse(JSON.stringify(kept))), kept);
  assert.deepEqual(n(n(bad)), n(bad));
  assert.deepEqual(n(deepFreeze(JSON.parse(JSON.stringify(good)))), good);
});

test("seat-notes set: a note is set without touching its input, an empty text clears, an unchanged text changes nothing, the 201st note pushes out the one changed longest ago, and bad keys, clocks and inputs are harmless", () => {
  const { setNote, noteFor, hasNote } = lib;
  const A = "c1|rig:a";
  const B = "c1|rig:b";
  const empty = deepFreeze({});
  const one = setNote(empty, A, "hello", 1000);
  assert.deepEqual(one, { [A]: { text: "hello", updatedAt: 1000 } });
  assert.deepEqual(empty, {});
  assert.notEqual(one, empty);
  assert.equal(noteFor(one, A), "hello");
  assert.equal(hasNote(one, A), true);
  assert.equal(hasNote(one, B), false);
  assert.equal(noteFor(one, B), "");

  // The same cleaned text changes nothing, whatever the clock says.
  assert.equal(setNote(one, A, "hello", 2000), one);
  assert.equal(setNote(one, A, "hello  \r\n", 2000), one);
  // A new text replaces it, bumps the time and moves the note last.
  const two = setNote(setNote(one, B, "second", 1500), A, "changed", 3000);
  assert.deepEqual(two, {
    [B]: { text: "second", updatedAt: 1500 },
    [A]: { text: "changed", updatedAt: 3000 },
  });
  assert.deepEqual(Object.keys(two), [B, A]);
  assert.deepEqual(one, { [A]: { text: "hello", updatedAt: 1000 } });

  // An empty, blank, hidden-only or non-text value clears; clearing nothing changes nothing.
  for (const blank of ["", "   \n\t", "\u200b\u202e", null, undefined, 5, {}])
    assert.deepEqual(setNote(two, A, blank, 5), { [B]: two[B] }, String(blank));
  assert.equal(setNote(two, "c1|rig:none", "", 5), two);
  assert.deepEqual(setNote(one, A, "", 5), {});

  // Bad keys change nothing.
  for (const key of [
    "",
    "nokey",
    "a|",
    "|a",
    "x".repeat(201),
    "c|a\u202eb",
    undefined,
    null,
    5,
  ])
    assert.equal(setNote(one, key, "text", 5), one, String(key));
  assert.equal(setNote(one, "__proto__", "text", 5), one);
  // A clock that is not a finite number of at least 0 counts as 0; a fraction is cut.
  for (const now of [NaN, -1, Infinity, "5", undefined, null])
    assert.equal(setNote(empty, A, "t", now)[A].updatedAt, 0, String(now));
  assert.equal(setNote(empty, A, "t", 1.9)[A].updatedAt, 1);
  assert.equal(setNote(empty, A, "y".repeat(2500), 1)[A].text.length, 2000);
  // Notes that are not an object behave as no notes; the same value comes back when nothing changes.
  assert.deepEqual(setNote(null, A, "x", 1), {
    [A]: { text: "x", updatedAt: 1 },
  });
  assert.deepEqual(setNote("text", A, "x", 1), {
    [A]: { text: "x", updatedAt: 1 },
  });
  assert.equal(setNote(null, A, "", 1), null);
  assert.equal(setNote(undefined, A, "", 1), undefined);

  // Only a note's own entry is read, with a usable key.
  assert.equal(noteFor({}, "constructor"), "");
  assert.equal(
    noteFor(JSON.parse('{"__proto__":{"text":"x"}}'), "__proto__"),
    "",
  );
  assert.equal(noteFor({ [A]: { text: "dirty\u202e\r\n" } }, A), "dirty");
  assert.equal(noteFor({ [A]: "text" }, A), "");
  assert.equal(noteFor(null, A), "");
  assert.equal(noteFor([A], A), "");

  // 200 notes: a new key pushes out the one changed longest ago; an update at the limit pushes nothing out; the new note is never the one that goes.
  let full = {};
  for (let i = 0; i < 200; i++)
    full = setNote(full, "c1|rig:s" + i, "n" + i, 1000 + i);
  assert.equal(Object.keys(full).length, 200);
  const added = setNote(full, "c1|rig:new", "fresh", 5000);
  assert.equal(Object.keys(added).length, 200);
  assert.equal(hasNote(added, "c1|rig:s0"), false);
  assert.equal(hasNote(added, "c1|rig:s1"), true);
  assert.equal(hasNote(added, "c1|rig:new"), true);
  assert.equal(Object.keys(full).length, 200);
  assert.equal(hasNote(full, "c1|rig:s0"), true, "the input is not changed");
  const updated = setNote(full, "c1|rig:s0", "edited", 6000);
  assert.equal(Object.keys(updated).length, 200);
  assert.equal(hasNote(updated, "c1|rig:s1"), true);
  assert.equal(noteFor(updated, "c1|rig:s0"), "edited");
  const old = setNote(full, "c1|rig:older", "older clock", 0);
  assert.equal(
    hasNote(old, "c1|rig:older"),
    true,
    "the new note is kept even with an older time",
  );
  assert.equal(hasNote(old, "c1|rig:s0"), false);
  // Equal oldest times: the earlier note goes.
  let tied = {};
  for (let i = 0; i < 200; i++) tied = setNote(tied, "c1|rig:t" + i, "n", 7);
  const afterTie = setNote(tied, "c1|rig:tnew", "n", 8);
  assert.equal(hasNote(afterTie, "c1|rig:t0"), false);
  assert.equal(hasNote(afterTie, "c1|rig:t1"), true);
  // Frozen input is fine.
  assert.doesNotThrow(() => setNote(deepFreeze({ ...one }), B, "x", 1));
});

test("seat-notes tracer: a note typed in the real dialog for a seat of the real inventory is saved through the App's own handler, survives the workspace file and the real load callback, comes back in the dialog, clears, and nothing but the saved state is touched", () => {
  withoutPage(() => {
    const seat = inventory().seats[0];
    assert.equal(seat.id, "rig-1:dev-impl");
    const world = appWorld();
    const calls = [];
    const props = () => ({
      seat,
      connectionId: CONNECTION.id,
      notes: world.state.seatNotes,
      onNote: (s, text) => {
        calls.push([s, text]);
        world.onNote(s, text);
      },
    });
    const ui = dialogHarness(props());

    // Nothing is visible until it is used: a button and no dialog, the default state holds no field.
    assert.equal(world.state.seatNotes, undefined);
    assert.equal(ui.notesButton().props.className, "icon-button seat-note");
    assert.equal(ui.notesButton().props["aria-label"], "Notes for dev-impl");
    assert.equal(ui.notesButton().props.title, "Notes for dev-impl");
    assert.equal(ui.modal(), undefined);
    assert.equal(ui.textarea(), undefined);

    // Open, type, save.
    ui.notesButton().props.onClick();
    assert.equal(ui.modal().props.title, "Note for dev-impl");
    assert.equal(ui.textarea().props.value, "");
    ui.type("owns the migration\ncheck before merging  ");
    assert.equal(ui.counter().props.children, "41 / 2000 characters");
    ui.button("Save").props.onClick();
    assert.equal(ui.modal(), undefined, "the dialog closes");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], seat);
    assert.equal(calls[0][1], "owns the migration\ncheck before merging  ");
    assert.deepEqual(Object.keys(world.state.seatNotes), [K]);
    assert.equal(K, "c1|rig-1:dev-impl");
    assert.equal(
      world.state.seatNotes[K].text,
      "owns the migration\ncheck before merging",
    );
    assert.ok(Number.isInteger(world.state.seatNotes[K].updatedAt));
    assert.ok(world.state.seatNotes[K].updatedAt > 0);
    assert.equal(world.writes, 1);

    // The saved text is the same after a trip through the workspace file and the real load callback.
    const before = JSON.stringify(world.state.seatNotes);
    world.restart();
    assert.equal(JSON.stringify(world.state.seatNotes), before);
    ui.setProps(props());
    assert.equal(
      ui.notesButton().props.className,
      "icon-button seat-note has-note",
    );
    assert.equal(
      ui.notesButton().props["aria-label"],
      "Notes for dev-impl (has a note)",
    );
    assert.equal(
      ui.notesButton().props.title,
      "Notes for dev-impl: owns the migration check before merging",
    );
    ui.notesButton().props.onClick();
    assert.equal(
      ui.textarea().props.value,
      "owns the migration\ncheck before merging",
    );
    // Cancel throws the draft away: the saved note stays and the dialog opens on it again.
    ui.type("an unsaved draft");
    ui.button("Cancel").props.onClick();
    assert.equal(ui.modal(), undefined);
    assert.equal(JSON.stringify(world.state.seatNotes), before);
    ui.notesButton().props.onClick();
    assert.equal(
      ui.textarea().props.value,
      "owns the migration\ncheck before merging",
    );
    // Saving the same text writes nothing at all.
    const writes = world.writes;
    ui.button("Save").props.onClick();
    assert.equal(world.writes, writes);

    // A hostile saved file never throws: bad entries are dropped on load, the good one stays.
    world.restart((saved) => ({
      ...saved,
      seatNotes: JSON.parse(
        '{"__proto__":{"text":"x","updatedAt":1},"nokey":5,"c1|rig-1:dev-impl":{"text":"kept\\u202e","updatedAt":"x"},"c1|rig-1:dev-qa":null}',
      ),
    }));
    assert.deepEqual(world.state.seatNotes, {
      [K]: { text: "kept", updatedAt: 0 },
    });
    world.restart((saved) => ({ ...saved, seatNotes: "not an object" }));
    assert.deepEqual(world.state.seatNotes, {});

    // Clear removes the saved note and the accent state.
    world.restart(() => ({
      ...world.state,
      seatNotes: { [K]: { text: "to clear", updatedAt: 5 } },
    }));
    ui.setProps(props());
    assert.equal(
      ui.notesButton().props.className,
      "icon-button seat-note has-note",
    );
    ui.notesButton().props.onClick();
    assert.equal(ui.button("Clear").props.disabled, false);
    ui.button("Clear").props.onClick();
    assert.deepEqual(world.state.seatNotes, {});
    ui.setProps(props());
    assert.equal(ui.notesButton().props.className, "icon-button seat-note");
    // Another seat of the same rig has its own note.
    const other = inventory().seats[1];
    world.onNote(other, "qa note");
    assert.deepEqual(Object.keys(world.state.seatNotes), ["c1|rig-1:dev-qa"]);
  });
});

test("seat-notes dialog: the dialog says where the note lives, counts code points, warns past 2000, keeps edits to itself until Save, renders the note only as text, and a seat without a usable key or notes of any shape are harmless", () => {
  const seat = inventory().seats[0];
  const props = (over = {}) => ({
    seat,
    connectionId: "c1",
    notes: undefined,
    onNote: () => {},
    ...over,
  });
  const ui = dialogHarness(props());
  ui.notesButton().props.onClick();
  const modal = ui.modal();
  assert.equal(modal.props.title, "Note for dev-impl");
  assert.ok(
    modal.props.subtitle.includes(
      "Saved on this computer only. Do not store secrets here.",
    ),
  );
  assert.ok(modal.props.subtitle.includes("never sent to the seat"));
  assert.equal(typeof modal.props.onClose, "function");
  const area = ui.textarea();
  assert.equal(area.props["aria-label"], "Seat note");
  assert.equal(area.props["aria-describedby"], "seat-note-count");
  assert.equal(area.props.rows, 8);
  assert.equal(area.props.maxLength, undefined);
  assert.equal(ui.counter().props.className, "field-note");
  assert.equal(ui.counter().props.children, "0 / 2000 characters");
  assert.equal(ui.button("Clear").props.disabled, true);
  assert.equal(ui.button("Save").props.className, "primary-button");
  assert.equal(ui.button("Cancel").props.className, "secondary-button");
  assert.equal(ui.button("Clear").props.className, "secondary-button");
  ui.type("a\ud83d\ude00b");
  assert.equal(ui.counter().props.children, "3 / 2000 characters");
  ui.type("x".repeat(2001));
  assert.equal(
    ui.counter().props.children,
    "2001 / 2000 characters. Only the first 2000 are kept.",
  );
  // The dialog's own close (Escape, a click outside) throws the draft away and calls nothing.
  const calls = [];
  const closing = dialogHarness(
    props({ onNote: (...args) => calls.push(args) }),
  );
  closing.notesButton().props.onClick();
  closing.type("draft");
  closing.modal().props.onClose();
  assert.equal(closing.modal(), undefined);
  assert.deepEqual(calls, []);
  // Save sends exactly the typed text; the App's setNote cleans it.
  closing.notesButton().props.onClick();
  closing.type("  \u202eraw  ");
  closing.button("Save").props.onClick();
  assert.deepEqual(calls, [[seat, "  \u202eraw  "]]);

  // The note is drawn as the textarea's value and the button's title only, never as markup.
  const mark = "UNIQUE-NOTE-MARK";
  const notes = { "c1|rig-1:dev-impl": { text: mark, updatedAt: 1 } };
  const withNote = dialogHarness(props({ notes }));
  assert.equal(count(withNote.json(), mark), 1);
  withNote.notesButton().props.onClick();
  assert.equal(count(withNote.json(), mark), 2);
  assert.equal(withNote.textarea().props.value, mark);
  assert.equal(withNote.button("Clear").props.disabled, false);
  assert.ok(!/dangerouslySetInnerHTML/.test(withNote.json()));
  // The tooltip is one short line.
  const long = dialogHarness(
    props({
      notes: {
        "c1|rig-1:dev-impl": {
          text: "line one\nline two " + "z".repeat(200),
          updatedAt: 1,
        },
      },
    }),
  );
  const title = long.notesButton().props.title;
  assert.ok(title.startsWith("Notes for dev-impl: line one line two "));
  assert.ok(title.endsWith("..."));
  assert.ok(!/[\r\n]/.test(title));
  assert.ok(title.length <= "Notes for dev-impl: ".length + 83);

  // A seat that has no usable key gets no button: hidden characters, a bar in the connection id, an empty id.
  for (const over of [
    { seat: { ...seat, id: "rig:bad\u202eid" } },
    { seat: { ...seat, id: "" } },
    { connectionId: "a|b" },
    { connectionId: "" },
  ])
    assert.equal(dialogHarness(props(over)).tree(), null);
  // Notes of any shape render without a throw and show no note.
  const shapes = [
    null,
    "text",
    5,
    [],
    {},
    { "c1|rig-1:dev-impl": null },
    { "c1|rig-1:dev-impl": { text: 5 } },
    JSON.parse('{"__proto__":{"text":"x"}}'),
    { "c1|rig-1:dev-impl": { text: "\u200b" } },
  ];
  for (const odd of shapes) {
    const h = dialogHarness(props({ notes: odd }));
    assert.equal(h.notesButton().props.className, "icon-button seat-note");
  }
});

test("seat-notes wiring: the module is pure and documented, the dialog has five imports and no page, bridge, network, storage or markup, the state field, the load line, the handler and the sidebar props are exactly these, and nothing about notes reaches the main process, the settings, the drafts or the mobile gateway", () => {
  const source = read("src/seat-notes.ts");
  const code = stripComments(source);
  assert.ok(!/[^\t\n -~]/.test(source), "plain ASCII");
  assert.ok(!/^import /m.test(code), "no import");
  assert.ok(
    !/\b(window|document|fetch|localStorage|sessionStorage|navigator|clipboard|setTimeout|setInterval|require|process|console)\b|Date\.now|new Date|Math\.random|innerHTML/.test(
      code,
    ),
    "no page, clock or randomness",
  );
  const lines = source.split("\n");
  const exported = lines.filter((line) => line.startsWith("export "));
  assert.equal(exported.length, 13);
  lines.forEach((line, i) => {
    if (line.startsWith("export "))
      assert.ok(
        lines[i - 1].startsWith("/** ") && lines[i - 1].endsWith(" */"),
        "a doc comment above: " + line,
      );
  });

  const dialog = read("src/SeatNotes.tsx");
  const dialogCode = stripComments(dialog);
  assert.ok(!/[^\t\n -~]/.test(dialog), "plain ASCII");
  assert.equal((dialogCode.match(/^import /gm) || []).length, 5);
  for (const line of [
    'import { useState } from "react";',
    'import { StickyNote } from "lucide-react";',
    'import { Modal } from "./components";',
    'from "./seat-notes";',
    'import type { Seat } from "./types";',
  ])
    assert.equal(count(dialogCode, line), 1, line);
  assert.ok(
    !/\b(window|document|hrig|fetch|localStorage|sessionStorage|navigator|clipboard|console|XMLHttpRequest|WebSocket|setTimeout|setInterval|log)\b|innerHTML|dangerouslySetInnerHTML|href=|style=/.test(
      dialogCode,
    ),
    "no page, bridge, network, storage or markup",
  );
  assert.equal(count(dialogCode, "onNote("), 2);

  // Who knows the module and the dialog.
  const names = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(
    names
      .filter((name) => name !== "seat-notes.ts")
      .filter((name) => /\.\/seat-notes"/.test(read("src/" + name)))
      .sort(),
    ["App.tsx", "SeatNotes.tsx", "Sidebar.tsx", "types.ts"],
  );
  assert.deepEqual(
    names.filter((name) => /\.\/SeatNotes"/.test(read("src/" + name))).sort(),
    ["Sidebar.tsx"],
  );

  // The saved state: one optional field next to the other saved data, normalized on load, written through setState.
  const types = collapse(stripComments(read("src/types.ts")));
  assert.equal(
    count(types, 'seatNotes?: import("./seat-notes").SeatNotes;'),
    1,
  );
  assert.equal(count(types, 'hostTints?: import("./host-tint").HostTints;'), 1);
  assert.equal(
    count(types, 'reviewChecks?: import("./review-checks").ReviewChecks;'),
    1,
  );
  const app = collapse(appSource);
  assert.equal(
    count(
      app,
      'import { noteKey, normalizeSeatNotes, setNote } from "./seat-notes";',
    ),
    1,
  );
  assert.ok(
    app.includes(
      '? { "notifications.desktop": true } : {}), seatNotes: normalizeSeatNotes(base.seatNotes), });',
    ),
    "normalized on load",
  );
  assert.ok(
    app.includes(
      "fileRevision={fileRevision} notes={state.seatNotes} onNote={(seat, text) => { const now = Date.now(); setState((s) => { const current = normalizeSeatNotes(s.seatNotes); const next = setNote( current, noteKey(connection.id, seat.id), text, now, ); return next === current ? s : { ...s, seatNotes: next }; }); }} />",
    ),
    "written through setState, an unchanged note writes nothing",
  );
  assert.equal(count(app, "seatNotes"), 5);
  assert.equal(count(app, "normalizeSeatNotes("), 2);
  assert.equal(count(handlerCut.body, "window"), 0);
  assert.equal(count(handlerCut.body, "hrig"), 0);
  assert.ok(
    !/log\([^)]*[Nn]ote/.test(appSource),
    "no note text goes to the log",
  );
  // The two places the load callback is run from still pin the old lines in front of the new one.
  assert.ok(
    app.includes(
      "projectHistory: normalizeHistory(base.projectHistory), reviewChecks: normalizeReviewChecks(base.reviewChecks), connections,",
    ),
  );

  // The sidebar: two imports, two optional props, the button behind the handler, the old row buttons as before.
  const sidebar = collapse(stripComments(read("src/Sidebar.tsx")));
  assert.equal(count(sidebar, 'import SeatNote from "./SeatNotes";'), 1);
  assert.equal(
    count(sidebar, 'import type { SeatNotes } from "./seat-notes";'),
    1,
  );
  assert.ok(sidebar.includes("fileRevision, notes, onNote, }: {"));
  assert.ok(
    sidebar.includes(
      "notes?: SeatNotes; onNote?: (seat: Seat, text: string) => void; }) {",
    ),
  );
  assert.equal(
    count(
      sidebar,
      "{onNote && ( <SeatNote seat={s} connectionId={connection.id} notes={notes} onNote={onNote} /> )} </div>",
    ),
    1,
  );
  assert.equal(count(sidebar, "<SeatNote "), 1);
  for (const part of [
    "onDragStart={(event) => onDrag(event, s)}",
    "onClick={() => onSeat(s)}",
    "onClick={() => onRelaunch(s)}",
    "onClick={() => onSeatBeside(s)}",
  ])
    assert.equal(count(sidebar, part), 1, part);

  // Nothing about notes reaches the main process, the settings, the drafts, the settings export or the mobile gateway.
  for (const name of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs)$/.test(name))
      assert.ok(
        !/seatNotes|seat-notes|SeatNotes/.test(read("electron/" + name)),
        "main process: " + name,
      );
  for (const file of [
    "src/settings.ts",
    "src/SettingsPage.tsx",
    "src/settings-overrides.ts",
    "src/drafts.ts",
    "src/snippet-io.ts",
    "src/task-export.ts",
    "SETTINGS.md",
  ])
    assert.ok(
      !/seatNotes|seat-notes|SeatNotes/.test(read(file)),
      "not in " + file,
    );
});

test("seat-notes style: three rules sit directly after the session row hover rule, hide the notes button until its row is pointed at or focused, tint a seat that has a note with a color the stylesheet already uses for text, add no new color, and nothing is appended at the end", () => {
  const css = read("src/styles.css");
  const anchor =
    ".session-row:hover > .icon-button, .session-row:focus-within > .icon-button { color: var(--color-c8cfdd); }\n";
  const block =
    ".session-row > .seat-note { opacity: 0; }\n" +
    ".session-row:hover > .seat-note, .session-row:focus-within > .seat-note, .session-row > .seat-note.has-note { opacity: 1; }\n" +
    ".session-row > .seat-note.has-note { color: var(--color-a0e3c2); }\n";
  assert.equal(count(css, anchor + block + ".relaunch-target {"), 1);
  assert.equal(count(css, ".seat-note"), 5);
  assert.equal(count(css, "has-note"), 2);
  // The new rules use no hex color, no other token, no important flag and no theme selector.
  assert.ok(!/#[0-9a-f]{3,8}|rgb|!important|data-theme|:root/i.test(block));
  assert.deepEqual(
    [...block.matchAll(/var\(--[a-z0-9-]+\)/g)].map((m) => m[0]),
    ["var(--color-a0e3c2)"],
  );
  // That token is already drawn as text elsewhere, so High Contrast already measures it as text.
  assert.ok(count(css, "color: var(--color-a0e3c2)") >= 2);
  // The old rules are as they were and the old last rule is still last.
  assert.equal(
    count(
      css,
      ".session-row > .icon-button { flex-shrink: 0; color: var(--color-707b8e); }\n",
    ),
    1,
  );
  assert.ok(
    css
      .trimEnd()
      .endsWith(
        ".terminal-size.terminal-output-counter {\n  left: 12px;\n  transform: none;\n  animation: none;\n}",
      ),
  );
  // Only the dialog component uses the two class names.
  for (const name of fs.readdirSync(path.join(root, "src")))
    if (/\.tsx$/.test(name) && name !== "SeatNotes.tsx")
      assert.ok(!/seat-note(?!s)|has-note/.test(read("src/" + name)), name);
  assert.equal(
    count(
      read("src/SeatNotes.tsx"),
      '"icon-button seat-note" + (saved ? " has-note" : "")',
    ),
    1,
  );
});

test("seat-notes docs: README and PRIVACY.md say the note is private, kept only in the workspace file on this computer as plain text, never sent anywhere and kept until cleared, and every older docs pin is intact", () => {
  const readme = read("README.md");
  for (const part of [
    "3. Existing rigs and seats appear in the sidebar.",
    "Each session row also has a Notes button, shown when you point at the row or focus it and always on a seat that has a note, for a private note of up to 2000 characters about that seat.",
    "A note is kept only in HRig's workspace file on this computer, as plain text (keep secrets out of it);",
    "it is never sent to the seat, a terminal, the task queue or another machine, and it stays until you clear it. HRig keeps at most 200 notes and drops the oldest first, and a note belongs to one seat on one connection, so recreating a rig or renaming a seat leaves its old note behind.",
    "panel layouts, seat metadata and any private seat notes you write (plain text, so keep secrets out of them), not passwords or terminal transcripts.",
  ])
    assert.equal(count(readme, part), 1, part);
  assert.equal(
    count(readme, "TASKS.md"),
    1,
    "README keeps its single link to TASKS.md",
  );

  const privacy = read("PRIVACY.md");
  assert.ok(
    privacy.includes(
      "workspace layouts, per-file review checks, drafts/recovery copies, private seat notes, integration configuration,",
    ),
  );
  assert.equal(count(privacy, "private seat notes"), 1);
  assert.equal(count(privacy, "review checks"), 1);
  assert.equal(
    count(
      privacy,
      "Private seat notes are plain text in the workspace file, are not encrypted and are never sent to a seat, a host or the settings export; clear a note from its dialog to remove it.",
    ),
    1,
  );
  assert.ok(!privacy.startsWith(char(0xfeff)), "no byte order mark");
  assert.ok(
    privacy.endsWith("\n") && !privacy.endsWith("\n\n"),
    "one final line feed",
  );
  assert.ok(!privacy.includes("\r"), "no carriage return");
  const lines = privacy.split("\n");
  assert.equal(
    lines[lines.indexOf("## Snippet export and import") + 4],
    undefined,
    "still the last section",
  );
});
