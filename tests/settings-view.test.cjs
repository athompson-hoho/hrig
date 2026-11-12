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
const lib = load("src/settings-view.ts");
const settings = load("src/settings.ts");
const schema = settings.schema;
const KEYS = schema.map((row) => row.key);
const label = (key) => schema.find((row) => row.key === key).label;
const inCategory = (category) =>
  schema.filter((row) => row.category === category).map((row) => row.key);
const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

// ---------------------------------------------------------------------------
// The real SettingsPage.tsx over a very small react (state slots per
// component, a render after every state change in the page, elements recorded
// as plain objects). The settings context is a fake that records every call
// and applies a reset to its own maps, the way the App does.
function fakeContext({ user = {}, project = {} } = {}) {
  const context = {
    effective: settings.resolveSettings(user, project),
    user,
    project,
    recent: [],
    calls: { update: [], replace: [], reset: [] },
    update: (...args) => context.calls.update.push(args),
    replace: (...args) => context.calls.replace.push(args),
    reset: (scope, key) => {
      context.calls.reset.push(key === undefined ? [scope] : [scope, key]);
      if (key === undefined) context[scope] = {};
      else {
        const next = { ...context[scope] };
        delete next[key];
        context[scope] = next;
      }
    },
  };
  return context;
}
function pageHarness(context) {
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
    fullText: () => text(tree),
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
    heading: () =>
      text(
        all(tree).find(
          (n) =>
            n.type === "div" && n.props.className === "settings-section-title",
        ),
      ),
    // The Reset button of the category heading: its text starts with Reset or Remove and it is not the scope button.
    section() {
      const title = all(tree).find(
        (n) =>
          n.type === "div" && n.props.className === "settings-section-title",
      );
      return title
        ? all(title).find(
            (n) =>
              n.type === "button" &&
              n.props.className === "settings-reset-scope",
          )
        : undefined;
    },
    box(name) {
      const holder = all(tree).find(
        (n) =>
          n.type === "label" &&
          n.props.className === "checkbox-label" &&
          text(n).trim() === name,
      );
      assert.ok(holder, "the " + name + " box is on the page");
      return all(holder).find((n) => n.type === "input");
    },
    within: (node) => all(node),
    modals: () => all(tree).filter((n) => n.type === "Modal"),
    modal(title) {
      return harness.modals().find((n) => n.props.title === title);
    },
    notices: () =>
      all(tree).filter((n) => n.type === "p" && n.props.role === "status"),
  };
  return harness;
}

test("settings-view tracer: on the real page, Reset Editor asks first, then resets only the changed Editor settings of the current scope, one call each, and says what it did", () => {
  const context = fakeContext({
    user: {
      "editor.fontSize": 15,
      "editor.tabSize": 4,
      "terminal.fontSize": 14,
      "appearance.reduceMotion": true,
    },
    project: { "editor.fontSize": 18, "editor.wordWrap": "off" },
  });
  const page = pageHarness(context);
  page.chooseCategory("Editor");
  const button = page.section();
  assert.ok(button, "the heading has a reset button");
  assert.equal(page.text(button).trim(), "Reset Editor");
  assert.equal(button.props.disabled, false);
  assert.equal(
    button.props.title,
    "Restore the default of 2 changed settings in Editor",
  );
  // Pressing it only opens the question: nothing is reset yet.
  assert.equal(page.modals().length, 0);
  button.props.onClick();
  assert.equal(page.modals().length, 1);
  const modal = page.modal("Reset Editor settings?");
  assert.ok(modal);
  assert.equal(
    modal.props.subtitle,
    "Restore the default value of 2 changed settings in Editor. Project overrides remain.",
  );
  assert.deepEqual(context.calls.reset, []);
  assert.deepEqual(context.calls.replace, []);
  assert.deepEqual(context.calls.update, []);
  // Confirm: two single-setting resets, the editor ones, in the user scope.
  const confirm = page
    .all()
    .find((n) => n.type === "button" && page.text(n) === "Reset settings");
  confirm.props.onClick();
  assert.deepEqual(context.calls.reset, [
    ["user", "editor.fontSize"],
    ["user", "editor.tabSize"],
  ]);
  assert.equal(page.modals().length, 0, "the question closed");
  assert.deepEqual(context.user, {
    "terminal.fontSize": 14,
    "appearance.reduceMotion": true,
  });
  assert.deepEqual(context.project, {
    "editor.fontSize": 18,
    "editor.wordWrap": "off",
  });
  assert.ok(page.fullText().includes("Reset 2 settings in Editor."));
  assert.equal(page.section().props.disabled, true, "nothing left to reset");
  assert.equal(page.section().props.title, "No Editor setting is changed");
});

