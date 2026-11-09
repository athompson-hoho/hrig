const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const char = (code) => String.fromCharCode(code);

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
  }).outputFiles[0].text;
}
function load(entry) {
  const mod = new Module(path.join(root, entry), module);
  mod._compile(bundle(entry), path.join(root, entry));
  return mod.exports;
}

const pure = load("src/terminal-paste-history.ts");
const settings = load("src/settings.ts");
const {
  MAX_PASTE_HISTORY,
  MAX_PASTE_CHARS,
  MAX_PREVIEW_CHARS,
  pushPaste,
  previewOf,
} = pure;

// ---- the pure rules ----

test("terminal-paste-history push: the list keeps the newest ten pastes, moves a repeat to the front, keeps the text exactly and ignores empty, blank, huge and non-text input without changing its input", () => {
  assert.equal(MAX_PASTE_HISTORY, 10);
  assert.equal(MAX_PASTE_CHARS, 10000);
  assert.equal(MAX_PREVIEW_CHARS, 80);
  assert.deepEqual(pushPaste([], "a"), ["a"]);
  assert.deepEqual(pushPaste(["a"], "b"), ["b", "a"]);
  assert.deepEqual(pushPaste(["b", "a"], "a"), ["a", "b"]);
  assert.deepEqual(pushPaste(["c", "b", "a"], "b"), ["b", "c", "a"]);

  // The text is kept exactly as pasted: a trailing line break is part of it, so a repeat of it still asks first.
  assert.deepEqual(pushPaste(["ls"], "ls\n"), ["ls\n", "ls"]);
  assert.deepEqual(pushPaste([], "  padded  \n"), ["  padded  \n"]);

  // The cap: the newest ten stay and the oldest are dropped.
  let list = [];
  for (let i = 0; i < 12; i++) list = pushPaste(list, "p" + i);
  assert.deepEqual(list, [
    "p11",
    "p10",
    "p9",
    "p8",
    "p7",
    "p6",
    "p5",
    "p4",
    "p3",
    "p2",
  ]);
  const again = pushPaste(list, "p5");
  assert.equal(again[0], "p5");
  assert.deepEqual(
    [...again].sort(),
    [...list].sort(),
    "a repeat at the cap drops nothing",
  );
  const long = Array.from({ length: 15 }, (_, i) => "x" + i);
  assert.equal(pushPaste(long, "new").length, 10);
  assert.equal(
    pushPaste(long, "").length,
    10,
    "an over-long list is cut even when nothing is added",
  );

  // Empty and blank text is never remembered.
  for (const skip of [
    "",
    " ",
    "\n",
    "\t \r\n  ",
    "\u{00a0}",
    "\u{2003}\u{2028}",
  ]) {
    const input = ["keep"];
    const out = pushPaste(input, skip);
    assert.deepEqual(out, ["keep"], JSON.stringify(skip));
    assert.notEqual(out, input, "a new list");
  }

  // The size cap: 10,000 characters are kept, one more is not (and is not even scanned for blanks).
  const edge = "x".repeat(10000);
  assert.deepEqual(pushPaste(["a"], edge), [edge, "a"]);
  assert.deepEqual(pushPaste(["a"], edge + "x"), ["a"]);
  assert.deepEqual(pushPaste([], " ".repeat(10001)), []);

  // Anything that is not text is ignored.
  for (const bad of [undefined, null, 5, {}, [], ["a"], true])
    assert.deepEqual(pushPaste(["a"], bad), ["a"]);

  // Nothing is mutated.
  const frozen = Object.freeze(["b", "a"]);
  const out = pushPaste(frozen, "c");
  assert.deepEqual(out, ["c", "b", "a"]);
  assert.notEqual(out, frozen);
  assert.deepEqual(pushPaste(frozen, "a"), ["a", "b"]);
  assert.deepEqual(frozen, ["b", "a"]);

  const cleared = pure.clearPastes();
  assert.deepEqual(cleared, []);
  assert.notEqual(pure.clearPastes(), cleared, "a new list each time");
});

