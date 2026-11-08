const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function collapse(text) {
  return text.replace(/\s+/g, " ");
}
function tight(text) {
  return collapse(text)
    .replace(/\( /g, "(")
    .replace(/(?:, )? ?\)/g, ")");
}
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function count(text, needle) {
  return text.split(needle).length - 1;
}
function between(text, start, end) {
  const from = text.indexOf(tight(start));
  assert.ok(from >= 0, "missing start: " + start);
  const to = text.indexOf(tight(end), from + 1);
  assert.ok(to > from, "missing end: " + end);
  return text.slice(from, to);
}

function bundle(entry, external) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    external: external || [],
  }).outputFiles[0].text;
}
function loadPure() {
  const mod = new Module("terminal-search-history-test", module);
  mod._compile(
    bundle("src/terminal-search-history.ts"),
    "terminal-search-history-test",
  );
  return mod.exports;
}
const pure = loadPure();
const {
  MAX_SEARCH_HISTORY,
  MAX_SEARCH_QUERY,
  pushSearchQuery,
  recallSearchQuery,
  historyKeyDirection,
} = pure;

// ---- the real TerminalTools component, run outside React over fakes ----
// The component is bundled with its real helper modules; react, the icon set, the settings context, the shared widgets and the xterm search addon are replaced. A small hook runtime keeps state, refs and effects (with their dependency lists) so the real find box, its change handler and its key handler run exactly as written.
const TOOLS_ENTRY = "src/TerminalTools.tsx";
const TOOLS_EXTERNAL = [
  "react",
  "react/jsx-runtime",
  "lucide-react",
  "./SettingsContext",
  "./components",
  "@xterm/addon-search",
];
let toolsText;

function fakeTerminal() {
  return {
    loadAddon() {},
    attachCustomKeyEventHandler() {},
    hasSelection: () => false,
    getSelection: () => "",
    onSelectionChange: () => ({ dispose() {} }),
    element: {
      parentElement: { addEventListener() {}, removeEventListener() {} },
    },
    buffer: { active: { viewportY: 0 } },
    scrollToLine() {},
    focus() {},
    clear() {},
    paste() {},
  };
}

