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
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};
const char = (code) => String.fromCodePoint(code);

// The virtualized list of the long-list chain, drawn here as every row at once: these tests are about the board's
// own behavior (keys, filters, exports), and the list's windowing has its own tests.
function inlineList(props) {
  return { type: "div", props: { className: props.className, children: props.rows.map((row, i) => props.renderRow(row, i)) } };
}
inlineList.inline = true;

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
const lib = load("src/task-draft.ts");

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx over a very small react: state slots, effects queued and run after the render the way react runs
// them, elements recorded as plain objects. The window is a fake that records every bridge call and also carries the
// events, so the real module and the real board can be joined the way the app joins them.

const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [
  { name: "dev-a", rigName: "hrig" },
  { name: "dev-b", rigName: "hrig" },
];
const ROWS = [
  { id: "q1", status: "pending", title: "Task q1", destination: "dev-a@hrig" },
];

function boardHarness({ seats = SEATS, rows = ROWS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  const listeners = {};
  let pending = [];
  let cursor = 0;
  let tree = null;
  const calls = { queue: [], rigAction: [], sendMessage: [], taken: 0 };
  const before = {
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const win = {
    hrig: {
      queue: (connection, rigName) => {
        calls.queue.push([connection, rigName]);
        return Promise.resolve(rows);
      },
      rigAction: (...args) => {
        calls.rigAction.push(args);
        return Promise.resolve({});
      },
      sendMessage: (...args) => {
        calls.sendMessage.push(args);
        return Promise.resolve("");
      },
    },
    addEventListener(name, f) {
      (listeners[name] ||= []).push(f);
    },
    removeEventListener(name, f) {
      listeners[name] = (listeners[name] || []).filter((g) => g !== f);
    },
    dispatchEvent(event) {
      for (const f of (listeners[event.type] || []).slice()) f(event);
      return true;
    },
  };
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
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (
        !old ||
        list.length !== old.length ||
        list.some((d, k) => d !== old[k])
      ) {
        deps[i] = list;
        pending.push(() => {
          if (cleanups[i]) cleanups[i]();
          cleanups[i] = fn();
        });
      }
    },
  };
  const jsx = (type, props, key) =>
    typeof type === "function" && type.inline ? type(props) : { type, props, key };
  const Board = load("src/TaskBoard.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
      Download: "Download",
    },
    "./VirtualList": { VirtualList: inlineList },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const props = {
    connection: CONNECTION,
    rigName: undefined,
    seats,
    onSeat: () => {},
    draft: null,
    // What the app does: the draft is cleared as soon as the board has taken it.
    onDraftTaken: () => {
      calls.taken++;
      props.draft = null;
      render();
    },
  };
  function render() {
    globalThis.window = win;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    cursor = 0;
    tree = Board(props);
    const run = pending;
    pending = [];
    run.forEach((fn) => fn());
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
  const harness = {
    calls,
    win,
    props,
    all: () => all(tree),
    text,
    modal: () => all(tree).find((n) => n.type === "Modal"),
    byLabel: (label) =>
      all(tree).find((n) => n.props && n.props["aria-label"] === label),
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n) === name),
    notes: () =>
      all(tree)
        .filter((n) => n.type === "p" && n.props.className === "field-note")
        .map(text),
    errors: () => all(tree).filter((n) => n.type === "ErrorBox"),
    options: (label) =>
      all(harness.byLabel(label))
        .filter((n) => n.type === "option")
        .map((n) => (n.props.value !== undefined ? n.props.value : text(n))),
    /** What the app does when a terminal announces a draft: hand it to the board as a prop. */
    give(draft) {
      props.draft = draft;
      render();
    },
    type(label, value) {
      harness.byLabel(label).props.onChange({ target: { value } });
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
  return harness;
}

// ---------------------------------------------------------------------------
// The real TerminalTools.tsx over a small hook runtime (state, refs, effects) with a fake terminal, window and search addon,
// so the real right-click menu and the real request effect run as written.

const flatten = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    flatten(node.props && node.props.children, out);
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
const TOOLS_EXTERNAL = [
  "react",
  "react/jsx-runtime",
  "lucide-react",
  "./SettingsContext",
  "./components",
  "@xterm/addon-search",
];
let toolsText;
function mountTools(selection) {
  toolsText ??= bundle("src/TerminalTools.tsx", TOOLS_EXTERNAL);
  const events = [];
  const touched = { pasted: [], written: [], clipboard: [] };
  const listeners = {};
  const view = { selection };
  const term = {
    loadAddon() {},
    attachCustomKeyEventHandler() {},
    hasSelection: () => view.selection !== "",
    getSelection: () => view.selection,
    onSelectionChange: () => ({ dispose() {} }),
    element: {
      parentElement: {
        addEventListener(name, f) {
          listeners[name] = f;
        },
        removeEventListener(name) {
          delete listeners[name];
        },
      },
    },
    buffer: { active: { viewportY: 0 } },
    scrollToLine() {},
    focus() {},
    clear() {},
    paste(text) {
      touched.pasted.push(text);
    },
    selectAll() {},
  };
  const slots = [];
  const effectSlots = [];
  const pending = [];
  let hook = 0;
  let tree = null;
  let render = () => {};
  const react = {
    useState: (initial) => {
      const i = hook++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (next) => {
          const value = typeof next === "function" ? next(slots[i]) : next;
          if (Object.is(value, slots[i])) return;
          slots[i] = value;
          render();
        },
      ];
    },
    useRef: (initial) => {
      const i = hook++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect: (fn, deps) => {
      const i = hook++;
      const previous = effectSlots[i];
      const changed =
        !previous ||
        !deps ||
        deps.some((d, k) => !Object.is(d, previous.deps[k]));
      if (!changed) return;
      effectSlots[i] = { deps, cleanup: previous && previous.cleanup };
      pending.push(() => {
        if (effectSlots[i].cleanup) effectSlots[i].cleanup();
        const cleanup = fn();
        effectSlots[i].cleanup =
          typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  };
  const effective = {
    "terminal.copyOnSelect": false,
    "terminal.confirmMultilinePaste": false,
    "terminal.copyTrimTrailingWhitespace": false,
  };
  const element = (type, props) => ({ type, props });
  const lucide = new Proxy({}, { get: (_, name) => String(name) });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      innerWidth: 1000,
      innerHeight: 800,
      hrig: {
        platform: "linux",
        clipboardHasImage: async () => false,
        readClipboardText: async () => "",
        exportTerminal: async () => ({ saved: false }),
        writeTerminal: (...args) => touched.written.push(args),
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent(event) {
        events.push(event);
        return true;
      },
    },
  });
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  };
  try {
    const mod = new Module(path.join(root, "src/TerminalTools.tsx"), module);
    mod.require = (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx: element, jsxs: element, Fragment: "fragment" };
      if (name === "lucide-react") return lucide;
      if (name === "./SettingsContext")
        return { useSettings: () => ({ effective }) };
      if (name === "./components") return { IconButton: "IconButton" };
      if (name === "@xterm/addon-search")
        return {
          SearchAddon: class {
            onDidChangeResults() {
              return { dispose() {} };
            }
            dispose() {}
          },
        };
      return {};
    };
    mod._compile(toolsText, path.join(root, "src/TerminalTools.tsx"));
    const Tools = mod.exports.default;
    let props = {
      terminal: { current: term },
      terminalId: "t-77",
      generation: 1,
    };
    render = () => {
      hook = 0;
      tree = Tools(props);
      while (pending.length) pending.shift()();
    };
    render();
    return {
      events,
      touched,
      view,
      restore,
      /** The command center's Create task from selection: TerminalPanel counts one more request. */
      ask() {
        props = { ...props, taskRequest: (props.taskRequest || 0) + 1 };
        render();
      },
      openMenu(y = 20) {
        listeners.contextmenu({ preventDefault() {}, clientX: 10, clientY: y });
      },
      items() {
        return flatten(tree)
          .filter((n) => n.type === "button" && n.props.role === "menuitem")
          .map((n) => ({
            label: textOf(n),
            disabled: !!n.props.disabled,
            click: n.props.onClick,
          }));
      },
      notice() {
        const el = flatten(tree).find(
          (n) => n.props && n.props.className === "terminal-tool-notice",
        );
        return el ? textOf(el.props.children[0]) : "";
      },
      menuStyle() {
        const el = flatten(tree).find(
          (n) => n.props && n.props.role === "menu",
        );
        return el && el.props.style;
      },
    };
  } catch (e) {
    restore();
    throw e;
  }
}

