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
  const mod = new Module("goto-line-test", module);
  mod._compile(built.outputFiles[0].text, "goto-line-test");
  return mod.exports;
}

const { classifyTerminalKey, terminalOwnsKey } = bundle("src/terminal-keys.ts");
const shortcuts = bundle("src/shortcuts.ts");
const { zoomAction } = bundle("src/terminal-zoom.ts");

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
function panelText() {
  return tight(stripComments(read("src/EditorPanel.tsx")));
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

// Real source is cut out of a file, stripped of its types and run against
// fakes, so the app code itself is under test. A moved or reshaped piece fails
// loudly with a message naming it.
function cut(file, head, tail, name) {
  const source = stripComments(read(file));
  const from = source.indexOf(head);
  assert.ok(from >= 0, "missing " + name);
  const to = source.indexOf(tail, from + head.length);
  assert.ok(to > from, "unterminated " + name);
  return source.slice(from, to + tail.length);
}
function compile(code, params, result) {
  return new Function(
    ...params,
    transformSync(code, { loader: "ts" }).code + "\nreturn " + result + ";",
  );
}

// The command center entry Go to line: the real App function.
const commandFactory = compile(
  cut(
    "src/App.tsx",
    "\n  const goToLine = () => {\n",
    "\n  };\n",
    "the Go to line command",
  ).slice(1),
  ["requestAnimationFrame", "editorLineJumpers", "setToast"],
  "goToLine",
);
// What each mounted editor registers: the real helper of src/EditorPanel.tsx.
const openGoToLine = compile(
  cut(
    "src/EditorPanel.tsx",
    "\nfunction openGoToLine(editor: monaco.editor.ICodeEditor): boolean {\n",
    "\n}\n",
    "openGoToLine",
  ).slice(1),
  [],
  "openGoToLine",
)();

// One window: the animation frames wait in a queue until flush runs them, the
// registry is a real Map, and every jumper records that it was asked.
function world(answers = []) {
  const frames = [];
  const toasts = [];
  const asked = [];
  const jumpers = new Map();
  const add = (name, answer) =>
    jumpers.set(name, () => {
      asked.push(name);
      return answer;
    });
  answers.forEach((answer, index) => add("p" + index, answer));
  const goToLine = commandFactory(
    (frame) => frames.push(frame),
    jumpers,
    (text) => toasts.push(text),
  );
  const flush = () => {
    while (frames.length) frames.shift()();
  };
  return { goToLine, frames, toasts, asked, jumpers, add, flush };
}
function fakeEditor(focused) {
  const calls = [];
  return {
    calls,
    hasTextFocus: () => focused,
    trigger: (...args) => calls.push(args),
  };
}

test("goto-line tracer: the Go to line command waits for the frame after the command center closed, asks the editors and says so when none has focus", () => {
  // Nothing is looked up when the command runs: the command center still holds
  // the focus then, and gives it back to the editor on close.
  const none = world();
  none.goToLine();
  assert.equal(none.frames.length, 1);
  assert.deepEqual(none.toasts, []);
  none.flush();
  assert.deepEqual(none.toasts, ["Click an editor first"]);
  assert.equal(none.frames.length, 0);

  // The first editor that answers true gets the prompt; the rest are not asked.
  const second = world([false, true, false]);
  second.goToLine();
  assert.deepEqual(second.asked, []);
  second.flush();
  assert.deepEqual(second.asked, ["p0", "p1"]);
  assert.deepEqual(second.toasts, []);
  const only = world([true]);
  only.goToLine();
  only.flush();
  assert.deepEqual(only.asked, ["p0"]);
  assert.deepEqual(only.toasts, []);

  // No editor has focus: every one is asked once and the person is told.
  const nobody = world([false, false]);
  nobody.goToLine();
  nobody.flush();
  assert.deepEqual(nobody.asked, ["p0", "p1"]);
  assert.deepEqual(nobody.toasts, ["Click an editor first"]);

  // The registry is read in the frame, not when the command ran.
  const late = world();
  late.goToLine();
  late.add("opened-meanwhile", true);
  late.flush();
  assert.deepEqual(late.asked, ["opened-meanwhile"]);
  assert.deepEqual(late.toasts, []);
  const gone = world([true]);
  gone.goToLine();
  gone.jumpers.delete("p0");
  gone.flush();
  assert.deepEqual(gone.asked, []);
  assert.deepEqual(gone.toasts, ["Click an editor first"]);

  // Every run is one frame and at most one toast; the registry is not changed.
  const twice = world([false]);
  twice.goToLine();
  twice.goToLine();
  assert.equal(twice.frames.length, 2);
  twice.flush();
  assert.deepEqual(twice.toasts, [
    "Click an editor first",
    "Click an editor first",
  ]);
  assert.deepEqual([...twice.jumpers.keys()], ["p0"]);

  // What an editor registers: only an editor whose text has focus is asked to
  // open Monaco's own prompt, and the prompt is the editor action, not a key.
  const focused = fakeEditor(true);
  assert.equal(openGoToLine(focused), true);
  assert.deepEqual(focused.calls, [["hrig", "editor.action.gotoLine", null]]);
  const blurred = fakeEditor(false);
  assert.equal(openGoToLine(blurred), false);
  assert.deepEqual(blurred.calls, []);

  // App wiring, whitespace-insensitive and comment-stripped.
  const app = appText();
  assert.ok(
    has(app, 'editorFocusers, editorLineJumpers, } from "./editor-buffers";'),
    "the registry is imported from editor-buffers",
  );
  assert.equal(count(app, "editorLineJumpers"), 2);
  assert.equal(count(app, "const goToLine = () => {"), 1);
  assert.equal(count(app, "goToLine"), 2);
  assert.equal(count(app, 'name: "Go to line",'), 1);
  const entry = between(
    app,
    'name: "Go to line",',
    '["Visual workspace arranger", "arranger"],',
  );
  assert.ok(has(entry, 'hint: "Ctrl G in the editor",'));
  assert.ok(has(entry, "icon: <FileCode2 size={16} />,"));
  assert.ok(has(entry, "action: goToLine,"));
  const names = [
    'name: "Open keyboard shortcuts",',
    'name: "Go to line",',
    '["Visual workspace arranger", "arranger"],',
  ].map((needle) => app.indexOf(tight(needle)));
  assert.ok(names[0] > 0 && names[0] < names[1] && names[1] < names[2]);

  // Editor wiring: one registry entry per editor kind, removed only by its owner.
  const buffers = tight(stripComments(read("src/editor-buffers.ts")));
  assert.equal(
    count(
      buffers,
      "export const editorLineJumpers = new Map<string, () => boolean>();",
    ),
    1,
  );
  const panel = panelText();
  assert.equal(count(panel, "editorLineJumpers.set(id, jump);"), 2);
  assert.equal(count(panel, "editorLineJumpers.delete(id)"), 1);
  assert.ok(
    has(
      panel,
      "if (editorLineJumpers.get(id) === jumpRef.current) editorLineJumpers.delete(id);",
    ),
  );
  assert.ok(has(panel, "const jump = () => openGoToLine(editor);"));
  assert.ok(
    has(
      panel,
      "const jump = () => openGoToLine(editor.getModifiedEditor()) || openGoToLine(editor.getOriginalEditor());",
    ),
  );
  assert.equal(count(panel, "jumpRef.current = jump;"), 2);
  assert.equal(count(panel, "const jumpRef = useRef"), 1);
  assert.equal(
    count(panel, 'editor.trigger("hrig", "editor.action.gotoLine", null);'),
    1,
  );
  assert.equal(count(panel, ".trigger("), 1);
  assert.equal(count(panel, "editor.addCommand("), 1);
});

// The installed Monaco, read as source: the go-to-line action and its keys.
const monacoDir = path.join(root, "node_modules", "monaco-editor");
const monacoEsm = path.join(monacoDir, "esm", "vs");
const gotoFile = path.join(
  "editor",
  "standalone",
  "browser",
  "quickAccess",
  "standaloneGotoLineQuickAccess.js",
);
const findFile = path.join(
  "editor",
  "contrib",
  "find",
  "browser",
  "findController.js",
);

// Monaco's own parser behind the prompt, loaded from the installed package.
// The module needs four browser globals to load; they are set for the call
// and put back, and nothing else of the page is needed to parse a position.
function monacoParse(lines) {
  const built = buildSync({
    entryPoints: [
      path.join(
        monacoEsm,
        "editor",
        "contrib",
        "quickAccess",
        "browser",
        "gotoLineQuickAccess.js",
      ),
    ],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    loader: { ".css": "empty" },
  });
  const stubs = {
    window: globalThis,
    location: { href: "http://localhost/" },
    HTMLElement: class {},
    customElements: { get: () => true, define() {} },
  };
  const before = {};
  for (const name of Object.keys(stubs)) {
    before[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value: stubs[name],
      configurable: true,
      writable: true,
    });
  }
  try {
    const mod = new Module("goto-line-monaco", module);
    mod._compile(built.outputFiles[0].text, "goto-line-monaco");
    const Provider = class
      extends mod.exports.AbstractGotoLineQuickAccessProvider
    {
      constructor() {
        super();
        this.storageService = { getBoolean: () => false };
      }
    };
    const provider = new Provider();
    const model = {
      getLineCount: () => lines.length,
      getLineContent: (n) => lines[n - 1],
      getLineMaxColumn: (n) => lines[n - 1].length + 1,
      getOptions: () => ({ tabSize: 4 }),
      getValueLength: () => lines.join("\n").length,
    };
    return (text) => {
      const parsed = provider.parsePosition({ getModel: () => model }, text);
      return { line: parsed.lineNumber, column: parsed.column };
    };
  } finally {
    for (const name of Object.keys(stubs)) {
      if (before[name]) Object.defineProperty(globalThis, name, before[name]);
      else delete globalThis[name];
    }
  }
}

