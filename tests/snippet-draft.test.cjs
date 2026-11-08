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
const char = (code) => String.fromCharCode(code);
const ELLIPSIS = char(0x2026);
const MENU_LABEL = "Save selection as snippet" + ELLIPSIS;

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
const draftModule = () => load("src/snippet-draft.ts");

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

// ---- the real TerminalTools component, run outside React over fakes ----
// A small hook runtime keeps state, refs and effects so the real context menu and its handlers run as written; the terminal, the window and the xterm search addon are fakes.
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
    const props = {
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
      term,
      view,
      restore,
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

// A small react runtime for the real dialog: useState keeps slots and a state change renders again at once.
function dialogHarness(extra = {}) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  const calls = { inserted: [], changed: [], closed: 0 };
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
  const jsx = (type, props) => ({ type, props });
  const Dialog = load("src/TerminalSnippets.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
  }).default;
  const props = {
    name: "Prod",
    connection: "Prod DB",
    terminalId: "t1",
    snippets: [],
    context: { host: "prod-1" },
    onChange: (next) => calls.changed.push(next),
    onInsert: (text, run) => calls.inserted.push([text, run]),
    onClose: () => {
      calls.closed++;
    },
    ...extra,
  };
  function render() {
    cursor = 0;
    tree = Dialog(props);
  }
  render();
  return {
    calls,
    all: () => flatten(tree),
    text: textOf,
    field: (type) => flatten(tree).find((n) => n.type === type),
    button: (label) =>
      flatten(tree).find((n) => n.type === "button" && textOf(n) === label),
  };
}

test("snippet-draft tracer: the real right-click menu turns a one-line selection into a prefilled snippets dialog, refuses anything else with a notice, and saves and sends nothing", () => {
  const { SNIPPET_DRAFT_EVENT } = draftModule();
  assert.equal(SNIPPET_DRAFT_EVENT, "hrig:terminal-snippet-draft");

  // A selection with edge spaces: the menu item is enabled and one event carries the id and the trimmed text.
  const ctx = mountTools("  git status --short  ");
  try {
    ctx.openMenu(790);
    const labels = ctx.items().map((i) => i.label);
    assert.deepEqual(labels, ["Copy", MENU_LABEL, "Paste", "Select all"]);
    assert.equal(
      ctx.menuStyle().top,
      610,
      "room for the extra item at the bottom edge",
    );
    const item = ctx.items().find((i) => i.label === MENU_LABEL);
    assert.equal(item.disabled, false);
    item.click();
    assert.equal(ctx.events.length, 1);
    assert.equal(ctx.events[0].type, SNIPPET_DRAFT_EVENT);
    assert.deepEqual(ctx.events[0].detail, {
      id: "t-77",
      text: "git status --short",
    });
    assert.equal(ctx.notice(), "");
    assert.deepEqual(
      ctx.touched.pasted,
      [],
      "nothing is typed into the terminal",
    );
    assert.deepEqual(ctx.items(), [], "the menu closed");
  } finally {
    ctx.restore();
  }

  // Without a selection the item is disabled; even a forced click sends nothing and says why.
  const none = mountTools("");
  try {
    none.openMenu();
    const item = none.items().find((i) => i.label === MENU_LABEL);
    assert.equal(item.disabled, true);
    item.click();
    assert.deepEqual(none.events, []);
    assert.equal(none.notice(), "Select some terminal text first.");
  } finally {
    none.restore();
  }

  // Several lines, control characters or too much text: refused with a notice that never echoes the selection.
  const secret = "token=hunter2";
  for (const [selection, part] of [
    ["first " + secret + char(10) + "second", "single line"],
    [secret + char(13) + char(10) + "x", "single line"],
    [secret + char(9) + "x", "single line without control"],
    [secret + char(0x202e), "single line without control"],
    ["x".repeat(10001), "10,000"],
  ]) {
    const bad = mountTools(selection);
    try {
      bad.openMenu();
      bad
        .items()
        .find((i) => i.label === MENU_LABEL)
        .click();
      assert.deepEqual(bad.events, [], part);
      assert.ok(bad.notice().includes(part), bad.notice());
      assert.ok(
        !bad.notice().includes(secret),
        "the selection is not repeated",
      );
      assert.deepEqual(bad.touched.pasted, []);
    } finally {
      bad.restore();
    }
  }

  // The dialog opens with the fields filled in and keeps every action behind its own click.
  const { draftFromSelection } = draftModule();
  const draft = draftFromSelection("  git status --short  ");
  assert.deepEqual(draft, {
    ok: true,
    name: "git status --short",
    text: "git status --short",
  });
  const d = dialogHarness({ draft: { name: draft.name, text: draft.text } });
  assert.equal(d.field("input").props.value, "git status --short");
  assert.equal(d.field("textarea").props.value, "git status --short");
  assert.ok(
    d
      .all()
      .some((n) =>
        textOf(n).includes(
          "Nothing is saved or sent until you press Save snippet",
        ),
      ),
    "the dialog says nothing is saved or sent yet",
  );
  assert.ok(
    d.all().some((n) => textOf(n).includes("A selection can hold secrets")),
  );
  assert.deepEqual(d.calls.changed, [], "opening saves nothing");
  assert.deepEqual(d.calls.inserted, [], "opening sends nothing");
  assert.equal(d.calls.closed, 0);
  d.button("Save snippet").props.onClick();
  assert.equal(d.calls.changed.length, 1);
  assert.deepEqual(
    d.calls.changed[0].map((s) => [s.name, s.text]),
    [["git status --short", "git status --short"]],
  );
  assert.deepEqual(d.calls.inserted, [], "saving never sends");
  // No draft: the dialog is as before, empty and without the note.
  const plain = dialogHarness();
  assert.equal(plain.field("input").props.value, "");
  assert.equal(plain.field("textarea").props.value, "");
  assert.ok(
    !plain
      .all()
      .some((n) =>
        textOf(n).includes("Filled in from your terminal selection"),
      ),
  );
});

