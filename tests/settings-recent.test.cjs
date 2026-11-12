"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync, transformSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
function isAscii(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 126 || (c < 32 && c !== 10)) return false;
  }
  return true;
}

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
const lib = load("src/settings-recent.ts");
const settings = load("src/settings.ts");
const KEYS = settings.schema.map((row) => row.key);

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

const entry = (key, scope = "user", project = "") => ({ key, scope, project });
const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

// ---------------------------------------------------------------------------
// The real App.tsx provider block (the state, the helper and the settings
// context object), cut out of the source text, compiled with esbuild and run
// over a stand-in for the state and for the saving: so the real update, replace
// and reset methods note the real changes.
function providerFactory() {
  const app = read("src/App.tsx");
  const from = app.indexOf(
    "  // The settings changed since HRig started, newest first",
  );
  const to = app.indexOf("  const saveShortcutOverrides");
  assert.ok(from > 0 && to > from, "the provider block is in App.tsx");
  const block = app.slice(from, to);
  assert.equal(count(block, "const settingsContext = {"), 1);
  const wrapped =
    "(function (useState: any, changedKeys: any, noteChanges: any, recentFor: any, userPreferences: any, projectPreferences: any, projectId: any, preferences: any, changePreferences: any, validateOverrides: any) {\n" +
    block +
    "\nreturn settingsContext;\n})";
  const js = transformSync(wrapped, { loader: "ts" }).code;
  return new Function("return " + js)();
}
function makeApp({ projectId = "wsl::/work/app" } = {}) {
  const factory = providerFactory();
  const cell = { recent: [] };
  const maps = { user: {}, project: {} };
  const saves = [];
  const app = {
    cell,
    maps,
    saves,
    projectId,
    context: null,
    // One render of the App: the provider block runs again over the current state.
    render() {
      app.context = factory(
        (initial) => [
          cell.recent,
          (next) => {
            cell.recent = typeof next === "function" ? next(cell.recent) : next;
          },
        ],
        lib.changedKeys,
        lib.noteChanges,
        lib.recentFor,
        maps.user,
        maps.project,
        app.projectId,
        settings.resolveSettings(maps.user, maps.project),
        (scope, change) => {
          saves.push(scope);
          maps[scope] = change(maps[scope]);
        },
        settings.validateOverrides,
      );
      return app.context;
    },
  };
  app.render();
  return app;
}

// ---------------------------------------------------------------------------
// The real SettingsPage.tsx over a very small react (state slots per
// component, a render after every state change in the page, elements recorded
// as plain objects). The settings context is whatever the test hands in.
function pageHarness(getContext) {
  const rootFrame = { slots: [], cursor: 0, root: true };
  let frame = null;
  let tree = null;
  const react = {
    useState(initial) {
      const f = frame;
      const i = f.cursor++;
      if (!(i in f.slots))
        f.slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        f.slots[i],
        (value) => {
          f.slots[i] = typeof value === "function" ? value(f.slots[i]) : value;
          if (f.root) render();
        },
      ];
    },
    useEffect() {},
    useRef(initial) {
      const f = frame;
      const i = f.cursor++;
      if (!(i in f.slots)) f.slots[i] = { current: initial ?? null };
      return f.slots[i];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const icon = (name) => name;
  const Page = load("src/SettingsPage.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      Settings2: icon("Settings2"),
      Search: icon("Search"),
      RotateCcw: icon("RotateCcw"),
      Palette: icon("Palette"),
      Code2: icon("Code2"),
      TerminalSquare: icon("TerminalSquare"),
      LayoutGrid: icon("LayoutGrid"),
      Network: icon("Network"),
      Bell: icon("Bell"),
      Keyboard: icon("Keyboard"),
      Info: icon("Info"),
      FileJson: icon("FileJson"),
      Download: icon("Download"),
      Upload: icon("Upload"),
      Check: icon("Check"),
    },
    "./SettingsContext": { useSettings: () => getContext() },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
    "./UpdateSettings": () => null,
    "./MobileDevices": () => null,
  }).default;
  function resolve(node) {
    if (Array.isArray(node)) return node.map(resolve);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const saved = frame;
      frame = { slots: [], cursor: 0, root: false };
      try {
        return resolve(node.type(node.props));
      } finally {
        frame = saved;
      }
    }
    const props =
      node.props && "children" in node.props
        ? { ...node.props, children: resolve(node.props.children) }
        : node.props;
    return { type: node.type, props };
  }
  function render() {
    rootFrame.cursor = 0;
    frame = rootFrame;
    const out = Page({ project: "wsl / /work/app" });
    frame = null;
    tree = resolve(out);
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
    render,
    all: () => all(tree),
    text,
    rows: () =>
      all(tree)
        .filter((n) => n.props && n.props["data-setting"])
        .map((n) => n.props["data-setting"]),
    button: (match) => all(tree).find((n) => n.type === "button" && match(n)),
    chooseScope(name) {
      harness.button((n) => text(n) === name).props.onClick();
    },
    chooseCategory(name) {
      harness.button((n) => n.props["aria-label"] === name).props.onClick();
    },
    search(value) {
      all(tree)
        .find(
          (n) =>
            n.type === "input" && n.props["aria-label"] === "Search settings",
        )
        .props.onChange({ target: { value } });
    },
    box(label) {
      const holder = all(tree).find(
        (n) =>
          n.type === "label" &&
          n.props.className === "checkbox-label" &&
          text(n).trim() === label,
      );
      assert.ok(holder, "the " + label + " box is on the page");
      const input = all(holder).find((n) => n.type === "input");
      return { holder, input, title: holder.props.title };
    },
    fullText: () => text(tree),
    // The heading and the count of the section title (the title may hold more, such as a button).
    heading: () => {
      const title = all(tree).find(
        (n) =>
          n.type === "div" && n.props.className === "settings-section-title",
      );
      const [h3, count] = title.props.children;
      return text(h3) + text(count);
    },
    openJson() {
      harness.button((n) => text(n).includes("Settings JSON")).props.onClick();
    },
  };
  return harness;
}