test("goto-line monaco: the installed editor registers editor.action.gotoLine on Ctrl+G (the Control key on macOS) while an editor has focus, the app bundles it and overrides nothing, and Monaco's own parser reads line and column", () => {
  const version = JSON.parse(
    fs.readFileSync(path.join(monacoDir, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.56\./,
    "Monaco changed to " + version + ": audit Ctrl+G and the prompt again",
  );

  // The action: its id, the focus-only context and the two keys.
  const goto = collapse(
    fs.readFileSync(path.join(monacoEsm, gotoFile), "utf8"),
  );
  for (const fragment of [
    "static { this.ID = 'editor.action.gotoLine'; }",
    "precondition: undefined,",
    "kbExpr: EditorContextKeys.focus,",
    "primary: 2048 /* KeyMod.CtrlCmd */ | 37 /* KeyCode.KeyG */,",
    "mac: { primary: 256 /* KeyMod.WinCtrl */ | 37 /* KeyCode.KeyG */ },",
    "weight: 100 /* KeybindingWeight.EditorContrib */",
    "registerEditorAction(GotoLineAction);",
    "quickAccess.show(StandaloneGotoLineQuickAccessProvider.GO_TO_LINE_PREFIX);",
  ])
    assert.ok(goto.includes(collapse(fragment)), "missing " + fragment);

  // No other Monaco binding uses the G key except Find next and Find previous
  // on macOS, which is why the macOS key of the prompt is the Control key.
  const found = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) {
        const lines = fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.includes("KeyCode.KeyG"));
        if (lines.length)
          found[path.relative(monacoEsm, file)] = lines.map((l) => l.trim());
      }
    }
  };
  walk(path.join(monacoEsm, "editor"));
  assert.deepEqual(found, {
    [findFile]: [
      "mac: { primary: 2048 /* KeyMod.CtrlCmd */ | 37 /* KeyCode.KeyG */, secondary: [61 /* KeyCode.F3 */] },",
      "mac: { primary: 2048 /* KeyMod.CtrlCmd */ | 1024 /* KeyMod.Shift */ | 37 /* KeyCode.KeyG */, secondary: [1024 /* KeyMod.Shift */ | 61 /* KeyCode.F3 */] },",
    ],
    [gotoFile]: [
      "primary: 2048 /* KeyMod.CtrlCmd */ | 37 /* KeyCode.KeyG */,",
      "mac: { primary: 256 /* KeyMod.WinCtrl */ | 37 /* KeyCode.KeyG */ },",
    ],
  });

  // The app imports the whole editor entry, which includes the contribution:
  // nothing extra is imported, so the bundle does not grow.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(monacoDir, "package.json"), "utf8"),
  );
  assert.equal(manifest.exports["."].import, "./esm/vs/index.js");
  assert.ok(
    fs
      .readFileSync(path.join(monacoEsm, "index.js"), "utf8")
      .includes(
        "import './editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';",
      ),
    "the entry of the package imports the go-to-line contribution",
  );
  const panel = read("src/EditorPanel.tsx");
  assert.equal(count(panel, 'import * as monaco from "monaco-editor";'), 1);
  assert.ok(!panel.includes("monaco-editor/esm"));
  assert.ok(!panel.includes("editor.api"));
  assert.ok(!/alias|monaco/.test(read("vite.config.ts")));

  // Monaco's own parser: line, line and column with three separators, a
  // negative line from the end, clipping, and no target for text.
  const doc = Array.from({ length: 40 }, (_, i) => "line " + (i + 1));
  const parse = monacoParse(doc);
  assert.deepEqual(parse("12"), { line: 12, column: 1 });
  assert.deepEqual(parse("12:5"), { line: 12, column: 5 });
  assert.deepEqual(parse("12,5"), { line: 12, column: 5 });
  assert.deepEqual(parse("12#5"), { line: 12, column: 5 });
  assert.deepEqual(parse(" 12 : 5 "), { line: 12, column: 5 });
  assert.deepEqual(parse("1"), { line: 1, column: 1 });
  assert.deepEqual(parse("40"), { line: 40, column: 1 });
  assert.deepEqual(parse("-1"), { line: 40, column: 1 });
  assert.deepEqual(parse("-3"), { line: 38, column: 1 });
  assert.deepEqual(parse("999"), { line: 40, column: 1 });
  assert.deepEqual(parse("0"), { line: 1, column: 1 });
  assert.deepEqual(parse("12:999"), { line: 12, column: 8 });
  for (const text of ["", "abc", "x:5", ":"])
    assert.equal(parse(text).line, undefined, JSON.stringify(text));
});