function loadTools() {
  toolsText ??= bundle(TOOLS_ENTRY, TOOLS_EXTERNAL);
  const world = { searches: [], cleared: 0, current: null, timers: [] };
  const react = {
    useState: (initial) => world.current.state(initial),
    useRef: (initial) => world.current.ref(initial),
    useEffect: (fn, deps) => world.current.effect(fn, deps),
  };
  class FakeSearch {
    onDidChangeResults() {
      return { dispose() {} };
    }
    findNext(query, options) {
      world.searches.push({ method: "findNext", query, options });
      return true;
    }
    findPrevious(query, options) {
      world.searches.push({ method: "findPrevious", query, options });
      return true;
    }
    clearDecorations() {
      world.cleared++;
    }
    dispose() {}
  }
  const effective = {
    "terminal.copyOnSelect": false,
    "terminal.confirmMultilinePaste": false,
    "terminal.copyTrimTrailingWhitespace": false,
  };
  const mod = new Module(path.join(root, TOOLS_ENTRY), module);
  mod.require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") {
      const record = (type, props) => {
        world.current.calls.push({ type, props });
        return null;
      };
      return { jsx: record, jsxs: record };
    }
    if (name === "./SettingsContext")
      return { useSettings: () => ({ effective }) };
    if (name === "@xterm/addon-search") return { SearchAddon: FakeSearch };
    return {};
  };
  mod._compile(toolsText, path.join(root, TOOLS_ENTRY));
  const Tools = mod.exports.default;

  function mount(initialProps) {
    let props = { generation: 1, terminalId: "t", ...initialProps };
    props.terminal ??= { current: fakeTerminal() };
    const slots = [];
    const effectSlots = [];
    const pending = [];
    let hook = 0;
    let flushing = false;
    const inst = {
      calls: [],
      state(initial) {
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
      ref(initial) {
        const i = hook++;
        if (!(i in slots)) slots[i] = { current: initial };
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
      inst.calls = [];
      try {
        Tools(props);
      } finally {
        world.current = before;
      }
      flush();
    }
    render();

    const input = () => {
      const element = inst.calls.find(
        (c) =>
          c.type === "input" && c.props["aria-label"] === "Find in terminal",
      );
      assert.ok(element, "the find box must be open");
      return element.props;
    };
    const handle = {
      open: () => inst.calls.some((c) => c.type === "input"),
      value: () => input().value,
      type: (text) => input().onChange({ target: { value: text } }),
      press(key, extra) {
        const event = {
          key,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          nativeEvent: { isComposing: false },
          defaultPrevented: false,
          preventDefault() {
            event.defaultPrevented = true;
          },
          ...extra,
        };
        input().onKeyDown(event);
        return event;
      },
      click(label) {
        const button = inst.calls.find(
          (c) => c.type === "button" && c.props["aria-label"] === label,
        );
        assert.ok(button, "missing button " + label);
        button.props.onClick();
      },
      escape() {
        const panel = inst.calls.find(
          (c) => c.type === "div" && c.props.className === "terminal-tools",
        );
        panel.props.onKeyDown({
          key: "Escape",
          preventDefault() {},
          stopPropagation() {},
        });
      },
      reopen() {
        props = { ...props, findRequest: (props.findRequest || 0) + 1 };
        render();
      },
    };
    return handle;
  }
  return {
    mount,
    searches: world.searches,
    // Runs the debounced incremental searches the way the 150 ms timer would.
    settle() {
      const due = world.timers.splice(0);
      for (const timer of due) timer.fn();
    },
    timers: world.timers,
    install() {
      const saved = {
        window: Object.getOwnPropertyDescriptor(globalThis, "window"),
        raf: Object.getOwnPropertyDescriptor(
          globalThis,
          "requestAnimationFrame",
        ),
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      };
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: {
          hrig: {
            platform: "linux",
            clipboardHasImage: async () => false,
            readClipboardText: async () => "",
          },
        },
      });
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        writable: true,
        value: (f) => f(),
      });
      let next = 0;
      globalThis.setTimeout = (fn) => {
        const timer = { id: ++next, fn };
        world.timers.push(timer);
        return timer.id;
      };
      globalThis.clearTimeout = (id) => {
        const at = world.timers.findIndex((t) => t.id === id);
        if (at >= 0) world.timers.splice(at, 1);
      };
      return () => {
        for (const name of ["window", "requestAnimationFrame"]) {
          const descriptor = saved[name === "window" ? "window" : "raf"];
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
        }
        globalThis.setTimeout = saved.setTimeout;
        globalThis.clearTimeout = saved.clearTimeout;
      };
    },
  };
}
function withTools(run) {
  const tools = loadTools();
  const restore = tools.install();
  try {
    return run(tools);
  } finally {
    restore();
  }
}
const searched = (tools) => tools.searches.map((s) => [s.method, s.query]);