test("settings-recent tracer: a change made through the real settings context shows up first under Recently changed on the real page, across categories, and nothing is saved or exported by the filter", () => {
  const app = makeApp();
  const page = pageHarness(() => app.context);
  const before = page.box("Recently changed");
  assert.equal(before.input.props.disabled, true, "nothing changed yet");
  assert.equal(before.input.props.checked, false);
  assert.equal(
    before.title,
    "Nothing has changed in the user scope since HRig started",
  );

  // Three real changes, one render of the App after each (the way React re-renders).
  app.context.update("user", "editor.fontSize", 15);
  app.render();
  app.context.update("user", "appearance.reduceMotion", true);
  app.render();
  app.context.update("user", "terminal.fontSize", 14);
  app.render();
  page.render();
  assert.deepEqual(app.cell.recent, [
    entry("terminal.fontSize"),
    entry("appearance.reduceMotion"),
    entry("editor.fontSize"),
  ]);
  const after = page.box("Recently changed");
  assert.equal(after.input.props.disabled, false);
  assert.equal(
    after.title,
    "Show the settings changed since HRig started, newest first",
  );

  // Off: the page lists the selected category as it always did.
  assert.equal(
    page.heading(),
    "Appearance" +
      settings.schema.filter((row) => row.category === "Appearance").length +
      " settings",
  );
  // On: the three rows, most recent first, from three categories; the heading says why.
  after.input.props.onChange({ target: { checked: true } });
  assert.deepEqual(page.rows(), [
    "terminal.fontSize",
    "appearance.reduceMotion",
    "editor.fontSize",
  ]);
  assert.equal(page.heading(), "Recently changed3 settings");
  assert.equal(page.box("Recently changed").input.props.checked, true);

  // The filter only filters: no settings were saved by turning it on, and the saved maps hold exactly the three values.
  assert.equal(app.saves.length, 3);
  assert.deepEqual(app.maps.user, {
    "editor.fontSize": 15,
    "appearance.reduceMotion": true,
    "terminal.fontSize": 14,
  });

  // Changing the same setting again moves it to the front; resetting one counts as a change too.
  app.context.update("user", "editor.fontSize", 16);
  app.render();
  app.context.reset("user", "terminal.fontSize");
  app.render();
  page.render();
  assert.deepEqual(page.rows(), [
    "terminal.fontSize",
    "editor.fontSize",
    "appearance.reduceMotion",
  ]);
});