test("settings-view keys: the changed settings of one category in one map, in settings page order, never from another category, another map or the prototype", () => {
  const { modifiedKeysInCategory } = lib;
  const editor = inCategory("Editor");
  const own = {
    "editor.tabSize": 4,
    "editor.fontSize": 15,
    "terminal.fontSize": 14,
    "workspace.refreshInterval": 30,
  };
  assert.deepEqual(modifiedKeysInCategory(schema, own, "Editor"), [
    "editor.fontSize",
    "editor.tabSize",
  ]);
  assert.deepEqual(
    modifiedKeysInCategory(schema, own, "Editor"),
    editor.filter((key) => key in own),
    "the order is the schema's",
  );
  assert.deepEqual(modifiedKeysInCategory(schema, own, "Terminal"), [
    "terminal.fontSize",
  ]);
  assert.deepEqual(modifiedKeysInCategory(schema, own, "Workspace"), [
    "workspace.refreshInterval",
  ]);
  // Category isolation over the whole schema: every key in the answer is a row of that category.
  const everything = Object.fromEntries(
    schema.map((row) => [row.key, settings.defaults[row.key]]),
  );
  const seen = new Set();
  for (const category of [
    "Appearance",
    "Editor",
    "Terminal",
    "Workspace",
    "Connections & rigs",
    "Notifications",
  ]) {
    const keys = modifiedKeysInCategory(schema, everything, category);
    assert.deepEqual(keys, inCategory(category));
    for (const key of keys) {
      assert.ok(!seen.has(key), key + " is in one category only");
      seen.add(key);
    }
  }
  assert.equal(seen.size, KEYS.length, "every setting belongs to one category");
  // The shortcut overrides are in Workspace and nowhere else.
  assert.deepEqual(
    modifiedKeysInCategory(
      schema,
      { "shortcuts.overrides": "a=b" },
      "Workspace",
    ),
    ["shortcuts.overrides"],
  );
  for (const category of ["Editor", "Terminal", "Appearance", "Notifications"])
    assert.deepEqual(
      modifiedKeysInCategory(
        schema,
        { "shortcuts.overrides": "a=b" },
        category,
      ),
      [],
    );
  // Empty and unknown: nothing to reset.
  assert.deepEqual(modifiedKeysInCategory(schema, {}, "Editor"), []);
  for (const category of [
    "",
    "editor",
    "EDITOR",
    " Editor",
    "Keyboard shortcuts",
    "JSON",
    "About",
    "Updates",
    "Mobile devices",
    undefined,
    null,
    7,
    {},
    ["Editor"],
  ])
    assert.deepEqual(modifiedKeysInCategory(schema, own, category), []);
  // Only own, defined values count: the prototype, junk and undefined do not.
  assert.deepEqual(
    modifiedKeysInCategory(
      schema,
      Object.create({ "editor.fontSize": 15 }),
      "Editor",
    ),
    [],
  );
  assert.deepEqual(
    modifiedKeysInCategory(schema, { "editor.fontSize": undefined }, "Editor"),
    [],
  );
  assert.deepEqual(
    modifiedKeysInCategory(schema, { nope: 1, "editor.nope": 2 }, "Editor"),
    [],
  );
  for (const bad of [undefined, null, 5, "text", true, [], () => 1])
    assert.deepEqual(modifiedKeysInCategory(schema, bad, "Editor"), []);
  for (const rows of [undefined, null, "rows", 3, {}])
    assert.deepEqual(modifiedKeysInCategory(rows, own, "Editor"), []);
  assert.deepEqual(
    modifiedKeysInCategory([null, 3, undefined, {}], own, "Editor"),
    [],
  );
  // Nothing is changed and the answer is a new list.
  const frozen = deepFreeze({ ...own });
  const answer = modifiedKeysInCategory(
    deepFreeze(schema.slice()),
    frozen,
    "Editor",
  );
  assert.deepEqual(frozen, own);
  assert.notEqual(answer, modifiedKeysInCategory(schema, frozen, "Editor"));
});

test("settings-view copy: the button, tooltip, question, sentence, names and notice for the user and project scopes, with plurals, a cap on the names and a safe answer for odd input", () => {
  const { describeSectionReset, MAX_NAMED } = lib;
  assert.equal(MAX_NAMED, 8);
  const two = ["editor.fontSize", "editor.tabSize"];
  assert.deepEqual(describeSectionReset("user", "Editor", two), {
    count: 2,
    button: "Reset Editor",
    buttonTitle: "Restore the default of 2 changed settings in Editor",
    title: "Reset Editor settings?",
    subtitle:
      "Restore the default value of 2 changed settings in Editor. Project overrides remain.",
    detail: label("editor.fontSize") + ", " + label("editor.tabSize") + ".",
    confirm: "Reset settings",
    notice: "Reset 2 settings in Editor.",
  });
  assert.deepEqual(describeSectionReset("project", "Editor", two), {
    count: 2,
    button: "Remove Editor overrides",
    buttonTitle: "Remove 2 project overrides in Editor",
    title: "Remove Editor project overrides?",
    subtitle:
      "Remove 2 project overrides in Editor and inherit your user preferences.",
    detail: label("editor.fontSize") + ", " + label("editor.tabSize") + ".",
    confirm: "Remove overrides",
    notice: "Removed 2 project overrides in Editor.",
  });
  // One and none.
  const one = describeSectionReset("user", "Editor", ["editor.fontSize"]);
  assert.equal(
    one.buttonTitle,
    "Restore the default of 1 changed setting in Editor",
  );
  assert.equal(one.notice, "Reset 1 setting in Editor.");
  assert.equal(
    describeSectionReset("project", "Editor", ["editor.fontSize"]).notice,
    "Removed 1 project override in Editor.",
  );
  const none = describeSectionReset("user", "Editor", []);
  assert.equal(none.count, 0);
  assert.equal(none.buttonTitle, "No Editor setting is changed");
  assert.equal(none.detail, "");
  assert.equal(
    describeSectionReset("project", "Editor", []).buttonTitle,
    "This project has no Editor overrides",
  );
  // The names: eight shown, the rest counted.
  const twelve = inCategory("Terminal").slice(0, 12);
  const long = describeSectionReset("user", "Terminal", twelve);
  assert.equal(
    long.detail,
    twelve.slice(0, 8).map(label).join(", ") + " and 4 more.",
  );
  assert.equal(
    describeSectionReset("user", "Terminal", twelve.slice(0, 8)).detail,
    twelve.slice(0, 8).map(label).join(", ") + ".",
    "exactly eight are all named",
  );
  assert.equal(
    describeSectionReset(
      "user",
      "Terminal",
      twelve.slice(0, 9),
    ).detail.endsWith(" and 1 more."),
    true,
  );
  // A category name with an ampersand, as the page has one, and the text is plain.
  assert.equal(
    describeSectionReset("user", "Connections & rigs", ["rig.defaultTeamSize"])
      .title,
    "Reset Connections & rigs settings?",
  );
  // Rows given are used for the names; an unknown key shows as itself; hostile input does not throw.
  assert.equal(
    describeSectionReset(
      "user",
      "Editor",
      ["editor.fontSize"],
      [
        {
          key: "editor.fontSize",
          category: "Editor",
          label: "Zoom",
          description: "",
        },
      ],
    ).detail,
    "Zoom.",
  );
  assert.equal(
    describeSectionReset("user", "Editor", ["editor.fontSize"], []).detail,
    "editor.fontSize.",
  );
  for (const keys of [undefined, null, "editor.fontSize", 3, {}])
    assert.equal(describeSectionReset("user", "Editor", keys).count, 0);
  assert.equal(describeSectionReset("user", undefined, two).button, "Reset ");
  assert.equal(
    describeSectionReset("user", "Editor", two, null).detail,
    "editor.fontSize, editor.tabSize.",
  );
  // Any scope but project reads as the user scope.
  assert.equal(
    describeSectionReset("elsewhere", "Editor", two).button,
    "Reset Editor",
  );
  // The keys given are not changed.
  const frozen = deepFreeze(two.slice());
  describeSectionReset("user", "Editor", frozen);
  assert.deepEqual(frozen, two);
});