test("terminal-paste-history preview: the picker line is the first line with text, cleaned of control and invisible characters, cut to 80 characters, with the line count and the length", () => {
  assert.deepEqual(previewOf("ls -la"), { text: "ls -la", lines: 1, chars: 6 });
  assert.deepEqual(previewOf("a\nb\nc"), { text: "a", lines: 3, chars: 5 });
  assert.deepEqual(previewOf("a\r\nb"), { text: "a", lines: 2, chars: 4 });
  assert.deepEqual(previewOf("a\rb"), { text: "a", lines: 2, chars: 3 });
  assert.deepEqual(
    previewOf("ls\n"),
    { text: "ls", lines: 1, chars: 3 },
    "one trailing break is not a line",
  );

  // The first line that has text; white space inside it is collapsed.
  const spaced = "\n\n  \r\n\t\n  echo   hi \t there  \nnext";
  assert.deepEqual(previewOf(spaced), {
    text: "echo hi there",
    lines: 6,
    chars: spaced.length,
  });
  assert.equal(previewOf("\u0007\u0001\nreal").text, "real");

  // Control characters are shown as nothing.
  assert.equal(
    previewOf("a\u0000b\u0007c\u001b[31md\u007fe\u0085f\u009fg").text,
    "abc[31mdefg",
  );
  assert.equal(previewOf("a\tb").text, "a b");

  // Invisible and direction characters, tag characters and lone surrogates are dropped; emoji sequences stay whole.
  assert.equal(
    previewOf("ab\u{202e}cd\u{200b}ef\u{2066}g\u{00ad}h\u{feff}i\u{061c}j")
      .text,
    "abcdefghij",
  );
  assert.equal(previewOf("a\u{E0041}b\ud800c").text, "abc");
  const family = "\u{1F468}\u{200d}\u{1F469}\u{200d}\u{1F467}";
  assert.equal(previewOf("x " + family).text, "x " + family);
  assert.equal(previewOf("\u{2764}\u{fe0f}").text, "\u{2764}\u{fe0f}");
  assert.deepEqual(previewOf("\u{200b}\u{202e}"), {
    text: "",
    lines: 1,
    chars: 2,
  });

  // The 80-character cut, by characters rather than code units, with an ellipsis and no trailing space before it.
  assert.equal(previewOf("x".repeat(80)).text, "x".repeat(80));
  assert.equal(previewOf("x".repeat(81)).text, "x".repeat(80) + "\u{2026}");
  assert.equal(previewOf("x".repeat(200)).text.length, 81);
  assert.equal(
    previewOf("x".repeat(79) + " yyy").text,
    "x".repeat(79) + "\u{2026}",
  );
  assert.equal(previewOf("\u{1F600}".repeat(80)).text, "\u{1F600}".repeat(80));
  assert.equal(
    previewOf("\u{1F600}".repeat(81)).text,
    "\u{1F600}".repeat(80) + "\u{2026}",
  );

  // Empty and non-text input shows nothing.
  for (const none of ["", undefined, null, 5, {}])
    assert.deepEqual(previewOf(none), { text: "", lines: 0, chars: 0 });

  // Huge text stays cheap: only the first 4,096 characters are looked at.
  const big = "x".repeat(5000000);
  assert.deepEqual(previewOf(big), {
    text: "x".repeat(80) + "\u{2026}",
    lines: 1,
    chars: 5000000,
  });
  const blank = "\n".repeat(100000) + "hi";
  assert.deepEqual(previewOf(blank), {
    text: "",
    lines: 100001,
    chars: 100002,
  });
  assert.equal(previewOf("\n".repeat(1000) + "hi").text, "hi");

  // Hostile text of every kind never throws and never shows a break or a hidden character.
  const alphabet = [
    "a",
    "Z",
    " ",
    "\t",
    "\r",
    "\n",
    "\u0000",
    "\u001b",
    "\u007f",
    "\u0085",
    "\u{00ad}",
    "\u{200b}",
    "\u{200d}",
    "\u{202e}",
    "\u{2066}",
    "\u{2028}",
    "\u{feff}",
    "\ud800",
    "\udc00",
    "\u{1F600}",
    "\u{E0041}",
    "\u{00a0}",
    "\u{3000}",
  ];
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const hidden =
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u{00ad}\u{061c}\u{180e}\u{200b}\u{200c}\u{200e}\u{200f}\u{2028}-\u{202e}\u{2060}-\u{206f}\u{feff}\ud800-\udfff\u{e0000}-\u{e007f}]/u;
  for (let n = 0; n < 400; n++) {
    let text = "";
    const size = next() % 120;
    for (let i = 0; i < size; i++) text += alphabet[next() % alphabet.length];
    const out = previewOf(text);
    assert.equal(typeof out.text, "string");
    assert.ok(
      [...out.text].length <= MAX_PREVIEW_CHARS + 1,
      JSON.stringify(text),
    );
    assert.ok(!/[\r\n]/.test(out.text), JSON.stringify(text));
    assert.ok(!hidden.test(out.text), JSON.stringify(text));
    assert.equal(out.chars, text.length);
  }
});