test("settings-recent note: a change moves to the front once, the list is cut to 50, nothing is mutated and bad input is not noted", () => {
  const { noteChange, noteChanges, MAX_RECENT } = lib;
  assert.equal(MAX_RECENT, 50);
  let list = [];
  list = noteChange(list, "editor.fontSize", "user");
  list = noteChange(list, "editor.tabSize", "user");
  list = noteChange(list, "editor.fontSize", "user");
  assert.deepEqual(list, [entry("editor.fontSize"), entry("editor.tabSize")]);

  // Immutability: a frozen list, frozen entries and the same list noted twice.
  const frozen = deepFreeze([
    entry("editor.fontSize"),
    entry("editor.tabSize"),
  ]);
  const next = noteChange(frozen, "editor.tabSize", "user");
  assert.deepEqual(next, [entry("editor.tabSize"), entry("editor.fontSize")]);
  assert.deepEqual(frozen, [entry("editor.fontSize"), entry("editor.tabSize")]);
  assert.notEqual(next, frozen);
  assert.notEqual(
    noteChange(frozen, "nope", "user"),
    frozen,
    "always a new list",
  );

  // Unknown keys, unknown scopes and non-keys are not noted; the list stays as it was.
  for (const key of [
    "nope",
    "editor",
    "__proto__",
    "constructor",
    "toString",
    "",
    " editor.fontSize",
    "EDITOR.FONTSIZE",
    null,
    undefined,
    7,
    {},
    ["editor.fontSize"],
  ])
    assert.deepEqual(noteChange(list, key, "user"), list, String(key));
  for (const scope of ["", "User", "global", undefined, null, 1, {}])
    assert.deepEqual(noteChange(list, "editor.fontSize", scope), list);

  // The cap, whatever the number of settings: one user entry per setting, then project entries of many projects; the oldest drop first.
  let big = [];
  for (const key of KEYS) big = noteChange(big, key, "user");
  assert.equal(big.length, Math.min(KEYS.length, 50));
  assert.deepEqual(big[0], entry(KEYS[KEYS.length - 1]));
  for (let i = 0; i < 60; i++) {
    big = noteChange(big, "editor.fontSize", "project", "wsl::/p" + i);
    assert.ok(big.length <= 50, "never more than 50");
  }
  assert.equal(big.length, 50);
  assert.deepEqual(big[0], entry("editor.fontSize", "project", "wsl::/p59"));
  assert.deepEqual(
    big[49],
    entry("editor.fontSize", "project", "wsl::/p10"),
    "the oldest 10 project entries and every user entry were dropped",
  );
  assert.ok(big.every((e) => e.scope === "project"));
  // A list that arrives too long is cut too.
  const long = [];
  for (let i = 0; i < 200; i++)
    long.push(entry(KEYS[i % 49], "project", "p" + i));
  assert.equal(noteChange(long, "editor.fontSize", "user").length, 50);

  // A batch lists its keys in the order given, first key most recent; at most 50 keys are read.
  const batch = noteChanges(
    [entry("editor.tabSize")],
    ["editor.fontSize", "terminal.fontSize", "editor.tabSize"],
    "user",
  );
  assert.deepEqual(batch, [
    entry("editor.fontSize"),
    entry("terminal.fontSize"),
    entry("editor.tabSize"),
  ]);
  assert.deepEqual(noteChanges([], "editor.fontSize", "user"), []);
  assert.deepEqual(noteChanges("junk", ["editor.fontSize"], "user"), [
    entry("editor.fontSize"),
  ]);
  assert.deepEqual(noteChanges(batch, [], "user"), batch);
  const many = new Array(100000).fill("editor.fontSize");
  assert.deepEqual(noteChanges([], many, "user"), [entry("editor.fontSize")]);
  const sparse = new Array(10);
  sparse[3] = "editor.tabSize";
  assert.deepEqual(noteChanges([], sparse, "user"), [entry("editor.tabSize")]);
});

test("settings-recent rows: the rows of one scope come back most recent first, once each, only from the rows given and only for known keys", () => {
  const { recentRows, noteChange } = lib;
  const schema = settings.schema;
  let list = [];
  for (const [key, scope] of [
    ["editor.fontSize", "user"],
    ["editor.tabSize", "project"],
    ["terminal.fontSize", "user"],
    ["appearance.reduceMotion", "user"],
  ])
    list = noteChange(list, key, scope, scope === "project" ? "p1" : "");
  const keysOf = (rows) => rows.map((row) => row.key);
  assert.deepEqual(keysOf(recentRows(schema, list, "user")), [
    "appearance.reduceMotion",
    "terminal.fontSize",
    "editor.fontSize",
  ]);
  assert.deepEqual(keysOf(recentRows(schema, list, "project")), [
    "editor.tabSize",
  ]);
  // The very row objects of the rows given.
  assert.equal(
    recentRows(schema, list, "user")[0],
    schema.find((row) => row.key === "appearance.reduceMotion"),
  );
  // A part of the schema: only its rows, in recency order.
  const editorOnly = schema.filter((row) => row.category === "Editor");
  assert.deepEqual(keysOf(recentRows(editorOnly, list, "user")), [
    "editor.fontSize",
  ]);
  // Unknown keys and junk entries in the list are skipped, not thrown on.
  const messy = [
    null,
    7,
    "editor.fontSize",
    { key: "nope", scope: "user", project: "" },
    { key: "editor.fontSize", scope: "elsewhere", project: "" },
    { scope: "user" },
    Object.create({ key: "editor.fontSize", scope: "user", project: "" }),
    ...list,
  ];
  assert.deepEqual(keysOf(recentRows(schema, messy, "user")), [
    "appearance.reduceMotion",
    "terminal.fontSize",
    "editor.fontSize",
  ]);
  for (const bad of [undefined, null, "junk", 5, {}, { length: 3 }])
    assert.deepEqual(recentRows(schema, bad, "user"), []);
  for (const rows of [undefined, null, "rows", 3, {}])
    assert.deepEqual(recentRows(rows, list, "user"), []);
  assert.deepEqual(recentRows([], list, "user"), []);
  assert.deepEqual(
    keysOf(recentRows([null, undefined, 3, {}], list, "user")),
    [],
  );
  // The same key noted in two projects is listed once for the project scope.
  const twice = [
    entry("editor.tabSize", "project", "p2"),
    entry("editor.tabSize", "project", "p1"),
  ];
  assert.deepEqual(keysOf(recentRows(schema, twice, "project")), [
    "editor.tabSize",
  ]);
  // The list given is not changed.
  const frozen = deepFreeze(list.map((e) => ({ ...e })));
  recentRows(schema, frozen, "user");
  assert.deepEqual(frozen, list);
});