test("terminal-search-history tracer: the real find box remembers a query only when Enter runs a search, ArrowUp and ArrowDown recall it, and every terminal shares the list", () => {
  withTools((tools) => {
    const a = tools.mount({ findRequest: 1 });
    assert.equal(a.open(), true, "Ctrl+F opens the find box");
    assert.equal(a.value(), "");

    // Nothing is remembered yet: the key is left to the input.
    let event = a.press("ArrowUp");
    assert.equal(event.defaultPrevented, false);
    assert.equal(a.value(), "");

    // Enter and Shift+Enter search exactly as before.
    a.type("alpha");
    event = a.press("Enter");
    assert.equal(event.defaultPrevented, true);
    a.type("beta");
    a.press("Enter", { shiftKey: true });
    assert.deepEqual(searched(tools), [
      ["findNext", "alpha"],
      ["findPrevious", "beta"],
    ]);
    assert.equal(tools.searches[0].options.incremental, false);
    assert.equal(tools.searches[0].options.regex, false);
    assert.equal(tools.searches[0].options.caseSensitive, false);

    // Typing alone, and the debounced incremental search, remember nothing.
    a.type("gamma");
    tools.settle();
    assert.deepEqual(searched(tools).slice(2), [["findNext", "gamma"]]);
    assert.equal(tools.searches[2].options.incremental, true);
    a.type("");
    tools.settle();

    // ArrowUp from the empty box walks back, newest first, and stops at the oldest.
    event = a.press("ArrowUp");
    assert.equal(event.defaultPrevented, true);
    assert.equal(a.value(), "beta");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha");
    event = a.press("ArrowUp");
    assert.equal(event.defaultPrevented, true, "browsing keeps the key");
    assert.equal(a.value(), "alpha");
    a.press("ArrowDown");
    assert.equal(a.value(), "beta");
    a.press("ArrowDown");
    assert.equal(a.value(), "");
    event = a.press("ArrowDown");
    assert.equal(event.defaultPrevented, false);
    assert.equal(a.value(), "");

    // Recall never searches or records by itself.
    assert.equal(tools.searches.length, 3, "no search from recalling");

    // Typed text is the person's own: arrows stay with the input.
    a.type("be");
    for (const key of ["ArrowUp", "ArrowDown"]) {
      event = a.press(key);
      assert.equal(event.defaultPrevented, false);
      assert.equal(a.value(), "be");
    }
    a.type("");
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { nativeEvent: { isComposing: true } },
    ]) {
      event = a.press("ArrowUp", extra);
      assert.equal(event.defaultPrevented, false);
      assert.equal(a.value(), "");
    }
    // Editing a recalled query ends browsing; other keys never count as browsing.
    a.press("ArrowUp");
    assert.equal(a.value(), "beta");
    for (const key of ["ArrowLeft", "a", "Home"]) {
      event = a.press(key);
      assert.equal(
        event.defaultPrevented,
        false,
        key + " is not a history key",
      );
      assert.equal(a.value(), "beta");
    }
    a.type("betaX");
    event = a.press("ArrowUp");
    assert.equal(event.defaultPrevented, false);
    assert.equal(a.value(), "betaX");

    // Searching a recalled query moves it to the front and stops browsing.
    a.type("");
    a.press("ArrowUp");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha");
    a.press("Enter");
    assert.equal(tools.searches.length, 4);
    event = a.press("ArrowUp");
    assert.equal(
      event.defaultPrevented,
      false,
      "a searched query is typed text",
    );
    a.type("");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha");
    // Searching the newest entry again leaves the list as it was and still
    // ends browsing, so the box is typed text again.
    a.press("Enter");
    assert.equal(tools.searches.length, 5);
    event = a.press("ArrowUp");
    assert.equal(event.defaultPrevented, false, "typed text after Enter");
    assert.equal(a.value(), "alpha");
    a.type("");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha");
    a.press("ArrowUp");
    assert.equal(a.value(), "beta");

    // Nothing that did not run a search is remembered: an empty box, an invalid
    // regular expression and a blank query (which searches but is not kept).
    a.type("");
    a.press("Enter");
    assert.equal(tools.searches.length, 5, "an empty query runs no search");
    a.click("Use regular expression");
    a.type("[");
    a.press("Enter");
    assert.equal(
      tools.searches.length,
      5,
      "an invalid expression runs no search",
    );
    a.click("Use regular expression");
    a.type("   ");
    a.press("Enter");
    assert.equal(tools.searches.length, 6);
    assert.equal(
      tools.searches[5].query,
      "   ",
      "the search itself is unchanged",
    );
    a.type("");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha", "[ and blanks were not remembered");

    // Closing and reopening the find box keeps the list.
    a.type("");
    a.escape();
    assert.equal(a.open(), false);
    a.reopen();
    assert.equal(a.open(), true);
    a.type("");
    a.press("ArrowUp");
    assert.equal(a.value(), "alpha");

    // A second terminal in the same window sees the same list and adds to it,
    // and each find box keeps its own place while browsing.
    a.type("");
    a.press("ArrowUp");
    a.press("ArrowUp");
    assert.equal(a.value(), "beta", "terminal A is browsing at the oldest");
    const b = tools.mount({ findRequest: 1 });
    assert.equal(b.value(), "");
    b.press("ArrowUp");
    assert.equal(b.value(), "alpha", "terminal B starts at the newest");
    a.press("ArrowDown");
    assert.equal(a.value(), "alpha", "A carries on from its own place");
    b.type("zeta");
    b.press("Enter");
    a.type("");
    a.press("ArrowUp");
    assert.equal(a.value(), "zeta", "what B searched is in A's list");
  });

  // A new window (a new load of the code) starts with nothing remembered.
  withTools((tools) => {
    const fresh = tools.mount({ findRequest: 1 });
    const event = fresh.press("ArrowUp");
    assert.equal(event.defaultPrevented, false);
    assert.equal(fresh.value(), "");
  });
});

