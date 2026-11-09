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
const lib = load("src/settings-overrides.ts");
const settings = load("src/settings.ts");

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

const row = (key) => settings.schema.find((r) => r.key === key);

// ---------------------------------------------------------------------------
// The real SettingsPage.tsx (and its real Row) over a very small react: state
// slots per component, a render after every state change in the page,
// elements recorded as plain objects. The settings context is a fake that
// records every call it gets.

function pageHarness({
  user = {},
  project = {},
  projectPath = "wsl::/work/app",
} = {}) {
  const calls = { update: [], replace: [], reset: [] };
  const context = {
    effective: settings.resolveSettings(user, project),
    user,
    project,
    update: (...args) => calls.update.push(args),
    replace: (...args) => calls.replace.push(args),
    reset: (...args) => calls.reset.push(args),
  };
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
    "./SettingsContext": { useSettings: () => context },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
    "./UpdateSettings": () => null,
    "./MobileDevices": () => null,
  }).default;
  // Function elements (the page's Row) are run with a fresh frame each.
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
    const out = Page({ project: projectPath });
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
  const shape = (node) =>
    JSON.stringify(node, (k, v) => (typeof v === "function" ? "fn" : v));
  const harness = {
    calls,
    all: () => all(tree),
    text,
    shape,
    rows: () => all(tree).filter((n) => n.props && n.props["data-setting"]),
    row(key) {
      const found = harness.rows().find((n) => n.props["data-setting"] === key);
      assert.ok(found, "row " + key + " is on the page");
      const parts = all(found);
      const badges = parts.filter(
        (n) => n.props && n.props.className === "setting-badge",
      );
      const reset = parts.find(
        (n) => n.type === "button" && n.props.className === "setting-reset",
      );
      return {
        node: found,
        className: found.props.className,
        badges: badges.map((n) => text(n)),
        badgeNodes: badges,
        reset,
        shape: shape(found),
      };
    },
    summary: () =>
      all(tree).find(
        (n) =>
          n.type === "p" &&
          n.props.className === "settings-scope-note" &&
          "data-overrides" in n.props,
      ),
    scopeNote: () =>
      all(tree).filter(
        (n) => n.type === "p" && n.props.className === "settings-scope-note",
      ),
    overrideBadges: () =>
      all(tree).filter((n) => n.props && "data-override" in n.props),
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
    selectedScope: () =>
      all(
        all(tree).find(
          (n) => n.type === "div" && n.props["aria-label"] === "Settings scope",
        ),
      )
        .filter((n) => n.type === "button" && n.props["aria-pressed"] === true)
        .map((n) => text(n)),
  };
  return harness;
}

const USER = { "editor.fontSize": 14, "appearance.reduceMotion": true };
const PROJECT = {
  "editor.fontSize": 18,
  "editor.wordWrap": "off",
  "editor.tabSize": 2,
  "appearance.reduceMotion": true,
  "rig.defaultTeamSize": 4,
};
const SUMMARY_TEXT =
  "This project overrides 5 settings; 3 differ from your user values.";
const SUMMARY_TITLE =
  "Overridden here: appearance.reduceMotion, editor.fontSize, editor.tabSize, editor.wordWrap, rig.defaultTeamSize.";

