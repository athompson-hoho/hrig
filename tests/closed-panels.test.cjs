const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(file, module);
  mod._compile(built.outputFiles[0].text, file);
  return mod.exports;
}

const closed = load("src/closed-panels.ts");
const {
  MAX_CLOSED_PANELS,
  describeClosedPanel,
  normalizeClosed,
  planReopen,
  popLatest,
  pushClosed,
} = closed;

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

const SCOPE = "local::/work/app::rig1";
const OTHER_SCOPE = "ssh1::/srv::";
const LOCAL = { id: "local", name: "This computer", kind: "local", root: "." };
const CTX = {
  connectionIds: ["local", "ssh1"],
  activeConnectionId: "local",
  inventoryReady: true,
  seats: [
    { id: "a1", session: "s-a1" },
    { id: "a2", session: null },
  ],
};

function fileTab(file, extra = {}, component = "editor") {
  return {
    component,
    name: file.split("/").pop(),
    config: { connection: LOCAL, root: "/work/app", path: file, ...extra },
  };
}
function seatTab(seatId, extra = {}) {
  return {
    component: "terminal",
    name: "alpha",
    config: {
      connection: LOCAL,
      root: "/work/app",
      seat: { id: seatId, rigId: "r1", rigName: "demo", name: "alpha" },
      terminalId: "seat:local:" + seatId,
      ...extra,
    },
  };
}
function entryOf(file, extra = {}) {
  return {
    kind: "file",
    scope: SCOPE,
    title: file,
    connectionId: "local",
    root: "/work/app",
    path: file,
    ...extra,
  };
}
function makeRng(seed) {
  let x = seed;
  return (n) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % n;
  };
}

test("closed-panels tracer: closing an editor tab records it, popping returns it and the plan is the normal file open, through the real App wiring", () => {
  const entry = describeClosedPanel(fileTab("src/a.ts", { line: 12 }), SCOPE);
  assert.deepEqual(entry, {
    kind: "file",
    scope: SCOPE,
    title: "a.ts",
    connectionId: "local",
    root: "/work/app",
    path: "src/a.ts",
    line: 12,
  });
  const stack = pushClosed([], entry);
  assert.deepEqual(stack, [entry]);
  const popped = popLatest(stack, SCOPE);
  assert.deepEqual(popped.entry, entry);
  assert.deepEqual(popped.stack, []);
  assert.deepEqual(planReopen(popped.entry, CTX), {
    action: "openFile",
    path: "src/a.ts",
    diff: false,
    connectionId: "local",
    root: "/work/app",
    line: 12,
  });
  assert.deepEqual(popLatest([], SCOPE), { entry: null, stack: [] });
  assert.equal(MAX_CLOSED_PANELS, 10);

  const app = appText();
  assert.ok(
    has(
      app,
      'import { describeClosedPanel, planReopen, popLatest, pushClosed, type ClosedPanel, } from "./closed-panels";',
    ),
    "App imports the pure module",
  );
  assert.ok(
    has(app, "const closedPanels = useRef<ClosedPanel[]>([]);"),
    "the stack lives in a ref, in memory only",
  );
  assert.equal(
    count(app, "rememberClosed("),
    2,
    "exactly two calls: the confirmed close and the plain close",
  );
  assert.ok(
    has(
      app,
      "const rememberClosed = (id: string) => { const node = model.getNodeById(id); if (!(node instanceof TabNode)) return; closedPanels.current = pushClosed( closedPanels.current, describeClosedPanel( { component: node.getComponent(), name: node.getName(), config: node.getConfig(), }, workspace, ), ); };",
    ),
    "rememberClosed reads only component, name and config of a live tab",
  );
  const closeTab = between(
    app,
    "const closeTab = (id: string) => {",
    "const onAction = (action: Action) => {",
  );
  assert.ok(
    has(closeTab, "rememberClosed(id); model.doAction(Actions.deleteTab(id));"),
    "the confirmed close records the tab right before it is deleted",
  );
  const branch = between(
    app,
    "if (action.type === Actions.DELETE_TAB) {",
    "return action;",
  );
  assert.ok(
    has(branch, "clearBuffer(id); rememberClosed(id); }"),
    "the plain close records the tab last, after the dirty-tab confirmation",
  );
  const dirty = between(
    branch,
    "if (dirtyTabs.current.has(id)) {",
    "return undefined;",
  );
  assert.ok(
    !dirty.includes("rememberClosed("),
    "a close that is waiting for confirmation records nothing yet",
  );
  assert.equal(count(app, 'name: "Reopen closed panel",'), 1);
  assert.equal(count(app, "action: reopenClosedPanel,"), 1);
  const reopen = between(
    app,
    "const reopenClosedPanel = () => {",
    "const commands = [",
  );
  assert.ok(
    has(
      reopen,
      "openFile(plan.path, plan.diff, plan.line, { connection: target, root: plan.root, });",
    ),
    "a file reopens through openFile",
  );
  assert.ok(has(reopen, "if (seat) openSeat(seat);"), "a seat via openSeat");
  assert.ok(has(reopen, 'setToast("Nothing to reopen");'));
});