test("settings-recent changed: the keys whose own value differs between two maps, in settings page order, with only own and defined values counting", () => {
  const { changedKeys } = lib;
  assert.deepEqual(changedKeys({}, {}), []);
  assert.deepEqual(
    changedKeys({ "editor.fontSize": 14 }, { "editor.fontSize": 14 }),
    [],
  );
  assert.deepEqual(
    changedKeys({ "editor.fontSize": 14 }, { "editor.fontSize": 15 }),
    ["editor.fontSize"],
  );
  assert.deepEqual(
    changedKeys({}, { "editor.fontSize": 13 }),
    ["editor.fontSize"],
    "an override equal to the default is still a new override",
  );
  assert.deepEqual(changedKeys({ "editor.fontSize": 13 }, {}), [
    "editor.fontSize",
  ]);
  assert.deepEqual(
    changedKeys({ "editor.fontSize": 14 }, { "editor.fontSize": undefined }),
    ["editor.fontSize"],
    "undefined counts as removed",
  );
  assert.deepEqual(changedKeys({}, { "editor.fontSize": undefined }), []);
  // Order is the schema's, whatever the order of the keys in the maps.
  const before = {
    "terminal.fontSize": 12,
    "editor.fontSize": 12,
    "rig.defaultTeamSize": 3,
  };
  const after = {
    "rig.defaultTeamSize": 4,
    "editor.fontSize": 13,
    "terminal.fontSize": 13,
  };
  assert.deepEqual(
    changedKeys(before, after),
    KEYS.filter((key) => key in before),
  );
  // Values that are not equal but alike: NaN is the same as NaN, zero is not minus zero.
  assert.deepEqual(
    changedKeys({ "terminal.lineHeight": NaN }, { "terminal.lineHeight": NaN }),
    [],
  );
  assert.deepEqual(
    changedKeys({ "terminal.lineHeight": 0 }, { "terminal.lineHeight": -0 }),
    ["terminal.lineHeight"],
  );
  // Inherited fields and keys the schema does not know are not seen; hostile inputs give no keys.
  const inherited = Object.create({ "editor.fontSize": 20 });
  assert.deepEqual(changedKeys(inherited, {}), []);
  assert.deepEqual(changedKeys({}, inherited), []);
  assert.deepEqual(changedKeys({ nope: 1 }, { nope: 2 }), []);
  for (const bad of [undefined, null, 5, "text", true, [], () => 1])
    assert.deepEqual(changedKeys(bad, bad), []);
  assert.deepEqual(changedKeys(null, { "editor.fontSize": 14 }), [
    "editor.fontSize",
  ]);
  assert.deepEqual(changedKeys({ "editor.fontSize": 14 }, "junk"), [
    "editor.fontSize",
  ]);
  // Nothing is changed.
  const frozen = deepFreeze({ "editor.fontSize": 14 });
  changedKeys(frozen, deepFreeze({}));
  assert.deepEqual(frozen, { "editor.fontSize": 14 });
});

test("settings-recent scope: user and project changes are separate, a project's changes belong to that project, and the list handed to the page is the one for the open project", () => {
  const { noteChange, recentFor, recentRows } = lib;
  const schema = settings.schema;
  let list = [];
  list = noteChange(list, "editor.fontSize", "user", "ignored for user");
  list = noteChange(list, "editor.fontSize", "project", "wsl::/a");
  list = noteChange(list, "editor.tabSize", "project", "wsl::/b");
  list = noteChange(list, "terminal.fontSize", "user");
  assert.deepEqual(list, [
    entry("terminal.fontSize"),
    entry("editor.tabSize", "project", "wsl::/b"),
    entry("editor.fontSize", "project", "wsl::/a"),
    entry("editor.fontSize"),
  ]);
  assert.deepEqual(recentFor(list, "wsl::/a"), [
    entry("terminal.fontSize"),
    entry("editor.fontSize", "project", "wsl::/a"),
    entry("editor.fontSize"),
  ]);
  assert.deepEqual(recentFor(list, "wsl::/b"), [
    entry("terminal.fontSize"),
    entry("editor.tabSize", "project", "wsl::/b"),
    entry("editor.fontSize"),
  ]);
  assert.deepEqual(recentFor(list, "wsl::/none"), [
    entry("terminal.fontSize"),
    entry("editor.fontSize"),
  ]);
  assert.deepEqual(recentFor(list, undefined), recentFor(list, ""));
  assert.deepEqual(recentFor("junk", "wsl::/a"), []);
  const keysOf = (rows) => rows.map((row) => row.key);
  assert.deepEqual(
    keysOf(recentRows(schema, recentFor(list, "wsl::/a"), "project")),
    ["editor.fontSize"],
  );
  assert.deepEqual(
    keysOf(recentRows(schema, recentFor(list, "wsl::/b"), "project")),
    ["editor.tabSize"],
  );
  assert.deepEqual(
    keysOf(recentRows(schema, recentFor(list, "wsl::/b"), "user")),
    ["terminal.fontSize", "editor.fontSize"],
  );

  // The real provider: the project id the App has when the change is made is the project it is noted for.
  const app = makeApp({ projectId: "wsl::/a" });
  app.context.update("project", "editor.fontSize", 18);
  app.render();
  app.context.update("user", "terminal.fontSize", 14);
  app.render();
  assert.deepEqual(app.context.recent, [
    entry("terminal.fontSize"),
    entry("editor.fontSize", "project", "wsl::/a"),
  ]);
  app.projectId = "wsl::/b";
  app.render();
  assert.deepEqual(
    app.context.recent,
    [entry("terminal.fontSize")],
    "another project does not see the first project's change",
  );
  app.projectId = "wsl::/a";
  app.render();
  assert.equal(
    app.context.recent.length,
    2,
    "and it is back when that project is open again",
  );
});

