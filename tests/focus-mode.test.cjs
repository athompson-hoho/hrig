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
  const mod = new Module("focus-mode-test", module);
  mod._compile(built.outputFiles[0].text, "focus-mode-test");
  return mod.exports;
}

const pure = bundle("src/focus-mode.ts");
const {
  FOCUS_OFF,
  enterFocus,
  exitFocus,
  toggleFocus,
  focusAfterSidebar,
  showStatusBar,
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
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// The real toggleFocusMode source is cut out of src/App.tsx, stripped of its
// types and run against fake React state, so the App function itself is under test.
function appFunction(name) {
  const source = stripComments(read("src/App.tsx"));
  const head = "\n  const " + name + " = () => {\n";
  const from = source.indexOf(head);
  assert.ok(from >= 0, "missing " + name);
  const to = source.indexOf("\n  };\n", from + head.length);
  assert.ok(to > from, "unterminated " + name);
  return source.slice(from + 1, to + "\n  };".length);
}
const compiled = new Function(
  "focusMode",
  "sidebar",
  "preferences",
  "setFocusMode",
  "setSidebar",
  "toggleFocus",
  transformSync(appFunction("toggleFocusMode"), { loader: "ts" }).code +
    "\nreturn toggleFocusMode;",
);

// One window: the sidebar state, the saved status bar preference and the focus
// state, with the same effect the App runs after the sidebar value changes.
function world(start) {
  const w = {
    focus: FOCUS_OFF,
    sidebar: start.sidebar,
    preference: start.statusBar,
    writes: 0,
  };
  const settle = () => {
    w.focus = focusAfterSidebar(w.focus, w.sidebar);
  };
  w.toggle = () => {
    const run = compiled(
      w.focus,
      w.sidebar,
      Object.freeze({ "appearance.statusBar": w.preference }),
      (value) => {
        w.focus = value;
      },
      (value) => {
        w.sidebar = value;
      },
      toggleFocus,
    );
    run();
    settle();
  };
  // setSidebar((v) => !v): Ctrl+B, the Toggle sidebar command and the toolbar button.
  w.ctrlB = () => {
    w.sidebar = !w.sidebar;
    settle();
  };
  // setSidebar(true): the activity rail, opening a project, the welcome guide.
  w.openSidebar = () => {
    w.sidebar = true;
    settle();
  };
  // The existing Toggle status bar command writes the saved preference.
  w.statusBarCommand = () => {
    w.preference = !w.preference;
    w.writes++;
  };
  w.shown = () => ({
    sidebar: w.sidebar,
    statusBar: showStatusBar(w.focus, w.preference),
  });
  return w;
}

// The same rules written the other way round: one remembered value pair.
function model(start) {
  const m = { sidebar: start.sidebar, pref: start.statusBar, saved: null };
  m.apply = (op) => {
    if (op === "toggle") {
      if (m.saved) {
        m.sidebar = m.saved.sidebar;
        m.saved = null;
      } else {
        m.saved = { sidebar: m.sidebar, statusBar: m.pref };
        m.sidebar = false;
      }
    } else if (op === "ctrlB") {
      m.sidebar = !m.sidebar;
      if (m.saved && m.sidebar) m.saved = null;
    } else if (op === "openSidebar") {
      m.sidebar = true;
      m.saved = null;
    } else m.pref = !m.pref;
  };
  m.shown = () => ({
    sidebar: m.sidebar,
    statusBar: m.pref && m.saved === null,
  });
  return m;
}

const STARTS = [
  { sidebar: true, statusBar: true },
  { sidebar: true, statusBar: false },
  { sidebar: false, statusBar: true },
  { sidebar: false, statusBar: false },
];
const OPS = ["toggle", "ctrlB", "openSidebar", "statusBarCommand"];

test("focus-mode tracer: the real toggleFocusMode hides the sidebar and status bar, brings back exactly what was there, ends when the sidebar opens and never writes the saved preference", () => {
  // Sidebar and status bar both showing: hidden, then back.
  const a = world({ sidebar: true, statusBar: true });
  assert.deepEqual(a.shown(), { sidebar: true, statusBar: true });
  a.toggle();
  assert.deepEqual(a.shown(), { sidebar: false, statusBar: false });
  assert.equal(a.focus.on, true);
  assert.equal(a.preference, true, "the saved preference is not touched");
  a.toggle();
  assert.deepEqual(a.shown(), { sidebar: true, statusBar: true });
  assert.equal(a.focus, FOCUS_OFF);
  assert.equal(a.preference, true);
  assert.equal(a.writes, 0);

  // The sidebar was already closed: leaving focus mode keeps it closed.
  const b = world({ sidebar: false, statusBar: true });
  b.toggle();
  assert.deepEqual(b.shown(), { sidebar: false, statusBar: false });
  b.toggle();
  assert.deepEqual(b.shown(), { sidebar: false, statusBar: true });

  // The status bar preference is off: it stays off after focus mode.
  const c = world({ sidebar: true, statusBar: false });
  c.toggle();
  assert.deepEqual(c.shown(), { sidebar: false, statusBar: false });
  c.toggle();
  assert.deepEqual(c.shown(), { sidebar: true, statusBar: false });
  assert.equal(c.preference, false, "still off, still the person's choice");

  // Opening the sidebar with Ctrl+B ends focus mode and keeps the sidebar open.
  const d = world({ sidebar: true, statusBar: true });
  d.toggle();
  d.ctrlB();
  assert.deepEqual(d.shown(), { sidebar: true, statusBar: true });
  assert.equal(d.focus, FOCUS_OFF);
  d.ctrlB();
  assert.deepEqual(
    d.shown(),
    { sidebar: false, statusBar: true },
    "closing the sidebar afterwards must not hide the status bar again",
  );
  d.toggle();
  d.toggle();
  assert.deepEqual(d.shown(), { sidebar: false, statusBar: true });

  // Any other route that opens the sidebar does the same.
  const e = world({ sidebar: false, statusBar: true });
  e.toggle();
  e.openSidebar();
  assert.deepEqual(e.shown(), { sidebar: true, statusBar: true });
  assert.equal(e.focus, FOCUS_OFF);

  // Toggle status bar during focus mode changes only the saved preference; the
  // bar stays hidden and then follows the person's latest choice.
  const f = world({ sidebar: true, statusBar: true });
  f.toggle();
  f.statusBarCommand();
  assert.deepEqual(f.shown(), { sidebar: false, statusBar: false });
  f.toggle();
  assert.deepEqual(f.shown(), { sidebar: true, statusBar: false });
  assert.equal(f.writes, 1, "only the existing command wrote the preference");

  // The wiring that makes the function above the one the app runs.
  const app = appText();
  assert.ok(
    has(
      app,
      'import { FOCUS_OFF, focusAfterSidebar, showStatusBar, toggleFocus, type FocusState, } from "./focus-mode";',
    ),
  );
  const lucide = between(app, "Keyboard,", 'from "lucide-react";');
  assert.ok(has(lucide, "Focus,"));
  assert.equal(
    count(
      app,
      "const [focusMode, setFocusMode] = useState<FocusState>(FOCUS_OFF);",
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "useEffect(() => setFocusMode((f) => focusAfterSidebar(f, sidebar)), [sidebar]);",
    ),
    1,
    "the one effect that ends focus mode when the sidebar opens, by any route",
  );
  const body = between(
    app,
    "const toggleFocusMode = () => {",
    "useEffect(() => setFocusMode(",
  );
  assert.ok(
    has(
      body,
      'const step = toggleFocus(focusMode, { sidebar, statusBar: preferences["appearance.statusBar"], });',
    ),
  );
  assert.ok(has(body, "setFocusMode(step.state);"));
  assert.ok(has(body, "if (step.view) setSidebar(step.view.sidebar);"));
  assert.equal(count(body, "setFocusMode("), 1);
  assert.equal(count(body, "setSidebar("), 1);
  assert.equal(
    count(
      app,
      '{showStatusBar(focusMode, preferences["appearance.statusBar"]) &&',
    ),
    1,
  );
  assert.equal(
    count(app, '{preferences["appearance.statusBar"] &&'),
    0,
    "the plain preference gate is gone",
  );
  assert.ok(has(app, '&& ( <footer className="statusbar">'));
  assert.ok(
    has(app, '{sidebar && ( <div className="sidebar-container"'),
    "the sidebar still renders on the plain sidebar value",
  );
  for (const name of [
    "Toggle sidebar",
    "Toggle status bar",
    "Toggle focus mode",
    "Open welcome guide",
  ])
    assert.equal(count(app, 'name: "' + name + '",'), 1, name);
  assert.ok(has(app, "action: toggleFocusMode,"));
  const first = app.indexOf('name: "Toggle sidebar",');
  const second = app.indexOf('name: "Toggle status bar",');
  const third = app.indexOf('name: "Toggle focus mode",');
  const fourth = app.indexOf('name: "Open welcome guide",');
  assert.ok(
    first >= 0 && first < second && second < third && third < fourth,
    "the entry sits after Toggle status bar",
  );
  assert.ok(
    has(
      app,
      'name: "Toggle sidebar", hint: "Ctrl B", icon: <PanelLeft size={16} />, action: () => setSidebar((v) => !v),',
    ),
    "Toggle sidebar is untouched",
  );
  assert.ok(has(app, "<Focus size={16} />"));
});

test("focus-mode transitions: enter, exit and toggle remember and restore the exact prior values, entering twice keeps the first snapshot, and a sweep agrees with an independent model", () => {
  assert.deepEqual(FOCUS_OFF, { on: false });
  assert.ok(Object.isFrozen(FOCUS_OFF));

  // Enter remembers both values and asks for both parts to be hidden.
  for (const start of STARTS) {
    const input = deepFreeze({ ...start });
    const entered = enterFocus(FOCUS_OFF, input);
    assert.deepEqual(entered.state, { on: true, prev: start });
    assert.deepEqual(entered.view, { sidebar: false, statusBar: false });
    assert.notEqual(entered.state.prev, input, "the snapshot is a copy");

    // Exit restores exactly the prior values, and the state is off again.
    const left = exitFocus(entered.state);
    assert.deepEqual(left.view, start);
    assert.equal(left.state, FOCUS_OFF);
    assert.notEqual(left.view, entered.state.prev, "the answer is a copy");

    // Toggle twice is enter then exit, and the second call ignores what is
    // shown by then (everything is hidden).
    const once = toggleFocus(FOCUS_OFF, input);
    assert.deepEqual(once, entered);
    const twice = toggleFocus(once.state, { sidebar: false, statusBar: false });
    assert.deepEqual(twice, left);
    const third = toggleFocus(twice.state, input);
    assert.deepEqual(third, entered, "and a third toggle enters again");
  }

  // Entering while the sidebar or the status bar is already hidden remembers
  // it hidden, so leaving never shows what the person had closed.
  const closed = enterFocus(FOCUS_OFF, { sidebar: false, statusBar: true });
  assert.deepEqual(closed.state.prev, { sidebar: false, statusBar: true });
  assert.deepEqual(exitFocus(closed.state).view, {
    sidebar: false,
    statusBar: true,
  });
  const bare = enterFocus(FOCUS_OFF, { sidebar: false, statusBar: false });
  assert.deepEqual(exitFocus(bare.state).view, {
    sidebar: false,
    statusBar: false,
  });

  // Entering while already on keeps the first snapshot and the same state.
  const on = enterFocus(FOCUS_OFF, { sidebar: true, statusBar: true }).state;
  const again = enterFocus(on, { sidebar: false, statusBar: false });
  assert.equal(again.state, on);
  assert.deepEqual(again.state.prev, { sidebar: true, statusBar: true });
  assert.deepEqual(again.view, { sidebar: false, statusBar: false });
  assert.deepEqual(exitFocus(again.state).view, {
    sidebar: true,
    statusBar: true,
  });

  // Exiting while off restores nothing.
  assert.deepEqual(exitFocus(FOCUS_OFF), { state: FOCUS_OFF, view: null });

  // The person opens the sidebar while focus mode is on: it ends, no view is
  // applied here, and a closed sidebar keeps it on.
  assert.equal(focusAfterSidebar(on, true), FOCUS_OFF);
  assert.equal(focusAfterSidebar(on, false), on);
  assert.equal(focusAfterSidebar(FOCUS_OFF, true), FOCUS_OFF);
  assert.equal(focusAfterSidebar(FOCUS_OFF, false), FOCUS_OFF);
  assert.equal(focusAfterSidebar(on, undefined), on);
  assert.equal(focusAfterSidebar(on, 1), on, "only a real true opens it");

  // The status bar renders only for a preference that is on and focus mode off.
  assert.equal(showStatusBar(FOCUS_OFF, true), true);
  assert.equal(showStatusBar(FOCUS_OFF, false), false);
  assert.equal(showStatusBar(on, true), false);
  assert.equal(showStatusBar(on, false), false);
  assert.equal(showStatusBar(FOCUS_OFF, 1), true, "truthy preference shows");
  assert.equal(showStatusBar(FOCUS_OFF, undefined), false);

  // Hostile inputs: anything that is not a well formed on state is off.
  for (const state of [
    null,
    undefined,
    7,
    "x",
    [],
    {},
    { on: true },
    { on: "yes", prev: { sidebar: true, statusBar: true } },
    { on: false, prev: { sidebar: true, statusBar: true } },
  ]) {
    assert.deepEqual(exitFocus(state), { state: FOCUS_OFF, view: null });
    assert.equal(focusAfterSidebar(state, true), FOCUS_OFF);
    assert.equal(showStatusBar(state, true), true);
    assert.equal(toggleFocus(state, STARTS[0]).state.on, true);
  }
  for (const prev of [null, undefined, 7, "x", [], {}, { sidebar: 1 }]) {
    const entered = enterFocus(FOCUS_OFF, prev);
    assert.deepEqual(entered.state, {
      on: true,
      prev: { sidebar: false, statusBar: false },
    });
  }

  // Frozen inputs are never mutated, whatever happens.
  const frozen = deepFreeze(enterFocus(FOCUS_OFF, STARTS[0]).state);
  exitFocus(frozen);
  enterFocus(frozen, STARTS[1]);
  toggleFocus(frozen, STARTS[2]);
  focusAfterSidebar(frozen, true);
  showStatusBar(frozen, true);

  // Sweep: every start and every sequence of up to six actions, the real App
  // function against the independent model, with the invariants of the window.
  let sequences = 0;
  const reached = { entered: 0, ended: 0, restored: 0 };
  const run = (start, ops) => {
    const w = world(start);
    const m = model(start);
    let written = 0;
    for (const op of ops) {
      const before = w.focus.on;
      w[op]();
      m.apply(op);
      if (op === "statusBarCommand") written++;
      assert.deepEqual(w.shown(), m.shown(), JSON.stringify([start, ops, op]));
      assert.equal(w.writes, written, "only the command writes the preference");
      if (w.focus.on) {
        assert.equal(w.sidebar, false, "focus mode on means no sidebar");
        assert.equal(w.shown().statusBar, false);
      } else {
        assert.equal(w.shown().statusBar, w.preference);
      }
      if (w.sidebar) assert.equal(w.focus.on, false);
      if (!before && w.focus.on) reached.entered++;
      if (before && !w.focus.on) {
        reached.ended++;
        if (op === "toggle") reached.restored++;
      }
    }
    sequences++;
  };
  const walk = (start, ops, depth) => {
    run(start, ops);
    if (depth === 6) return;
    for (const op of OPS) walk(start, [...ops, op], depth + 1);
  };
  for (const start of STARTS) walk(start, [], 0);
  assert.equal(sequences, 4 * ((4 ** 7 - 1) / 3));
  assert.ok(reached.entered > 1000 && reached.ended > 1000);
  assert.ok(reached.restored > 500, "the sweep reaches the exit command");

  // Enter then exit with nothing in between restores every start exactly.
  for (const start of STARTS) {
    const w = world(start);
    w.toggle();
    w.toggle();
    assert.deepEqual(w.shown(), {
      sidebar: start.sidebar,
      statusBar: start.statusBar,
    });
    assert.equal(w.preference, start.statusBar);
  }
});

test("focus-mode is session view state: nothing is stored, the preference is never written, the module is pure and only the two render gates change", () => {
  // The module: printable ASCII, no imports and none of the words that would
  // let it reach the DOM, a clock, storage or a setting.
  const source = read("src/focus-mode.ts");
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
    "Math.random",
    "export default",
  ]) {
    assert.ok(!code.includes(word), "the module mentions " + word);
  }
  assert.deepEqual(Object.keys(pure).sort(), [
    "FOCUS_OFF",
    "enterFocus",
    "exitFocus",
    "focusAfterSidebar",
    "showStatusBar",
    "toggleFocus",
  ]);

  // The App function: no setting, no stored state, no layout, no terminal.
  const app = appText();
  const body = between(
    app,
    "const toggleFocusMode = () => {",
    "useEffect(() => setFocusMode(",
  );
  for (const word of [
    "settingsContext",
    "update(",
    "setState(",
    "saveState",
    "flushState",
    "localStorage",
    "window.hrig",
    "writeTerminal",
    "resizeTerminal",
    "createTerminal",
    "sendTerminalCommand",
    "fit(",
    "ResizeObserver",
    "dispatchEvent",
    "setTimeout",
    "requestAnimationFrame",
    "setToast",
    "notify(",
    "model.",
    "Actions.",
    "doAction(",
    "setModel(",
    "remember(",
  ]) {
    assert.ok(!body.includes(word), "toggleFocusMode uses " + word);
  }
  assert.equal(
    count(app, '"appearance.statusBar",'),
    1,
    "the only write of this preference is the existing Toggle status bar command",
  );
  assert.ok(
    has(
      between(app, 'name: "Toggle status bar",', 'name: "Toggle focus mode",'),
      'settingsContext.update( Object.hasOwn(projectPreferences, "appearance.statusBar") ? "project" : "user", "appearance.statusBar", !preferences["appearance.statusBar"], ),',
    ),
    "Toggle status bar is untouched",
  );
  // Focus state never reaches a stored structure or a setting.
  assert.equal(
    count(app, "setFocusMode("),
    2,
    "the function and the one effect",
  );
  for (const file of [
    "src/types.ts",
    "src/settings.ts",
    "src/SettingsPage.tsx",
    "SETTINGS.md",
  ]) {
    const text = read(file);
    assert.ok(!/focus-?mode|FocusState|focusMode/i.test(text), file);
  }
  assert.ok(
    !/state\.focus|focus:|\.\.\.focus/.test(stripComments(read("src/App.tsx"))),
    "focus is not part of the workspace state",
  );
  const settings = bundle("src/settings.ts");
  assert.ok(
    !Object.keys(settings.defaults).some((key) => /focus/i.test(key)),
    "no setting exists for focus mode",
  );
  assert.equal(settings.defaults["appearance.statusBar"], true);
  // The only places focus state is read: the status bar gate and the function.
  assert.equal(count(app, "showStatusBar("), 1);
  assert.equal(count(app, "toggleFocus("), 1);
  assert.equal(count(app, "focusAfterSidebar("), 1);
  assert.equal(count(app, "FOCUS_OFF"), 2, "the import and the first state");
});