test("settings-overrides page: the real settings page tells a user scope row that the open project overrides it, counts the overrides, keeps the project scope badge and Remove project override exactly as they were, and saves nothing", () => {
  // The fixture is real data: it passes the real validation.
  assert.deepEqual(settings.validateOverrides(USER), USER);
  assert.deepEqual(settings.validateOverrides(PROJECT), PROJECT);

  const page = pageHarness({ user: USER, project: PROJECT });
  const bare = pageHarness({ user: USER, project: {} });
  assert.deepEqual(page.selectedScope(), ["User"]);

  // The summary: one paragraph in the existing note style, text and tooltip.
  const summary = page.summary();
  assert.ok(summary, "the summary paragraph is drawn");
  assert.deepEqual(Object.keys(summary.props).sort(), [
    "children",
    "className",
    "data-overrides",
    "title",
  ]);
  assert.equal(page.text(summary), SUMMARY_TEXT);
  assert.equal(summary.props["data-overrides"], 5);
  assert.equal(summary.props.title, SUMMARY_TITLE);
  assert.equal(
    page.scopeNote().length,
    2,
    "the old scope note and the new line",
  );
  assert.equal(
    bare.scopeNote().length,
    1,
    "nothing overridden: only the old note",
  );
  assert.equal(bare.summary(), undefined);
  assert.equal(page.scopeNote()[0].props.className, "settings-scope-note");
  assert.equal(
    page.text(page.scopeNote()[0]),
    "User settings are saved on this computer. Project overrides take precedence.",
    "the old note is unchanged",
  );

  // User scope, Editor: a differing value, a project-only value, a same value.
  page.chooseCategory("Editor");
  bare.chooseCategory("Editor");
  const size = page.row("editor.fontSize");
  assert.deepEqual(size.badges, ["Modified", "Overridden in this project: 18"]);
  assert.equal(size.className, "setting-row modified");
  assert.deepEqual(Object.keys(size.badgeNodes[1].props).sort(), [
    "children",
    "className",
    "data-override",
    "title",
  ]);
  assert.equal(size.badgeNodes[1].props["data-override"], "overridden");
  assert.equal(
    size.badgeNodes[1].props.title,
    "This project uses 18; your user setting is 14. Open the Project scope to change it or remove the override.",
  );
  assert.equal(size.badgeNodes[0].props["data-override"], undefined);
  const wrap = page.row("editor.wordWrap");
  assert.deepEqual(wrap.badges, ["Overridden in this project: off"]);
  assert.equal(
    wrap.className,
    "setting-row ",
    "the user scope row is not Modified",
  );
  const tab = page.row("editor.tabSize");
  assert.deepEqual(tab.badges, ["Also set in this project (same value)"]);
  assert.equal(tab.badgeNodes[0].props["data-override"], "same");
  assert.equal(
    tab.badgeNodes[0].props.title,
    "This project sets the same value as your user setting (2) and keeps it if you change your user setting. Open the Project scope to remove the override.",
  );
  // A row the project does not set is drawn exactly as without any project.
  for (const key of [
    "editor.minimap",
    "editor.insertSpaces",
    "editor.fontFamily",
  ]) {
    assert.deepEqual(page.row(key).badges, []);
    assert.equal(page.row(key).shape, bare.row(key).shape, key);
  }
  // The same rows with no project overrides carry no note at all.
  assert.deepEqual(bare.row("editor.fontSize").badges, ["Modified"]);
  assert.deepEqual(bare.row("editor.wordWrap").badges, []);

  // Other categories: a switch both scopes set alike, a choice with labels.
  page.chooseCategory("Appearance");
  assert.deepEqual(page.row("appearance.reduceMotion").badges, [
    "Modified",
    "Also set in this project (same value)",
  ]);
  page.chooseCategory("Connections & rigs");
  assert.deepEqual(page.row("rig.defaultTeamSize").badges, [
    "Overridden in this project: Team",
  ]);
  assert.deepEqual(page.row("rig.defaultRuntime").badges, []);

  // Search results use the same rows, so the note follows them.
  page.search("font");
  assert.deepEqual(page.row("editor.fontSize").badges, [
    "Modified",
    "Overridden in this project: 18",
  ]);
  assert.deepEqual(page.row("terminal.fontSize").badges, []);
  page.search("");

  // Project scope: the existing badge and reset button, pinned as they were,
  // and no override note (the rows of this scope already are the overrides).
  page.chooseScope("Project");
  assert.deepEqual(page.selectedScope(), ["Project"]);
  assert.deepEqual(page.overrideBadges(), [], "no note in the project scope");
  assert.equal(
    page.text(page.summary()),
    SUMMARY_TEXT,
    "the count shows in both scopes",
  );
  page.chooseCategory("Editor");
  const own = page.row("editor.fontSize");
  assert.equal(own.className, "setting-row modified");
  assert.deepEqual(own.badges, ["Project override"]);
  assert.equal(own.reset.props.title, "Remove project override");
  assert.equal(own.reset.props.disabled, false);
  assert.equal(own.reset.props["aria-label"], "Reset Editor font size");
  const free = page.row("editor.minimap");
  assert.equal(free.className, "setting-row ");
  assert.deepEqual(free.badges, []);
  assert.equal(free.reset.props.title, "Remove project override");
  assert.equal(free.reset.props.disabled, true);
  assert.deepEqual(page.row("editor.wordWrap").badges, ["Project override"]);
  assert.deepEqual(page.row("editor.tabSize").badges, ["Project override"]);
  assert.deepEqual(page.row("editor.insertSpaces").badges, []);
  // Back to the user scope: the user rows are as before.
  page.chooseScope("User");
  assert.deepEqual(page.row("editor.fontSize").badges, [
    "Modified",
    "Overridden in this project: 18",
  ]);

  // Project scope with nothing overridden: no count, no badge, as before.
  const empty = pageHarness({ user: USER, project: {} });
  empty.chooseScope("Project");
  empty.chooseCategory("Editor");
  assert.equal(empty.summary(), undefined);
  assert.deepEqual(empty.overrideBadges(), []);
  assert.deepEqual(empty.row("editor.fontSize").badges, []);
  assert.equal(empty.row("editor.fontSize").reset.props.disabled, true);

  // Nothing overridden: no note and no count anywhere in any category or search.
  const none = pageHarness({ user: USER, project: {} });
  for (const name of [
    "Appearance",
    "Editor",
    "Terminal",
    "Workspace",
    "Connections & rigs",
    "Notifications",
  ]) {
    none.chooseCategory(name);
    assert.deepEqual(none.overrideBadges(), [], name);
    assert.equal(none.summary(), undefined, name);
  }
  none.search("a");
  assert.deepEqual(none.overrideBadges(), []);

  // One override: the count has no differing part when they all differ.
  const one = pageHarness({ user: {}, project: { "editor.fontSize": 20 } });
  assert.equal(one.text(one.summary()), "This project overrides 1 setting.");

  // Display only: nothing was saved, replaced or reset by any of the above.
  for (const h of [page, bare, empty, none, one])
    assert.deepEqual(h.calls, { update: [], replace: [], reset: [] });
});