test("settings-recent model: random sequences of changes keep the list equal to a plain model, within 50, without repeats and in known keys only", () => {
  const rnd = seeded(20260511);
  const scopes = ["user", "project"];
  const projects = ["wsl::/a", "wsl::/b", "local::/c"];
  let sequences = 0;
  for (let n = 0; n < 150; n++) {
    let list = [];
    let model = [];
    const steps = 1 + Math.floor(rnd() * 120);
    for (let i = 0; i < steps; i++) {
      const key =
        rnd() < 0.08 ? "nope-" + i : KEYS[Math.floor(rnd() * KEYS.length)];
      const scope = scopes[Math.floor(rnd() * 2)];
      const project =
        scope === "project" ? projects[Math.floor(rnd() * 3)] : "";
      list = lib.noteChange(list, key, scope, project);
      if (KEYS.includes(key)) {
        model = [
          { key, scope, project },
          ...model.filter(
            (e) =>
              !(e.key === key && e.scope === scope && e.project === project),
          ),
        ].slice(0, 50);
      }
      assert.deepEqual(list, model);
    }
    assert.ok(list.length <= 50);
    const seen = new Set(
      list.map((e) => e.key + "|" + e.scope + "|" + e.project),
    );
    assert.equal(seen.size, list.length, "no repeats");
    const filtered = lib.recentFor(list, projects[n % 3]);
    for (const e of filtered)
      assert.ok(e.scope === "user" || e.project === projects[n % 3]);
    sequences++;
  }
  assert.equal(sequences, 150);
});

test("settings-recent page: the real page shows the Recently changed box beside Modified only, lists the recent rows in order, combines with search and Modified only, follows the scope, and is left by choosing a category or Settings JSON", () => {
  const user = {
    "editor.fontSize": 15,
    "appearance.reduceMotion": true,
    "terminal.fontSize": 14,
  };
  const recent = [
    entry("terminal.fontSize"),
    entry("editor.fontSize", "project", "p"),
    entry("appearance.reduceMotion"),
    entry("editor.fontSize"),
  ];
  const context = {
    effective: settings.resolveSettings(user, { "editor.fontSize": 18 }),
    user,
    project: { "editor.fontSize": 18 },
    recent,
    update() {},
    replace() {},
    reset() {},
  };
  const page = pageHarness(() => context);
  const boxes = page
    .all()
    .filter((n) => n.type === "label" && n.props.className === "checkbox-label")
    .map((n) => page.text(n).trim());
  assert.deepEqual(
    boxes,
    ["Modified only", "Recently changed"],
    "beside Modified only, after it",
  );
  assert.equal(page.box("Recently changed").input.props.type, "checkbox");

  const on = () =>
    page
      .box("Recently changed")
      .input.props.onChange({ target: { checked: true } });
  on();
  assert.deepEqual(page.rows(), [
    "terminal.fontSize",
    "appearance.reduceMotion",
    "editor.fontSize",
  ]);
  assert.equal(page.heading(), "Recently changed3 settings");
  // Appearance is the selected category, yet its theme picker is not drawn in this view.
  assert.equal(
    page.all().some((n) => n.props && n.props.className === "theme-collection"),
    false,
  );
  // Search narrows it and says Search results; the order stays the recent one.
  page.search("font");
  assert.deepEqual(page.rows(), ["terminal.fontSize", "editor.fontSize"]);
  assert.equal(page.heading(), "Search results2 settings");
  page.search("zzzz");
  assert.deepEqual(page.rows(), []);
  assert.ok(
    page
      .fullText()
      .includes(
        "Try a different keyword or turn off Modified only or Recently changed.",
      ),
  );
  page.search("");
  // Modified only narrows it to the settings the scope still overrides (all three here).
  page.box("Modified only").input.props.onChange({ target: { checked: true } });
  assert.deepEqual(page.rows().length, 3);
  page
    .box("Modified only")
    .input.props.onChange({ target: { checked: false } });
  // The project scope has its own list and its own order.
  page.chooseScope("Project");
  assert.deepEqual(page.rows(), ["editor.fontSize"]);
  assert.equal(page.box("Recently changed").input.props.checked, true);
  // Nothing recent in a scope: an empty list, the box stays usable so it can be turned off.
  context.recent = [entry("editor.fontSize")];
  page.render();
  assert.deepEqual(page.rows(), []);
  assert.equal(page.box("Recently changed").input.props.disabled, false);
  page
    .box("Recently changed")
    .input.props.onChange({ target: { checked: false } });
  assert.equal(page.box("Recently changed").input.props.disabled, true);
  assert.equal(
    page.box("Recently changed").title,
    "Nothing has changed in the project scope since HRig started",
  );
  context.recent = recent;
  page.render();
  page.chooseScope("User");
  // Choosing a category leaves the view.
  on();
  assert.equal(page.heading(), "Recently changed3 settings");
  page.chooseCategory("Terminal");
  assert.equal(page.box("Recently changed").input.props.checked, false);
  assert.equal(page.heading().startsWith("Terminal"), true);
  // Settings JSON is reachable with the box on, and leaves the view too.
  on();
  page.openJson();
  assert.equal(page.box("Recently changed").input.props.checked, false);
  assert.equal(
    page
      .all()
      .some(
        (n) => n.type === "section" && n.props.className === "settings-json",
      ),
    true,
  );
  // Update and Mobile devices categories do not hide the list while it is on.
  page.chooseCategory("Updates");
  on();
  assert.equal(page.heading(), "Recently changed3 settings");

  // A context with no recent list at all (an older provider, a test double) works as before.
  const bare = pageHarness(() => ({ ...context, recent: undefined }));
  assert.equal(bare.box("Recently changed").input.props.disabled, true);
  assert.equal(bare.rows().length > 0, true);
});