test("goto-line adds nothing of its own: the app claims no Ctrl+G, so a terminal or a field keeps it, and there is no parser, no second command and no global shortcut", () => {
  const app = appText();
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  assert.ok(!handler.includes('"g"'), "the key handler never looks at G");
  assert.ok(!handler.includes("goToLine"));
  assert.ok(
    has(handler, "routeOverriddenKey(event, window.hrig.platform, shortcutOverrides)"),
    "app shortcuts route through the override catalog",
  );
  assert.ok(!handler.includes('"workspace.gotoLine"'));

  // Ctrl+G and its relatives pass every layer that could take them.
  const chords = [
    { ctrlKey: true, metaKey: false, shiftKey: false },
    { ctrlKey: false, metaKey: true, shiftKey: false },
    { ctrlKey: true, metaKey: false, shiftKey: true },
    { ctrlKey: false, metaKey: true, shiftKey: true },
  ];
  const terminal = { closest: (selector) => (selector ? {} : null) };
  for (const platform of ["darwin", "win32", "linux", "freebsd", ""]) {
    for (const mods of chords) {
      const event = { key: "g", altKey: false, ...mods };
      for (const selected of [false, true])
        assert.equal(
          classifyTerminalKey(event, platform, selected),
          "pass",
          platform + JSON.stringify(mods),
        );
      assert.equal(terminalOwnsKey(event, platform, terminal), false);
      assert.equal(zoomAction(event), null);
      assert.equal(
        shortcuts.isReopenPanelKey({ ...event, key: "G" }, platform),
        false,
      );
      assert.equal(
        shortcuts.isMaximizePanelKey({ ...event, key: "G" }, platform),
        false,
      );
      assert.equal(
        shortcuts.isFocusModeKey({ ...event, key: "G" }, platform),
        false,
      );
      assert.equal(
        shortcuts.isHelpKey(event, { tagName: "BODY" }, false),
        false,
      );
    }
  }

  // The prompt is Monaco's: the app has no parser, no key binding for it, and
  // names the editor action in exactly one place.
  assert.ok(!fs.existsSync(path.join(root, "src", "goto-line.ts")));
  let named = 0;
  for (const name of fs.readdirSync(path.join(root, "src"))) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const text = read(path.join("src", name));
    assert.ok(!/parseLineColumn|parsePosition/.test(text), name);
    named += count(stripComments(text), "editor.action.gotoLine");
  }
  assert.equal(named, 1);
  const editor = read("src/EditorPanel.tsx");
  assert.ok(!editor.includes("KeyCode.KeyG"));
  assert.ok(!editor.includes("registerEditorAction"));
  assert.ok(!editor.includes("addAction("));
  assert.equal(count(editor, "monaco.KeyCode."), 1);
  assert.ok(
    /editor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,/.test(
      editor,
    ),
  );

  // No native menu or main-process shortcut can take it either.
  for (const name of fs.readdirSync(path.join(root, "electron"))) {
    if (!/\.(cjs|mjs)$/.test(name)) continue;
    const text = read(path.join("electron", name));
    for (const word of ["before-input-event", "globalShortcut", "accelerator"])
      assert.ok(!text.includes(word), name + " uses " + word);
  }

  // Quick Open keeps its own :line suffix, which opens a file at a line; it is
  // a different path from the prompt and is not touched.
  const quick = tight(stripComments(read("src/QuickOpen.tsx")));
  assert.ok(has(quick, "const suffix = query.match(/:(\\d+)$/);"));
  assert.ok(has(quick, "onOpen(first.path, lineRef.current)"));
  assert.ok(
    has(
      panelText(),
      "if (config.line) { editorRef.current?.revealLineInCenter(config.line);",
    ),
  );
});