test("settings-view page: the real page shows the category reset only in a category view, never resets without the confirmation, is scope aware, and acts on the current state", () => {
  // Where the button is and is not.
  const context = fakeContext({
    user: { "editor.fontSize": 15, "terminal.fontSize": 14 },
    project: { "editor.tabSize": 4 },
  });
  const page = pageHarness(context);
  assert.ok(page.section(), "Appearance is a category view");
  assert.equal(
    page.section().props.disabled,
    true,
    "nothing changed in Appearance",
  );
  for (const name of [
    "Editor",
    "Terminal",
    "Workspace",
    "Connections & rigs",
    "Notifications",
  ]) {
    page.chooseCategory(name);
    assert.ok(page.section(), name + " has the button");
    assert.equal(page.text(page.section()).trim(), "Reset " + name);
  }
  for (const name of [
    "Keyboard shortcuts",
    "About",
    "Updates",
    "Mobile devices",
  ]) {
    page.chooseCategory(name);
    assert.equal(page.section(), undefined, name + " has no rows to reset");
  }
  page.chooseCategory("Editor");
  page.search("font");
  assert.equal(page.section(), undefined, "a search is not a category");
  page.search("");
  assert.ok(page.section());
  page
    .all()
    .find((n) => n.type === "button" && page.text(n).includes("Settings JSON"))
    .props.onClick();
  assert.equal(page.section(), undefined, "the JSON view has none");
  page.chooseCategory("Editor");
  context.recent = [{ key: "editor.fontSize", scope: "user", project: "" }];
  page.render();
  page.box("Recently changed").props.onChange({ target: { checked: true } });
  assert.equal(
    page.section(),
    undefined,
    "the Recently changed view is not a category",
  );

  // Never without the confirmation: open, cancel, close, and no call is ever made.
  const ctx = fakeContext({
    user: {
      "editor.fontSize": 15,
      "editor.tabSize": 4,
      "terminal.fontSize": 14,
    },
    project: { "editor.fontSize": 18, "editor.wordWrap": "off" },
  });
  const p = pageHarness(ctx);
  p.chooseCategory("Editor");
  p.section().props.onClick();
  const modal = p.modal("Reset Editor settings?");
  modal.props.onClose();
  assert.equal(p.modals().length, 0, "closing the question resets nothing");
  p.section().props.onClick();
  p.all()
    .find((n) => n.type === "button" && p.text(n) === "Cancel reset")
    .props.onClick();
  assert.equal(p.modals().length, 0);
  assert.deepEqual(ctx.calls, { update: [], replace: [], reset: [] });
  assert.ok(
    Object.keys(ctx.user).length === 3 && Object.keys(ctx.project).length === 2,
  );
  // The detail line names the settings and nothing else.
  p.section().props.onClick();
  const detail = p
    .all()
    .find(
      (n) =>
        n.type === "p" &&
        n.props.className === "settings-scope-note" &&
        p.text(n).includes(label("editor.fontSize")),
    );
  assert.equal(
    p.text(detail),
    label("editor.fontSize") + ", " + label("editor.tabSize") + ".",
  );
  assert.equal(
    p
      .all()
      .filter(
        (n) => n.type === "button" && n.props.className === "primary-button",
      ).length,
    1,
    "one confirming button",
  );
  p.modal("Reset Editor settings?").props.onClose();

  // Project scope: the project's own keys only, the project wording, and the user map is untouched.
  p.chooseScope("Project");
  assert.equal(p.text(p.section()).trim(), "Remove Editor overrides");
  assert.equal(p.section().props.title, "Remove 2 project overrides in Editor");
  p.section().props.onClick();
  assert.ok(p.modal("Remove Editor project overrides?"));
  p.all()
    .find((n) => n.type === "button" && p.text(n) === "Remove overrides")
    .props.onClick();
  assert.deepEqual(ctx.calls.reset, [
    ["project", "editor.fontSize"],
    ["project", "editor.wordWrap"],
  ]);
  assert.deepEqual(ctx.project, {});
  assert.deepEqual(ctx.user, {
    "editor.fontSize": 15,
    "editor.tabSize": 4,
    "terminal.fontSize": 14,
  });
  assert.ok(p.fullText().includes("Removed 2 project overrides in Editor."));

  // The scope and the category are the ones in view when it is pressed: Terminal in the user scope touches only Terminal.
  p.chooseScope("User");
  p.chooseCategory("Terminal");
  p.section().props.onClick();
  p.all()
    .find((n) => n.type === "button" && p.text(n) === "Reset settings")
    .props.onClick();
  assert.deepEqual(ctx.calls.reset.slice(2), [["user", "terminal.fontSize"]]);
  assert.deepEqual(ctx.user, { "editor.fontSize": 15, "editor.tabSize": 4 });

  // The question is about the state now: if the settings were reset elsewhere meanwhile, the confirming button is off and calls nothing.
  p.chooseCategory("Editor");
  p.section().props.onClick();
  ctx.user = {};
  p.render();
  const stale = p
    .all()
    .find((n) => n.type === "button" && p.text(n) === "Reset settings");
  assert.equal(stale.props.disabled, true);
  assert.equal(
    p
      .modal("Reset Editor settings?")
      .props.subtitle.includes("0 changed settings"),
    true,
  );
  const before = ctx.calls.reset.length;
  stale.props.onClick();
  assert.equal(
    ctx.calls.reset.length,
    before,
    "even a forced click resets nothing",
  );

  // A long list: the names are capped and the count is the real one.
  const big = {};
  for (const key of inCategory("Terminal")) big[key] = settings.defaults[key];
  const c3 = fakeContext({ user: big });
  const p3 = pageHarness(c3);
  p3.chooseCategory("Terminal");
  p3.section().props.onClick();
  const named = p3
    .all()
    .find(
      (n) =>
        n.type === "p" &&
        n.props.className === "settings-scope-note" &&
        p3.text(n).includes(" more."),
    );
  assert.ok(named, "more than eight are summarised");
  assert.ok(
    p3
      .text(named)
      .endsWith(" and " + (inCategory("Terminal").length - 8) + " more."),
  );
  p3.all()
    .find((n) => n.type === "button" && p3.text(n) === "Reset settings")
    .props.onClick();
  assert.equal(c3.calls.reset.length, inCategory("Terminal").length);
  assert.deepEqual(Object.keys(c3.user), []);
  // Shortcut overrides are in Workspace and are named in its question.
  const c4 = fakeContext({
    user: { "shortcuts.overrides": "workspace.reopenPanel=Ctrl+Shift+J" },
  });
  const p4 = pageHarness(c4);
  p4.chooseCategory("Workspace");
  p4.section().props.onClick();
  assert.ok(p4.fullText().includes(label("shortcuts.overrides") + "."));
});