test("snippet-draft pure: a selection becomes one trimmed line with a short name, and several lines, control characters and oversize text are refused", () => {
  const { draftFromSelection, MAX_DRAFT_NAME } = draftModule();
  assert.equal(MAX_DRAFT_NAME, 30);
  const ok = (selection, name, text) =>
    assert.deepEqual(
      draftFromSelection(selection),
      { ok: true, name, text },
      JSON.stringify(selection),
    );
  const refused = (selection, part) => {
    const r = draftFromSelection(selection);
    assert.equal(r.ok, false, JSON.stringify(selection));
    assert.ok(r.error.includes(part), r.error);
    assert.deepEqual(Object.keys(r), ["ok", "error"]);
  };
  ok("ls", "ls", "ls");
  ok("  ls -l  ", "ls -l", "ls -l");
  ok("ls" + char(10), "ls", "ls");
  ok(char(10) + "  ls  " + char(13) + char(10), "ls", "ls");
  ok("echo  two   spaces", "echo  two   spaces", "echo  two   spaces");
  ok("caf" + char(0xe9), "caf" + char(0xe9), "caf" + char(0xe9));
  // The name: at most 30 characters, then three dots; never half a character; no dangling space.
  ok("a".repeat(30), "a".repeat(30), "a".repeat(30));
  ok("a".repeat(31), "a".repeat(30) + "...", "a".repeat(31));
  ok("a".repeat(28) + " b", "a".repeat(28) + " b", "a".repeat(28) + " b");
  ok("a".repeat(29) + " b", "a".repeat(29) + "...", "a".repeat(29) + " b");
  ok("a".repeat(29) + " bcd", "a".repeat(29) + "...", "a".repeat(29) + " bcd");
  const grin = String.fromCodePoint(0x1f600);
  ok(grin.repeat(30), grin.repeat(30), grin.repeat(30));
  ok(grin.repeat(31), grin.repeat(30) + "...", grin.repeat(31));
  ok("x".repeat(10000), "x".repeat(30) + "...", "x".repeat(10000));
  // Several lines are refused whole: never joined, never cut to the first line.
  for (const multi of [
    "a" + char(10) + "b",
    "a" + char(13) + "b",
    "a" + char(13) + char(10) + "b",
    "a" + char(10) + char(10) + "b",
    "  a  " + char(10) + "  b  ",
  ])
    refused(multi, "single line");
  assert.ok(
    draftFromSelection("a\nb").error.includes("Nothing was saved or sent"),
  );
  // Nothing to save.
  for (const nothing of [
    undefined,
    null,
    5,
    true,
    {},
    [],
    ["a"],
    "",
    "   ",
    char(10),
    char(9),
    char(0xa0),
    char(0xfeff),
  ])
    refused(nothing, "Select some terminal text first.");
  // Tabs, escapes, invisible and direction characters and oversize text come back through the existing validator.
  for (const code of [
    9, 7, 27, 0, 127, 0x85, 0x2028, 0x2029, 0x200b, 0x200d, 0x202e, 0x2066,
    0xad,
  ])
    refused("a" + char(code) + "b", "single line without control");
  refused("x".repeat(10001), "10,000");
  ok("x".repeat(10000), "x".repeat(30) + "...", "x".repeat(10000));

  // A seeded walk against a plain model.
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pieces = [
    "a",
    "git status",
    " ",
    "  ",
    char(10),
    char(13),
    char(9),
    char(0x200b),
    "{host}",
    grin,
    "x".repeat(12),
  ];
  for (let run = 0; run < 400; run++) {
    let selection = "";
    for (let n = Math.floor(next() * 8); n > 0; n--)
      selection += pieces[Math.floor(next() * pieces.length)];
    const trimmed = selection.replace(/^\s+|\s+$/g, "");
    const r = draftFromSelection(selection);
    if (trimmed === "") assert.equal(r.ok, false);
    else if (trimmed.includes(char(10)) || trimmed.includes(char(13)))
      assert.ok(!r.ok && r.error.includes("single line"));
    else if (
      [...trimmed].some(
        (c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 0x200b,
      )
    )
      assert.equal(r.ok, false);
    else {
      const chars = [...trimmed];
      const head = chars.slice(0, 30).join("").trimEnd();
      assert.deepEqual(r, {
        ok: true,
        name: chars.length > 30 ? head + "..." : head,
        text: trimmed,
      });
    }
  }
});

test("snippet-draft event: the app hears one validated announcement per selection and an unsubscribe stops it", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const handlers = {};
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
        if (handlers[event.type]) handlers[event.type](event);
        return true;
      },
    },
  });
  try {
    const { publishSnippetDraft, onSnippetDraft, SNIPPET_DRAFT_EVENT } =
      draftModule();
    const heard = [];
    const stop = onSnippetDraft((id, draft) => heard.push([id, draft]));
    assert.equal(typeof handlers[SNIPPET_DRAFT_EVENT], "function");
    publishSnippetDraft("t1", "  ls -l  ");
    assert.deepEqual(
      heard,
      [["t1", { name: "ls -l", text: "ls -l" }]],
      "the name is derived on the receiving side",
    );
    // Anything a script could dispatch that is not a clean one-line selection opens nothing.
    const bad = [
      undefined,
      null,
      "x",
      {},
      { id: "", text: "ls" },
      { id: 5, text: "ls" },
      { id: "t1" },
      { id: "t1", text: 5 },
      { id: "t1", text: "" },
      { id: "t1", text: "a" + char(10) + "b" },
      { id: "t1", text: "a" + char(9) + "b" },
      { id: "t1", text: "x".repeat(10001) },
    ];
    for (const detail of bad)
      window.dispatchEvent(new CustomEvent(SNIPPET_DRAFT_EVENT, { detail }));
    assert.equal(heard.length, 1);
    stop();
    assert.equal(handlers[SNIPPET_DRAFT_EVENT], undefined);
    publishSnippetDraft("t1", "pwd");
    assert.equal(heard.length, 1, "nothing after the unsubscribe");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
  // Outside a window nothing throws.
  const { publishSnippetDraft, onSnippetDraft } = draftModule();
  publishSnippetDraft("t1", "ls");
  onSnippetDraft(() => {})();
});

