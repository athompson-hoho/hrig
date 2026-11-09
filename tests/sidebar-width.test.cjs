const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync, transformSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function bundle(entry) {
  const built = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = new Module("sidebar-width-test", module);
  mod._compile(built.outputFiles[0].text, "sidebar-width-test");
  return mod.exports;
}

const pure = bundle("src/sidebar-width.ts");
const {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  normalizeSidebarWidth,
  dragSidebarWidth,
} = pure;

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
function appText() {
  return tight(stripComments(read("src/App.tsx")));
}
function has(text, fragment) {
  return text.includes(tight(fragment));
}
function between(text, start, end) {
  const from = text.indexOf(tight(start));
  assert.ok(from >= 0, "missing start: " + start);
  const to = text.indexOf(tight(end), from + 1);
  assert.ok(to > from, "missing end: " + end);
  return text.slice(from, to);
}
function count(text, needle) {
  return text.split(needle).length - 1;
}

// The real App source is cut out of src/App.tsx, stripped of its types and run
// against fakes, so the App code itself is under test. A moved or reshaped
// piece fails loudly with a message naming it.
function cut(head, tail, name) {
  const source = stripComments(read("src/App.tsx"));
  const from = source.indexOf(head);
  assert.ok(from >= 0, "missing " + name);
  const to = source.indexOf(tail, from + head.length);
  assert.ok(to > from, "unterminated " + name);
  return {
    text: source.slice(from, to + tail.length),
    body: source.slice(from + head.length, to),
  };
}
function compile(code, params, result) {
  return new Function(
    ...params,
    transformSync(code, { loader: "ts" }).code + "\nreturn " + result + ";",
  );
}

// The local connection and defaultState, as the App declares them.
const freshSource = (() => {
  const source = stripComments(read("src/App.tsx"));
  const from = source.indexOf("const local: Connection = {");
  assert.ok(from >= 0, "missing the local connection");
  const mid = source.indexOf("const defaultState: WorkspaceState = {", from);
  assert.ok(mid > from, "missing defaultState");
  const to = source.indexOf("\n};", mid);
  assert.ok(to > mid, "unterminated defaultState");
  return source.slice(from, to + "\n};".length);
})();
const defaultState = compile(
  freshSource,
  ["SIDEBAR_DEFAULT_WIDTH"],
  "defaultState",
)(SIDEBAR_DEFAULT_WIDTH);

// The boot effect's load callback: what the App does with the saved workspace.
const loadCut = cut(
  "\n      .then(([saved, found]) => {\n",
  "\n      })\n      .catch((e) => setBootError(e.message));",
  "the workspace load callback",
);
const loadFactory = compile(
  "const load = ([saved, found]) => {" + loadCut.body + "\n};",
  [
    "setDetected",
    "defaultState",
    "normalizeHistory",
    "setState",
    "setLoaded",
    "log",
    "normalizeSidebarWidth",
    "normalizeReviewChecks",
  ],
  "load",
);
function loadWith(saved, found = []) {
  const out = { states: [], detected: [], loaded: 0, logs: [] };
  const run = loadFactory(
    (value) => out.detected.push(value),
    defaultState,
    (history) => history,
    (value) => out.states.push(value),
    () => {
      out.loaded++;
    },
    (text) => out.logs.push(text),
    normalizeSidebarWidth,
    (value) => value,
  );
  run([saved, found]);
  return out;
}
// What the main process writes and reads: the whole state as JSON text.
function viaFile(state) {
  return JSON.parse(JSON.stringify(state));
}

// The drag handler: the real resizeSidebar against a fake document.
const resizeCut = cut(
  "\n  const resizeSidebar = (event: React.PointerEvent) => {\n",
  "\n  };\n",
  "resizeSidebar",
);
const resizeFactory = compile(
  resizeCut.text.slice(1),
  [
    "state",
    "setState",
    "document",
    "normalizeSidebarWidth",
    "dragSidebarWidth",
  ],
  "resizeSidebar",
);
function fakeDocument() {
  const listeners = { pointermove: [], pointerup: [] };
  return {
    body: { style: { cursor: "" } },
    listeners,
    addEventListener(type, fn) {
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = listeners[type].filter((item) => item !== fn);
    },
    fire(type, event) {
      for (const fn of [...listeners[type]]) fn(event);
    },
  };
}
function dragWorld(initial) {
  const w = { state: { ...initial }, doc: fakeDocument(), updates: 0 };
  const setState = (update) => {
    w.updates++;
    w.state = update(w.state);
  };
  // The App makes a new handler on every render, from that render's state.
  w.down = (clientX) =>
    resizeFactory(
      w.state,
      setState,
      w.doc,
      normalizeSidebarWidth,
      dragSidebarWidth,
    )({ clientX });
  w.move = (clientX) => w.doc.fire("pointermove", { clientX });
  w.up = () => w.doc.fire("pointerup", {});
  return w;
}