test("focus-mode chord, hint and docs: the shortcut is claimed after the other chords and before the generic ones, acts only with no dialog open, is found in no other handler, and NAVIGATION.md says what it does", () => {
  const DOT = String.fromCharCode(183);
  const app = appText();
  assert.ok(
    has(
      app,
      'import { focusModeShortcutHint, isFocusModeKey } from "./shortcuts";',
    ),
  );
  assert.ok(
    has(
      app,
      "hint: `Hide the sidebar and status bar " +
        DOT +
        " ${focusModeShortcutHint(window.hrig.platform)}`,",
    ),
  );
  assert.equal(count(app, "focusModeShortcutHint(window.hrig.platform)"), 1);
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  const order = [
    "if (isHelpKey(",
    "if (isReopenPanelKey(event, window.hrig.platform)) {",
    "if (isMaximizePanelKey(event, window.hrig.platform)) {",
    "if (isFocusModeKey(event, window.hrig.platform)) {",
    "if (event.ctrlKey || event.metaKey) {",
  ].map((needle) => handler.indexOf(tight(needle)));
  assert.ok(
    order.every((at, i) => at >= 0 && (i === 0 || order[i - 1] < at)),
    "claim order: " + order,
  );
  assert.ok(
    has(
      handler,
      "if (isFocusModeKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) toggleFocusMode(); return; }",
    ),
    "claimed always, acts only with no dialog open",
  );
  assert.equal(
    count(app, "toggleFocusMode("),
    2,
    "the chord and the rebound chord",
  );
  assert.equal(count(app, "isFocusModeKey("), 1);
  // What was there before is untouched: the early return, the claimed letters,
  // the other claimed chords and Ctrl+B.
  assert.ok(
    has(
      handler,
      "if (event.defaultPrevented || event.isComposing || event.altKey) return;",
    ),
  );
  assert.ok(
    has(
      handler,
      '[",", "k", "o", "b", "p"].includes(event.key.toLowerCase()) || (event.shiftKey && event.key.toLowerCase() === "t")',
    ),
  );
  assert.ok(
    has(
      handler,
      'if (event.key.toLowerCase() === "b") { event.preventDefault(); setSidebar((v) => !v); }',
    ),
    "Ctrl+B still toggles the sidebar",
  );
  assert.ok(
    has(
      handler,
      'if (event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); openShell(); }',
    ),
  );
  assert.ok(
    has(
      handler,
      "if (isReopenPanelKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) reopenClosedPanel(); return; }",
    ),
  );
  assert.ok(
    has(
      handler,
      'if (isMaximizePanelKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) toggleMaximize("toggle", event.target); return; }',
    ),
  );
  assert.ok(
    !/fit\(|resizeTerminal|ResizeObserver|dispatchEvent|setTimeout/.test(
      handler,
    ),
  );
  assert.equal(count(app, '"Escape"'), 1, "no new Escape handler");
  assert.equal(
    count(app, 'addEventListener("keydown"'),
    2,
    "no second handler",
  );

  // The chord letter, audited again by machine: no other source file compares
  // a key with d, and only the shortcut module and the App know the predicate.
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort();
  assert.deepEqual(
    files.filter((name) =>
      /\bkey(?:\.toLowerCase\(\))?\s*[!=]==?\s*"d"|case "d"/i.test(
        stripComments(read("src/" + name)),
      ),
    ),
    ["shortcuts.ts"],
    "only the predicate compares a key with d",
  );
  assert.deepEqual(
    files.filter((name) =>
      stripComments(read("src/" + name)).includes("isFocusModeKey("),
    ),
    ["App.tsx", "shortcuts.ts"],
  );
  assert.deepEqual(
    files.filter((name) =>
      /\b(?:enterFocus|exitFocus|toggleFocus|focusAfterSidebar|showStatusBar)\(/.test(
        stripComments(read("src/" + name)),
      ),
    ),
    ["App.tsx", "focus-mode.ts"],
  );
  // Nothing outside src listens for keys: no shortcut layer in the main
  // process, the pop-out page, the mobile app or the start page, and the one
  // application menu holds only the standard macOS roles.
  const scan = (dir, found) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file, found);
      else if (/\.(cjs|mjs|js|html|ts|tsx)$/.test(entry.name)) found.push(file);
    }
    return found;
  };
  const outside = [
    ...scan(path.join(root, "electron"), []),
    ...scan(path.join(root, "public"), []),
    ...scan(path.join(root, "mobile"), []),
    path.join(root, "index.html"),
  ];
  assert.ok(outside.length > 10);
  for (const file of outside) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(
      !/before-input-event|globalShortcut|registerShortcut|accelerator|keydown|onKeyDown|keyup|keypress/.test(
        text,
      ),
      path.relative(root, file) + " handles keys",
    );
  }
  assert.ok(
    collapse(read("electron/main.cjs")).includes(
      "Menu.setApplicationMenu(process.platform==='darwin'?Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'windowMenu'}]):null);",
    ),
  );

  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const lines = raw.split("\n");
  assert.equal(lines.at(-1), "", "the file ends with one line feed");
  const mine = lines.filter((line) =>
    line.startsWith("The command center entry Toggle focus mode"),
  );
  assert.equal(mine.length, 1);
  const after = (start) =>
    lines.indexOf(mine[0]) > lines.findIndex((line) => line.startsWith(start));
  assert.ok(after("The command center entry Reopen closed panel"));
  assert.ok(after("Double-click the empty part of a panel group's tab strip"));
  assert.ok(/^[\x20-\x7e]*$/.test(mine[0]), "ASCII only");
  for (const fragment of [
    "or Ctrl+Shift+D (Cmd+Shift+D on macOS)",
    "hides the sidebar and the status bar so the panels get the whole window",
    "running it again puts both back exactly as they were",
    "a sidebar or status bar you had already closed stays closed",
    "Focus mode is a view state for the current session only",
    "It is not a setting, nothing is saved or written",
    "the Show status bar preference is never changed",
    "choosing Toggle status bar while focus mode is on changes the saved preference and takes effect when you leave",
    "Opening the sidebar by any route (Ctrl+B, Toggle sidebar, the sidebar button, an activity rail icon, opening a project) ends focus mode and keeps the sidebar open",
    "The activity rail and toolbar stay visible",
    "restarting the app starts with focus mode off",
    "The shortcut is ignored while a dialog is open and does not repeat while held",
    "in a terminal it replaces Ctrl+Shift+D, which no longer reaches the shell",
    "plain Ctrl+D, including Monaco's add selection to next match in the editor, is unchanged",
    "nothing is typed or sent",
  ])
    assert.ok(mine[0].includes(fragment), "NAVIGATION.md lacks: " + fragment);
  assert.ok(
    raw.includes("also runs Toggle sidebar, Toggle status bar"),
    "the earlier command center sentence is still there",
  );
});