// ---- the real TerminalTools component, run outside React over fakes ----
// The component is bundled with its real helper modules; react, the icon set, the settings context, the shared widgets and the xterm search addon are replaced. A small hook runtime keeps state, refs and effects (with their dependency lists) per mounted terminal, so two terminals share the one module-level store exactly as two panels do.
const TOOLS_EXTERNAL = [
  "react",
  "react/jsx-runtime",
  "lucide-react",
  "./SettingsContext",
  "./components",
  "@xterm/addon-search",
];
let toolsText;
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
const BASE_MENU = [
  "Copy",
  "Save selection as snippet" + char(8230),
  "Create task from selection" + char(8230),
  "Paste",
  "Select all",
];
const HISTORY_LABEL = "Paste from history" + char(8230);
const WITH_HISTORY_MENU = [
  "Copy",
  "Save selection as snippet" + char(8230),
  "Create task from selection" + char(8230),
  "Paste",
  HISTORY_LABEL,
  "Select all",
];

function loadTools() {
  toolsText ??= bundle("src/TerminalTools.tsx", TOOLS_EXTERNAL);
  const world = {
    current: null,
    mounted: [],
    // The setting is left out on purpose: absent means off, as in every other harness.
    effective: {
      "terminal.copyOnSelect": false,
      "terminal.confirmMultilinePaste": false,
      "terminal.copyTrimTrailingWhitespace": false,
    },
    clipboard: "",
    reads: 0,
    bridge: [],
  };
  const react = {
    useState: (initial) => world.current.state(initial),
    useRef: (initial) => world.current.ref(initial),
    useEffect: (fn, deps) => world.current.effect(fn, deps),
  };
  const element = (type, props) => ({ type, props });
  const lucide = new Proxy({}, { get: (_, name) => String(name) });
  const mod = new Module(path.join(root, "src/TerminalTools.tsx"), module);
  mod.require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return { jsx: element, jsxs: element, Fragment: "fragment" };
    if (name === "lucide-react") return lucide;
    if (name === "./SettingsContext")
      return { useSettings: () => ({ effective: world.effective }) };
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

  function mount(initial = {}) {
    const slots = [];
    const effectSlots = [];
    const pending = [];
    let hook = 0;
    let flushing = false;
    const inst = {
      tree: null,
      pasted: [],
      focused: 0,
      listeners: {},
      keyHandler: null,
      props: null,
      state(start) {
        const i = hook++;
        if (!(i in slots)) slots[i] = start;
        return [
          slots[i],
          (value) => {
            const next = typeof value === "function" ? value(slots[i]) : value;
            if (Object.is(next, slots[i])) return;
            slots[i] = next;
            render();
          },
        ];
      },
      ref(start) {
        const i = hook++;
        if (!(i in slots)) slots[i] = { current: start };
        return slots[i];
      },
      effect(fn, deps) {
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
    const term = {
      loadAddon() {},
      attachCustomKeyEventHandler(f) {
        inst.keyHandler = f;
      },
      hasSelection: () => false,
      getSelection: () => "",
      onSelectionChange: () => ({ dispose() {} }),
      element: {
        parentElement: {
          addEventListener(name, f) {
            inst.listeners[name] = f;
          },
          removeEventListener(name) {
            delete inst.listeners[name];
          },
        },
      },
      buffer: { active: { viewportY: 0 } },
      scrollToLine() {},
      focus() {
        inst.focused++;
      },
      clear() {},
      paste(text) {
        inst.pasted.push(text);
      },
      selectAll() {},
    };
    inst.props = {
      generation: 1,
      terminalId: "t-1",
      terminal: { current: term },
      ...initial,
    };
    function flush() {
      if (flushing) return;
      flushing = true;
      try {
        while (pending.length) pending.shift()();
      } finally {
        flushing = false;
      }
    }
    function render() {
      const before = world.current;
      world.current = inst;
      hook = 0;
      try {
        inst.tree = Tools(inst.props);
      } finally {
        world.current = before;
      }
      flush();
    }
    render();
    const find = (test) => flatten(inst.tree).find(test) || null;
    const items = () =>
      flatten(inst.tree).filter(
        (n) => n.type === "button" && n.props.role === "menuitem",
      );
    const handle = {
      pasted: inst.pasted,
      term,
      props: () => inst.props,
      focused: () => inst.focused,
      render,
      setProps(next) {
        inst.props = { ...inst.props, ...next };
        render();
      },
      unmount() {
        for (const slot of effectSlots)
          if (slot && slot.cleanup) slot.cleanup();
        effectSlots.length = 0;
        world.mounted = world.mounted.filter((m) => m !== handle);
      },
      async pressPaste() {
        assert.ok(inst.keyHandler, "the key handler is registered");
        inst.keyHandler({
          key: "v",
          type: "keydown",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          preventDefault() {},
        });
        await tick();
      },
      async openMenu(y = 20) {
        inst.listeners.contextmenu({
          preventDefault() {},
          clientX: 10,
          clientY: y,
        });
        await tick();
      },
      labels: () => items().map(textOf),
      async click(label) {
        const item = items().find((n) => textOf(n) === label);
        assert.ok(item, "menu item " + label);
        item.props.onClick();
        await tick();
      },
      picker: () => {
        const el = find(
          (n) =>
            typeof n.type === "function" &&
            n.props &&
            Array.isArray(n.props.entries),
        );
        return el && el.props;
      },
      confirm: () => {
        const el = find(
          (n) =>
            typeof n.type === "function" &&
            n.props &&
            typeof n.props.onAnswer === "function",
        );
        return el && el.props;
      },
      notice: () => {
        const el = find(
          (n) => n.props && n.props.className === "terminal-tool-notice",
        );
        return el ? textOf(el.props.children[0]) : "";
      },
      menuTop: () => {
        const el = find((n) => n.props && n.props.role === "menu");
        return el && el.props.style.top;
      },
    };
    world.mounted.push(handle);
    return handle;
  }
  return {
    mount,
    effective: world.effective,
    get bridge() {
      return world.bridge;
    },
    get reads() {
      return world.reads;
    },
    set clipboard(text) {
      world.clipboard = text;
    },
    // Re-renders every mounted terminal, as a changed setting does.
    rerenderAll() {
      for (const m of [...world.mounted]) m.render();
    },
    install() {
      const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
      // Only the calls the paste route makes are allowed; any other bridge call is recorded and fails the test that made it.
      const hrig = new Proxy(
        {
          platform: "linux",
          clipboardHasImage: async () => false,
          readClipboardText: async () => {
            world.reads++;
            return world.clipboard;
          },
          exportTerminal: async () => ({ saved: false }),
        },
        {
          get(target, name) {
            if (name in target) return target[name];
            world.bridge.push(String(name));
            return () => Promise.resolve();
          },
        },
      );
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: {
          innerWidth: 1000,
          innerHeight: 800,
          hrig,
          addEventListener() {},
          removeEventListener() {},
        },
      });
      return () => {
        if (previous) Object.defineProperty(globalThis, "window", previous);
        else delete globalThis.window;
      };
    },
  };
}
async function withTools(run) {
  const tools = loadTools();
  const restore = tools.install();
  try {
    return await run(tools);
  } finally {
    restore();
  }
}