// A saved workspace file with the given text in place of the width.
function savedWith(widthText) {
  return JSON.parse(
    '{"version":1,"connections":[],"activeConnection":"local","sidebarWidth":' +
      widthText +
      "}",
  );
}

test("sidebar-width tracer: the real drag handler and the real load callback keep the width inside 210 to 440, a saved width comes back unchanged after a restart and a damaged one is repaired", () => {
  // A new workspace starts where it always started.
  assert.equal(defaultState.sidebarWidth, 264);
  assert.equal(defaultState.version, 1);

  // Loading: no file, an unsupported version and a file without a width give
  // the default; nothing is thrown and the workspace is loaded once.
  for (const saved of [
    null,
    { version: 2, connections: [], sidebarWidth: 300 },
    { version: 1, connections: [] },
  ]) {
    const out = loadWith(saved);
    assert.equal(out.states.length, 1);
    assert.equal(out.states[0].sidebarWidth, 264);
    assert.equal(out.loaded, 1);
  }

  // A width already in range comes back exactly as saved.
  for (const width of [210, 211, 264, 300, 333.5, 439.9, 440]) {
    const out = loadWith(savedWith(String(width)));
    assert.equal(out.states[0].sidebarWidth, width, "width " + width);
  }

  // A damaged file is repaired, never trusted: the clamp for numbers and the
  // default for everything else, including JSON that parses to an infinity.
  const repaired = [
    ["5000", 440],
    ["441", 440],
    ["209", 210],
    ["0", 210],
    ["-50", 210],
    ["1e999", 264],
    ["-1e999", 264],
    ['"300"', 264],
    ['""', 264],
    ["null", 264],
    ["true", 264],
    ["false", 264],
    ["[]", 264],
    ["[300]", 264],
    ["{}", 264],
    ['{"width":300}', 264],
  ];
  for (const [text, expected] of repaired) {
    const out = loadWith(savedWith(text));
    assert.equal(out.states[0].sidebarWidth, expected, "saved " + text);
    assert.ok(Number.isFinite(out.states[0].sidebarWidth));
  }

  // Everything else in the saved file is carried over untouched.
  const rich = {
    version: 1,
    connections: [
      { id: "local", name: "This computer", kind: "local", root: "." },
    ],
    activeConnection: "work",
    roots: { work: "/srv/app" },
    activeRig: "alpha",
    layouts: { one: { layout: { type: "row" } } },
    savedLayouts: [],
    sidebarWidth: 9999,
  };
  const loaded = loadWith(viaFile(rich)).states[0];
  assert.equal(loaded.sidebarWidth, 440);
  assert.equal(loaded.activeConnection, "work");
  assert.deepEqual(loaded.roots, rich.roots);
  assert.equal(loaded.activeRig, "alpha");
  assert.deepEqual(loaded.layouts, rich.layouts);

  // Dragging: the handler follows the pointer inside the range and stops at
  // both limits, touches only the width and cleans up when the button is released.
  const w = dragWorld({
    version: 1,
    connections: [],
    activeRig: "r1",
    layouts: { a: 1 },
    sidebarWidth: 300,
  });
  w.down(500);
  assert.equal(w.doc.body.style.cursor, "col-resize");
  assert.equal(w.doc.listeners.pointermove.length, 1);
  assert.equal(w.doc.listeners.pointerup.length, 1);
  w.move(560);
  assert.equal(w.state.sidebarWidth, 360);
  w.move(-1000);
  assert.equal(w.state.sidebarWidth, 210);
  w.move(5000);
  assert.equal(w.state.sidebarWidth, 440);
  w.move(533.5);
  assert.equal(w.state.sidebarWidth, 333.5);
  assert.deepEqual(
    { ...w.state, sidebarWidth: 0 },
    {
      version: 1,
      connections: [],
      activeRig: "r1",
      layouts: { a: 1 },
      sidebarWidth: 0,
    },
  );
  const updates = w.updates;
  w.up();
  assert.equal(w.doc.body.style.cursor, "");
  assert.equal(w.doc.listeners.pointermove.length, 0);
  assert.equal(w.doc.listeners.pointerup.length, 0);
  w.move(900);
  assert.equal(w.updates, updates, "no update after release");
  assert.equal(w.state.sidebarWidth, 333.5);

  // The width the drag ended on survives a restart: file text and back.
  assert.equal(loadWith(viaFile(w.state)).states[0].sidebarWidth, 333.5);
  for (const target of [-900, 3000]) {
    const edge = dragWorld({ version: 1, connections: [], sidebarWidth: 300 });
    edge.down(500);
    edge.move(500 + target);
    edge.up();
    const again = loadWith(viaFile(edge.state)).states[0].sidebarWidth;
    assert.equal(again, edge.state.sidebarWidth);
    assert.ok(again === 210 || again === 440);
  }

  // A drag that starts from a damaged value starts from the repaired one.
  for (const [bad, from] of [
    ["300", 264],
    [null, 264],
    [undefined, 264],
    [NaN, 264],
    [Infinity, 264],
    [{}, 264],
    [[], 264],
    [5000, 440],
    [-50, 210],
  ]) {
    const d = dragWorld({ version: 1, connections: [], sidebarWidth: bad });
    d.down(100);
    d.move(110);
    assert.equal(d.state.sidebarWidth, Math.min(440, Math.max(210, from + 10)));
    d.up();
  }

  // The render uses the same repair, and nothing else sizes the sidebar.
  const app = appText();
  assert.equal(
    count(
      app,
      tight("style={{ width: normalizeSidebarWidth(state.sidebarWidth) }}"),
    ),
    1,
  );
  assert.ok(!/state\.sidebarWidth \|\|/.test(app), "the old fallback is gone");
  assert.ok(
    has(
      app,
      '{sidebar && ( <div className="sidebar-container" style={{ width: normalizeSidebarWidth(state.sidebarWidth) }} >',
    ),
  );
  assert.equal(
    count(
      app,
      '<div className="sidebar-resizer" onPointerDown={resizeSidebar} />',
    ),
    1,
  );
});