// An independent model of the three states, written from the rules in the docs.
function modelState(key, user, project) {
  const hasProject = Object.prototype.hasOwnProperty.call(project, key);
  if (!hasProject) return "inherited";
  const userValue = Object.prototype.hasOwnProperty.call(user, key)
    ? user[key]
    : settings.defaults[key];
  return project[key] === userValue ? "same" : "overridden";
}

test("settings-overrides rules: states, own properties only, ordering, value text, notes, the count line and a seeded walk", () => {
  const keys = settings.schema.map((r) => r.key);
  assert.equal(lib.MAX_VALUE_TEXT, 40);
  assert.equal(lib.MAX_TITLE_KEYS, 10);

  // describeOverride: the three states for each kind of value.
  const info = (key, user, project) =>
    lib.describeOverride({ key }, user, project);
  assert.deepEqual(info("editor.fontSize", {}, {}), {
    key: "editor.fontSize",
    state: "inherited",
    userValue: 13,
    projectValue: undefined,
  });
  assert.deepEqual(info("editor.fontSize", { "editor.fontSize": 15 }, {}), {
    key: "editor.fontSize",
    state: "inherited",
    userValue: 15,
    projectValue: undefined,
  });
  assert.equal(
    info("editor.fontSize", {}, { "editor.fontSize": 16 }).state,
    "overridden",
  );
  assert.equal(
    info("editor.fontSize", {}, { "editor.fontSize": 13 }).state,
    "same",
  );
  assert.equal(
    info(
      "editor.fontSize",
      { "editor.fontSize": 16 },
      { "editor.fontSize": 16 },
    ).state,
    "same",
  );
  assert.equal(
    info(
      "editor.fontSize",
      { "editor.fontSize": 16 },
      { "editor.fontSize": 13 },
    ).state,
    "overridden",
    "the project value that equals the default still differs from the user's own value",
  );
  assert.equal(
    info("editor.minimap", {}, { "editor.minimap": true }).state,
    "overridden",
  );
  assert.equal(
    info("editor.minimap", {}, { "editor.minimap": false }).state,
    "same",
  );
  assert.equal(
    info(
      "editor.wordWrap",
      { "editor.wordWrap": "off" },
      { "editor.wordWrap": "on" },
    ).state,
    "overridden",
  );
  assert.equal(
    info("editor.wordWrap", {}, { "editor.wordWrap": "on" }).state,
    "same",
  );
  assert.equal(
    info(
      "appearance.statusBarHidden",
      {},
      { "appearance.statusBarHidden": "layout" },
    ).state,
    "overridden",
  );
  // Own properties only; junk scopes mean nothing is overridden.
  const inherited = Object.create({ "editor.fontSize": 99 });
  assert.equal(info("editor.fontSize", {}, inherited).state, "inherited");
  assert.equal(info("editor.fontSize", inherited, {}).userValue, 13);
  assert.equal(info("__proto__", {}, {}).state, "inherited");
  assert.equal(info("toString", {}, {}).state, "inherited");
  for (const junk of [
    undefined,
    null,
    0,
    1,
    "editor.fontSize",
    true,
    [],
    () => 1,
  ])
    assert.equal(info("editor.fontSize", junk, junk).state, "inherited");
  assert.equal(info("editor.fontSize", {}, [16]).state, "inherited");
  // A project value that is not text, a number or a switch is not an override.
  for (const bad of [null, undefined, {}, [], () => 1, Symbol("x")])
    assert.equal(
      info("editor.fontSize", {}, { "editor.fontSize": bad }).state,
      "inherited",
    );
  // Frozen input is fine and is never changed.
  const frozenUser = Object.freeze({ "editor.fontSize": 14 });
  const frozenProject = Object.freeze({ "editor.fontSize": 18 });
  assert.equal(
    info("editor.fontSize", frozenUser, frozenProject).state,
    "overridden",
  );
  assert.deepEqual(frozenUser, { "editor.fontSize": 14 });

  // overriddenKeys: schema order, flagged, known keys only.
  assert.deepEqual(lib.overriddenKeys({}, {}), []);
  assert.deepEqual(lib.overriddenKeys(undefined, undefined), []);
  assert.deepEqual(
    lib.overriddenKeys(
      { "editor.fontSize": 14 },
      {
        "rig.defaultTeamSize": 4,
        "editor.tabSize": 2,
        "editor.fontSize": 18,
        "not.real": 1,
      },
    ),
    [
      { key: "editor.fontSize", differs: true },
      { key: "editor.tabSize", differs: false },
      { key: "rig.defaultTeamSize", differs: true },
    ],
  );
  assert.deepEqual(
    lib.overriddenKeys({}, JSON.parse('{"__proto__":{"editor.fontSize":1}}')),
    [],
  );

  // formatValue: switches, option labels, plain text, caps, odd input.
  assert.equal(lib.formatValue({}, true), "On");
  assert.equal(lib.formatValue({}, false), "Off");
  assert.equal(lib.formatValue({}, 18), "18");
  assert.equal(lib.formatValue({}, 1.28), "1.28");
  assert.equal(lib.formatValue({}, "monospace"), "monospace");
  assert.equal(lib.formatValue(row("rig.defaultTeamSize"), 4), "Team");
  assert.equal(lib.formatValue(row("rig.defaultTeamSize"), 3), "3");
  assert.equal(lib.formatValue(row("editor.wordWrap"), "off"), "off");
  assert.equal(
    lib.formatValue(row("appearance.accent"), "theme"),
    "Theme default",
  );
  assert.equal(lib.formatValue({}, ""), "empty");
  assert.equal(lib.formatValue({}, "  \n\t "), "empty");
  assert.equal(lib.formatValue({}, " a \n\t b  c "), "a b c");
  assert.equal(lib.formatValue({}, "x".repeat(40)), "x".repeat(40));
  assert.equal(lib.formatValue({}, "x".repeat(41)), "x".repeat(37) + "...");
  assert.equal(
    lib.formatValue({}, "ab" + " ".repeat(60) + "cd"),
    "ab cd",
    "white space is collapsed before the cap",
  );
  assert.equal(
    lib.formatValue({}, "word ".repeat(20)),
    "word word word word word word word wo...",
  );
  const astral = String.fromCodePoint(0x1f600);
  const cut = lib.formatValue({}, astral.repeat(50));
  assert.equal(cut, astral.repeat(37) + "...");
  assert.equal(Array.from(cut).length, 40);
  for (const odd of [
    undefined,
    null,
    NaN,
    Infinity,
    {},
    [],
    () => 1,
    Symbol("x"),
  ])
    assert.equal(lib.formatValue({}, odd), "");
  assert.equal(lib.formatValue({}, 5000000 + ""), "5000000");

  // overrideNote: null when inherited; the exact words otherwise.
  const noteOf = (key, user, project) =>
    lib.overrideNote(row(key), user, project);
  assert.equal(noteOf("editor.fontSize", {}, {}), null);
  assert.equal(noteOf("editor.fontSize", { "editor.fontSize": 9 }, {}), null);
  assert.deepEqual(
    noteOf(
      "editor.fontSize",
      { "editor.fontSize": 14 },
      { "editor.fontSize": 18 },
    ),
    {
      state: "overridden",
      text: "Overridden in this project: 18",
      title:
        "This project uses 18; your user setting is 14. Open the Project scope to change it or remove the override.",
    },
  );
  assert.deepEqual(noteOf("editor.minimap", {}, { "editor.minimap": true }), {
    state: "overridden",
    text: "Overridden in this project: On",
    title:
      "This project uses On; your user setting is Off. Open the Project scope to change it or remove the override.",
  });
  assert.deepEqual(noteOf("editor.minimap", {}, { "editor.minimap": false }), {
    state: "same",
    text: "Also set in this project (same value)",
    title:
      "This project sets the same value as your user setting (Off) and keeps it if you change your user setting. Open the Project scope to remove the override.",
  });
  assert.equal(
    noteOf(
      "appearance.statusBarHidden",
      {},
      { "appearance.statusBarHidden": "layout, sessions" },
    ).text,
    "Overridden in this project: layout, sessions",
  );
  assert.ok(
    noteOf(
      "appearance.statusBarHidden",
      {},
      { "appearance.statusBarHidden": "layout" },
    ).title.includes("your user setting is empty"),
    "an empty user value reads as empty",
  );
  assert.equal(
    noteOf("terminal.wordSeparator", {}, { "terminal.wordSeparator": ".,;" })
      .text,
    "Overridden in this project: .,;",
  );

  // summarizeOverrides: the grammar of the count line and the tooltip.
  const sum = (user, project) => lib.summarizeOverrides(user, project);
  assert.deepEqual(sum({}, {}), {
    count: 0,
    differing: 0,
    text: "",
    title: "",
  });
  assert.deepEqual(sum(undefined, null), {
    count: 0,
    differing: 0,
    text: "",
    title: "",
  });
  assert.equal(
    sum({}, { "editor.fontSize": 18 }).text,
    "This project overrides 1 setting.",
  );
  assert.equal(
    sum({}, { "editor.fontSize": 18, "editor.minimap": true }).text,
    "This project overrides 2 settings.",
  );
  assert.equal(
    sum({}, { "editor.fontSize": 13 }).text,
    "This project overrides 1 setting; 0 differ from your user values.",
  );
  assert.equal(
    sum({}, { "editor.fontSize": 13, "editor.minimap": true }).text,
    "This project overrides 2 settings; 1 differs from your user value.",
  );
  assert.equal(
    sum(
      {},
      {
        "editor.fontSize": 13,
        "editor.tabSize": 2,
        "editor.minimap": true,
        "editor.wordWrap": "off",
      },
    ).text,
    "This project overrides 4 settings; 2 differ from your user values.",
  );
  assert.equal(
    sum({}, { "editor.fontSize": 18 }).title,
    "Overridden here: editor.fontSize.",
  );
  const everything = Object.fromEntries(
    settings.schema.map((r) => [
      r.key,
      typeof settings.defaults[r.key] === "boolean"
        ? !settings.defaults[r.key]
        : settings.defaults[r.key],
    ]),
  );
  const big = sum({}, everything);
  assert.equal(big.count, keys.length);
  assert.ok(
    big.title.startsWith(
      "Overridden here: " +
        keys.slice(0, 10).join(", ") +
        " and " +
        (keys.length - 10) +
        " more",
    ),
  );
  assert.ok(big.title.endsWith("more."));
  assert.equal(big.title.split(", ").length, 10);
  const exactlyTen = Object.fromEntries(
    keys.slice(0, 10).map((k) => [k, everything[k]]),
  );
  assert.equal(
    sum({}, exactlyTen).title,
    "Overridden here: " + keys.slice(0, 10).join(", ") + ".",
  );

  // The indicator agrees with the badge the page always had: every known key
  // the project owns is listed, and nothing else.
  for (const project of [
    { "editor.fontSize": 18, "editor.tabSize": 2, "rig.defaultTeamSize": 4 },
    {},
    { "editor.fontSize": 13 },
  ])
    assert.deepEqual(
      lib.overriddenKeys({}, project).map((item) => item.key),
      keys.filter((k) => Object.hasOwn(project, k)),
    );

  // A seeded walk of 300 random pairs against the model.
  const rand = seeded(8675309);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const alt = (key) => {
    const base = settings.defaults[key];
    if (typeof base === "boolean") return !base;
    if (typeof base === "number") return base + 1;
    return base + "x";
  };
  const value = (key) => (rand() < 0.5 ? settings.defaults[key] : alt(key));
  let walked = 0;
  for (let i = 0; i < 300; i++) {
    walked++;
    const user = {};
    const project = {};
    for (const key of keys) {
      if (rand() < 0.25) user[key] = value(key);
      if (rand() < 0.25) project[key] = value(key);
    }
    const expected = keys
      .map((key) => [key, modelState(key, user, project)])
      .filter(([, state]) => state !== "inherited");
    assert.deepEqual(
      lib
        .overriddenKeys(user, project)
        .map((item) => [item.key, item.differs ? "overridden" : "same"]),
      expected,
    );
    for (const key of [pick(keys), pick(keys), pick(keys)]) {
      const state = modelState(key, user, project);
      assert.equal(lib.describeOverride({ key }, user, project).state, state);
      const note = lib.overrideNote(row(key), user, project);
      assert.equal(note === null, state === "inherited");
      if (note) assert.equal(note.state, state);
    }
    const summary = lib.summarizeOverrides(user, project);
    assert.equal(summary.count, expected.length);
    assert.equal(
      summary.differing,
      expected.filter(([, s]) => s === "overridden").length,
    );
    assert.equal(summary.text === "", expected.length === 0);
  }
  assert.equal(walked, 300, "all 300 random pairs were checked");
});