test("settings-view wiring: the module is pure and reads only the settings module, the page adds one button and one question that call the existing reset one setting at a time, and saving, styles and the settings shape are untouched", () => {
  const source = read("src/settings-view.ts");
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
    "new RegExp",
    "Math.random",
    "Date",
    "performance.",
    "rigAction",
    "sendMessage",
    "validateOverrides",
    "safeOverrides",
    "resolveSettings",
    "JSON.",
    "innerHTML",
  ])
    assert.equal(count(code, word), 0, "the module has no " + word);
  const exported = [
    ...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm),
  ].map((m) => m[1]);
  for (const name of [
    "MAX_NAMED",
    "SectionReset",
    "modifiedKeysInCategory",
    "describeSectionReset",
  ])
    assert.ok(exported.includes(name), "exports " + name);
  const rows = source.split("\n");
  rows.forEach((line, i) => {
    if (/^export /.test(line))
      assert.ok(/\*\/\s*$/.test(rows[i - 1]), "doc comment above: " + line);
  });
  assert.ok(source.includes("export const MAX_NAMED = 8;"));

  // SettingsPage.tsx: the additions, each once.
  const page = collapse(read("src/SettingsPage.tsx"));
  assert.equal(count(page, 'from "./settings-view"'), 1);
  const imported = /import \{([^}]*)\} from "\.\/settings-view";/.exec(page);
  assert.ok(imported, "one import from the module");
  const names = imported[1].split(",").map((name) => name.trim());
  assert.ok(names.includes("describeSectionReset"));
  assert.ok(names.includes("modifiedKeysInCategory"));
  assert.equal(count(page, "modifiedKeysInCategory("), 1);
  assert.equal(count(page, "describeSectionReset("), 1);
  assert.equal(
    count(page, '[confirmSection, setConfirmSection] = useState(""),'),
    1,
  );
  assert.equal(
    count(
      page,
      "const sectionKeys = modifiedKeysInCategory( schema, own, confirmSection || category, );",
    ),
    1,
  );
  assert.equal(
    count(
      page,
      "const sectionReset = describeSectionReset( scope, confirmSection || category, sectionKeys, );",
    ),
    1,
  );
  assert.equal(
    count(
      page,
      '{!listing && ( <button className="settings-reset-scope" disabled={!sectionReset.count} title={sectionReset.buttonTitle} onClick={() => setConfirmSection(category)} > <RotateCcw size={12} /> {sectionReset.button} </button> )}',
    ),
    1,
    "one button, shown in a category view only, and it only opens the question",
  );
  assert.equal(
    count(page, "for (const key of sectionKeys) context.reset(scope, key);"),
    1,
    "the one reset call goes through the existing reset, one setting at a time",
  );
  assert.equal(count(page, "{confirmSection && ( <Modal"), 1);
  assert.equal(count(page, 'setConfirmSection("")'), 3);
  assert.equal(count(page, "<Modal"), 2);
  assert.equal(
    count(page, "disabled={!sectionReset.count}"),
    2,
    "the button and the confirming button are off with nothing to reset",
  );
  // The older reset code is kept word for word, and the saving and scope code counted as it was plus the one new loop call.
  for (const part of [
    "[confirmReset, setConfirmReset] = useState(false),",
    "<RotateCcw size={12} /> Reset {scope} settings",
    "context.reset(scope);",
    'setNotice("Reset " + scope + " settings.");',
    "Cancel reset",
    "onClick={() => context.reset(scope, row.key)}",
    "context.replace(scope, report.valid);", // the import check (X09) decides what is applied
  ])
    assert.ok(page.includes(part), "SettingsPage still has: " + part);
  assert.equal(count(page, "context.update("), 2);
  assert.equal(
    count(page, "context.reset("),
    3,
    "the row, the whole scope and the new loop",
  );
  assert.equal(count(page, "context.replace("), 1);
  assert.equal(count(page, "useSettings()"), 2);
  // The added JSX has no markup, style or address property.
  const at = page.indexOf("{confirmSection && ( <Modal");
  const added = page.slice(at, page.indexOf("{sectionReset.confirm}", at) + 40);
  for (const word of [
    "href",
    "style=",
    "dangerously",
    "innerHTML",
    "ref=",
    "onKeyDown",
    'className="new',
  ])
    assert.equal(count(added, word), 0, "the added JSX has no " + word);
  // Many reset calls in one click are one render and one save: the App saves in an effect on the state, debounced.
  const app = collapse(read("src/App.tsx"));
  assert.equal(
    count(
      app,
      "const timer = setTimeout( () => window.hrig.saveState(state).catch((e) => {",
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "350, ); return () => clearTimeout(timer); }, [state, loaded, log]);",
    ),
    1,
  );
  // Only existing styles, no new class, no settings key.
  const css = read("src/styles.css");
  assert.ok(css.includes(".settings-reset-scope {"));
  assert.ok(css.includes(".settings-scope-note {"));
  assert.equal(count(css, "settings-view"), 0);
  assert.equal(count(css, "section-reset"), 0);
  assert.equal(
    count(code, "defaults"),
    0,
    "no default or schema change is needed",
  );
  // Only the page imports the module; no main process or mobile file knows it.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => read("src/" + name).includes("settings-view"))
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
            .includes("settings-view"),
          dir + "/" + name,
        );
  }
});