test("settings-recent provider: the real App update, replace and reset note exactly the settings whose own value changed, once each, and an unchanged write notes nothing", () => {
  const app = makeApp();
  const ctx = () => app.context;
  const settle = () => app.render();
  // A new value: noted. The same value again: nothing to note.
  ctx().update("user", "editor.fontSize", 15);
  settle();
  ctx().update("user", "editor.fontSize", 15);
  settle();
  assert.deepEqual(app.cell.recent, [entry("editor.fontSize")]);
  // Setting the default value as a first override is a change (the row becomes Modified).
  ctx().update("user", "editor.tabSize", settings.defaults["editor.tabSize"]);
  settle();
  assert.deepEqual(
    app.cell.recent.map((e) => e.key),
    ["editor.tabSize", "editor.fontSize"],
  );
  // Resetting a row that is not modified notes nothing; resetting a modified one does.
  ctx().reset("user", "terminal.fontSize");
  settle();
  assert.equal(app.cell.recent.length, 2);
  ctx().reset("user", "editor.fontSize");
  settle();
  assert.deepEqual(
    app.cell.recent.map((e) => e.key),
    ["editor.fontSize", "editor.tabSize"],
  );
  assert.deepEqual(app.maps.user, { "editor.tabSize": 2 });
  // Resetting the whole scope notes every key that was modified, in settings order; the other scope is untouched.
  ctx().update("user", "terminal.fontSize", 14);
  settle();
  ctx().update("user", "appearance.reduceMotion", true);
  settle();
  ctx().update("project", "rig.defaultTeamSize", 4);
  settle();
  ctx().reset("user");
  settle();
  assert.deepEqual(app.maps.user, {});
  assert.deepEqual(
    app.cell.recent
      .filter((e) => e.scope === "user")
      .slice(0, 3)
      .map((e) => e.key),
    KEYS.filter((k) =>
      [
        "appearance.reduceMotion",
        "editor.tabSize",
        "terminal.fontSize",
      ].includes(k),
    ),
  );
  assert.deepEqual(app.maps.project, { "rig.defaultTeamSize": 4 });
  // replace (Apply JSON): the keys added, changed or dropped are noted, the ones carried over are not.
  ctx().replace("user", { "editor.fontSize": 20, "terminal.fontSize": 12 });
  settle();
  const savesBefore = app.saves.length;
  ctx().replace("user", { "editor.fontSize": 20, "editor.wordWrap": "off" });
  settle();
  assert.equal(app.saves.length, savesBefore + 1, "replace still saves once");
  assert.deepEqual(
    app.cell.recent.slice(0, 2).map((e) => e.key),
    KEYS.filter((k) => ["editor.wordWrap", "terminal.fontSize"].includes(k)),
  );
  assert.ok(app.cell.recent.slice(0, 2).every((e) => e.scope === "user"));
  // The settings written are exactly what they were: noting adds nothing to the saved maps.
  assert.deepEqual(app.maps.user, {
    "editor.fontSize": 20,
    "editor.wordWrap": "off",
  });
  // Several resets in one click handler (every closure is the one of the last render) note each key.
  ctx().replace("user", {
    "editor.fontSize": 21,
    "editor.tabSize": 4,
    "editor.wordWrap": "off",
  });
  settle();
  const handler = app.context;
  for (const key of ["editor.fontSize", "editor.tabSize", "editor.wordWrap"])
    handler.reset("user", key);
  settle();
  assert.deepEqual(app.maps.user, {});
  assert.deepEqual(
    app.cell.recent.slice(0, 3).map((e) => e.key),
    ["editor.wordWrap", "editor.tabSize", "editor.fontSize"],
  );
});