test("sidebar-width normalize: only a finite number is a width, a width in range is unchanged, the rest is clamped or defaulted without throwing, and a drag equals the old formula", () => {
  assert.equal(SIDEBAR_MIN_WIDTH, 210);
  assert.equal(SIDEBAR_MAX_WIDTH, 440);
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 264);

  const table = [
    [264, 264],
    [210, 210],
    [440, 440],
    [211, 211],
    [439, 439],
    [300.5, 300.5],
    [209.99, 210],
    [440.01, 440],
    [0, 210],
    [-0, 210],
    [-5, 210],
    [1e9, 440],
    [-1e9, 210],
    [Number.MAX_VALUE, 440],
    [-Number.MAX_VALUE, 210],
    [Number.MIN_VALUE, 210],
    [NaN, 264],
    [Infinity, 264],
    [-Infinity, 264],
    ["300", 264],
    ["", 264],
    ["abc", 264],
    [null, 264],
    [undefined, 264],
    [true, 264],
    [false, 264],
    [[], 264],
    [[300], 264],
    [{}, 264],
    [{ width: 300 }, 264],
    [new Number(300), 264],
    [10n, 264],
    [Symbol("w"), 264],
    [() => 300, 264],
  ];
  for (const [input, expected] of table) {
    assert.equal(
      normalizeSidebarWidth(input),
      expected,
      "normalize " + String(typeof input === "symbol" ? "symbol" : input),
    );
  }

  // Malformed data must never throw: values that would throw if they were
  // read, converted or inspected are only looked at by type.
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error("read");
      },
      has() {
        throw new Error("has");
      },
      getPrototypeOf() {
        throw new Error("prototype");
      },
    },
  );
  const bomb = {
    valueOf() {
      throw new Error("valueOf");
    },
    toString() {
      throw new Error("toString");
    },
  };
  for (const hostile of [trap, bomb]) {
    assert.equal(normalizeSidebarWidth(hostile), 264);
    assert.equal(dragSidebarWidth(hostile, 10, 20), 264 + 10);
  }

  // A sweep over every width from far below to far above the range.
  let previous = -Infinity;
  let reached = { low: 0, inside: 0, high: 0 };
  for (let value = -1000; value <= 1500; value += 0.25) {
    const out = normalizeSidebarWidth(value);
    assert.ok(
      Number.isFinite(out) && out >= 210 && out <= 440,
      "range " + value,
    );
    assert.equal(normalizeSidebarWidth(out), out, "idempotent " + value);
    assert.ok(out >= previous, "monotonic " + value);
    previous = out;
    if (value < 210) {
      assert.equal(out, 210);
      reached.low++;
    } else if (value > 440) {
      assert.equal(out, 440);
      reached.high++;
    } else {
      assert.equal(out, value, "unchanged " + value);
      reached.inside++;
    }
  }
  assert.ok(reached.low > 800 && reached.inside > 900 && reached.high > 1000);

  // The drag is exactly the formula the handle always used, for every
  // starting width inside the range and a spread of pointer positions.
  const legacy = (start, startX, clientX) =>
    Math.max(210, Math.min(440, start + clientX - startX));
  let compared = 0;
  for (let start = 210; start <= 440; start += 0.5) {
    for (const startX of [0, 17.25, 400, 1234.5]) {
      for (
        let clientX = startX - 500;
        clientX <= startX + 500;
        clientX += 12.7
      ) {
        assert.equal(
          dragSidebarWidth(start, startX, clientX),
          legacy(start, startX, clientX),
        );
        compared++;
      }
    }
  }
  assert.ok(compared > 100000);

  // A drag from a damaged start begins at the repaired width; a pointer
  // position that is not a finite number leaves the width alone.
  assert.equal(dragSidebarWidth("300", 0, 10), 274);
  assert.equal(dragSidebarWidth(5000, 0, -10), 430);
  assert.equal(dragSidebarWidth(-50, 0, 5), 215);
  assert.equal(dragSidebarWidth(undefined, 0, 0), 264);
  for (const [startX, clientX] of [
    [NaN, 5],
    [0, NaN],
    [0, Infinity],
    [-Infinity, 0],
    [Infinity, Infinity],
    ["a", 5],
    [0, "5"],
    [undefined, undefined],
    [null, 3],
  ]) {
    assert.equal(dragSidebarWidth(300, startX, clientX), 300);
    assert.equal(dragSidebarWidth("x", startX, clientX), 264);
  }
});