test("settings-view docs: SETTINGS.md has one Reset category paragraph with every claim, next to the scope text, and the Transfer and discoverability row names it", () => {
  const doc = read("SETTINGS.md");
  assert.equal(isAscii(doc), true, "SETTINGS.md is ASCII");
  const paragraphs = doc
    .split("\n\n")
    .filter((p) => p.startsWith("Reset category:"));
  assert.equal(paragraphs.length, 1, "one Reset category paragraph");
  const p = collapse(paragraphs[0]);
  for (const claim of [
    "a Reset button beside the setting count",
    "only in a category view, not in a search, in Recently changed, or in Settings JSON",
    "greyed out when nothing in that category is changed",
    "It asks first",
    "names the settings it will change",
    "up to eight, then how many more",
    "nothing is reset until you confirm",
    "only the changed settings of that category in the scope you are looking at",
    "In the User scope it restores their defaults and the project's overrides remain",
    "In the Project scope it removes the project's overrides in that category, and the user values apply again",
    "The other category, the other scope and every setting that is not changed are left alone",
    "It does the same as pressing each row's reset button",
    "the settings it resets also appear under Recently changed",
    "There is no undo",
  ])
    assert.ok(p.includes(claim), "SETTINGS.md must say: " + claim);
  const at = doc.indexOf("Reset category:");
  assert.ok(at > doc.indexOf("Recently changed:"));
  assert.ok(at < doc.indexOf("## Settings catalog"), "in the scope section");
  assert.equal(count(doc, "Reset category:"), 1);
  const row = doc
    .split("\n")
    .filter((line) => line.startsWith("| Transfer and discoverability |"));
  assert.equal(row.length, 1, "one Transfer and discoverability row");
  assert.ok(row[0].includes("per-category"));
  assert.equal(lib.MAX_NAMED, 8, "the paragraph's number is the code's");
});

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
const joined = (parts) => parts.map((part) => part.text).join("");
const marks = (parts) =>
  parts.filter((part) => part.match).map((part) => part.text);
const lone = (text) =>
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    text,
  );

test("settings-view parts: the search words are matched as text, case blind, left to right and never overlapping, the parts always add up to the text, and no character is cut", () => {
  const { highlightParts, MAX_QUERY, MAX_SCAN, MAX_MARKS } = lib;
  assert.equal(MAX_QUERY, 100);
  assert.equal(MAX_SCAN, 2000);
  assert.equal(MAX_MARKS, 20);
  const P = (text, match = false) => ({ text, match });
  // One match, in the middle, at the start, at the end, the whole text.
  assert.deepEqual(highlightParts("Editor font size", "font"), [
    P("Editor "),
    P("font", true),
    P(" size"),
  ]);
  assert.deepEqual(highlightParts("font size", "font"), [
    P("font", true),
    P(" size"),
  ]);
  assert.deepEqual(highlightParts("Editor font", "font"), [
    P("Editor "),
    P("font", true),
  ]);
  assert.deepEqual(highlightParts("font", "font"), [P("font", true)]);
  // Case blind both ways, the original case kept in the part; the search is trimmed.
  assert.deepEqual(highlightParts("Font Size", "fONT"), [
    P("Font", true),
    P(" Size"),
  ]);
  assert.deepEqual(highlightParts("font size", "  FONT\t\n"), [
    P("font", true),
    P(" size"),
  ]);
  // Several matches, and matches that would overlap are taken left to right without overlap.
  assert.deepEqual(highlightParts("a font and a font", "font"), [
    P("a "),
    P("font", true),
    P(" and a "),
    P("font", true),
  ]);
  assert.deepEqual(highlightParts("aaaa", "aa"), [
    P("aa", true),
    P("aa", true),
  ]);
  assert.deepEqual(highlightParts("aaa", "aa"), [P("aa", true), P("a")]);
  assert.deepEqual(highlightParts("abab", "ab"), [
    P("ab", true),
    P("ab", true),
  ]);
  assert.deepEqual(highlightParts("aXa", "a"), [
    P("a", true),
    P("X"),
    P("a", true),
  ]);
  // Inner spaces are part of the words.
  assert.deepEqual(highlightParts("the font size row", "font size"), [
    P("the "),
    P("font size", true),
    P(" row"),
  ]);
  assert.deepEqual(
    highlightParts("font  size", "font size"),
    [P("font  size")],
    "no match, one plain part",
  );
  // No search, a blank one, no match, odd inputs.
  for (const query of [
    undefined,
    null,
    "",
    "   ",
    "\t\n",
    7,
    {},
    ["font"],
    true,
  ])
    assert.deepEqual(highlightParts("Editor font size", query), [
      P("Editor font size"),
    ]);
  assert.deepEqual(highlightParts("Editor font size", "zebra"), [
    P("Editor font size"),
  ]);
  for (const text of ["", undefined, null, 7, {}, ["a"]])
    assert.deepEqual(highlightParts(text, "a"), []);
  // Characters that mean something in a pattern mean themselves here: nothing is escaped because nothing is a pattern.
  assert.deepEqual(highlightParts("match a.*b here", ".*"), [
    P("match a"),
    P(".*", true),
    P("b here"),
  ]);
  assert.deepEqual(highlightParts("abc", ".*"), [P("abc")]);
  assert.deepEqual(highlightParts("a (b) [c] {d} e", "(b)"), [
    P("a "),
    P("(b)", true),
    P(" [c] {d} e"),
  ]);
  for (const meta of [
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "\\",
    "^",
    "$",
    "|",
    "?",
    "*",
    "+",
    ".",
    "a+",
    "(a+)+$",
    "[a-",
    "\\1",
    "(?<n>",
    "%",
    "\\u0041",
    "\\p{L}",
  ]) {
    const host = "x" + meta + "y" + meta;
    const out = highlightParts(host, meta);
    assert.deepEqual(marks(out), [meta, meta], meta);
    assert.equal(joined(out), host);
  }
  assert.deepEqual(
    highlightParts("aaaa", "(a+)+$"),
    [P("aaaa")],
    "no pattern engine: a nasty pattern is just text",
  );
  // Emoji and other characters outside the basic plane are matched whole and never cut.
  assert.deepEqual(
    highlightParts("Dark \u{1F319} mode \u{1F319}", "\u{1F319}"),
    [P("Dark "), P("\u{1F319}", true), P(" mode "), P("\u{1F319}", true)],
  );
  const half = highlightParts("Dark \u{1F319} mode", "\ud83c");
  assert.deepEqual(
    half,
    [P("Dark "), P("\u{1F319}", true), P(" mode")],
    "a search for half a pair marks the whole character",
  );
  assert.equal(
    highlightParts("Dark \u{1F319} mode", "\udf19").some((part) => part.match),
    true,
  );
  for (const part of half) assert.equal(lone(part.text), false);
  // A family emoji (joiners) and a letter with a combining mark: matched as written, whole characters kept.
  const family = "\u{1F469}‍\u{1F4BB}";
  assert.deepEqual(highlightParts("by " + family + " ok", family), [
    P("by "),
    P(family, true),
    P(" ok"),
  ]);
  assert.deepEqual(highlightParts("écran", "é"), [P("é", true), P("cran")]);
  assert.deepEqual(
    highlightParts("écran", "É"),
    [P("é", true), P("cran")],
    "an accented capital finds the small one",
  );
  assert.deepEqual(
    highlightParts("Жур", "ж"),
    [P("Ж", true), P("ур")],
    "Cyrillic case is folded",
  );
  assert.deepEqual(highlightParts("日本語", "本"), [
    P("日"),
    P("本", true),
    P("語"),
  ]);
  // A letter that lower cases to two units is mapped back to the whole letter; the Kelvin sign is a K.
  assert.deepEqual(highlightParts("İstanbul", "i"), [
    P("İ", true),
    P("stanbul"),
  ]);
  assert.deepEqual(
    highlightParts("İstanbul", "istanbul"),
    [P("İstanbul")],
    "as the search itself finds nothing here",
  );
  assert.deepEqual(highlightParts("K", "k"), [P("K", true)]);
  assert.deepEqual(highlightParts("Straße", "STRAßE"), [P("Straße", true)]);
  // The documented limit: case is folded one character at a time, so a Greek capital sigma that ends a word is found by the page's search (which lower cases the whole text) but is not marked.
  assert.equal("ΟΔΟΣ".toLowerCase().includes("οδος"), true);
  assert.deepEqual(highlightParts("ΟΔΟΣ", "οδος"), [P("ΟΔΟΣ")]);
  // Long searches are not marked and not cut: 100 code points work, 101 do not, a huge one costs nothing.
  const hundred = "a".repeat(100);
  assert.deepEqual(highlightParts("x" + hundred + "y", hundred), [
    P("x"),
    P(hundred, true),
    P("y"),
  ]);
  assert.deepEqual(highlightParts("x" + hundred + "ay", hundred + "a"), [
    P("x" + hundred + "ay"),
  ]);
  const emoji100 = "\u{1F319}".repeat(100);
  assert.deepEqual(
    marks(highlightParts(emoji100, emoji100)),
    [emoji100],
    "100 code points of two units each",
  );
  assert.deepEqual(
    highlightParts(emoji100 + "x", emoji100 + "\u{1F319}"),
    [P(emoji100 + "x")],
    "101 code points",
  );
  assert.deepEqual(highlightParts("abc", "b".repeat(5000000)), [P("abc")]);
  // Long texts: only the first MAX_SCAN units are searched, the rest comes back as plain text, a pair at the edge is not cut, and nothing is lost.
  const filler = "x".repeat(1990);
  const longText = filler + " font here and more font " + "y".repeat(5000);
  const longOut = highlightParts(longText, "font");
  assert.equal(joined(longOut), longText);
  assert.deepEqual(
    marks(longOut),
    ["font"],
    "the match at 1991 is inside the scan, the later ones are not",
  );
  const edge = "a".repeat(1999) + "\u{1F319}" + "font";
  const edgeOut = highlightParts(edge, "font");
  assert.equal(joined(edgeOut), edge);
  assert.deepEqual(marks(edgeOut), []);
  for (const part of edgeOut) assert.equal(lone(part.text), false);
  const huge = "ab ".repeat(1000000);
  const hugeOut = highlightParts(huge, "ab");
  assert.equal(joined(hugeOut), huge);
  assert.equal(marks(hugeOut).length, MAX_MARKS);
  // At most MAX_MARKS marks; the later matches stay in the plain tail.
  const many = "font ".repeat(50);
  const manyOut = highlightParts(many, "font");
  assert.equal(marks(manyOut).length, 20);
  assert.equal(joined(manyOut), many);
  assert.equal(manyOut[manyOut.length - 1].match, false);
  // A scan that cannot go wrong slowly: the worst case for a plain search over the largest text and search.
  const slow = highlightParts("a".repeat(2001) + "b", "a".repeat(99) + "c");
  assert.deepEqual(slow, [P("a".repeat(2001) + "b")]);
  // The text given is not changed.
  const frozen = Object.freeze("Editor font size");
  assert.deepEqual(highlightParts(frozen, "font"), [
    P("Editor "),
    P("font", true),
    P(" size"),
  ]);
});