test("terminal-paste-history tracer: with the setting on, what the real terminal tools paste is remembered, Paste from history in the right-click menu lists it, choosing an entry pastes it through the same route (the multi-line confirmation included) and nothing else happens", async () => {
  await withTools(async (tools) => {
    const a = tools.mount({ terminalId: "a" });

    // Off (the default): the paste works and is remembered nowhere; the menu is the base menu.
    tools.clipboard = "echo off";
    await a.pressPaste();
    assert.deepEqual(a.pasted, ["echo off"]);
    await a.openMenu();
    assert.deepEqual(a.labels(), BASE_MENU);
    await a.click("Paste");
    assert.deepEqual(a.pasted, ["echo off", "echo off"]);
    await a.openMenu();
    assert.deepEqual(
      a.labels(),
      BASE_MENU,
      "nothing was remembered while it was off",
    );

    // On: pastes from the key and from the menu are remembered, newest first.
    tools.effective["terminal.pasteHistory"] = true;
    a.render();
    tools.clipboard = "echo one";
    await a.pressPaste();
    tools.clipboard = "echo two";
    await a.openMenu();
    await a.click("Paste");
    assert.deepEqual(a.pasted.slice(2), ["echo one", "echo two"]);
    await a.openMenu();
    assert.deepEqual(
      a.labels(),
      WITH_HISTORY_MENU,
      "the item sits right after Paste",
    );

    // Opening the picker pastes nothing, reads no clipboard and calls no other bridge function.
    const reads = tools.reads;
    const total = a.pasted.length;
    await a.click(HISTORY_LABEL);
    const picker = a.picker();
    assert.ok(picker, "the picker opens");
    assert.deepEqual(picker.entries, ["echo two", "echo one"]);
    assert.equal(a.pasted.length, total);
    assert.equal(tools.reads, reads);

    // Choosing an entry pastes exactly that text once, reads no clipboard, closes the picker and moves the entry to the front.
    picker.onChoose("echo one");
    await tick();
    assert.equal(a.pasted.length, total + 1);
    assert.equal(a.pasted.at(-1), "echo one");
    assert.equal(tools.reads, reads, "the clipboard is not read for an entry");
    assert.equal(a.picker(), null, "the picker closes");
    await a.openMenu();
    await a.click(HISTORY_LABEL);
    assert.deepEqual(a.picker().entries, ["echo one", "echo two"]);
    a.picker().onClose();
    assert.equal(a.picker(), null);

    // A multi-line paste asks first and is remembered only after Paste; a refused one is not remembered.
    tools.effective["terminal.confirmMultilinePaste"] = true;
    a.render();
    tools.clipboard = "x\ny";
    await a.pressPaste();
    assert.ok(a.confirm(), "the confirmation opens");
    a.confirm().onAnswer(false);
    await tick();
    assert.equal(a.pasted.at(-1), "echo one", "a refused paste pastes nothing");
    tools.clipboard = "ls\npwd";
    await a.pressPaste();
    a.confirm().onAnswer(true);
    await tick();
    assert.equal(a.pasted.at(-1), "ls\npwd");
    await a.openMenu();
    await a.click(HISTORY_LABEL);
    assert.deepEqual(
      a.picker().entries,
      ["ls\npwd", "echo one", "echo two"],
      "the refused text is not in the list",
    );

    // Choosing the multi-line entry asks again; Cancel pastes nothing and changes nothing; Paste pastes it exactly once.
    const before = a.pasted.length;
    a.picker().onChoose("ls\npwd");
    await tick();
    const ask = a.confirm();
    assert.ok(ask, "the multi-line confirmation applies to an entry");
    assert.equal(ask.lines, 2);
    assert.equal(
      a.pasted.length,
      before,
      "nothing is pasted until Paste is chosen",
    );
    ask.onAnswer(false);
    await tick();
    assert.equal(a.pasted.length, before);
    assert.equal(a.confirm(), null);
    await a.openMenu();
    await a.click(HISTORY_LABEL);
    assert.deepEqual(a.picker().entries, ["ls\npwd", "echo one", "echo two"]);
    a.picker().onChoose("ls\npwd");
    await tick();
    a.confirm().onAnswer(true);
    await tick();
    assert.equal(a.pasted.length, before + 1);
    assert.equal(
      a.pasted.at(-1),
      "ls\npwd",
      "pasted exactly as it was, with no Enter added",
    );

    // The bridge saw nothing but the clipboard reads: no terminal write, so Enter is never sent.
    assert.deepEqual(tools.bridge, []);
  });
});