const SELECTION =
  "  npm test\nFAIL tests/a.test.cjs\n  expected 1 to equal 2\n\n";
const BODY = "npm test\nFAIL tests/a.test.cjs\n  expected 1 to equal 2";

test("task-draft tracer: a selection announced from a terminal fills the real Assign work dialog on the real board with no owner chosen, and nothing is created until Create assigned task is pressed", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    assert.equal(board.calls.queue.length, 1);
    assert.equal(
      board.modal(),
      undefined,
      "no dialog before anything is asked",
    );

    // The terminal asks; the app, here a stand-in, hands the draft to the board together with the seat of that terminal.
    const stop = lib.onTaskDraft((id, draft) =>
      board.give({ ...draft, suggested: id === "t-1" ? "dev-a@hrig" : "" }),
    );
    assert.equal(lib.requestTaskDraft("t-1", SELECTION), "");
    stop();
    assert.equal(board.calls.taken, 1, "the board took the draft once");
    assert.equal(board.props.draft, null);

    // The existing dialog, filled in, with the owner empty and the create button still disabled.
    const modal = board.modal();
    assert.equal(modal.props.title, "Assign work to a seat");
    assert.equal(board.byLabel("Task subject").props.value, "npm test");
    assert.equal(board.byLabel("Task brief").props.value, BODY);
    assert.equal(board.byLabel("Task destination").props.value, "");
    assert.deepEqual(board.options("Task destination"), [
      "",
      "dev-a@hrig",
      "dev-b@hrig",
    ]);
    assert.equal(board.button("Create assigned task").props.disabled, true);
    const notes = board.notes();
    assert.ok(
      notes.some((n) => n.startsWith("Prepared from a terminal selection.")),
    );
    assert.ok(notes.some((n) => n.includes(lib.SECRETS_WARNING)));
    assert.ok(notes.some((n) => n.includes("terminal of dev-a@hrig")));
    assert.deepEqual(board.calls.rigAction, [], "opening creates nothing");
    assert.deepEqual(board.calls.sendMessage, []);
    await board.flush();
    assert.equal(board.calls.queue.length, 1, "opening reads nothing more");

    // The person picks an owner (not the suggested one) and presses the dialog's own button: one create, with the reviewed text.
    board.type("Task destination", "dev-b@hrig");
    assert.equal(board.button("Create assigned task").props.disabled, false);
    assert.deepEqual(
      board.calls.rigAction,
      [],
      "choosing an owner creates nothing",
    );
    board.button("Create assigned task").props.onClick();
    await board.flush();
    assert.deepEqual(board.calls.rigAction, [
      [
        CONNECTION,
        {
          op: "taskCreate",
          id: undefined,
          title: "npm test",
          destination: "dev-b@hrig",
          body: BODY,
        },
      ],
    ]);
    assert.deepEqual(board.calls.sendMessage, []);
    assert.equal(board.modal(), undefined, "the dialog closed after creating");
    assert.equal(board.calls.queue.length, 2, "one refresh after creating");

    // A selection that cannot become a task is explained and changes nothing.
    assert.equal(
      lib.requestTaskDraft("t-1", "   "),
      "The selection holds only blank or invisible characters. Nothing was prepared.",
    );
    assert.equal(board.modal(), undefined);
    assert.equal(board.calls.rigAction.length, 1);
  } finally {
    board.unmount();
  }
});