test("closed-panels bounded stack keeps the newest 10, moves a repeat to the top, isolates workspaces, never mutates and cleans anything it is given", () => {
  const frozen = (list) => Object.freeze(list.map((e) => Object.freeze(e)));
  const many = [];
  for (let i = 0; i < 25; i++) {
    const before = frozen(many);
    const next = pushClosed(before, entryOf("f" + i + ".ts"));
    assert.notEqual(next, before);
    assert.equal(next.length, Math.min(i + 1, 10), "length after " + i);
    many.splice(0, many.length, ...next);
  }
  assert.deepEqual(
    many.map((e) => e.path),
    Array.from({ length: 10 }, (_, i) => "f" + (15 + i) + ".ts"),
  );
  assert.deepEqual(pushClosed(many, null), many);
  assert.notEqual(pushClosed(many, null), many);
  assert.deepEqual(pushClosed(many, { kind: "terminal" }), many);

  const A = entryOf("a.ts");
  const B = entryOf("b.ts");
  const C = entryOf("c.ts");
  assert.deepEqual(
    pushClosed(pushClosed(pushClosed(pushClosed([], A), B), C), A),
    [B, C, A],
  );
  const aMoved = entryOf("a.ts", { line: 40 });
  const moved = pushClosed([A, B], aMoved);
  assert.deepEqual(moved, [B, aMoved]);
  assert.equal(moved[1].line, 40);
  const diffA = entryOf("a.ts", { kind: "diff" });
  assert.deepEqual(pushClosed([A], diffA), [A, diffA]);
  const farA = entryOf("a.ts", { scope: OTHER_SCOPE });
  assert.deepEqual(pushClosed([A], farA), [A, farA]);
  const seatA = {
    kind: "seat",
    scope: SCOPE,
    title: "alpha",
    connectionId: "local",
    seatId: "a1",
  };
  assert.deepEqual(pushClosed([seatA], { ...seatA, title: "renamed" }), [
    { ...seatA, title: "renamed" },
  ]);

  const mixed = [A, entryOf("x.ts", { scope: OTHER_SCOPE }), C];
  const first = popLatest(frozen(mixed), SCOPE);
  assert.deepEqual(first.entry, C);
  assert.deepEqual(first.stack, [A, mixed[1]]);
  const second = popLatest(first.stack, SCOPE);
  assert.deepEqual(second.entry, A);
  assert.deepEqual(second.stack, [mixed[1]]);
  assert.deepEqual(popLatest(second.stack, SCOPE).entry, null);
  assert.deepEqual(popLatest(second.stack, OTHER_SCOPE).entry, mixed[1]);
  assert.deepEqual(popLatest(mixed, "nowhere").stack, mixed);
  assert.equal(popLatest(mixed, undefined).entry, null);
  assert.equal(popLatest("not a list", SCOPE).entry, null);

  // Independent model: newest last, the same panel kept once, 10 at most.
  const rng = makeRng(20261108);
  const identities = [];
  for (const scope of [SCOPE, OTHER_SCOPE])
    for (let i = 0; i < 7; i++) identities.push(entryOf("p" + i, { scope }));
  let real = [];
  let model = [];
  for (let step = 0; step < 400; step++) {
    if (rng(4) === 0) {
      const scope = rng(2) === 0 ? SCOPE : OTHER_SCOPE;
      const out = popLatest(real, scope);
      const at = model.map((e) => e.scope).lastIndexOf(scope);
      assert.deepEqual(out.entry, at < 0 ? null : model[at], "pop " + step);
      if (at >= 0) model = model.filter((_, i) => i !== at);
      real = out.stack;
    } else {
      const entry = identities[rng(identities.length)];
      real = pushClosed(real, entry);
      model = model
        .filter((e) => e.scope !== entry.scope || e.path !== entry.path)
        .concat(entry)
        .slice(-10);
    }
    assert.deepEqual(real, model, "step " + step);
  }

  const NL = String.fromCharCode(10);
  const NUL = String.fromCharCode(0);
  const DEL = String.fromCharCode(127);
  for (const junk of [
    null,
    undefined,
    7,
    "text",
    {},
    { length: 3 },
    true,
    () => [],
  ])
    assert.deepEqual(normalizeClosed(junk), [], String(junk));
  const messy = normalizeClosed([
    null,
    7,
    "x",
    [],
    { kind: "shell", scope: SCOPE, connectionId: "local" },
    { kind: "terminal", scope: SCOPE, connectionId: "local", seatId: "s" },
    { ...entryOf("ok.ts"), content: "SECRET", output: "ls", token: "t" },
    entryOf("bad" + NL + "path"),
    entryOf("bad" + NUL),
    entryOf("bad" + DEL),
    entryOf(""),
    entryOf("p", { root: "" }),
    entryOf("p", { scope: "" }),
    entryOf("p", { connectionId: 5 }),
    entryOf("long", { path: "x".repeat(4097) }),
    entryOf("edge", { path: "y".repeat(4096) }),
    { kind: "seat", scope: SCOPE, connectionId: "local" },
    { kind: "seat", scope: SCOPE, connectionId: "local", seatId: "s" + NL },
    { kind: "seat", scope: SCOPE, connectionId: "local", seatId: "a1", x: 1 },
  ]);
  assert.deepEqual(
    messy.map((e) => e.path ?? e.seatId),
    ["ok.ts", "y".repeat(4096), "a1"],
  );
  assert.deepEqual(Object.keys(messy[0]).sort(), [
    "connectionId",
    "kind",
    "path",
    "root",
    "scope",
    "title",
  ]);
  assert.deepEqual(Object.keys(messy[2]).sort(), [
    "connectionId",
    "kind",
    "scope",
    "seatId",
    "title",
  ]);
  assert.equal(messy[2].title, "a1", "a blank title falls back to the id");
  const titled = normalizeClosed([
    { ...entryOf("t.ts"), title: "  a" + NL + "b" + "c".repeat(300) },
    { ...entryOf("u.ts"), title: " " + NL + " " },
  ]);
  assert.ok(titled[0].title.length >= 190 && titled[0].title.length <= 200);
  assert.ok(titled[0].title.startsWith("a b"));
  assert.ok(titled[0].title.endsWith("c"));
  assert.equal(titled[1].title, "u.ts");
  const lines = [0, -1, 1.5, "3", NaN, Infinity, 10000001, null, undefined];
  for (const line of lines)
    assert.equal(
      "line" in normalizeClosed([entryOf("l.ts", { line })])[0],
      false,
      String(line),
    );
  for (const line of [1, 7, 10000000])
    assert.equal(normalizeClosed([entryOf("l.ts", { line })])[0].line, line);
  const twice = normalizeClosed(
    Array.from({ length: 40 }, (_, i) => entryOf("n" + (i % 13))),
  );
  assert.equal(twice.length, 10);
  assert.deepEqual(normalizeClosed(twice), twice);
  assert.notEqual(normalizeClosed(twice), twice);
});