test("sidebar-width is stored in the workspace state only: no setting, no second store, no change to the style, and the module is pure", () => {
  // The module: printable ASCII, no import and no way to reach the page,
  // the clock, storage or the network; exactly these exports.
  const source = read("src/sidebar-width.ts");
  assert.ok(/^[\n\x20-\x7e]*$/.test(source), "ASCII only");
  const code = stripComments(source);
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
    "async",
    "await",
    "class",
  ])
    assert.ok(
      !new RegExp("\\b" + word + "\\b").test(code),
      "module word " + word,
    );
  assert.ok(!/Math\.random|export default/.test(code));
  assert.deepEqual(Object.keys(pure).sort(), [
    "SIDEBAR_DEFAULT_WIDTH",
    "SIDEBAR_MAX_WIDTH",
    "SIDEBAR_MIN_WIDTH",
    "dragSidebarWidth",
    "normalizeSidebarWidth",
  ]);

  // The limits are the ones the stylesheet already enforces as a minimum.
  const css = read("src/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/\.sidebar-container\s*\{([^}]*)\}/g)];
  assert.equal(rules.length, 1, "one .sidebar-container rule");
  assert.deepEqual(
    rules[0][1]
      .split(";")
      .map((item) => item.replace(/\s+/g, ""))
      .filter(Boolean),
    [
      "position:relative",
      "flex-shrink:0",
      "min-width:" + SIDEBAR_MIN_WIDTH + "px",
    ],
  );

  // App.tsx: the three number literals are gone from the places that used
  // them, the import is the only new one, and the width is touched in exactly
  // the six places this feature knows about.
  const app = appText();
  assert.ok(
    has(
      app,
      'import { SIDEBAR_DEFAULT_WIDTH, dragSidebarWidth, normalizeSidebarWidth, } from "./sidebar-width";',
    ),
  );
  assert.equal(count(app, "./sidebar-width"), 1);
  const literals = /\b(264|210|440)\b/;
  assert.ok(!literals.test(freshSource), "defaultState holds no literal");
  assert.ok(
    !literals.test(resizeCut.text),
    "the drag handler holds no literal",
  );
  assert.ok(!literals.test(loadCut.text), "the load callback holds no literal");
  assert.ok(
    !literals.test(between(app, "{sidebar && (", "<Sidebar")),
    "the sidebar container holds no literal",
  );
  assert.equal(count(app, "sidebarWidth"), 6);
  assert.equal(count(app, "sidebarWidth:"), 3);
  assert.ok(
    has(
      app,
      "setState({ ...base, sidebarWidth: normalizeSidebarWidth(base.sidebarWidth), projectHistory:",
    ),
    "the repaired width is set after the saved state is spread",
  );
  assert.ok(
    has(app, "const startWidth = normalizeSidebarWidth(state.sidebarWidth);"),
  );
  assert.ok(
    has(app, "sidebarWidth: dragSidebarWidth(startWidth, startX, e.clientX),"),
  );

  // The width is part of the existing workspace state and travels through
  // the existing save and load path, whole.
  const types = stripComments(read("src/types.ts"));
  assert.equal(count(types, "sidebarWidth?: number;"), 1);
  assert.deepEqual(
    [...types.matchAll(/\bsidebar\w*\??:/g)].map((m) => m[0]),
    ["sidebarWidth?:"],
    "no other sidebar field in the types",
  );
  assert.ok(has(app, "window.hrig.saveState(state)"));
  assert.ok(has(app, "window.hrig.flushState(stateRef.current)"));
  assert.ok(has(app, "window.hrig.loadState()"));
  const main = tight(stripComments(read("electron/main.cjs")));
  assert.equal(
    count(main, tight("{ ...state, windowBounds: mainWindow.getBounds() }")),
    2,
    "the save and the flush write the whole state",
  );
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (file.endsWith(".cjs"))
      assert.ok(
        !/sidebarWidth/.test(read("electron/" + file)),
        "the main process never looks at the width: " + file,
      );
  const preload = read("electron/preload.cjs");
  for (const name of ["loadState", "saveState", "flushState"])
    assert.ok(preload.includes(name), "preload " + name);

  // No setting, no second store, no open or closed state saved with it.
  const settings = bundle("src/settings.ts");
  assert.ok(
    !Object.keys(settings.defaults).some((key) => /sidebar/i.test(key)),
    "no setting for the sidebar",
  );
  assert.ok(!/sidebarWidth/i.test(read("SETTINGS.md")));
  assert.ok(!/sidebarWidth/.test(stripComments(read("src/settings.ts"))));
  assert.ok(!/sidebarWidth/.test(stripComments(read("src/SettingsPage.tsx"))));
  assert.ok(!/localStorage|sessionStorage/.test(resizeCut.text + loadCut.text));
  assert.equal(count(app, "const [sidebar, setSidebar] = useState(true);"), 1);

  // Hiding the sidebar by focus mode never touches the width.
  const focus = cut(
    "\n  const toggleFocusMode = () => {\n",
    "\n  };\n",
    "toggleFocusMode",
  );
  assert.ok(!/idth/.test(focus.text), "focus mode leaves the width alone");
});