test("settings-recent wiring: the module is pure and reads only the settings module, it is kept in memory in the App and handed through the context, nothing about it is saved, exported or sent, and the page changes only its filter", () => {
  const source = read("src/settings-recent.ts");
  const code = stripComments(source);
  assert.equal(isAscii(source), true, "the module is ASCII");
  assert.deepEqual(
    [...code.matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]),
    ["./settings"],
  );
  assert.equal(count(code, "export default"), 0);
  for (const word of [
    "document.",
    "window.",
    "globalThis",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "navigator",
    "process.",
    "require(",
    "fetch(",
    "XMLHttpRequest",
    "setTimeout",
    "setInterval",
    "eval(",
    "new Function",
    "Math.random",
    "Date",
    "performance.",
    "rigAction",
    "sendMessage",
    "validateOverrides",
    "safeOverrides",
    "resolveSettings",
    "JSON.",
  ])
    assert.equal(count(code, word), 0, "the module has no " + word);
  const exported = [
    ...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm),
  ].map((m) => m[1]);
  assert.deepEqual(exported, [
    "RecentChange",
    "MAX_RECENT",
    "noteChange",
    "noteChanges",
    "changedKeys",
    "recentFor",
    "recentRows",
  ]);
  const rows = source.split("\n");
  rows.forEach((line, i) => {
    if (/^export /.test(line))
      assert.ok(/\*\/\s*$/.test(rows[i - 1]), "doc comment above: " + line);
  });
  assert.ok(source.includes("export const MAX_RECENT = 50;"));

  // The context: one more member, a list, with an empty default.
  const ctxFile = collapse(read("src/SettingsContext.tsx"));
  assert.equal(
    count(ctxFile, 'import type { RecentChange } from "./settings-recent";'),
    1,
  );
  assert.equal(count(ctxFile, "recent: RecentChange[];"), 1);
  assert.equal(count(ctxFile, "recent: [],"), 1);
  assert.equal(count(ctxFile, "update: () => {},"), 1);

  // The App: the list lives in a state slot declared once, is noted from the three writers and from nowhere else, and is never saved.
  const app = collapse(read("src/App.tsx"));
  assert.equal(count(app, 'from "./settings-recent";'), 1);
  assert.equal(
    count(
      app,
      "const [recentChanges, setRecentChanges] = useState<RecentChange[]>([]);",
    ),
    1,
  );
  assert.equal(count(app, "setRecentChanges("), 1);
  assert.equal(count(app, "noteRecent("), 3, "the three writers call it");
  assert.equal(
    count(app, "noteRecent(scope, { ...ownSettings(scope), [key]: value });"),
    1,
  );
  assert.equal(count(app, "noteRecent(scope, value);"), 1);
  assert.equal(count(app, "recent: recentFor(recentChanges, projectId),"), 1);
  assert.equal(
    count(
      app,
      "noteRecent( scope, key ? { ...ownSettings(scope), [key]: undefined } : {}, );",
    ),
    1,
  );
  assert.equal(
    count(app, "recentChanges"),
    2,
    "the declaration and the one read",
  );
  for (const part of [
    "const changePreferences = (",
    "validateOverrides({ [key]: value }),",
    "changePreferences(scope, () => validateOverrides(value));",
    "if (key) delete next[key]; else return {};",
  ])
    assert.ok(app.includes(part), "App still has: " + part);
  assert.equal(count(app, "window.hrig.saveState(state)"), 1);
  const types = read("src/types.ts");
  assert.ok(
    !/recentChanges|RecentChange|settings-recent/.test(types),
    "not part of the workspace state type",
  );
  assert.ok(!/recentChanges|settings-recent/.test(read("src/settings.ts")));
  for (const dir of ["electron", "mobile"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base))
      if (fs.statSync(path.join(base, name)).isFile())
        assert.ok(
          !/settings-recent|recentChanges|RecentChange/.test(
            fs.readFileSync(path.join(base, name), "utf8"),
          ),
          dir + "/" + name,
        );
  }

  // SettingsPage.tsx: the additions, each once; the saving and scope code counted as it was.
  const page = collapse(read("src/SettingsPage.tsx"));
  assert.equal(
    count(page, 'import { recentRows } from "./settings-recent";'),
    1,
  );
  assert.equal(count(page, 'from "./settings-recent"'), 1);
  assert.equal(count(page, "recentRows("), 1);
  assert.equal(
    count(page, "const recent = recentRows(schema, context.recent, scope);"),
    1,
  );
  assert.equal(
    count(page, "[recentOnly, setRecentOnly] = useState(false),"),
    1,
  );
  assert.equal(
    count(page, "setRecentOnly(false);"),
    2,
    "choosing a category and opening the JSON leave the view",
  );
  assert.equal(count(page, "const listing = !!query || recentOnly;"), 1);
  assert.equal(
    count(
      page,
      "const matches = recentOnly ? recent.filter((row) => found.includes(row)) : found;",
    ),
    1,
  );
  assert.equal(count(page, ": recentOnly || row.category === category) &&"), 1);
  assert.equal(count(page, "disabled={!recent.length && !recentOnly}"), 1);
  assert.equal(
    count(page, "onChange={(e) => setRecentOnly(e.target.checked)}"),
    1,
  );
  assert.equal(
    count(page.replace("!!query", ""), "!query"),
    0,
    "every browse-or-search gate now reads listing",
  );
  for (const gate of [
    'className={category === name && !listing ? "selected" : ""}',
    'aria-current={category === name && !listing ? "page" : undefined}',
    "category==='Updates' && !listing ? <UpdateSettings />",
    'category === "Mobile devices" && !listing ? <MobileDevices />',
    '{!listing && category === "Appearance" && !modifiedOnly && (',
  ])
    assert.equal(count(page, gate), 1, gate);
  for (const part of [
    "const modified = Object.hasOwn(own, row.key);",
    'title={ scope === "project" ? "Remove project override" : "Reset to default" }',
    "disabled={!modified}",
    "onClick={() => context.reset(scope, row.key)}",
    "validateOverrides({ [row.key]: next });",
    "context.update(scope, row.key, next);",
    "context.reset(scope);",
    "context.replace(scope, report.valid);", // the import check (X09) decides what is applied
    "settings: own",
    'a.download = "hrig-" + scope + "-settings.json";',
  ])
    assert.ok(page.includes(part), "SettingsPage still has: " + part);
  assert.equal(count(page, "context.update("), 2);
  assert.equal(count(page, "context.replace("), 1);
  assert.equal(count(page, "useSettings()"), 2);
  assert.equal(count(page, "setScope("), 2);
  // The added JSX writes no address, style or raw-markup property and no handler but the box's own.
  const at = page.indexOf("title={ recent.length || recentOnly");
  assert.ok(at > 0, "the box is in the toolbar");
  const added = page.slice(
    at,
    page.indexOf("Recently changed </label>", at) + 30,
  );
  for (const word of [
    "href",
    "style=",
    "dangerously",
    "innerHTML",
    "ref=",
    "onClick",
    "onKeyDown",
  ])
    assert.equal(count(added, word), 0, "the added JSX has no " + word);
  assert.equal(count(added, "onChange"), 1);
  // Only existing styles are used and none is added.
  const css = read("src/styles.css");
  assert.ok(css.includes(".checkbox-label {"));
  assert.ok(css.includes(".settings-toolbar .checkbox-label {"));
  assert.equal(count(css, "recent"), 0, "no new stylesheet rule");

  // Nothing but the App and the page imports the module.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => read("src/" + name).includes("settings-recent"))
    .sort();
  assert.deepEqual(users, [
    "App.tsx",
    "SettingsContext.tsx",
    "SettingsPage.tsx",
  ]);
});