test("task-draft draft: the selection is trimmed, cleaned of hidden characters and terminal escapes, cut to 120 characters for the subject and 8,000 for the brief, and a selection with no text is refused", () => {
  const { draftFromSelection, MAX_SUBJECT, MAX_BODY, MAX_READ } = lib;
  assert.equal(MAX_SUBJECT, 120);
  assert.equal(MAX_BODY, 8000);
  assert.equal(MAX_READ, 100000);
  const ok = (selection, opts) => {
    const draft = draftFromSelection(selection, opts);
    assert.equal(draft.ok, true, JSON.stringify(draft).slice(0, 200));
    return draft;
  };

  // Shape and trimming.
  assert.deepEqual(ok("  fix the build  "), {
    ok: true,
    subject: "fix the build",
    body: "fix the build",
    truncated: false,
    secretLike: false,
    suggested: "",
  });
  // The subject is the first line with text, its runs of spaces and tabs made one space; the brief is everything.
  const several = ok("\n\n   first line\t with  gaps \nsecond");
  assert.equal(several.subject, "first line with gaps");
  assert.equal(several.body, "first line\t with  gaps \nsecond");

  // The subject: 120 characters stay, 121 are cut to 117 and three dots; the brief keeps all of it.
  const exact = ok("a".repeat(120));
  assert.equal(exact.subject, "a".repeat(120));
  const cut = ok("a".repeat(121));
  assert.equal(cut.subject, "a".repeat(117) + "...");
  assert.equal(cut.body, "a".repeat(121));
  assert.equal(
    cut.truncated,
    false,
    "a cut subject loses nothing: the brief has it all",
  );
  assert.equal(
    ok("a".repeat(116) + " " + "b".repeat(30)).subject,
    "a".repeat(116) + "...",
    "a space just before the cut does not stay in front of the dots",
  );
  const emoji = char(0x1f600);
  const wide = ok("x".repeat(116) + emoji.repeat(10)).subject;
  assert.equal(Array.from(wide).length, 120);
  assert.ok(wide.isWellFormed(), "a character is never split");
  assert.equal(wide, "x".repeat(116) + emoji + "...");

  // The brief: 8,000 stay, one more is cut and says so, by characters and never through a pair.
  const full = ok("a".repeat(MAX_BODY));
  assert.equal(full.body.length, MAX_BODY);
  assert.equal(full.truncated, false);
  const over = ok("a".repeat(MAX_BODY + 1));
  assert.equal(over.body, "a".repeat(MAX_BODY));
  assert.equal(over.truncated, true);
  assert.equal(
    ok("a".repeat(MAX_BODY - 1) + " b").body,
    "a".repeat(MAX_BODY - 1),
    "the edge of a cut brief is trimmed",
  );
  const pair = ok("a".repeat(MAX_BODY - 1) + emoji + "z");
  assert.equal(Array.from(pair.body).length, MAX_BODY);
  assert.ok(pair.body.isWellFormed());
  assert.equal(pair.truncated, true);

  // A huge selection is read only up to MAX_READ characters: a password just past the bound is not seen, one before it is.
  const filler = "x ".repeat(MAX_READ / 2);
  const huge = ok(filler + "password=hunter2secret");
  assert.equal(huge.truncated, true);
  assert.equal(huge.secretLike, false);
  assert.equal(ok("password=hunter2secret " + filler).secretLike, true);
  assert.equal(ok("y".repeat(3000000)).body.length, MAX_BODY);

  // Hidden characters are dropped wherever they are, and so are lone surrogates.
  for (const code of [
    0x00, 0x01, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x7f, 0x80, 0x9f, 0xad,
    0x61c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e,
    0x2060, 0x2066, 0x2069, 0xfeff, 0xe0001, 0xe007f,
  ])
    assert.equal(ok("ab" + char(code) + "cd").body, "abcd", code.toString(16));
  assert.equal(ok("ab" + String.fromCharCode(0xd800) + "cd").body, "abcd");
  assert.equal(ok("ab" + String.fromCharCode(0xdc00) + "cd").body, "abcd");
  // A tab and a line feed are the only controls a brief keeps; every kind of line break becomes a line feed.
  assert.equal(ok("a\tb\nc").body, "a\tb\nc");
  assert.equal(
    ok("a\r\nb\rc" + char(0x2028) + "d" + char(0x2029) + "e" + char(0x85) + "f")
      .body,
    "a\nb\nc\nd\ne\nf",
  );
  // Terminal escape sequences go whole, not letter by letter.
  assert.equal(
    ok(
      char(27) +
        "[31mred" +
        char(27) +
        "[0m text " +
        char(27) +
        "]0;title" +
        char(7) +
        "done " +
        char(27) +
        "]8;;http://x" +
        char(27) +
        "\\link",
    ).body,
    "red text done link",
  );
  // Text in any script stays as it is.
  const words =
    "Za" +
    char(0x17c) +
    char(0xf3) +
    char(0x142) +
    char(0x107) +
    " " +
    char(0x65e5) +
    char(0x672c) +
    " " +
    emoji;
  assert.equal(ok(words).body, words);
  // Cleaning is stable: the cleaned brief cleans to itself.
  for (const text of [several.body, pair.body, words, "a\tb\nc"])
    assert.equal(ok(text).body, text);

  // Nothing to prepare.
  for (const nothing of [undefined, null, 5, {}, [], ""])
    assert.deepEqual(draftFromSelection(nothing), {
      ok: false,
      error: "Select some terminal text first.",
    });
  for (const blank of [
    "   \n\t ",
    char(0x200b).repeat(3),
    char(27) + "[0m",
    char(0xfeff) + " " + char(0x202e),
  ])
    assert.deepEqual(draftFromSelection(blank), {
      ok: false,
      error:
        "The selection holds only blank or invisible characters. Nothing was prepared.",
    });

  // The suggested seat is kept as cleaned text, never longer than 200 characters, and anything else is empty.
  assert.equal(ok("x", { suggested: "dev-a@hrig" }).suggested, "dev-a@hrig");
  assert.equal(
    ok("x", { suggested: " dev" + char(0x202e) + "-a@hrig\n" }).suggested,
    "dev-a@hrig",
  );
  assert.equal(ok("x", { suggested: "s".repeat(300) }).suggested.length, 200);
  for (const opts of [
    undefined,
    null,
    [],
    {},
    { suggested: 5 },
    { suggested: null },
  ])
    assert.equal(ok("x", opts).suggested, "");
  // The options are only read.
  const frozen = Object.freeze({ suggested: "dev-a@hrig" });
  assert.equal(ok("x", frozen).suggested, "dev-a@hrig");
  assert.deepEqual(frozen, { suggested: "dev-a@hrig" });
});