test("settings-overrides wiring: the module is pure and reads only the settings module, SettingsPage adds exactly the note and the count with the existing classes, and saving, scopes and styles are untouched", () => {
  const source = read("src/settings-overrides.ts");
  const code = stripComments(source);
  assert.equal(isAscii(source), true, "the module is ASCII");
  assert.deepEqual(
    [...code.matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]),
    ["./settings"],
    "the only import is the settings module",
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
  ])
    assert.equal(count(code, word), 0, "the module has no " + word);
  const exported = [
    ...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm),
  ].map((m) => m[1]);
  assert.deepEqual(exported, [
    "SettingValue",
    "OverrideState",
    "OverrideInfo",
    "OverriddenKey",
    "OverrideNote",
    "OverrideSummary",
    "MAX_VALUE_TEXT",
    "MAX_TITLE_KEYS",
    "describeOverride",
    "overriddenKeys",
    "formatValue",
    "overrideNote",
    "summarizeOverrides",
  ]);
  const rows = source.split("\n");
  rows.forEach((line, i) => {
    if (/^export /.test(line))
      assert.ok(/\*\/\s*$/.test(rows[i - 1]), "doc comment above: " + line);
  });
  assert.ok(source.includes("export const MAX_VALUE_TEXT = 40;"));
  assert.ok(source.includes("export const MAX_TITLE_KEYS = 10;"));

  // SettingsPage.tsx: the additions, each once.
  const page = collapse(read("src/SettingsPage.tsx"));
  assert.equal(
    count(
      page,
      'import { overrideNote, summarizeOverrides } from "./settings-overrides";',
    ),
    1,
  );
  assert.equal(count(page, 'from "./settings-overrides"'), 1);
  assert.equal(
    count(
      page,
      'const note = scope === "user" ? overrideNote(row, context.user, context.project) : null;',
    ),
    1,
    "user scope only",
  );
  assert.equal(count(page, "overrideNote("), 1);
  assert.equal(
    count(
      page,
      '{note && ( <span className="setting-badge" data-override={note.state} title={note.title} > {note.text} </span> )}',
    ),
    1,
  );
  assert.equal(
    count(
      page,
      "const summary = summarizeOverrides(context.user, context.project);",
    ),
    1,
  );
  assert.equal(count(page, "summarizeOverrides("), 1);
  assert.equal(
    count(
      page,
      '{summary.text && ( <p className="settings-scope-note" data-overrides={summary.count} title={summary.title} > {summary.text} </p> )}',
    ),
    1,
  );
  // The note comes after the existing badge and the summary after the existing scope note.
  assert.ok(
    page.indexOf('{scope === "project" ? "Project override" : "Modified"}') <
      page.indexOf("{note && ("),
  );
  assert.ok(
    page.indexOf(
      ': "User settings are saved on this computer. Project overrides take precedence."}',
    ) < page.indexOf("{summary.text && ("),
  );
  // What was there before is untouched, word for word.
  for (const part of [
    "const modified = Object.hasOwn(own, row.key);",
    '<div className={`setting-row ${modified ? "modified" : ""}`} data-setting={row.key} >',
    '{modified && ( <span className="setting-badge"> {scope === "project" ? "Project override" : "Modified"} </span> )}',
    'title={ scope === "project" ? "Remove project override" : "Reset to default" }',
    'aria-label={"Reset " + row.label}',
    "disabled={!modified}",
    "onClick={() => context.reset(scope, row.key)}",
    "validateOverrides({ [row.key]: next });",
    "context.update(scope, row.key, next);",
    'own = scope === "user" ? context.user : context.project;',
    "context.reset(scope);",
    "context.replace(scope, next);",
  ])
    assert.ok(page.includes(part), "SettingsPage still has: " + part);
  // The saving and scope code is counted exactly as it was.
  assert.equal(count(page, "context.update("), 2);
  assert.equal(count(page, "context.reset("), 3);
  assert.equal(count(page, "context.replace("), 1);
  assert.equal(count(page, "validateOverrides("), 2);
  assert.equal(count(page, "useSettings()"), 2);
  assert.equal(count(page, "setScope("), 2);
  // The added JSX writes no handler, address, style or raw-markup property.
  const added = [
    page.slice(page.indexOf("{note && ("), page.indexOf("{note && (") + 160),
    page.slice(
      page.indexOf("{summary.text && ("),
      page.indexOf("{summary.text && (") + 170,
    ),
  ].join(" ");
  for (const word of [
    "onClick",
    "onChange",
    "href",
    "style=",
    "dangerously",
    "innerHTML",
    "ref=",
  ])
    assert.equal(count(added, word), 0, "the added JSX has no " + word);
  // Only existing styles are used.
  const css = read("src/styles.css");
  assert.ok(css.includes(".setting-badge {"));
  assert.ok(css.includes(".settings-scope-note {"));
  assert.equal(count(css, "data-override"), 0, "no new stylesheet rule");
  assert.equal(count(css, "settings-override"), 0);

  // Nothing else imports the module, and no main-process or mobile file knows it.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => read("src/" + name).includes("settings-overrides"))
    .sort();
  assert.deepEqual(users, ["SettingsPage.tsx"]);
  for (const dir of ["electron", "mobile"]) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base))
      if (fs.statSync(path.join(base, name)).isFile())
        assert.ok(
          !fs
            .readFileSync(path.join(base, name), "utf8")
            .includes("settings-overrides"),
          dir + "/" + name,
        );
  }
});