test("goto-line shortcut: the Editor group lists Ctrl+G once on every platform, the command center hint agrees with it, and NAVIGATION.md documents the prompt after the sidebar paragraph", () => {
  // The catalog row, found by what it says rather than by its position.
  for (const platform of ["darwin", "win32", "linux", "freebsd", ""]) {
    const rows = shortcuts
      .shortcutGroups(platform)
      .flatMap((group) =>
        group.shortcuts.map((s) => ({ ...s, group: group.id })),
      );
    assert.deepEqual(
      rows
        .filter((row) => /go to a line/i.test(row.label))
        .map((row) => [row.group, row.id, row.keys]),
      [["editor", "editor.gotoLine", ["Ctrl+G"]]],
      platform,
    );
    assert.equal(
      rows.filter((row) => row.keys.some((k) => /^(ctrl|cmd)\+g$/i.test(k)))
        .length,
      1,
      platform + " lists the chord once",
    );
  }

  // The command center entry shows the same chord, spelled as its hints are.
  const app = appText();
  const chord = "Ctrl+G";
  assert.ok(
    has(app, 'hint: "' + chord.split("+").join(" ") + ' in the editor",'),
  );
  assert.ok(has(app, 'setToast("Click an editor first");'));

  // NAVIGATION.md: one new paragraph, after the sidebar and focus mode ones.
  const nav = read("NAVIGATION.md");
  assert.equal(nav.charCodeAt(0), 0xfeff, "the byte order mark is kept");
  assert.ok(nav.endsWith(".\n") && !nav.endsWith("\n\n"));
  const lines = nav.split("\n");
  const mine = lines.filter((line) =>
    line.startsWith("Ctrl+G opens the go-to-line prompt in the code editor"),
  );
  assert.equal(mine.length, 1);
  const paragraph = mine[0];
  assert.ok(/^[\x20-\x7e]+$/.test(paragraph), "plain ASCII only");
  const at = lines.indexOf(paragraph);
  assert.ok(lines[at - 1] === "" && at > 0);
  assert.ok(
    at >
      lines.findIndex((l) =>
        l.startsWith("The sidebar shows and hides with Ctrl+B"),
      ),
  );
  assert.ok(
    at >
      lines.findIndex((l) =>
        l.startsWith("The command center entry Toggle focus mode"),
      ),
  );
  for (const fragment of [
    "in a diff view too, while that editor has focus",
    "(Control+G on macOS, where Cmd+G finds the next match)",
    "the shortcut is listed in the Keyboard shortcuts sheet",
    "The command center entry Go to line opens the same prompt in the editor that had focus when you opened the command center",
    "shows Click an editor first when none did",
    "optionally followed by a colon and a column such as 12:5",
    "(a comma or # also separates them)",
    "a negative number counts from the end of the file",
    "a number past the end goes to the last line",
    "Enter jumps and Escape cancels",
    "The shortcut belongs to the editor only, so in a terminal Ctrl+G stays the shell's own key and a text field keeps it",
    "separate from the :line suffix in Quick Open, which opens a file at a line",
    "there is no setting, nothing is saved, and nothing is typed or sent",
  ])
    assert.ok(paragraph.includes(fragment), "missing: " + fragment);
  assert.ok(
    nav.includes("The command center entry Toggle focus mode"),
    "earlier paragraphs are still there",
  );
});