test("task-draft secret: a private key block is refused without repeating it, a token, a password or a long mixed run is only a warning, and the note says so", () => {
  const { draftFromSelection, reviewNote, SECRETS_WARNING, MAX_BODY } = lib;
  const dash = "-----";
  // Every private key header is refused, with the reason and not the key.
  for (const kind of [
    "RSA PRIVATE KEY",
    "EC PRIVATE KEY",
    "DSA PRIVATE KEY",
    "OPENSSH PRIVATE KEY",
    "PRIVATE KEY",
    "ENCRYPTED PRIVATE KEY",
    "PGP PRIVATE KEY BLOCK",
  ]) {
    const key =
      "ssh to host\n" +
      dash +
      "BEGIN " +
      kind +
      dash +
      "\nMIIEvQIBADANBgkq\n" +
      dash +
      "END " +
      kind +
      dash;
    const refused = draftFromSelection(key);
    assert.equal(refused.ok, false, kind);
    assert.ok(refused.error.includes("private key"), kind);
    assert.ok(
      !refused.error.includes("MIIEvQ") &&
        !refused.error.includes("ssh to host"),
    );
  }
  // A header split by an invisible character is the same header once the character is gone.
  assert.equal(
    draftFromSelection(
      dash + "BEGIN RSA PRIV" + char(0x200b) + "ATE KEY" + dash,
    ).ok,
    false,
  );
  // Public material is not a private key.
  for (const kind of ["PUBLIC KEY", "CERTIFICATE", "RSA PUBLIC KEY"])
    assert.equal(
      draftFromSelection(dash + "BEGIN " + kind + dash + "\nAAAA").ok,
      true,
      kind,
    );

  // A warning only: the selection is still prepared, and the text is shown as it is, never redacted.
  const mixed = "aB3".repeat(14);
  for (const secret of [
    "sk-" + "a1B2c3D4e5F6g7H8i9",
    "ghp_" + "a".repeat(36),
    "github_pat_" + "a1".repeat(15),
    "xoxb-1234567890-abcdefghij",
    "AKIA" + "ABCDEFGHIJKLMNOP",
    "AIza" + "x".repeat(35),
    "npm_" + "a".repeat(36),
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9",
    "password=hunter2secret",
    "TOKEN: abcdef123",
    "api_key = 'abcdef123456'",
    "Authorization: Bearer abc123def456",
    mixed,
  ]) {
    const draft = draftFromSelection("run with " + secret + " now");
    assert.equal(draft.ok, true, secret);
    assert.equal(draft.secretLike, true, secret);
    assert.equal(draft.body, "run with " + secret + " now", "not redacted");
  }
  for (const plain of [
    "npm test",
    "git status --short",
    "password",
    "the token was refreshed",
    "tests/a.test.cjs:12",
    "commit " + "a1b2c3d4e5".repeat(4),
    "/usr/local/lib/node_modules/typescript/lib/tsc.js",
    "a".repeat(60),
    "ab3".repeat(14),
  ])
    assert.equal(draftFromSelection(plain).secretLike, false, plain);

  // The note: always the standing line, a second one only for a warning, and the cut named.
  const base = {
    subject: "s",
    body: "b",
    truncated: false,
    secretLike: false,
    suggested: "",
  };
  assert.equal(
    SECRETS_WARNING,
    "Selections can contain secrets: review before creating.",
  );
  assert.equal(
    reviewNote(base),
    "Prepared from a terminal selection. Review the subject, the brief and the owner: nothing is created until you press Create assigned task. Selections can contain secrets: review before creating.",
  );
  assert.equal(
    reviewNote({ ...base, secretLike: true }),
    reviewNote(base) +
      " This selection looks like it holds a key, token or password.",
  );
  assert.equal(
    reviewNote({ ...base, truncated: true }),
    "Prepared from a terminal selection, cut to the first " +
      MAX_BODY.toLocaleString("en-US") +
      " characters. Review the subject, the brief and the owner: nothing is created until you press Create assigned task. Selections can contain secrets: review before creating.",
  );
});

test("task-draft recipient: only a seat of the current list is ever accepted, and the hint names a suggested seat without choosing it", () => {
  const { validRecipient, ownerHint, draftFromSelection } = lib;
  assert.equal(validRecipient("dev-a@hrig", SEATS), "dev-a@hrig");
  assert.equal(validRecipient("dev-b@hrig", SEATS), "dev-b@hrig");
  for (const wrong of [
    "dev-a@other",
    "dev-c@hrig",
    "DEV-A@hrig",
    " dev-a@hrig",
    "dev-a@hrig ",
    "dev-a",
    "@hrig",
    "@",
    "",
    "human@kernel",
    5,
    null,
    undefined,
    {},
    ["dev-a@hrig"],
  ])
    assert.equal(validRecipient(wrong, SEATS), "", String(wrong));
  // The seat list is untrusted too.
  for (const seats of [
    undefined,
    null,
    "dev-a@hrig",
    {},
    [],
    [null, 5, "dev-a@hrig", []],
    [{ name: "dev-a" }, { rigName: "hrig" }],
    [{ name: 5, rigName: "hrig" }],
    [Object.create({ name: "dev-a", rigName: "hrig" })],
  ])
    assert.equal(
      validRecipient("dev-a@hrig", seats),
      "",
      JSON.stringify(seats),
    );
  // Extra seat fields do not matter, and the lists are not changed.
  const seats = Object.freeze([
    Object.freeze({
      id: "x",
      name: "dev-a",
      rigName: "hrig",
      status: "running",
    }),
  ]);
  assert.equal(validRecipient("dev-a@hrig", seats), "dev-a@hrig");

  const draft = draftFromSelection("x", { suggested: "dev-a@hrig" });
  assert.equal(
    ownerHint(draft, SEATS),
    "The selection came from the terminal of dev-a@hrig. Choose the owner yourself: none is chosen for you.",
  );
  assert.equal(
    ownerHint(draft, []),
    "",
    "a seat that is gone is not mentioned",
  );
  assert.equal(ownerHint(draft, undefined), "");
  assert.equal(ownerHint({ ...draft, suggested: "" }, SEATS), "");
  assert.equal(ownerHint({ ...draft, suggested: "dev-z@hrig" }, SEATS), "");
});

test("task-draft event: the app hears one validated announcement per selection, a malformed event opens nothing, an unsubscribe stops it, and a refused selection announces nothing", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const handlers = {};
  const sent = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener(name, f) {
        handlers[name] = f;
      },
      removeEventListener(name, f) {
        if (handlers[name] === f) delete handlers[name];
      },
      dispatchEvent(event) {
        sent.push(event);
        if (handlers[event.type]) handlers[event.type](event);
        return true;
      },
    },
  });
  try {
    const {
      publishTaskDraft,
      onTaskDraft,
      requestTaskDraft,
      TASK_DRAFT_EVENT,
    } = lib;
    assert.equal(TASK_DRAFT_EVENT, "hrig:terminal-task-draft");
    const heard = [];
    const stop = onTaskDraft((id, draft) => heard.push([id, draft]));
    assert.equal(typeof handlers[TASK_DRAFT_EVENT], "function");

    // One event carries the id and the text as they are; the draft is made on the receiving side, without a suggested seat.
    publishTaskDraft("t1", "  ls -l\nwc  ");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].detail, { id: "t1", text: "  ls -l\nwc  " });
    assert.deepEqual(heard, [
      [
        "t1",
        {
          subject: "ls -l",
          body: "ls -l\nwc",
          truncated: false,
          secretLike: false,
          suggested: "",
        },
      ],
    ]);

    // Anything a script could dispatch that is not a usable selection opens nothing.
    const dash = "-----";
    const bad = [
      undefined,
      null,
      "x",
      5,
      [],
      {},
      { id: "", text: "ls" },
      { id: 5, text: "ls" },
      { id: "t1" },
      { id: "t1", text: 5 },
      { id: "t1", text: "" },
      { id: "t1", text: " \n " },
      { id: "t1", text: dash + "BEGIN PRIVATE KEY" + dash },
    ];
    for (const detail of bad)
      window.dispatchEvent(new CustomEvent(TASK_DRAFT_EVENT, { detail }));
    assert.equal(heard.length, 1);

    // The one call the entry points make: a good selection is announced once and returns nothing to show.
    assert.equal(requestTaskDraft("t2", "pwd"), "");
    assert.equal(heard.length, 2);
    assert.equal(heard[1][0], "t2");
    assert.equal(sent.length, 1 + bad.length + 1);
    // A refused selection returns the reason, never repeats the selection and announces nothing.
    const secret = "hunter2";
    const before = sent.length;
    assert.equal(
      requestTaskDraft("t2", ""),
      "Select some terminal text first.",
    );
    assert.equal(
      requestTaskDraft("t2", undefined),
      "Select some terminal text first.",
    );
    const key = requestTaskDraft(
      "t2",
      dash + "BEGIN PRIVATE KEY" + dash + secret,
    );
    assert.ok(key.includes("private key") && !key.includes(secret));
    assert.equal(sent.length, before);

    stop();
    assert.equal(handlers[TASK_DRAFT_EVENT], undefined);
    publishTaskDraft("t1", "pwd");
    assert.equal(heard.length, 2, "nothing after the unsubscribe");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
  // Outside a window nothing throws.
  lib.publishTaskDraft("t1", "ls");
  lib.onTaskDraft(() => {})();
  assert.equal(lib.requestTaskDraft("t1", "ls"), "");
});