test("settings-overrides docs: SETTINGS.md has one Project override indicator paragraph with every claim, next to the scope text", () => {
  const doc = read("SETTINGS.md");
  assert.equal(isAscii(doc), true, "SETTINGS.md is ASCII");
  const paragraphs = doc
    .split("\n\n")
    .filter((p) => p.startsWith("Project override indicator:"));
  assert.equal(
    paragraphs.length,
    1,
    "one Project override indicator paragraph",
  );
  const p = collapse(paragraphs[0]);
  for (const claim of [
    "In the User scope a row shows a note when the open project overrides that setting",
    "Overridden in this project: followed by the project value",
    "a choice shows its label and a switch shows On or Off",
    "Also set in this project (same value)",
    "which it keeps if you later change your user setting",
    "A line under the scope note counts them",
    "This project overrides 5 settings; 3 differ from your user values.",
    "its tooltip lists the keys (the first ten)",
    "The Project scope, which already marks its own rows with Project override and has Remove project override, is unchanged",
    "the count also shows there; its rows are the overrides, and Modified only lists the ones in the current category",
    "reads the open project's own saved overrides",
    "Nothing is saved, changed or sent by the indicator",
    "it is display only",
    "the value shown in the User scope is not the value in effect for that project",
  ])
    assert.ok(p.includes(claim), "SETTINGS.md must say: " + claim);
  const at = doc.indexOf("Project override indicator:");
  assert.ok(at > doc.indexOf("## Scope and persistence"));
  assert.ok(at < doc.indexOf("## Settings catalog"), "in the scope section");
  assert.equal(count(doc, "Project override indicator"), 1);
});