test("terminal-paste-history store: each terminal has its own list, the list goes when the terminal closes or the setting is turned off, Clear history empties it, and a paste that does not reach the terminal is not remembered", async () => {
  await withTools(async (tools) => {
    tools.effective["terminal.pasteHistory"] = true;
    const a = tools.mount({ terminalId: "a" });
    const b = tools.mount({ terminalId: "b" });
    tools.clipboard = "secret-for-a";
    await a.pressPaste();
    await b.openMenu();
    assert.deepEqual(b.labels(), BASE_MENU, "another terminal does not see it");
    tools.clipboard = "secret-for-b";
    await b.pressPaste();
    await a.openMenu();
    await a.click(HISTORY_LABEL);
    assert.deepEqual(a.picker().entries, ["secret-for-a"]);
    a.picker().onClose();
    await b.openMenu();
    await b.click(HISTORY_LABEL);
    assert.deepEqual(b.picker().entries, ["secret-for-b"]);
    b.picker().onClose();

    // A reconnect (a new generation) keeps the list.
    a.setProps({ generation: 2 });
    await a.openMenu();
    assert.deepEqual(a.labels(), WITH_HISTORY_MENU);

    // The item lifts the bottom-edge clamp by its own height, and only while it shows.
    await a.openMenu(790);
    assert.equal(a.menuTop(), 800 - 223 - 33);
    const c = tools.mount({ terminalId: "c" });
    await c.openMenu(790);
    assert.equal(c.menuTop(), 800 - 223, "no history, no change to the clamp");

    // Clear history forgets this terminal's entries at once and says so without showing any of them.
    await a.openMenu();
    await a.click(HISTORY_LABEL);
    a.picker().onClear();
    assert.equal(a.picker(), null, "the picker closes");
    assert.equal(a.notice(), "Paste history cleared.");
    await a.openMenu();
    assert.deepEqual(a.labels(), BASE_MENU);
    await b.openMenu();
    assert.deepEqual(
      b.labels().includes(HISTORY_LABEL),
      true,
      "another terminal keeps its own list",
    );

    // Closing a terminal forgets its list: a new panel with the same id starts empty.
    b.unmount();
    const again = tools.mount({ terminalId: "b" });
    await again.openMenu();
    assert.deepEqual(again.labels(), BASE_MENU);

    // Turning the setting off forgets every list and closes an open picker; turning it on again starts empty.
    tools.clipboard = "to-be-forgotten";
    await again.pressPaste();
    await again.openMenu();
    await again.click(HISTORY_LABEL);
    assert.ok(again.picker());
    tools.effective["terminal.pasteHistory"] = false;
    tools.rerenderAll();
    assert.equal(again.picker(), null, "the open picker closes");
    await again.openMenu();
    assert.deepEqual(again.labels(), BASE_MENU);
    tools.clipboard = "while-off";
    await again.pressPaste();
    tools.effective["terminal.pasteHistory"] = true;
    tools.rerenderAll();
    await again.openMenu();
    assert.deepEqual(
      again.labels(),
      BASE_MENU,
      "nothing came back and nothing was kept while it was off",
    );

    // A paste that never reaches the terminal (the terminal was replaced while the confirmation was open) is not remembered.
    tools.effective["terminal.confirmMultilinePaste"] = true;
    again.render();
    tools.clipboard = "p\nq";
    await again.pressPaste();
    const ask = again.confirm();
    assert.ok(ask);
    const pastedBefore = again.pasted.length;
    again.props().terminal.current = {
      ...again.term,
      paste: () => assert.fail("pasted into the replacement"),
    };
    ask.onAnswer(true);
    await tick();
    assert.equal(
      again.pasted.length,
      pastedBefore,
      "nothing was pasted into the old terminal either",
    );
    await again.openMenu();
    assert.deepEqual(again.labels(), BASE_MENU);
    assert.deepEqual(tools.bridge, []);
  });
});