test("task-draft command: the command center request reads the selection once through the terminal tools, announces it once, explains a selection that cannot be used, and types, pastes and sends nothing", () => {
  const { TASK_DRAFT_EVENT } = lib;
  const ctx = mountTools("  npm test\nFAIL x  ");
  try {
    assert.deepEqual(ctx.events, [], "mounting announces nothing");
    ctx.ask();
    assert.equal(ctx.events.length, 1);
    assert.equal(ctx.events[0].type, TASK_DRAFT_EVENT);
    assert.deepEqual(ctx.events[0].detail, {
      id: "t-77",
      text: "  npm test\nFAIL x  ",
    });
    assert.equal(ctx.notice(), "");
    ctx.ask();
    assert.equal(ctx.events.length, 2, "one event per request");
    assert.deepEqual(
      ctx.touched,
      { pasted: [], written: [], clipboard: [] },
      "nothing is typed into the terminal, pasted or sent",
    );
  } finally {
    ctx.restore();
  }

  // No selection: a notice and no event; the next good request clears the notice.
  const none = mountTools("");
  try {
    none.ask();
    assert.deepEqual(none.events, []);
    assert.equal(none.notice(), "Select some terminal text first.");
    none.view.selection = "pwd";
    none.ask();
    assert.equal(none.events.length, 1);
    assert.equal(none.notice(), "");
  } finally {
    none.restore();
  }

  // A private key or an invisible-only selection is refused with a reason that does not repeat it.
  const dash = "-----";
  for (const [selection, part] of [
    [dash + "BEGIN PRIVATE KEY" + dash + "\nSECRETBYTES", "private key"],
    [char(0x200b) + " " + char(0x202e), "blank or invisible"],
  ]) {
    const bad = mountTools(selection);
    try {
      bad.ask();
      assert.deepEqual(bad.events, [], part);
      assert.ok(bad.notice().includes(part), bad.notice());
      assert.ok(!bad.notice().includes("SECRETBYTES"));
      assert.deepEqual(bad.touched.pasted, []);
    } finally {
      bad.restore();
    }
  }
});

test("task-draft menu: the real right-click menu has Create task from selection right after Save selection as snippet, enabled only with a selection, and a click announces the selection and types, pastes and sends nothing", () => {
  const { TASK_DRAFT_EVENT } = lib;
  const SAVE = "Save selection as snippet" + char(0x2026);
  const TASK = "Create task from selection" + char(0x2026);
  const ctx = mountTools("  npm test  ");
  try {
    ctx.openMenu(790);
    assert.deepEqual(
      ctx.items().map((i) => i.label),
      ["Copy", SAVE, TASK, "Paste", "Select all"],
    );
    assert.equal(
      ctx.menuStyle().top,
      577,
      "room for the extra item at the bottom edge",
    );
    const item = ctx.items().find((i) => i.label === TASK);
    assert.equal(item.disabled, false);
    item.click();
    assert.equal(ctx.events.length, 1);
    assert.equal(ctx.events[0].type, TASK_DRAFT_EVENT);
    assert.deepEqual(ctx.events[0].detail, {
      id: "t-77",
      text: "  npm test  ",
    });
    assert.equal(ctx.notice(), "");
    assert.deepEqual(ctx.items(), [], "the menu closed");
    assert.deepEqual(ctx.touched, { pasted: [], written: [], clipboard: [] });
  } finally {
    ctx.restore();
  }

  // Without a selection the item is disabled; even a forced click announces nothing and says why.
  const none = mountTools("");
  try {
    none.openMenu();
    const item = none.items().find((i) => i.label === TASK);
    assert.equal(item.disabled, true);
    item.click();
    assert.deepEqual(none.events, []);
    assert.equal(none.notice(), "Select some terminal text first.");
  } finally {
    none.restore();
  }

  // A private key is refused in the menu too, with a notice that does not repeat it.
  const key = mountTools("-----BEGIN PRIVATE KEY-----\nSECRETBYTES");
  try {
    key.openMenu();
    key
      .items()
      .find((i) => i.label === TASK)
      .click();
    assert.deepEqual(key.events, []);
    assert.ok(key.notice().includes("private key"));
    assert.ok(!key.notice().includes("SECRETBYTES"));
  } finally {
    key.restore();
  }
});