test("snippet-draft wiring: the pure module touches nothing, the menu item and the app listener only open the dialog, and the dialog takes the draft as plain fields", () => {
  const moduleSource = read("src/snippet-draft.ts");
  const code = stripComments(moduleSource);
  assert.ok(!/[^ -~\n]/.test(moduleSource), "printable ASCII only");
  assert.ok(!moduleSource.includes(char(92) + "u"), "no escape sequence");
  assert.deepEqual(
    [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]),
    ["./terminal-commands"],
  );
  for (const banned of [
    /\bdocument\b/,
    /\bReact\b/,
    /window\.hrig/,
    /\bDate\b/,
    /setTimeout/,
    /\bfetch\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\basync\b|\bawait\b/,
    /Math\.random|randomUUID/,
    /\bconsole\b/,
    /export default/,
    /\brequire\b/,
    /clipboard|writeTerminal|sendTerminalCommand|getSelection/,
  ])
    assert.ok(!banned.test(code), "the module stays quiet: " + banned);
  assert.equal(count(code, "window.dispatchEvent("), 1);
  assert.equal(count(code, "window.addEventListener("), 1);
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)]
      .map((m) => m[1])
      .sort(),
    [
      "DraftResult",
      "MAX_DRAFT_NAME",
      "SNIPPET_DRAFT_EVENT",
      "SnippetDraft",
      "draftFromSelection",
      "onSnippetDraft",
      "publishSnippetDraft",
    ],
  );

  // The menu: one new item, enabled only with a selection, going through the same choose wrapper as Copy.
  const tools = tight(stripComments(read("src/TerminalTools.tsx")));
  assert.equal(
    count(
      tools,
      'import { draftFromSelection, publishSnippetDraft } from "./snippet-draft";',
    ),
    1,
  );
  assert.equal(
    count(
      tools,
      "const selectedText = () => terminal.current?.getSelection();",
    ),
    1,
  );
  assert.equal(
    count(tools, "const text = selectedText();"),
    1,
    "copy reads through the same helper",
  );
  assert.equal(
    count(tools, "const draft = draftFromSelection(selectedText());"),
    1,
  );
  assert.equal(
    count(
      tools,
      "if (draft.ok) publishSnippetDraft(terminalId, draft.text); else setNotice(draft.error);",
    ),
    1,
  );
  assert.equal(count(tools, "publishSnippetDraft("), 1);
  assert.equal(
    count(
      tools,
      'role="menuitem" disabled={!menu.selection} onClick={choose(saveSelectionAsSnippet)}',
    ),
    1,
  );
  assert.equal(count(tools, "Save selection as snippet"), 1);
  assert.equal(count(tools, "window.innerHeight - 190"), 1);
  const handler = tools.slice(
    tools.indexOf("const saveSelectionAsSnippet"),
    tools.indexOf("const [hasImage,setHasImage]"),
  );
  assert.ok(
    !/paste|writeTerminal|writeText|sendTerminalCommand|onChange|terminalSnippets/.test(
      handler,
    ),
    "the handler only publishes or explains",
  );

  // The app: one listener through the module, a ref so the handler sees the current terminals, one write of target and draft.
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(
    count(
      app,
      'import { onSnippetDraft, type SnippetDraft } from "./snippet-draft";',
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "const [snippetDraft, setSnippetDraft] = useState<SnippetDraft | null>(null);",
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "useEffect(() => onSnippetDraft((id, draft) => openSnippetDraft.current(id, draft)), []);",
    ),
    1,
  );
  assert.equal(count(app, "onSnippetDraft("), 1);
  assert.equal(count(app, "setSnippetDraft(draft);"), 1);
  assert.equal(
    count(app, "setSnippetDraft("),
    2,
    "set once from the event, cleared once on close",
  );
  assert.ok(
    app.includes(
      'notify("Saved snippets are not available in this terminal");',
    ),
  );
  assert.equal(count(app, "draft={snippetDraft}"), 1);
  assert.equal(
    count(
      app,
      "onClose={() => {setSnippetTarget(null);setSnippetDraft(null);}}",
    ),
    1,
  );
  const opener = app.slice(
    app.indexOf("openSnippetDraft.current = "),
    app.indexOf("useEffect(() => onSnippetDraft("),
  );
  assert.ok(
    opener.includes(
      "terminalTabs.find(t => (t.config as PanelConfig).terminalId === id)",
    ),
    "the dialog opens for the terminal that asked",
  );
  assert.ok(
    !/terminalSnippets|sendTerminalCommand|onChange|writeTerminal/.test(opener),
    "the listener never saves or sends",
  );

  // The dialog: the draft is two plain fields and one note; no new outlet.
  const dialog = tight(stripComments(read("src/TerminalSnippets.tsx")));
  assert.equal(
    count(dialog, "draft?: { name: string; text: string } | null;"),
    1,
  );
  assert.equal(count(dialog, 'useState(draft ? draft.name : "")'), 1);
  assert.equal(count(dialog, 'useState(draft ? draft.text : "")'), 1);
  assert.equal(count(dialog, "{draft && <p"), 1);
  assert.equal(count(dialog, "onInsert("), 2, "no new way to insert");
  assert.equal(
    count(dialog, "onChange("),
    2,
    "the saved list is still written only by Save snippet and the Delete button",
  );
  const dialogImports = [
    ...stripComments(read("src/TerminalSnippets.tsx")).matchAll(
      /^import .* from "([^"]+)";/gm,
    ),
  ].map((m) => m[1]);
  assert.ok(
    !dialogImports.includes("./snippet-draft"),
    "the dialog does not know the event module",
  );
});