test("closed-panels reopenable kinds are files, diffs and seat panels only, a plan can only open a file, attach a seat or skip, and the module stays pure", () => {
  assert.equal(describeClosedPanel(fileTab("a/b.ts"), SCOPE).kind, "file");
  assert.equal(
    describeClosedPanel(fileTab("a/b.ts", {}, "diff"), SCOPE).kind,
    "diff",
  );
  assert.deepEqual(describeClosedPanel(seatTab("a1"), SCOPE), {
    kind: "seat",
    scope: SCOPE,
    title: "alpha",
    connectionId: "local",
    seatId: "a1",
  });
  const uuid = "6f1c2d3e-aaaa-bbbb-cccc-1234567890ab";
  const skipped = [
    [
      "a shell",
      {
        ...seatTab("a1"),
        config: { connection: LOCAL, terminalId: uuid, root: "/w" },
      },
    ],
    [
      "a seat panel whose id is not its seat",
      seatTab("a1", { terminalId: "seat:local:other" }),
    ],
    [
      "a seat panel on another connection id",
      seatTab("a1", { terminalId: "seat:ssh1:a1" }),
    ],
    ["a rig-control terminal", seatTab("a1", { rigControlToken: "tok" })],
    [
      "a rig-control terminal without a seat",
      {
        component: "terminal",
        name: "rig",
        config: {
          connection: LOCAL,
          root: "/w",
          terminalId: uuid,
          rigControlToken: "tok",
        },
      },
    ],
    ["a terminal with a numeric seat id", seatTab(5)],
  ];
  for (const [label, tab] of skipped)
    assert.equal(describeClosedPanel(tab, SCOPE), null, label);
  for (const component of [
    "settings",
    "arranger",
    "doctor",
    "rigControl",
    "attention",
    "projectTools",
    "review",
    "problems",
    "ports",
    "preview",
    "rigManager",
    "savedDrafts",
    "workItems",
    "missingSeat",
    "queue",
    "messages",
    "activity",
    "welcome",
    "shellPlaceholder",
    "",
    undefined,
    7,
  ])
    assert.equal(
      describeClosedPanel({ ...fileTab("a.ts"), component }, SCOPE),
      null,
      String(component),
    );
  const NL = String.fromCharCode(10);
  for (const bad of [
    null,
    undefined,
    "tab",
    {},
    { component: "editor" },
    { component: "editor", config: null },
    { component: "editor", config: "x" },
    { component: "editor", config: { path: "a.ts", root: "/w" } },
    {
      component: "editor",
      config: { connection: null, path: "a.ts", root: "/w" },
    },
    {
      component: "editor",
      config: { connection: { id: 3 }, path: "a.ts", root: "/w" },
    },
    { component: "editor", config: { connection: LOCAL, root: "/w" } },
    {
      component: "editor",
      config: { connection: LOCAL, path: "", root: "/w" },
    },
    {
      component: "editor",
      config: { connection: LOCAL, path: "a" + NL + "b", root: "/w" },
    },
    { component: "diff", config: { connection: LOCAL, path: "a.ts" } },
  ])
    assert.equal(describeClosedPanel(bad, SCOPE), null, JSON.stringify(bad));
  assert.equal(describeClosedPanel(fileTab("a.ts"), ""), null);
  assert.equal(describeClosedPanel(fileTab("a.ts"), undefined), null);

  const noLine = planReopen(entryOf("a.ts"), CTX);
  assert.deepEqual(noLine, {
    action: "openFile",
    path: "a.ts",
    diff: false,
    connectionId: "local",
    root: "/work/app",
  });
  assert.equal("line" in noLine, false);
  const diffPlan = planReopen(entryOf("a.ts", { kind: "diff", line: 3 }), CTX);
  assert.equal(diffPlan.diff, true);
  assert.equal(diffPlan.line, 3);
  const gone = planReopen(entryOf("a.ts", { connectionId: "removed" }), CTX);
  assert.equal(gone.action, "skip");
  assert.equal(gone.keep, false);
  assert.ok(gone.message.includes("a.ts") && gone.message.includes("removed"));
  const seat = (seatId, extra = {}) => ({ ...seatA(), seatId, ...extra });
  function seatA() {
    return {
      kind: "seat",
      scope: SCOPE,
      title: "alpha",
      connectionId: "local",
      seatId: "a1",
    };
  }
  assert.deepEqual(planReopen(seat("a1"), CTX), {
    action: "openSeat",
    seatId: "a1",
  });
  const stale = planReopen(seat("a1"), { ...CTX, inventoryReady: false });
  assert.equal(stale.action, "skip");
  assert.equal(stale.keep, true);
  assert.ok(stale.message.includes("Nothing was started"));
  const idle = planReopen(seat("a2"), CTX);
  assert.equal(idle.action, "skip");
  assert.equal(idle.keep, true);
  assert.ok(idle.message.includes("Nothing was started"));
  const missing = planReopen(seat("zz"), CTX);
  assert.equal(missing.action, "skip");
  assert.equal(missing.keep, false);
  const away = planReopen(seat("a1", { connectionId: "ssh1" }), CTX);
  assert.equal(away.action, "skip");
  assert.equal(away.keep, false);

  const allowed = {
    openFile: ["action", "connectionId", "diff", "line", "path", "root"],
    openSeat: ["action", "seatId"],
    skip: ["action", "keep", "message"],
  };
  let seen = 0;
  for (const kind of ["file", "diff", "seat"])
    for (const ready of [true, false])
      for (const seatId of ["a1", "a2", "zz"])
        for (const connectionId of ["local", "ssh1", "removed"])
          for (const line of [undefined, 9]) {
            const entry =
              kind === "seat"
                ? seat(seatId, { connectionId })
                : entryOf("q.ts", { kind, connectionId, line });
            const plan = planReopen(entry, { ...CTX, inventoryReady: ready });
            assert.ok(Object.hasOwn(allowed, plan.action), plan.action);
            for (const key of Object.keys(plan))
              assert.ok(allowed[plan.action].includes(key), key);
            seen++;
          }
  assert.equal(seen, 3 * 2 * 3 * 3 * 2);

  assert.deepEqual(Object.keys(closed).sort(), [
    "MAX_CLOSED_PANELS",
    "describeClosedPanel",
    "normalizeClosed",
    "planReopen",
    "popLatest",
    "pushClosed",
  ]);
  const source = read("src/closed-panels.ts");
  assert.ok(!/[^\x20-\x7e\n]/.test(source), "the module is ASCII only");
  const code = stripComments(source);
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
    /localStorage/,
    /writeTerminal/,
    /createTerminal/,
    /sendTerminalCommand/,
    /rigControl\b/,
    /export default/,
  ])
    assert.ok(!forbidden.test(code), "the module must stay pure: " + forbidden);
});