test("settings-view fuzz: for random texts and searches the parts add up to the text, no part is empty, no character is cut, marks hold the search, and a mark exists exactly when the page's own search matches", () => {
  const { highlightParts } = lib;
  const rnd = seeded(20260512);
  const alphabet = [
    "a",
    "B",
    "c",
    "é",
    "É",
    "İ",
    "ı",
    "ß",
    "ẞ",
    "K",
    "\u{1F319}",
    "\u{1F469}",
    "‍",
    "́",
    " ",
    ".",
    "*",
    "(",
    "$",
    "\\",
    "Ж",
    "ж",
    "日",
    "f",
    "o",
    "n",
    "t",
  ];
  const pick = (n) => {
    let out = "";
    for (let i = 0; i < n; i++)
      out += alphabet[Math.floor(rnd() * alphabet.length)];
    return out;
  };
  const fold = (text) =>
    Array.from(text)
      .map((c) => c.toLowerCase())
      .join("");
  let checked = 0;
  let matched = 0;
  for (let n = 0; n < 600; n++) {
    const text = pick(Math.floor(rnd() * 70));
    let query;
    const mode = rnd();
    if (mode < 0.5 && text.length) {
      const chars = Array.from(text);
      const a = Math.floor(rnd() * chars.length);
      query = chars.slice(a, a + 1 + Math.floor(rnd() * 4)).join("");
      if (rnd() < 0.5) query = query.toUpperCase();
      if (rnd() < 0.3) query = "  " + query + " ";
    } else query = pick(1 + Math.floor(rnd() * 3));
    const parts = highlightParts(text, query);
    if (text === "") {
      assert.deepEqual(parts, []);
      continue;
    }
    assert.equal(joined(parts), text, "the parts add up to the text");
    parts.forEach((part, i) => {
      assert.ok(part.text.length > 0, "no empty part");
      assert.equal(typeof part.match, "boolean");
      if (i > 0)
        assert.ok(
          part.match || parts[i - 1].match,
          "plain parts are never next to each other",
        );
      assert.equal(lone(part.text), false, "no character is cut");
    });
    const needle = query.trim();
    const found = needle
      ? text.toLowerCase().includes(needle.toLowerCase())
      : false;
    assert.equal(
      parts.some((part) => part.match),
      found,
      JSON.stringify([text, query]),
    );
    for (const part of parts.filter((p) => p.match))
      assert.ok(
        fold(part.text).includes(fold(needle)),
        "a mark holds the search",
      );
    assert.deepEqual(
      highlightParts(text, query),
      parts,
      "the same answer twice",
    );
    checked++;
    if (found) matched++;
  }
  assert.equal(checked > 500, true);
  assert.equal(
    matched > 100,
    true,
    "the generator produced plenty of real matches",
  );
});