test("terminal-search-history list: a bounded most-recent list that trims, dedupes, caps and ignores empty, with recall that stops at both ends", () => {
  assert.equal(MAX_SEARCH_HISTORY, 20);
  assert.equal(MAX_SEARCH_QUERY, 500);

  // push
  assert.deepEqual(pushSearchQuery([], "a"), ["a"]);
  assert.deepEqual(pushSearchQuery(["a"], "  b \t"), ["b", "a"]);
  assert.deepEqual(pushSearchQuery(["c", "b", "a"], "a"), ["a", "c", "b"]);
  assert.deepEqual(pushSearchQuery(["b", "a"], " a "), ["a", "b"]);
  assert.deepEqual(pushSearchQuery(["a"], "A"), ["A", "a"], "case is kept");
  assert.deepEqual(pushSearchQuery([], "a  b"), ["a  b"], "inner spaces kept");
  for (const blank of [
    "",
    " ",
    "   ",
    "\t",
    "\n",
    " \r\n\t ",
    null,
    undefined,
    5,
    {},
  ]) {
    const list = Object.freeze(["x", "y"]);
    const out = pushSearchQuery(list, blank);
    assert.deepEqual(out, ["x", "y"], "ignored: " + String(blank));
    assert.notEqual(out, list, "a copy comes back");
  }
  const input = Object.freeze(["c", "b", "a"]);
  const pushed = pushSearchQuery(input, "d");
  assert.deepEqual(pushed, ["d", "c", "b", "a"]);
  assert.deepEqual(input, ["c", "b", "a"], "the input list is never changed");
  const long = "q".repeat(500);
  assert.deepEqual(
    pushSearchQuery([], long),
    [long],
    "500 characters are kept",
  );
  assert.deepEqual(pushSearchQuery([], "  " + long + "  "), [long]);
  assert.deepEqual(pushSearchQuery(["a"], long + "q"), ["a"], "501 is ignored");
  let grown = [];
  for (let i = 0; i < 25; i++) grown = pushSearchQuery(grown, "q" + i);
  assert.equal(grown.length, 20);
  assert.equal(grown[0], "q24");
  assert.equal(grown[19], "q5");
  assert.equal(new Set(grown).size, 20);
  assert.deepEqual(
    pushSearchQuery(grown, "q10").slice(0, 3),
    ["q10", "q24", "q23"],
    "a duplicate moves up without growing the list",
  );
  assert.equal(pushSearchQuery(grown, "q10").length, 20);
  assert.equal(
    pushSearchQuery(grown, "fresh").at(-1),
    "q6",
    "the oldest drops",
  );

  // recall
  const list = ["c", "b", "a"];
  const step = (index, direction, current) =>
    recallSearchQuery(list, index, direction, current);
  assert.deepEqual(step(-1, "older", ""), { index: 0, text: "c" });
  assert.equal(step(-1, "newer", ""), null);
  assert.equal(step(-1, "older", "x"), null, "typed text is left alone");
  assert.equal(step(-1, "newer", "x"), null);
  assert.equal(step(-1, "older", "c"), null, "equal text is not browsing");
  assert.equal(recallSearchQuery([], -1, "older", ""), null);
  assert.equal(recallSearchQuery([], 0, "newer", ""), null);
  assert.deepEqual(step(0, "older", "c"), { index: 1, text: "b" });
  assert.deepEqual(step(1, "older", "b"), { index: 2, text: "a" });
  assert.deepEqual(step(2, "older", "a"), { index: 2, text: "a" });
  assert.deepEqual(step(2, "newer", "a"), { index: 1, text: "b" });
  assert.deepEqual(step(1, "newer", "b"), { index: 0, text: "c" });
  assert.deepEqual(step(0, "newer", "c"), { index: -1, text: "" });
  assert.equal(step(1, "older", "zzz"), null, "an edited entry ends browsing");
  for (const bad of [
    NaN,
    1.5,
    99,
    -2,
    Infinity,
    -Infinity,
    undefined,
    null,
    "1",
  ]) {
    assert.equal(step(bad, "older", "b"), null, "index " + String(bad));
    assert.equal(step(bad, "newer", "b"), null);
  }
  // A box with no text value never matches an index outside the list.
  for (const outside of [3, 99, -1, -2]) {
    assert.equal(step(outside, "older", undefined), null, "index " + outside);
    assert.equal(step(outside, "newer", undefined), null);
  }
  assert.deepEqual(list, ["c", "b", "a"], "recall never changes the list");

  // key mapping
  assert.equal(historyKeyDirection({ key: "ArrowUp" }), "older");
  assert.equal(historyKeyDirection({ key: "ArrowDown" }), "newer");
  assert.equal(
    historyKeyDirection({ key: "ArrowUp", shiftKey: false }),
    "older",
  );
  for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
    for (const key of ["ArrowUp", "ArrowDown"])
      assert.equal(historyKeyDirection({ key, [mod]: true }), null, mod);
  }
  assert.equal(historyKeyDirection({ key: "ArrowUp" }, true), null);
  for (const key of [
    "Enter",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "Up",
    "a",
    "",
  ])
    assert.equal(historyKeyDirection({ key }), null, key);

  // The glue the find box runs: one shared list and one place per box.
  const world = { list: [] };
  const box = () => {
    let at = -1;
    return {
      search(query) {
        world.list = pushSearchQuery(world.list, query);
        at = -1;
      },
      press(direction, current) {
        const result = recallSearchQuery(world.list, at, direction, current);
        if (!result) return null;
        at = result.index;
        return result.text;
      },
    };
  };
  const left = box();
  const right = box();
  left.search("alpha");
  left.search("beta");
  left.search("gamma");
  assert.equal(left.press("older", ""), "gamma");
  assert.equal(left.press("older", "gamma"), "beta");
  assert.equal(right.press("older", ""), "gamma", "each box has its own place");
  assert.equal(left.press("older", "beta"), "alpha");
  left.search("alpha");
  assert.deepEqual(world.list, ["alpha", "gamma", "beta"]);
  assert.equal(
    left.press("older", "alpha"),
    null,
    "a searched query is typed text",
  );
  assert.equal(left.press("older", ""), "alpha");

  // The two functions against a model that follows the written rules step by
  // step, over a seeded random walk of typing, searching and arrow presses.
  let seed = 20260711;
  const rnd = (n) => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % n;
  };
  const words = [
    "a",
    " a ",
    "b",
    "B",
    "  ",
    "",
    "ab c",
    "x".repeat(500),
    "y".repeat(501),
    "c",
    "d",
    "e",
  ];
  for (let run = 0; run < 400; run++) {
    const mine = box();
    world.list = [];
    let typed = "";
    let recent = []; // newest first
    let at = null; // the entry the last recall landed on; stays while the text is typed over
    for (let stepNo = 0; stepNo < 60; stepNo++) {
      const op = rnd(5);
      if (op === 0) {
        typed = words[rnd(words.length)] + (rnd(8) === 0 ? "z" + stepNo : "");
      } else if (op === 1) {
        const kept = typed.trim();
        mine.search(typed);
        at = null;
        if (kept !== "" && kept.length <= 500)
          recent = [kept, ...recent.filter((x) => x !== kept)].slice(0, 20);
      } else {
        const older = op !== 4;
        const shown = mine.press(older ? "older" : "newer", typed);
        let want = null;
        if (at !== null && recent[at] === typed) {
          if (older) {
            at = Math.min(at + 1, recent.length - 1);
            want = recent[at];
          } else if (at === 0) {
            at = null;
            want = "";
          } else {
            at -= 1;
            want = recent[at];
          }
        } else if (typed === "" && older && recent.length > 0) {
          at = 0;
          want = recent[0];
        }
        assert.equal(shown, want, "run " + run + " step " + stepNo);
        if (shown !== null) typed = shown;
      }
      assert.deepEqual(world.list, recent);
      assert.ok(recent.length <= 20);
      assert.equal(new Set(recent).size, recent.length);
      assert.ok(recent.every((x) => x !== "" && x === x.trim()));
    }
  }
});