function sourceFiles() {
  return fs
    .readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => e.name)
    .sort();
}
function filesWith(pattern) {
  return sourceFiles().filter((file) =>
    pattern.test(stripComments(read("src/" + file))),
  );
}

test("closed-panels close routes: the one tab delete and the one close action both record first, and no other way to close a panel exists", () => {
  const app = appText();
  assert.equal(count(app, "Actions.deleteTab("), 1, "one delete, in closeTab");
  assert.equal(count(app, "Actions.DELETE_TAB"), 1, "one intercepted close");
  assert.equal(count(app, "rememberClosed("), 2);
  assert.deepEqual(filesWith(/\.deleteTab\(/), ["App.tsx"]);
  assert.deepEqual(filesWith(/\bDELETE_TAB\b/), ["App.tsx"]);
  for (const route of [
    /deleteTabset/,
    /DELETE_TABSET/,
    /Actions\.group\(/,
    /Actions\.GROUP/,
    /onAuxMouseClick/,
    /[tT]abSetEnableClose/,
    /enableCloseButton/,
    /closeAll/,
  ])
    assert.deepEqual(
      filesWith(route),
      [],
      "a new way to close panels needs rememberClosed: " + route,
    );
  // The one tab menu opens from the Layout hook in App.tsx and closes only through closeTab.
  assert.deepEqual(filesWith(/onContextMenu=/), ["App.tsx"]);
  assert.equal(count(app, "onContextMenu="), 1);
  const layout = tight(stripComments(read("src/layout.ts")));
  assert.equal(count(layout, "enableClose: true"), 1, "only the welcome tab");
  for (const replace of [
    "const applyPreset = (preset: string) => {",
    "const openAll = () => {",
    "const travel = (direction:",
  ]) {
    const body = between(app, replace, "const ");
    assert.ok(!body.includes("rememberClosed"), replace);
  }
  // Closing a seat tab already ends only the local attach client; reopening
  // goes through openSeat, which never starts a seat.
  const sidebarSeat = between(
    app,
    "const openSeat = (seat: Seat) => {",
    "const openShell = () => {",
  );
  assert.ok(
    has(
      sidebarSeat,
      'addPanel("terminal", seat.name, { seat, terminalId: id }, id);',
    ),
  );
  const reopen = between(
    app,
    "const reopenClosedPanel = () => {",
    "const commands = [",
  );
  for (const forbidden of [
    "addPanel(",
    "openShell",
    "writeTerminal",
    "createTerminal",
    "closeTerminal",
    "sendTerminalCommand",
    "rigControl",
    "window.hrig",
    "sendMessage",
    "rigAction",
  ])
    assert.ok(
      !reopen.includes(forbidden),
      "reopen must not touch " + forbidden,
    );
  assert.equal(count(reopen, "openFile("), 1);
  assert.equal(count(reopen, "openSeat("), 1);
});

test("closed-panels chord and docs: the shortcut is claimed before the generic chords, acts only with no dialog open, and NAVIGATION.md says what is and is not reopened", () => {
  const app = appText();
  assert.ok(
    has(
      app,
      'import { hasOpenDialog, isHelpKey, isReopenPanelKey, reopenShortcutHint, } from "./shortcuts";',
    ),
  );
  assert.ok(
    app.includes(
      "Latest closed file or seat " +
        String.fromCharCode(183) +
        " ${reopenShortcutHint(window.hrig.platform)}",
    ),
    "the palette hint shows the platform chord",
  );
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  const help = handler.indexOf(tight("if (isHelpKey("));
  const reopen = handler.indexOf(
    tight("if (isReopenPanelKey(event, window.hrig.platform)) {"),
  );
  const generic = handler.indexOf(
    tight("if (event.ctrlKey || event.metaKey) {"),
  );
  assert.ok(help > 0 && reopen > help && generic > reopen, "claim order");
  assert.ok(
    has(
      handler,
      "if (isReopenPanelKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) reopenClosedPanel(); return; }",
    ),
    "claimed always, acts only with no dialog open",
  );
  assert.ok(
    has(
      handler,
      "if (event.defaultPrevented || event.isComposing || event.altKey) return;",
    ),
    "Alt and Option presses are still ignored first",
  );
  assert.ok(
    has(
      handler,
      '[",", "k", "o", "b", "p"].includes(event.key.toLowerCase()) || (event.shiftKey && event.key.toLowerCase() === "t")',
    ),
    "the existing claimed chords are unchanged",
  );
  assert.ok(
    has(
      handler,
      'if (event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); openShell(); }',
    ),
    "Ctrl+Shift+T is still New shell",
  );
  assert.equal(count(app, "reopenClosedPanel"), 4);
  assert.deepEqual(filesWith(/isReopenPanelKey\(/), [
    "App.tsx",
    "shortcuts.ts",
  ]);

  const doc = read("NAVIGATION.md")
    .split("\n")
    .filter((line) =>
      line.startsWith("The command center entry Reopen closed panel"),
    );
  assert.equal(doc.length, 1);
  for (const fragment of [
    "Ctrl+Shift+H (Cmd+Shift+H on macOS)",
    "file, diff or seat panel you closed most recently in the current workspace",
    "up to 10 closed panels",
    "in memory only",
    "forgotten when the app restarts",
    "never file contents, terminal output or commands",
    "keeps only the newest copy",
    "exactly as if you had chosen it in Quick Open or the sidebar",
    "deleted file shows the usual error",
    "edits you discarded when closing are not restored",
    "Open seat, which attaches to the seat's existing session",
    "never launches, relaunches or restarts an agent",
    "nothing is typed or sent",
    "Shells, rig-control terminals, settings and tool panels are not remembered",
    "Ctrl+Shift+T (Cmd+Shift+T) still opens a new shell",
    "a short message says why",
    "stays in the list",
    "Nothing to reopen",
    "ignored while a dialog is open",
    "does not repeat while held",
    "no longer reaches the shell",
  ])
    assert.ok(doc[0].includes(fragment), "NAVIGATION.md must say: " + fragment);
  assert.ok(
    read("NAVIGATION.md").startsWith(String.fromCharCode(0xfeff) + "# Project"),
  );
});