test("settings-view marked: the real page marks the searched words in the name and the description of each result row as <mark> elements with plain text, nowhere else, and draws nothing different without a search", () => {
  const user = { "editor.fontSize": 15 };
  const context = fakeContext({ user });
  const page = pageHarness(context);
  const copy = (key) => {
    const row = page
      .all()
      .find((n) => n.props && n.props["data-setting"] === key);
    assert.ok(row, key + " is listed");
    const parts = page.within(row);
    return {
      label: parts.find(
        (n) => n.type === "label" && n.props.htmlFor === "setting-" + key,
      ),
      description: parts.find((n) => n.type === "p" && !n.props.className),
      code: parts.find((n) => n.type === "code"),
      all: parts,
    };
  };
  const expected = (text, query) => {
    const parts = lib.highlightParts(text, query);
    return parts.some((p) => p.match)
      ? parts.map((p) =>
          p.match ? { type: "mark", props: { children: p.text } } : p.text,
        )
      : text;
  };
  // No search: the label and the description are the plain strings, as before this feature.
  page.chooseCategory("Editor");
  const row = schema.find((r) => r.key === "editor.fontSize");
  assert.equal(copy("editor.fontSize").label.props.children, row.label);
  assert.equal(
    copy("editor.fontSize").description.props.children,
    row.description,
  );
  assert.equal(
    page.all().some((n) => n.type === "mark"),
    false,
  );
  // A search: every listed row has exactly the marks the module gives, in the name and in the description.
  page.search("font");
  const listed = page.rows();
  assert.ok(listed.length >= 3, "a few rows match font");
  let markedLabels = 0;
  let markedDescriptions = 0;
  for (const key of listed) {
    const r = schema.find((x) => x.key === key);
    const c = copy(key);
    assert.deepEqual(
      c.label.props.children,
      expected(r.label, "font"),
      key + " label",
    );
    assert.deepEqual(
      c.description.props.children,
      expected(r.description, "font"),
      key + " description",
    );
    assert.equal(c.code.props.children, key, "the key line is not marked");
    if (Array.isArray(c.label.props.children)) markedLabels++;
    if (Array.isArray(c.description.props.children)) markedDescriptions++;
  }
  assert.ok(markedLabels >= 2 && markedDescriptions >= 1);
  const fontSize = copy("editor.fontSize");
  assert.equal(fontSize.all.filter((n) => n.type === "mark").length >= 1, true);
  for (const mark of page.all().filter((n) => n.type === "mark")) {
    assert.equal(
      typeof mark.props.children,
      "string",
      "a mark holds plain text",
    );
    assert.deepEqual(
      Object.keys(mark.props),
      ["children"],
      "a mark has no handler, style or markup property",
    );
    assert.equal(mark.props.children.toLowerCase(), "font");
  }
  // The same search typed in capitals with edge spaces marks the same; the page lower cases and trims it, as its filter does.
  page.search("  FONT ");
  assert.deepEqual(
    copy("editor.fontSize").label.props.children,
    expected(row.label, "font"),
  );
  // A row found only through its key or an option has nothing to mark and shows its plain text.
  page.search("editor.tabsize");
  const tab = schema.find((r) => r.key === "editor.tabSize");
  assert.equal(copy("editor.tabSize").label.props.children, tab.label);
  assert.equal(
    page.all().some((n) => n.type === "mark"),
    false,
  );
  // Hostile search text: nothing is interpreted, no markup property anywhere, and the row text stays as it is.
  for (const hostile of [
    "<img src=x onerror=alert(1)>",
    "<mark>",
    "&lt;",
    "</p><script>",
    "${font}",
    "\u0000",
    "‮",
    "(?",
    "font".repeat(40),
  ]) {
    page.search(hostile);
    for (const node of page.all()) {
      assert.equal(
        node.props && "dangerouslySetInnerHTML" in node.props,
        false,
      );
      assert.equal(node.props && "innerHTML" in node.props, false);
    }
    for (const mark of page.all().filter((n) => n.type === "mark"))
      assert.equal(typeof mark.props.children, "string");
  }
  // The search that marks is the search that filters: every listed row is one the filter found, and what it found is marked in the label or description when the words are there.
  page.search("zebra");
  assert.deepEqual(page.rows(), []);
  page.search("");
  // With the Recently changed view the search marks too, and the row order is the recent one.
  context.recent = [
    { key: "terminal.fontSize", scope: "user", project: "" },
    { key: "editor.fontSize", scope: "user", project: "" },
  ];
  page.render();
  page.box("Recently changed").props.onChange({ target: { checked: true } });
  page.search("font");
  assert.deepEqual(page.rows(), ["terminal.fontSize", "editor.fontSize"]);
  assert.deepEqual(
    copy("terminal.fontSize").label.props.children,
    expected(schema.find((r) => r.key === "terminal.fontSize").label, "font"),
  );
});