test("settings-recent docs: SETTINGS.md has one Recently changed paragraph with every claim, next to the scope text, and the Transfer and discoverability row names the filter", () => {
  const doc = read("SETTINGS.md");
  assert.equal(isAscii(doc), true, "SETTINGS.md is ASCII");
  const paragraphs = doc
    .split("\n\n")
    .filter((p) => p.startsWith("Recently changed:"));
  assert.equal(paragraphs.length, 1, "one Recently changed paragraph");
  const p = collapse(paragraphs[0]);
  for (const claim of [
    "beside Modified only",
    "since HRig started, newest first",
    "across every category",
    "replaces the category order",
    "a search or Modified only narrows it as usual",
    "setting, resetting or applying JSON",
    "a setting changed more than once is listed once, at its latest change",
    "setting a row to the value it already had is not a change",
    "kept in memory only",
    "not saved, not exported in the Settings JSON, and empty again after a restart",
    "HRig stores no change times",
    "The User and Project scopes have their own lists",
    "the Project list belongs to the project you have open",
    "greyed out with a tooltip while nothing has changed in the scope you are looking at",
    "It only filters the page: nothing is saved, changed or sent by it",
    "choosing a category or Settings JSON leaves it",
  ])
    assert.ok(p.includes(claim), "SETTINGS.md must say: " + claim);
  const at = doc.indexOf("Recently changed:");
  assert.ok(at > doc.indexOf("Project override indicator:"));
  assert.ok(at < doc.indexOf("## Settings catalog"), "in the scope section");
  assert.equal(count(doc, "Recently changed:"), 1);
  const row = doc
    .split("\n")
    .filter((line) => line.startsWith("| Transfer and discoverability |"));
  assert.equal(row.length, 1, "one Transfer and discoverability row");
  assert.ok(row[0].includes("a Recently changed filter"));
  assert.equal(
    lib.MAX_RECENT,
    50,
    "the code's cap; the paragraph does not state it",
  );
});