test("task-draft board: a prepared dialog never defaults the owner, never overwrites a task being written, throws its text away when closed, shows the text as typed and creates only through its own button", async () => {
  const { draftFromSelection } = lib;
  const prepare = (text, suggested = "") => {
    const draft = draftFromSelection(text, { suggested });
    assert.equal(draft.ok, true);
    const { ok, ...rest } = draft;
    return rest;
  };
  const creates = (board) =>
    board.calls.rigAction.filter(([, a]) => a.op === "taskCreate");
  const subject = (board) => board.byLabel("Task subject").props.value;
  const brief = (board) => board.byLabel("Task brief").props.value;
  const owner = (board) => board.byLabel("Task destination").props.value;

  // Without a draft the Assign work button is what it always was: an empty dialog, no review note, the first seat as owner.
  let board = boardHarness();
  try {
    await board.flush();
    assert.equal(board.props.onDraftTaken !== undefined, true);
    board.button("Assign work").props.onClick();
    assert.equal(board.modal().props.title, "Assign work to a seat");
    assert.equal(subject(board), "");
    assert.equal(brief(board), "");
    assert.equal(
      owner(board),
      "dev-a@hrig",
      "the existing button keeps its own default",
    );
    assert.deepEqual(
      board.notes().filter((n) => n.includes("Prepared from")),
      [],
    );
    board.modal().props.onClose();
    assert.equal(board.modal(), undefined);

    // A prepared dialog: the owner stays empty whatever the suggestion, and the suggestion is only a line of text.
    board.give(
      prepare(
        "<img src=x onerror=alert(1)>\n[a](javascript:1)\n**bold**",
        "dev-b@hrig",
      ),
    );
    assert.equal(board.calls.taken, 1);
    assert.equal(owner(board), "");
    assert.equal(board.button("Create assigned task").props.disabled, true);
    assert.equal(subject(board), "<img src=x onerror=alert(1)>");
    assert.equal(
      brief(board),
      "<img src=x onerror=alert(1)>\n[a](javascript:1)\n**bold**",
    );
    assert.ok(board.notes().some((n) => n.includes("terminal of dev-b@hrig")));
    const raw = JSON.stringify(
      board.all().map((n) => Object.keys(n.props || {})),
    );
    assert.ok(!raw.includes("dangerouslySetInnerHTML"), "text only");
    assert.equal(board.byLabel("Task subject").props.onKeyDown, undefined);
    assert.equal(board.byLabel("Task brief").props.onKeyDown, undefined);

    // Closing it throws the text away: the next Assign work dialog is empty and has no note.
    board.modal().props.onClose();
    assert.equal(board.modal(), undefined);
    board.button("Assign work").props.onClick();
    assert.equal(subject(board), "");
    assert.equal(brief(board), "");
    assert.deepEqual(
      board.notes().filter((n) => n.includes("Prepared from")),
      [],
    );
    board.modal().props.onClose();

    // A suggestion that names a seat that is not listed gives no hint; a cut and a warning are named in the note.
    board.give({
      ...prepare("password=hunter2secret " + "z ".repeat(5000), "dev-z@hrig"),
    });
    const notes = board.notes().join(" | ");
    assert.ok(!notes.includes("terminal of"), notes);
    assert.ok(notes.includes("cut to the first 8,000 characters"));
    assert.ok(notes.includes("looks like it holds a key, token or password"));
    assert.ok(notes.includes(lib.SECRETS_WARNING));
    assert.equal(owner(board), "");
    board.modal().props.onClose();

    // The person edits what was prepared, picks an owner and presses the dialog's own button: what is created is what was reviewed.
    board.give(prepare("first line\nsecond line", "dev-a@hrig"));
    board.type("Task subject", "A better subject");
    board.type("Task brief", "A better brief");
    board.type("Task destination", "dev-a@hrig");
    assert.deepEqual(creates(board), [], "editing and choosing create nothing");
    board.button("Create assigned task").props.onClick();
    await board.flush();
    assert.deepEqual(creates(board), [
      [
        CONNECTION,
        {
          op: "taskCreate",
          id: undefined,
          title: "A better subject",
          destination: "dev-a@hrig",
          body: "A better brief",
        },
      ],
    ]);
    assert.equal(board.modal(), undefined);
    assert.deepEqual(
      board.notes().filter((n) => n.includes("Prepared from")),
      [],
      "the note is gone with the dialog",
    );
    assert.deepEqual(board.calls.sendMessage, []);
  } finally {
    board.unmount();
  }

  // A task already being written is never overwritten, and the person is told in the dialog.
  board = boardHarness();
  try {
    await board.flush();
    board.button("Assign work").props.onClick();
    board.type("Task subject", "half written");
    board.give(prepare("from the terminal"));
    assert.equal(board.calls.taken, 1, "the draft is taken either way");
    assert.equal(subject(board), "half written");
    assert.equal(brief(board), "");
    assert.equal(board.errors().length >= 1, true);
    assert.ok(
      board
        .all()
        .some(
          (n) =>
            n.type === "ErrorBox" &&
            n.props.error.includes("already being written"),
        ),
    );
    assert.equal(
      owner(board),
      "dev-a@hrig",
      "the open dialog is left as it was",
    );
    assert.deepEqual(creates(board), []);
    // An empty open dialog is not a task being written: it is filled in.
    board.type("Task subject", "");
    board.give(prepare("from the terminal"));
    assert.equal(subject(board), "from the terminal");
    assert.equal(
      owner(board),
      "",
      "a prepared dialog never defaults the owner",
    );
    board.modal().props.onClose();

    // A prepared dialog replaces open task details, which only show a task.
    board
      .all()
      .find((n) => n.type === "button" && n.props.className === "task-card")
      .props.onClick();
    await board.flush();
    assert.equal(board.modal().props.title, "Task details");
    board.give(prepare("from the terminal"));
    assert.equal(board.modal().props.title, "Assign work to a seat");
    assert.equal(subject(board), "from the terminal");
    assert.deepEqual(creates(board), []);
    assert.deepEqual(board.calls.sendMessage, []);
  } finally {
    board.unmount();
  }
});