test("snippet-draft docs: TERMINALS.md says the menu item needs a one-line selection, opens the dialog prefilled and never saves or sends by itself", () => {
  const doc = read("TERMINALS.md");
  assert.ok(!doc.startsWith(char(0xfeff)), "no byte order mark");
  assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"), "one final line feed");
  assert.ok(!doc.includes("\r"), "no carriage return");
  const lines = doc.split("\n");
  const hits = lines
    .map((line, i) => [line, i])
    .filter(([line]) => line.startsWith("Save selection as snippet"));
  assert.equal(hits.length, 1, "one paragraph");
  const [para, at] = hits[0];
  assert.ok(
    para.startsWith(
      "Save selection as snippet: right-click a terminal with text selected and choose Save selection as snippet",
    ),
  );
  assert.ok(!/[^ -~]/.test(para), "printable ASCII on one line");
  assert.equal(lines[at - 1], "");
  assert.equal(lines[at + 1], "");
  const exported = lines.findIndex((l) =>
    l.startsWith("Snippet export and import: "),
  );
  const keys = lines.findIndex((l) =>
    l.startsWith("While a terminal has keyboard focus, Ctrl+Shift+K"),
  );
  assert.ok(exported >= 0 && keys > exported, "anchors exist");
  assert.ok(
    at > exported && at < keys,
    "after the export paragraph, inside the snippet area",
  );
  for (const fragment of [
    "The item is greyed out when nothing is selected",
    "opens Saved snippets with the name and the command filled in",
    "the name is the first 30 characters of the text",
    "you press Save snippet to keep it, and you can change the name first",
    "Nothing is saved, typed into the terminal or sent until you do",
    "A snippet is a single line, so a selection that spans several lines is refused with a notice, never joined or cut to its first line",
    "so is one with control or invisible characters or more than 10,000 characters",
    "the spaces at the start and end of the selection are dropped",
    "A selection can contain secrets, and a saved snippet is stored as plain text in HRig's workspace settings, so check it before you save",
    "The selected text is not logged.",
  ])
    assert.ok(para.includes(fragment), "missing: " + fragment);
});