test("terminal-search-history session only: the list lives in memory inside one pure module and the find box, nothing is stored, sent or exported", () => {
  // The module: printable ASCII, no import, no environment, no clock.
  const moduleSource = read("src/terminal-search-history.ts");
  assert.ok(/^[\n -~]*$/.test(moduleSource), "ASCII only");
  const code = stripComments(moduleSource);
  for (const word of [
    "import",
    "require",
    "window",
    "document",
    "React",
    "hrig",
    "Date",
    "performance",
    "setTimeout",
    "fetch",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "async",
    "await",
    "class",
  ])
    assert.ok(
      !new RegExp("\\b" + word + "\\b").test(code),
      "module uses " + word,
    );
  assert.ok(!code.includes("Math.random"));
  assert.ok(!code.includes("export default"));
  assert.deepEqual(Object.keys(pure).sort(), [
    "MAX_SEARCH_HISTORY",
    "MAX_SEARCH_QUERY",
    "historyKeyDirection",
    "pushSearchQuery",
    "recallSearchQuery",
  ]);

  // The component: one module-level list, one place per box, nothing else.
  const tools = tight(stripComments(read("src/TerminalTools.tsx"))).replace(
    /,? }/g,
    " }",
  );
  assert.equal(
    count(
      tools,
      'import { historyKeyDirection, pushSearchQuery, recallSearchQuery } from "./terminal-search-history";',
    ),
    1,
  );
  const component = tools.indexOf("export default function TerminalTools(");
  assert.ok(component > 0);
  assert.equal(count(tools, "let searchHistory: readonly string[] = [];"), 1);
  assert.ok(
    tools.indexOf("let searchHistory: readonly string[] = [];") < component,
    "the list is one module-level value, not state per render",
  );
  assert.equal(count(tools, "const historyAt = useRef(-1);"), 1);
  assert.ok(tools.indexOf("const historyAt = useRef(-1);") > component);
  assert.equal(count(tools, "historyAt.current"), 3);
  let rest = tools;
  for (const allowed of [
    "let searchHistory: readonly string[] = [];",
    "searchHistory = pushSearchQuery(searchHistory, query);",
    "const step = recallSearchQuery(searchHistory, historyAt.current, direction, query);",
  ]) {
    assert.equal(count(rest, allowed), 1, "missing: " + allowed);
    rest = rest.replace(allowed, "");
  }
  assert.ok(!rest.includes("searchHistory"), "no other use of the list");
  const keyHandler = between(
    tools,
    'onKeyDown={(e) => { if (e.key === "Enter") {',
    '}} /> <button aria-label="Match case"',
  );
  assert.ok(
    keyHandler.includes(
      'if (e.key === "Enter") { e.preventDefault(); if (find(e.shiftKey)) { searchHistory = pushSearchQuery(searchHistory, query); historyAt.current = -1; } }',
    ),
    "only a search that ran is remembered, and it ends browsing",
  );
  assert.ok(
    keyHandler.includes(
      "const direction = historyKeyDirection(e, e.nativeEvent.isComposing); if (!direction) return; const step = recallSearchQuery(searchHistory, historyAt.current, direction, query); if (!step) return; e.preventDefault(); historyAt.current = step.index; setQuery(step.text);",
    ),
    "a recalled query only fills the box",
  );
  assert.equal(count(tools, "maxLength={500}"), 1);
  assert.equal(MAX_SEARCH_QUERY, 500, "the memory cap is the input cap");
  const findFunction = between(
    tools,
    "const find = (backwards = false, incremental = false) => {",
    "useEffect(() => { if (!open) return; const timer = setTimeout(",
  );
  assert.ok(!findFunction.includes("searchHistory"), "find never records");
  assert.ok(findFunction.includes("return search.current !== null;"));
  assert.equal(count(findFunction, "return false;"), 2);
  const debounce = between(
    tools,
    "useEffect(() => { if (!open) return; const timer = setTimeout(",
    "}, [query, regex, caseSensitive, open, generation]);",
  );
  assert.ok(!debounce.includes("searchHistory"), "typing never records");
  for (const word of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "saveState",
    "flushState",
  ])
    assert.equal(count(tools, word), 0, word);

  // Nothing else in the app learns about the list.
  const srcFiles = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.tsx?$/.test(f));
  const mentions = (re) =>
    srcFiles.filter((f) => re.test(read("src/" + f))).sort();
  assert.deepEqual(mentions(/terminal-search-history/), ["TerminalTools.tsx"]);
  assert.deepEqual(mentions(/pushSearchQuery/), [
    "TerminalTools.tsx",
    "terminal-search-history.ts",
  ]);
  assert.deepEqual(mentions(/searchHistory\b/), ["TerminalTools.tsx"]);
  for (const file of [
    "src/types.ts",
    "src/settings.ts",
    "src/SettingsPage.tsx",
    "src/App.tsx",
  ])
    assert.ok(
      !/searchHistory|findHistory|SearchHistory/.test(read(file)),
      file,
    );
  const electronFiles = fs
    .readdirSync(path.join(root, "electron"))
    .filter((f) => /\.(cjs|mjs)$/.test(f));
  for (const file of electronFiles)
    assert.ok(
      !/searchHistory|search-history|findHistory/.test(
        read("electron/" + file),
      ),
      "electron/" + file,
    );
  assert.ok(
    !/terminal\.search|terminal\.find|searchHistory/.test(read("SETTINGS.md")),
  );
});