// ---- the picker dialog ----

let pickerText;
function renderPicker(props) {
  pickerText ??= bundle("src/TerminalPasteHistory.tsx", [
    "react",
    "react/jsx-runtime",
    "./components",
  ]);
  const effects = [];
  const react = {
    useRef: (start) => ({ current: start }),
    useEffect: (fn) => effects.push(fn),
  };
  const element = (type, p) => ({ type, props: p });
  const mod = new Module(
    path.join(root, "src/TerminalPasteHistory.tsx"),
    module,
  );
  mod.require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return { jsx: element, jsxs: element, Fragment: "fragment" };
    if (name === "./components") return { Modal: "Modal" };
    return {};
  };
  mod._compile(pickerText, path.join(root, "src/TerminalPasteHistory.tsx"));
  const tree = mod.exports.default(props);
  const group = flatten(tree).find((n) => n.props && n.props.role === "group");
  assert.ok(group, "the list is a group");
  const focus = { list: 0 };
  group.props.ref.current = {
    focus() {
      focus.list++;
    },
  };
  for (const fn of effects) fn();
  const buttons = flatten(group.props.children).filter(
    (n) => n.type === "button",
  );
  const named = (label) =>
    flatten(tree).find((n) => n.type === "button" && textOf(n) === label);
  const wrapper = flatten(tree).find(
    (n) => n.type === "div" && typeof n.props.onKeyDown === "function",
  );
  return {
    tree,
    group,
    focus,
    buttons,
    named,
    wrapper,
    modal: flatten(tree).find((n) => n.type === "Modal"),
  };
}
const parts = (button) => {
  const [main, small] = button.props.children.props.children;
  return [main, textOf(small)];
};