test("settings-view style: the module is complete and pure, the page marks through one helper with elements only, and the one new style rule is a tokens-only rule", () => {
  const source = read("src/settings-view.ts");
  const code = stripComments(source);
  assert.equal(isAscii(source), true, "the module is ASCII");
  assert.deepEqual(
    [...code.matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]),
    ["./settings"],
  );
  const exported = [
    ...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm),
  ].map((m) => m[1]);
  assert.deepEqual(exported, [
    "MAX_NAMED",
    "SectionReset",
    "modifiedKeysInCategory",
    "describeSectionReset",
    "TextPart",
    "MAX_QUERY",
    "MAX_SCAN",
    "MAX_MARKS",
    "highlightParts",
  ]);
  const rows = source.split("\n");
  rows.forEach((line, i) => {
    if (/^export /.test(line))
      assert.ok(/\*\/\s*$/.test(rows[i - 1]), "doc comment above: " + line);
  });
  assert.ok(source.includes("export const MAX_QUERY = 100;"));
  assert.ok(source.includes("export const MAX_SCAN = 2000;"));
  assert.ok(source.includes("export const MAX_MARKS = 20;"));
  // No pattern engine anywhere in the module: this is what makes the search text safe.
  for (const word of [
    "RegExp",
    "new RegExp",
    ".match(",
    ".matchAll(",
    ".replace(",
    ".replaceAll(",
    ".test(",
    ".exec(",
    ".search(",
    ".split(",
    "innerHTML",
    "dangerously",
    "document.",
    "window.",
    "Date",
    "Math.random",
    "eval(",
  ])
    assert.equal(count(code, word), 0, "the module has no " + word);
  assert.equal(count(code, "indexOf("), 1, "one plain text search");
  assert.equal(
    [...code.matchAll(/\/[^\/\n*][^\/\n]*\/[gimsuy]*[.,;)]/g)].length,
    0,
    "no regular expression literal",
  );

  // SettingsPage.tsx: one helper, used for the name and the description, elements only.
  const page = collapse(read("src/SettingsPage.tsx"));
  assert.equal(count(page, "highlightParts("), 1);
  assert.equal(
    count(page, "function marked(text: string, query: string) {"),
    1,
  );
  assert.equal(
    count(
      page,
      "const parts = highlightParts(text, query); if (!parts.some((part) => part.match)) return text; return parts.map((part, i) => part.match ? <mark key={i}>{part.text}</mark> : part.text, ); }",
    ),
    1,
  );
  assert.equal(
    count(page, "marked("),
    3,
    "the helper, the name and the description",
  );
  assert.equal(count(page, "{marked(row.label, highlight)}"), 1);
  assert.equal(count(page, "<p>{marked(row.description, highlight)}</p>"), 1);
  assert.equal(
    count(page, "highlight={text}"),
    1,
    "the page's own trimmed and lower cased search",
  );
  assert.equal(count(page, "<mark"), 1);
  assert.equal(count(page, "dangerouslySetInnerHTML"), 0);
  assert.equal(count(page, "innerHTML"), 0);
  assert.equal(
    count(page, "<code>{row.key}</code>"),
    1,
    "the key line is plain text",
  );
  assert.equal(count(page, "const text = query.trim().toLowerCase();"), 1);
  for (const part of [
    '<label htmlFor={"setting-" + row.key}>',
    "const modified = Object.hasOwn(own, row.key);",
    'aria-label={"Reset " + row.label}',
  ])
    assert.ok(page.includes(part), "SettingsPage still has: " + part);

  // The one style rule: uses theme tokens only, adds nothing else.
  const css = read("src/styles.css");
  const rule = [
    "/* Search highlight in the settings list: the searched words in a row's name and description. */",
    ".setting-copy mark {",
    "  background: var(--surface);",
    "  color: var(--mint);",
    "  border-radius: 2px;",
    "  padding: 0 1px;",
    "}",
    "",
  ].join("\n");
  assert.equal(
    count(css, rule),
    1,
    "the rule is in the stylesheet once, comment and all",
  );
  assert.equal(count(css, ".setting-copy mark"), 1);
  assert.ok(
    css.indexOf(".setting-copy mark {") > css.indexOf(".setting-copy code {"),
    "next to the rest of the row styles, not at the end of the file",
  );
  assert.equal(isAscii(rule), true);
  assert.equal(
    /#[0-9a-fA-F]{3,8}|!important|rgb|url\(/.test(rule),
    false,
    "tokens only",
  );
  assert.equal(count(css, "{"), count(css, "}"), "braces balance");
  assert.ok(css.includes("--surface: var(--color-181a20);"));
  assert.ok(css.includes("--mint: var(--color-a0e3c2);"));
  // The older styles this feature leans on are still there.
  assert.ok(css.includes(".setting-copy > label {"));
  assert.ok(css.includes(".setting-copy p {"));
});

test("settings-view notes: SETTINGS.md has one Search highlight paragraph with every claim and numbers equal to the code's, next to the scope text, and the Transfer and discoverability row names it", () => {
  const doc = read("SETTINGS.md");
  assert.equal(isAscii(doc), true, "SETTINGS.md is ASCII");
  const paragraphs = doc
    .split("\n\n")
    .filter((p) => p.startsWith("Search highlight:"));
  assert.equal(paragraphs.length, 1, "one Search highlight paragraph");
  const p = collapse(paragraphs[0]);
  for (const claim of [
    "while you search, the words you typed are marked in the name and the description of each result row",
    "the key line and the option names are not marked",
    "a row found only by its key or an option shows no mark",
    "matched as text, not as a pattern",
    "characters such as . * ( [ and \\ mean themselves",
    "upper and lower case are the same",
    "drawn as plain text in a highlight, never as markup",
    "Only the first " + lib.MAX_SCAN + " characters of a text are searched",
    "at most " + lib.MAX_MARKS + " marks are drawn in one text",
    "a search longer than " + lib.MAX_QUERY + " characters is not marked",
    "Case is folded one character at a time",
    "a Greek capital sigma at the end of a word",
    "found by the search but not marked",
    "It is display only: it does not change what the search finds, and nothing is saved, changed or sent",
  ])
    assert.ok(p.includes(claim), "SETTINGS.md must say: " + claim);
  const at = doc.indexOf("Search highlight:");
  assert.ok(at > doc.indexOf("Reset category:"));
  assert.ok(at < doc.indexOf("## Settings catalog"), "in the scope section");
  assert.equal(count(doc, "Search highlight:"), 1);
  const row = doc
    .split("\n")
    .filter((line) => line.startsWith("| Transfer and discoverability |"));
  assert.equal(row.length, 1, "one Transfer and discoverability row");
  assert.ok(row[0].includes("search highlighting"));
  assert.ok(row[0].includes("per-category"));
  assert.ok(row[0].includes("a Recently changed filter"));
});