test("sidebar-width collapse shortcut: Ctrl+B (Cmd+B on macOS) already shows and hides the sidebar, it is listed once and no second chord exists, and NAVIGATION.md documents it with the width", () => {
  const shortcuts = bundle("src/shortcuts.ts");
  const terminal = bundle("src/terminal-keys.ts");
  for (const platform of ["darwin", "linux", "win32"]) {
    const mac = platform === "darwin";
    const mod = mac ? "Cmd" : "Ctrl";
    const rows = shortcuts
      .shortcutGroups(platform)
      .flatMap((group) => group.shortcuts);
    // One catalog row for the sidebar, and no other row that is about it
    // except the focus mode one, which names it.
    assert.deepEqual(
      rows.filter((row) => /sidebar/i.test(row.id)),
      [
        {
          id: "workspace.sidebar",
          label: "Show or hide the sidebar",
          keys: [mod + "+B"],
        },
      ],
    );
    assert.deepEqual(
      rows
        .filter((row) => /sidebar/i.test(row.label))
        .map((row) => row.id)
        .sort(),
      ["workspace.focusMode", "workspace.sidebar"],
    );
    assert.equal(
      rows.filter((row) =>
        row.keys.some(
          (key) => key.toLowerCase() === (mod + "+b").toLowerCase(),
        ),
      ).length,
      1,
      "the chord is listed once",
    );
    // A terminal leaves the key alone, so the App handler is what takes it,
    // even from inside a terminal panel.
    const press = {
      key: "b",
      ctrlKey: !mac,
      metaKey: mac,
      altKey: false,
      shiftKey: false,
    };
    for (const selected of [false, true])
      assert.equal(
        terminal.classifyTerminalKey(press, platform, selected),
        "pass",
      );
    assert.equal(
      terminal.terminalOwnsKey(press, platform, { closest: () => ({}) }),
      false,
    );
  }

  // The key handler: the chord is claimed for the whole window and flips the
  // sidebar, as it always did; it is the only place that tests a b key.
  const app = appText();
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  const generic = handler.slice(
    handler.indexOf(tight("if (event.ctrlKey || event.metaKey) {")),
  );
  assert.ok(generic.length < handler.length, "the generic Ctrl or Cmd branch");
  assert.ok(
    has(
      generic,
      'if ([",", "k", "o", "b", "p"].includes(event.key.toLowerCase()) || (event.shiftKey && event.key.toLowerCase() === "t")) { event.preventDefault(); event.stopPropagation(); }',
    ),
    "b is claimed so no terminal or editor sees it",
  );
  assert.ok(
    has(
      generic,
      'if (event.key.toLowerCase() === "b") { event.preventDefault(); setSidebar((v) => !v); }',
    ),
  );
  assert.equal(count(handler, 'toLowerCase() === "b"'), 1);
  assert.equal(count(handler, "setSidebar("), 1);

  // The other ways to the same toggle are untouched, and there are exactly
  // three call sites: the chord, the command center entry and the toolbar button.
  assert.equal(count(app, "setSidebar((v) => !v)"), 3);
  assert.equal(count(app, 'name: "Toggle sidebar"'), 1);
  const entry = between(
    app,
    'name: "Toggle sidebar",',
    'name: "Toggle status bar",',
  );
  assert.ok(entry.includes(tight('hint: "Ctrl B",')));
  assert.ok(entry.includes(tight("action: () => setSidebar((v) => !v),")));
  assert.ok(
    has(
      app,
      '<IconButton title={sidebar ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebar((v) => !v)} >',
    ),
  );
  // Where the chord was already listed for people.
  assert.ok(read("README.md").includes("| Ctrl B | Show / hide sidebar |"));
  assert.ok(
    stripComments(read("src/SettingsPage.tsx")).includes(
      '["Ctrl B", "Toggle sidebar"]',
    ),
  );

  // NAVIGATION.md: one paragraph, after the earlier ones, with the numbers
  // taken from the module so the text cannot drift from the limits.
  const nav = read("NAVIGATION.md");
  assert.equal(nav.charCodeAt(0), 0xfeff, "byte order mark");
  assert.ok(nav.endsWith(".\n") && !nav.endsWith("\n\n"));
  const mine = nav
    .split("\n")
    .filter((line) =>
      line.startsWith(
        "The sidebar shows and hides with Ctrl+B (Cmd+B on macOS)",
      ),
    );
  assert.equal(mine.length, 1);
  assert.ok(/^[\x20-\x7e]*$/.test(mine[0]), "ASCII only");
  const at = nav.indexOf(mine[0]);
  assert.ok(at > nav.indexOf("The command center entry Reopen closed panel"));
  assert.ok(at > nav.indexOf("The command center entry Toggle focus mode"));
  for (const fragment of [
    "with the Toggle sidebar entry in the command center",
    "the Hide sidebar and Show sidebar button in the toolbar",
    "also listed in the Keyboard shortcuts sheet",
    "including while a terminal has focus, so Ctrl+B does not reach the shell",
    "between " + SIDEBAR_MIN_WIDTH + " and " + SIDEBAR_MAX_WIDTH + " pixels",
    "moved to the nearest limit",
    "falls back to the default of " + SIDEBAR_DEFAULT_WIDTH + " pixels",
    "a new workspace starts at " + SIDEBAR_DEFAULT_WIDTH + " pixels",
    "Hiding the sidebar keeps its width",
    "or by leaving focus mode",
    "Whether the sidebar is open is not saved",
    "The width is not a setting",
    "nothing is typed or sent",
  ])
    assert.ok(mine[0].includes(fragment), "NAVIGATION.md: " + fragment);
  assert.ok(nav.includes("also runs Toggle sidebar, Toggle status bar"));
});