test("terminal-paste-history picker: the dialog lists previews only, starts with the focus on the list and nothing chosen, and only a click on an entry hands its text back", () => {
  const calls = [];
  const props = {
    entries: [
      "echo one",
      "line one\nline two with a long tail " + "z".repeat(200),
      "\u{200b}\u{202e}",
      "ab\u{202e}cd",
    ],
    onChoose: (text) => calls.push(["choose", text]),
    onClear: () => calls.push(["clear"]),
    onClose: () => calls.push(["close"]),
  };
  const ui = renderPicker(props);

  assert.equal(ui.modal.props.title, "Paste from history");
  assert.equal(
    ui.modal.props.onClose,
    props.onClose,
    "the close icon and the outside click close it",
  );
  assert.match(
    ui.modal.props.subtitle,
    /Nothing is sent to the terminal until you choose an entry/,
  );
  assert.deepEqual(calls, [], "opening pastes, clears and closes nothing");

  // Focus starts on the list itself, which is not a tab stop; no entry has the focus or is selected.
  assert.equal(ui.focus.list, 1);
  assert.equal(ui.group.props.tabIndex, -1);
  assert.equal(ui.buttons.length, 4);
  assert.ok(
    !flatten(ui.tree).some(
      (n) =>
        n.props &&
        (n.props.autoFocus ||
          n.props["aria-selected"] ||
          n.props["aria-pressed"]),
    ),
  );

  // Previews: the first line with text only, never the rest, never the hidden characters, with the counts.
  assert.deepEqual(parts(ui.buttons[0]), ["echo one", "1 line, 8 characters"]);
  const second = parts(ui.buttons[1]);
  assert.equal(second[0], "line one");
  assert.match(second[1], /^2 lines, \d+ characters$/);
  assert.deepEqual(parts(ui.buttons[2]), [
    "(no visible text)",
    "1 line, 2 characters",
  ]);
  assert.equal(parts(ui.buttons[3])[0], "abcd");
  const shown = textOf(ui.tree);
  assert.ok(
    !shown.includes("line two") && !shown.includes("zzz"),
    "only the first line is ever shown",
  );
  assert.ok(!/[\u{202e}\u{200b}]/u.test(shown));
  assert.ok(
    !flatten(ui.tree).some((n) => n.type === "button" && n.props.title),
    "no tooltip repeats the text",
  );

  // A click on an entry hands back its full text, once, and nothing else.
  ui.buttons[1].props.onClick();
  assert.deepEqual(calls, [["choose", props.entries[1]]]);
  calls.length = 0;
  ui.buttons[3].props.onClick();
  assert.deepEqual(
    calls,
    [["choose", "ab\u{202e}cd"]],
    "the full text is handed back, not the preview",
  );
  calls.length = 0;

  // The buttons.
  ui.named("Clear history").props.onClick();
  ui.named("Close").props.onClick();
  assert.deepEqual(calls, [["clear"], ["close"]]);
  calls.length = 0;

  // Escape closes without choosing; other keys do nothing.
  let prevented = 0;
  ui.wrapper.props.onKeyDown({
    key: "Enter",
    preventDefault: () => prevented++,
  });
  ui.wrapper.props.onKeyDown({ key: " ", preventDefault: () => prevented++ });
  ui.wrapper.props.onKeyDown({
    key: "ArrowDown",
    preventDefault: () => prevented++,
  });
  assert.deepEqual(calls, []);
  assert.equal(prevented, 0);
  ui.wrapper.props.onKeyDown({
    key: "Escape",
    preventDefault: () => prevented++,
  });
  assert.deepEqual(calls, [["close"]]);
  assert.equal(prevented, 1);

  // An empty list still renders, with no entry to choose.
  assert.equal(renderPicker({ ...props, entries: [] }).buttons.length, 0);
});