test("task-draft wiring: the pure module touches nothing, the entry points only ask, the app only opens the dialog, the board only fills it in and creates only through its own button, and nothing else changes", () => {
  const moduleSource = read("src/task-draft.ts");
  const code = stripComments(moduleSource);
  assert.ok(!/[^ -~\n]/.test(moduleSource), "printable ASCII only");
  assert.deepEqual([...code.matchAll(/^import /gm)], [], "no imports");
  for (const banned of [
    /\bdocument\b/,
    /\bReact\b/,
    /window\.hrig/,
    /\bDate\b/,
    /setTimeout|setInterval/,
    /\bfetch\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\basync\b|\bawait\b/,
    /Math\.random|randomUUID/,
    /\bconsole\b/,
    /export default/,
    /\brequire\b/,
    /clipboard|writeTerminal|sendTerminalCommand|getSelection|rigAction|taskCreate/,
  ])
    assert.ok(!banned.test(code), "the module stays quiet: " + banned);
  assert.equal(count(code, "window.dispatchEvent("), 1);
  assert.equal(count(code, "window.addEventListener("), 1);
  assert.equal(count(code, "window.removeEventListener("), 1);
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)]
      .map((m) => m[1])
      .sort(),
    [
      "MAX_BODY",
      "MAX_READ",
      "MAX_SUBJECT",
      "SECRETS_WARNING",
      "TASK_DRAFT_EVENT",
      "TaskDraft",
      "TaskDraftResult",
      "draftFromSelection",
      "onTaskDraft",
      "ownerHint",
      "publishTaskDraft",
      "requestTaskDraft",
      "reviewNote",
      "validRecipient",
    ],
  );
  const lines = moduleSource.split("\n");
  for (const [index, line] of lines.entries())
    if (/^export /.test(line))
      assert.ok(lines[index - 1].startsWith("/** "), "doc comment: " + line);

  // The terminal tools: one new import, one handler that only asks, one effect for the command center, one menu item after Save selection as snippet.
  const toolsSource = read("src/TerminalTools.tsx");
  const tools = tight(stripComments(toolsSource));
  assert.equal(
    count(tools, 'import { requestTaskDraft } from "./task-draft";'),
    1,
  );
  assert.equal(count(tools, "requestTaskDraft("), 1);
  assert.equal(
    count(
      tools,
      "const createTaskFromSelection = () => setNotice(requestTaskDraft(terminalId, selectedText()));",
    ),
    1,
    "the same one read of the selection as copy and snippets",
  );
  assert.equal(
    count(
      tools,
      "useEffect(() => { if (taskRequest) createTaskFromSelection(); }, [taskRequest]);",
    ),
    1,
  );
  assert.equal(count(tools, "taskRequest = 0,"), 1);
  assert.equal(count(tools, "taskRequest?: number;"), 1);
  assert.equal(
    count(
      tools,
      'role="menuitem" disabled={!menu.selection} onClick={choose(createTaskFromSelection)}',
    ),
    1,
  );
  assert.equal(count(tools, "Create task from selection"), 1, "the menu label");
  assert.equal(
    count(tools, "<span>Create task from selection" + char(0x2026) + "</span>"),
    1,
  );
  const saveAt = tools.indexOf("choose(saveSelectionAsSnippet)");
  const taskAt = tools.indexOf("choose(createTaskFromSelection)");
  assert.ok(
    saveAt > 0 && saveAt < taskAt && taskAt < tools.indexOf("choose(paste)"),
  );
  assert.equal(count(tools, "window.innerHeight - 223"), 1);
  const asks = between(
    tools,
    "const createTaskFromSelection",
    "const [hasImage,setHasImage]",
  );
  assert.ok(
    !/paste|writeTerminal|writeText|sendTerminalCommand|onChange|terminalSnippets|clipboard|getSelection|navigator|rigAction|hrig/.test(
      asks,
    ),
    "the handler and the effect only ask",
  );

  // The panel only counts the request; it never reads the selection, so the terminal tools stay the one reader of it.
  const panel = tight(stripComments(read("src/TerminalPanel.tsx")));
  assert.equal(
    count(panel, "const [taskRequest, setTaskRequest] = useState(0);"),
    1,
  );
  assert.equal(
    count(
      panel,
      'if (command === "task-from-selection") setTaskRequest(n => n + 1);',
    ),
    1,
  );
  assert.equal(count(panel, "taskRequest={taskRequest}"), 1);
  assert.ok(!/task-draft|getSelection|requestTaskDraft/.test(panel));
  assert.equal(
    count(read("src/terminal-commands.ts"), '"task-from-selection"'),
    1,
  );

  // The app: one listener through the module, a ref so the handler sees the current terminals, a board addressed by tab id, no way to create.
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(
    count(app, 'import { onTaskDraft, type TaskDraft } from "./task-draft";'),
    1,
  );
  assert.equal(count(app, "onTaskDraft("), 1);
  assert.equal(
    count(
      app,
      "useEffect(() => onTaskDraft((id, draft) => openTaskDraft.current(id, draft)), []);",
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "const [taskDraft, setTaskDraft] = useState<{tabId: string; draft: TaskDraft} | null>(null);",
    ),
    1,
  );
  assert.ok(
    app.indexOf("const [taskDraft, setTaskDraft]") <
      app.indexOf("const factory = (node: TabNode)"),
    "declared before the factory that reads it",
  );
  assert.equal(
    count(app, "setTaskDraft("),
    2,
    "set once from the event, cleared once when the board took it",
  );
  assert.equal(count(app, "onDraftTaken={() => setTaskDraft(null)}"), 1);
  assert.equal(
    count(
      app,
      "draft={taskDraft && taskDraft.tabId === node.getId() ? taskDraft.draft : null}",
    ),
    1,
  );
  assert.equal(count(app, "<TaskBoard"), 1);
  assert.ok(
    app.includes(
      'notify("Create task from selection is not available in this terminal");',
    ),
  );
  assert.equal(
    count(
      app,
      'action: () => {model.doAction(Actions.selectTab(t.id!));requestAnimationFrame(() => sendTerminalCommand(target.id, "task-from-selection"));}',
    ),
    1,
  );
  assert.equal(count(app, '"Terminal: Create task from selection"'), 1);
  const opener = app.slice(
    app.indexOf("openTaskDraft.current = "),
    app.indexOf("useEffect(() => onTaskDraft("),
  );
  assert.ok(
    opener.includes(
      "terminalTabs.find(t => (t.config as PanelConfig).terminalId === id)",
    ),
    "the board opens for the terminal that asked",
  );
  assert.ok(
    opener.includes(
      'suggested: cfg.seat ? cfg.seat.name + "@" + cfg.seat.rigName : ""',
    ),
    "the seat of that terminal is only a suggestion",
  );
  assert.ok(
    opener.includes(
      'const board = allTabs().find(t => t.component === "queue" && (t.config as PanelConfig).connection.id === cfg.connection.id);',
    ),
    "a board already open for that connection is reused",
  );
  assert.ok(
    opener.includes(
      'const tabId = board?.id || uid(); if (board) model.doAction(Actions.selectTab(tabId)); else addPanel("queue", "Task queue", {connection: cfg.connection, mode: currentRig?.name}, tabId);',
    ),
    "else a new one is opened under a known id",
  );
  assert.ok(
    !/rigAction|taskCreate|sendMessage|writeTerminal|sendTerminalCommand|destination|setState/.test(
      opener,
    ),
    "the listener never creates, sends or chooses an owner",
  );
  assert.equal(
    count(app, "taskCreate"),
    0,
    "the app has no way to create a task",
  );

  // The board: the draft only fills state, the owner is set to nothing, and the one call of mutate is still the dialog's own button.
  const boardSource = read("src/TaskBoard.tsx");
  const board = tight(stripComments(boardSource));
  assert.equal(
    count(
      board,
      'import { ownerHint, reviewNote, type TaskDraft } from "./task-draft";',
    ),
    1,
  );
  assert.equal(
    count(
      board,
      "const [prepared, setPrepared] = useState<TaskDraft | null>(null);",
    ),
    1,
  );
  assert.equal(count(board, "draft?: TaskDraft | null;"), 1);
  assert.equal(count(board, "onDraftTaken?: () => void;"), 1);
  const effect = between(board, "if (!draft) return;", "}, [draft]);");
  assert.ok(
    !/rigAction|sendMessage|mutate|hrig|window|setBusy|setRefresh/.test(effect),
    "the effect only fills the dialog",
  );
  assert.equal(
    count(effect, 'setDestination("")'),
    1,
    "the owner is set to nothing",
  );
  assert.ok(
    !/setDestination\((?!"")/.test(effect),
    "and never to anything else",
  );
  assert.equal(count(effect, "setTitle(draft.subject)"), 1);
  assert.equal(count(effect, "setBody(draft.body)"), 1);
  assert.equal(count(effect, "onDraftTaken?.()"), 1);
  assert.ok(
    board.indexOf("}, [draft]);") < board.indexOf("const addresses ="),
    "before the handlers the older tests pin",
  );
  assert.equal(count(board, "mutate("), 1, "still one caller of mutate");
  assert.equal(
    count(
      board,
      'onClick={() => mutate(create ? "taskCreate" : "taskHandoff")}',
    ),
    1,
  );
  assert.equal(count(board, "{reviewNote(prepared)}"), 1);
  assert.equal(count(board, "ownerHint(prepared, seats)"), 2);
  assert.equal(count(board, "dangerouslySetInnerHTML"), 0);
  assert.equal(count(boardSource, "style="), 0);
  assert.equal(count(boardSource, "className={"), 0);
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);

  // Nothing else uses the module, and the main process, the settings, the shortcuts and the stylesheet do not know the feature.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.tsx?$/.test(f) && f !== "task-draft.ts")
    .filter((f) => read("src/" + f).includes("task-draft"))
    .sort();
  assert.deepEqual(users, ["App.tsx", "TaskBoard.tsx", "TerminalTools.tsx"]);
  for (const file of [
    "src/shortcuts.ts",
    "src/settings.ts",
    "src/styles.css",
    "src/types.ts",
    "src/SettingsPage.tsx",
  ])
    assert.ok(!/task-draft|taskDraft|TaskDraft/.test(read(file)), file);
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs|js)$/.test(file))
      assert.ok(
        !/task-draft|taskDraft|TASK_DRAFT|terminal-task-draft|task-from-selection/.test(
          read("electron/" + file),
        ),
        file,
      );
  // The create path is the one the dialog always had.
  const features = tight(read("electron/features.cjs"));
  assert.equal(
    count(
      features,
      'case "taskCreate": args = [ "queue", "create", "--source", "hrig-desktop", "--destination", text(a.destination), "--summary", text(a.title), "--body", text(a.body), "--json", ]; break;',
    ),
    1,
  );
});

test("task-draft docs: TASKS.md and the design note say what is prepared and what is created, why the owner is never chosen, how the selection is treated and what was rejected", () => {
  const { MAX_SUBJECT, MAX_BODY, MAX_READ, SECRETS_WARNING } = lib;
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n### Creating a task from a selection\n"), 1);
  assert.equal(
    count(doc, "\n## "),
    2,
    "the two level 2 headings other tests count are untouched",
  );
  const at = doc.indexOf("\n### Creating a task from a selection\n");
  assert.ok(at > doc.indexOf("separate, explicit actions."));
  assert.ok(at < doc.indexOf("\n### Keyboard navigation\n"));
  assert.ok(at < doc.indexOf("\n### Card details\n"));
  const next = doc.indexOf("\n### ", at + 1);
  const section = doc.slice(at + 1, next);
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 3);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const say = (paragraph, parts) => {
    const flat = collapse(paragraph);
    for (const part of parts)
      assert.ok(flat.includes(part), "TASKS.md says: " + part);
  };
  say(paragraphs[0], [
    "right-click and choose Create task from selection",
    "choose Terminal: Create task from selection for that terminal",
    "greyed out when nothing is selected",
    "the one already open for that connection, else a new one",
    "the Assign work dialog filled in",
    "the subject is the first line of the selection (cut at " +
      MAX_SUBJECT +
      " characters)",
    "the task brief is the selection (cut at " +
      MAX_BODY.toLocaleString("en-US") +
      " characters",
    "This only prepares a task: nothing is created, sent or typed until you press Create assigned task",
    "the dialog's own button and the same path as Assign work",
    "closing the dialog throws the prepared text away",
    "A task you are already writing in the dialog is never overwritten",
  ]);
  say(paragraphs[1], [
    "The owner is never chosen for you",
    "it stays on Choose a seat",
    "Create assigned task stays disabled until you pick one",
    "names that seat as a suggestion, and it is not selected",
    "The Assign work button itself still starts with the first seat as owner, as before",
    "only a prepared dialog starts empty",
  ]);
  say(paragraphs[2], [
    "The selection is untrusted text",
    "Control, zero-width and direction-changing characters and terminal escape sequences are removed",
    "line breaks are kept",
    "plain text in the subject and brief boxes, never as HTML or Markdown and never run",
    "At most " +
      MAX_READ.toLocaleString("en-US") +
      " characters of a selection are read and " +
      MAX_BODY.toLocaleString("en-US") +
      " kept",
    "looks like a private key block is refused with a notice",
    "token, an API key or a password is prepared with a second warning",
    "every prepared dialog says: " + SECRETS_WARNING,
    "OpenRig enforces ownership and policy on the created task as for any other",
    "docs/task-from-selection.md has the design note",
  ]);
  // The names the docs use are the names in the code.
  assert.ok(read("src/TaskBoard.tsx").includes('"Create assigned task"'));
  assert.ok(read("src/TaskBoard.tsx").includes("Choose a seat"));
  assert.ok(read("src/TaskBoard.tsx").includes("Assign work"));
  assert.ok(
    read("src/App.tsx").includes("Terminal: Create task from selection"),
  );
  assert.ok(
    read("src/TerminalTools.tsx").includes("Create task from selection"),
  );

  const note = read("docs/task-from-selection.md");
  assert.ok(!/[^\n -~]/.test(note), "plain ASCII");
  assert.ok(note.endsWith(".\n") && !note.endsWith("\n\n"));
  assert.ok(!note.includes("\r"));
  assert.ok(
    note.startsWith(
      "# Creating a task from a terminal selection\n\nStatus: built. It only prepares a task. Creating it stays with the existing Assign work dialog.\n",
    ),
  );
  const headings = note.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(headings, [
    "## What it does",
    "## Prepared versus created",
    "## Why the owner is never chosen for you",
    "## Secrets and untrusted text",
    "## Ownership and policy",
    "## Rejected alternatives",
  ]);
  const flat = collapse(note);
  for (const part of [
    "Create task from selection, or open the command center and choose Terminal: Create task from selection",
    "cut at " + MAX_SUBJECT + " characters",
    "cut at " + MAX_BODY.toLocaleString("en-US") + " characters",
    "the owner is left empty",
    "nothing is created until you press Create assigned task",
    "Closing the dialog throws the prepared text away",
    "`taskCreate`: `rig queue create` with source `hrig-desktop`",
    "This feature adds no IPC channel, no preload member and no main process code",
    "A task you are already writing in the dialog is never overwritten",
    "Nothing is typed into the terminal, pasted or sent to a seat",
    "A task goes to the seat a person decides on",
    "Create assigned task stays disabled until you pick one",
    "it is a line of text, not a selection",
    "The Assign work button itself still starts with the first seat as owner, as it always did",
    "At most " +
      MAX_READ.toLocaleString("en-US") +
      " characters of a selection are read and " +
      MAX_BODY.toLocaleString("en-US") +
      " are kept",
    "never as HTML or Markdown, and never run",
    "refused with a notice that does not repeat it",
    SECRETS_WARNING,
    "These checks are a help, not a guarantee",
    "stored by OpenRig and shown to its owner",
    "starts with two dashes",
    "OpenRig enforces ownership and policy on the created task as for any other",
    "HRig does not impersonate a managed seat",
    "a one-click send",
    "a command line invites a paste into a shell",
    "editor selections, sending one selection to several seats",
  ])
    assert.ok(flat.includes(part), "design note says: " + part);
});
