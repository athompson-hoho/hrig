const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function bundle(options) {
  const built = buildSync({
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    ...options,
  });
  const mod = new Module("panel-maximize-test", module);
  mod._compile(built.outputFiles[0].text, "panel-maximize-test");
  return mod.exports;
}

// The pure module on its own, and the real layout code with the real
// flexlayout model in one bundle so Actions and Model share one instance.
const pure = bundle({ entryPoints: ["src/panel-maximize.ts"] });
const { planMaximize, withoutMaximized } = pure;
const real = bundle({
  stdin: {
    contents:
      'export * from "./src/layout.ts"; export { Actions, Model } from "flexlayout-react";',
    resolveDir: root,
    sourcefile: "panel-maximize-entry.ts",
    loader: "ts",
  },
});
const { Actions, Model, restoreModel, globalLayout } = real;

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

// A saved layout holds plain JSON; flexlayout adds active and maximized to it.
function plain(json) {
  return JSON.parse(
    JSON.stringify(json, (key, value) =>
      key === "active" || key === "maximized" ? undefined : value,
    ),
  );
}
function twoGroups() {
  return {
    global: globalLayout,
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "left",
          weight: 60,
          selected: 1,
          children: [
            {
              type: "tab",
              id: "t1",
              name: "a.ts",
              component: "editor",
              config: { path: "a.ts" },
            },
            { type: "tab", id: "t2", name: "Shell", component: "terminal" },
          ],
        },
        {
          type: "tabset",
          id: "right",
          weight: 40,
          children: [
            { type: "tab", id: "t3", name: "alpha", component: "terminal" },
          ],
        },
      ],
    },
  };
}
// The same four facts the App reads from the live model before it asks.
function viewOf(model, tabsetId) {
  const tabset = model.getNodeById(tabsetId);
  let groups = 0;
  model.visitNodes((node) => {
    if (
      node.getType() === "tabset" &&
      node.getLayoutId() === tabset.getLayoutId()
    )
      groups++;
  });
  return {
    tabsetId,
    enabled: tabset.isEnableMaximize(),
    groups,
    maximizedId:
      model.getMaximizedTabset(tabset.getLayoutId())?.getId() ?? null,
  };
}

test("panel-maximize tracer: the plan flips one group of the real flexlayout model, hides nothing in the tree and restores the exact layout, through the real App wiring", () => {
  const model = Model.fromJson(twoGroups());
  const before = plain(model.toJson());
  const maximize = planMaximize("maximize", viewOf(model, "right"));
  assert.deepEqual(maximize, {
    action: "toggle",
    tabsetId: "right",
    maximizing: true,
  });
  model.doAction(
    Actions.maximizeToggle(maximize.tabsetId, Model.MAIN_LAYOUT_ID),
  );
  assert.equal(model.getMaximizedTabset().getId(), "right");
  assert.equal(model.getMaximizedTabset().isMaximized(), true);
  assert.equal(model.getNodeById("left").isMaximized(), false);
  assert.deepEqual(plain(model.toJson()), before, "the tree is untouched");
  assert.equal(model.getNodeById("t1").getParent().getId(), "left");
  const json = model.toJson();
  assert.equal(json.layout.children[1].maximized, true);
  assert.equal(json.layout.children[0].maximized, undefined);
  for (const request of ["toggle", "restore"]) {
    assert.deepEqual(planMaximize(request, viewOf(model, "left")), {
      action: "toggle",
      tabsetId: "right",
      maximizing: false,
    });
  }
  const restore = planMaximize("toggle", viewOf(model, "right"));
  model.doAction(
    Actions.maximizeToggle(restore.tabsetId, Model.MAIN_LAYOUT_ID),
  );
  assert.equal(model.getMaximizedTabset(), undefined);
  assert.deepEqual(plain(model.toJson()), before, "restored exactly");
  assert.equal(model.getNodeById("left").getWeight(), 60);
  assert.equal(model.getNodeById("left").getSelected(), 1);
  assert.equal(planMaximize("restore", viewOf(model, "right")).action, "none");

  const app = appText();
  assert.ok(
    has(
      app,
      'import { planMaximize, planOpenInMaximized, type MaximizeRequest, } from "./panel-maximize";',
    ),
  );
  assert.ok(has(app, "TabNode, TabSetNode, type ILayoutApi,"));
  const body = between(
    app,
    "const toggleMaximize = (",
    "const reopenClosedPanel = () => {",
  );
  assert.ok(has(body, "request: MaximizeRequest, source: EventTarget | null"));
  assert.ok(has(body, 'closest?.("[data-panel-id]")'));
  assert.ok(has(body, "model.getActiveTabset() || model.getFirstTabSet()"));
  assert.ok(has(body, "const plan = planMaximize(request, {"));
  assert.ok(
    has(
      body,
      "maximizedId: model.getMaximizedTabset(layoutId)?.getId() ?? null,",
    ),
  );
  assert.ok(has(body, "enabled: !!focused && focused.isEnableMaximize(),"));
  assert.ok(
    has(
      body,
      "const layoutId = focused ? focused.getLayoutId() : Model.MAIN_LAYOUT_ID;",
    ),
    "the group's own layout window, so a detached window works too",
  );
  assert.ok(
    has(
      body,
      "if (node instanceof TabSetNode && node.getLayoutId() === layoutId) groups++;",
    ),
  );
  assert.ok(has(body, "tabsetId: focused ? focused.getId() : null,"));
  assert.ok(
    has(
      body,
      "while (owner && !(owner instanceof TabSetNode)) owner = owner.getParent();",
    ),
  );
  assert.ok(
    has(
      body,
      'if (plan.action === "none") { setToast(plan.message); return; }',
    ),
  );
  assert.ok(
    has(
      body,
      "remember(); model.doAction(Actions.maximizeToggle(plan.tabsetId, layoutId));",
    ),
    "one remembered flip of the flag, like the double-click path",
  );
  assert.equal(count(body, "doAction("), 1);
  for (const word of [
    "fit(",
    "resizeTerminal",
    "dispatchEvent",
    "ResizeObserver",
    "setTimeout",
    "requestAnimationFrame",
    "window.hrig",
    "writeTerminal",
    "createTerminal",
    "closeTerminal",
    "sendTerminalCommand",
    "Escape",
    "Actions.moveNode",
    "Actions.addTab",
    "Actions.deleteTab",
    "Actions.updateNodeAttributes",
    "setModel(",
    "Model.fromJson",
    "toJson(",
  ]) {
    assert.ok(
      !body.includes(word),
      "the maximize function must not use " + word,
    );
  }
  assert.equal(count(app, 'name: "Maximize panel",'), 1);
  assert.equal(count(app, 'name: "Restore panel layout",'), 1);
  assert.ok(has(app, 'action: () => toggleMaximize("maximize", null),'));
  assert.ok(has(app, 'action: () => toggleMaximize("restore", null),'));
});

test("panel-maximize plan: only toggle or none, restore always targets the maximized group, maximize needs a focused group that allows it and another group to hide", () => {
  const requests = [
    "toggle",
    "maximize",
    "restore",
    "",
    "undo",
    null,
    undefined,
    5,
  ];
  const tabsets = ["a", "", null, undefined, 7, "x".repeat(4097)];
  const enabled = [true, false, "yes", undefined];
  const groups = [0, 1, 2, 3, -1, 1.5, NaN, "2", undefined, Infinity];
  const maximized = [null, "a", "b", "", undefined, 7];
  let checked = 0;
  let toggles = 0;
  const validId = (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 4096;
  for (const request of requests)
    for (const tabsetId of tabsets)
      for (const enable of enabled)
        for (const group of groups)
          for (const maximizedId of maximized) {
            const view = deepFreeze({
              tabsetId,
              enabled: enable,
              groups: group,
              maximizedId,
            });
            const plan = planMaximize(request, view);
            const label = JSON.stringify([request, view]);
            checked++;
            assert.deepEqual(
              view,
              { tabsetId, enabled: enable, groups: group, maximizedId },
              "the view is never changed",
            );
            if (plan.action === "none") {
              assert.deepEqual(
                Object.keys(plan).sort(),
                ["action", "message"],
                label,
              );
              assert.ok(
                typeof plan.message === "string" && plan.message.endsWith("."),
                label,
              );
              const complete =
                validId(tabsetId) &&
                enable === true &&
                Number.isInteger(group) &&
                group >= 2;
              if (request === "restore" || request === "toggle")
                assert.ok(!validId(maximizedId), label);
              if (
                (request === "maximize" || request === "toggle") &&
                !validId(maximizedId)
              )
                assert.ok(
                  !complete,
                  "a complete view must produce a toggle: " + label,
                );
              continue;
            }
            toggles++;
            assert.deepEqual(
              Object.keys(plan).sort(),
              ["action", "maximizing", "tabsetId"],
              label,
            );
            assert.equal(plan.action, "toggle", label);
            if (plan.maximizing) {
              assert.ok(request === "toggle" || request === "maximize", label);
              assert.ok(!validId(maximizedId), label);
              assert.equal(plan.tabsetId, tabsetId, label);
              assert.ok(validId(tabsetId), label);
              assert.equal(enable, true, label);
              assert.ok(Number.isInteger(group) && group >= 2, label);
            } else {
              assert.ok(request === "toggle" || request === "restore", label);
              assert.equal(plan.tabsetId, maximizedId, label);
              assert.ok(validId(maximizedId), label);
            }
          }
  assert.equal(
    checked,
    requests.length *
      tabsets.length *
      enabled.length *
      groups.length *
      maximized.length,
  );
  assert.ok(
    toggles > 500,
    "the sweep reaches both kinds of toggle: " + toggles,
  );

  const ready = { tabsetId: "a", enabled: true, groups: 2, maximizedId: null };
  const on = { ...ready, maximizedId: "b" };
  assert.deepEqual(planMaximize("toggle", ready), {
    action: "toggle",
    tabsetId: "a",
    maximizing: true,
  });
  assert.deepEqual(planMaximize("maximize", ready), {
    action: "toggle",
    tabsetId: "a",
    maximizing: true,
  });
  assert.deepEqual(planMaximize("toggle", on), {
    action: "toggle",
    tabsetId: "b",
    maximizing: false,
  });
  assert.deepEqual(planMaximize("restore", on), {
    action: "toggle",
    tabsetId: "b",
    maximizing: false,
  });
  assert.deepEqual(planMaximize("restore", { ...on, tabsetId: null }), {
    action: "toggle",
    tabsetId: "b",
    maximizing: false,
  });
  assert.match(planMaximize("restore", ready).message, /Nothing is maximized/);
  assert.match(
    planMaximize("maximize", on).message,
    /already maximized.*Restore panel layout/,
  );
  assert.match(
    planMaximize("maximize", { ...ready, groups: 1 }).message,
    /Only one panel group/,
  );
  assert.match(
    planMaximize("maximize", { ...ready, enabled: false }).message,
    /cannot be maximized/,
  );
  assert.match(
    planMaximize("maximize", { ...ready, tabsetId: null }).message,
    /Click a panel first/,
  );
  assert.match(planMaximize("sideways", ready).message, /Nothing to do/);
  for (const bad of [null, undefined, 7, "x", [], {}]) {
    assert.equal(planMaximize("toggle", bad).action, "none");
    assert.equal(planMaximize("restore", bad).action, "none");
    assert.equal(planMaximize("maximize", bad).action, "none");
  }
  assert.notEqual(planMaximize("toggle", ready), planMaximize("toggle", ready));

  // The module is data in, data out: nothing it can reach could touch a layout or a PTY.
  assert.deepEqual(Object.keys(pure).sort(), [
    "planMaximize",
    "planOpenInMaximized",
    "withoutMaximized",
  ]);
  const source = read("src/panel-maximize.ts");
  assert.ok(!/[^\x20-\x7e\n]/.test(source), "ASCII only");
  assert.ok(
    !/\b(?:import|require|window|document|React|hrig|Date|performance|setTimeout|fetch|localStorage|Actions|Model)\b|Math\.random|export default/.test(
      stripComments(source),
    ),
    "the module must stay pure",
  );
});

test("panel-maximize is a session-only view state: withoutMaximized and restoreModel drop the flag and nothing else, the library facts it relies on hold, and no other restore path exists", () => {
  const stored = deepFreeze({
    global: { tabSetEnableMaximize: true },
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "a",
          maximized: true,
          active: true,
          children: [
            { type: "tab", id: "t", config: { maximized: true, path: "a.ts" } },
          ],
        },
        { type: "tabset", id: "b", children: [] },
        { type: "row", maximized: true, children: [] },
      ],
    },
    subLayouts: {
      w1: {
        layout: {
          type: "row",
          children: [{ type: "tabset", maximized: true, children: [] }],
        },
      },
    },
  });
  const cleaned = withoutMaximized(stored);
  assert.notEqual(cleaned, stored);
  assert.notEqual(cleaned.layout.children, stored.layout.children);
  assert.equal(cleaned.layout.children[0].maximized, undefined);
  assert.equal("maximized" in cleaned.layout.children[0], false);
  assert.equal(cleaned.layout.children[0].active, true);
  assert.equal(cleaned.layout.children[0].children[0].config.maximized, true);
  assert.equal(
    cleaned.layout.children[2].maximized,
    true,
    "only tab sets lose the key",
  );
  assert.equal("maximized" in cleaned.subLayouts.w1.layout.children[0], false);
  assert.deepEqual(cleaned.layout.children[1], stored.layout.children[1]);
  assert.deepEqual(
    withoutMaximized(cleaned),
    cleaned,
    "applying it twice changes nothing",
  );
  assert.equal(
    stored.layout.children[0].maximized,
    true,
    "the input is never changed",
  );
  for (const value of [null, undefined, 0, 7, "text", true]) {
    assert.equal(withoutMaximized(value), value);
  }
  assert.deepEqual(withoutMaximized([{ type: "tabset", maximized: true }, 3]), [
    { type: "tabset" },
    3,
  ]);

  // The library really writes the flag and reads it back; that is why the strip exists.
  const model = Model.fromJson(twoGroups());
  const before = plain(model.toJson());
  model.doAction(Actions.maximizeToggle("right", Model.MAIN_LAYOUT_ID));
  const json = JSON.parse(JSON.stringify(model.toJson()));
  assert.equal(json.layout.children[1].maximized, true);
  assert.equal(Model.fromJson(json).getMaximizedTabset().getId(), "right");
  const restored = restoreModel(json);
  assert.equal(restored.getMaximizedTabset(), undefined);
  assert.deepEqual(
    plain(restored.toJson()),
    before,
    "nothing but the flag is dropped",
  );
  assert.equal(restored.getNodeById("right").isEnableMaximize(), true);
  restored.doAction(Actions.maximizeToggle("left", Model.MAIN_LAYOUT_ID));
  assert.equal(
    restored.getMaximizedTabset().getId(),
    "left",
    "it can be maximized again",
  );
  assert.ok(
    restoreModel(undefined).getNodeById("welcome"),
    "no stored layout still gives the welcome tab",
  );

  // Closing the last tab of the maximized group clears the flag by itself.
  const closing = Model.fromJson(json);
  closing.doAction(Actions.deleteTab("t3"));
  assert.equal(closing.getMaximizedTabset(), undefined);
  assert.deepEqual(
    closing.toJson().layout.children.map((c) => c.id),
    ["left"],
  );
  // A lone group accepts the toggle too, which is why the plan refuses it.
  const lone = Model.fromJson({
    global: globalLayout,
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "only",
          children: [{ type: "tab", id: "x", name: "X", component: "editor" }],
        },
      ],
    },
  });
  assert.equal(viewOf(lone, "only").groups, 1);
  assert.equal(planMaximize("toggle", viewOf(lone, "only")).action, "none");
  lone.doAction(Actions.maximizeToggle("only", Model.MAIN_LAYOUT_ID));
  assert.equal(lone.getMaximizedTabset().getId(), "only");

  // Source pins: the strip is the single restore choke point and the built-in stays on.
  const layoutSource = tight(stripComments(read("src/layout.ts")));
  assert.ok(
    has(layoutSource, 'import { withoutMaximized } from "./panel-maximize";'),
  );
  assert.equal(count(layoutSource, "...withoutMaximized(json),"), 1);
  assert.equal(count(layoutSource, "tabSetEnableMaximize: true,"), 1);
  assert.ok(has(layoutSource, "global: { ...globalLayout, ...json.global },"));
  const app = appText();
  assert.equal(
    count(app, "Model.fromJson("),
    2,
    "undo and the first panel; every stored layout goes through restoreModel",
  );
  assert.equal(count(app, "restoreModel("), 3);
  assert.ok(
    has(app, "const next = Model.fromJson(json, model);"),
    "undo keeps the exact snapshot",
  );
  const sources = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name));
  for (const name of sources) {
    const text = stripComments(read("src/" + name));
    assert.ok(
      !/enableMaximize:\s*false/i.test(text),
      name + " must not turn the built-in maximize off",
    );
  }
  assert.ok(
    sources.includes("panel-maximize.ts") && sources.length > 40,
    "the module sits next to the others",
  );
});

test("panel-maximize double-click: the built-in maximize stays on, a tab still renames, the empty tab strip maximizes through the app's own action hook, and the app adds no header handler", () => {
  const lib = path.join(root, "node_modules", "flexlayout-react");
  const version = JSON.parse(
    fs.readFileSync(path.join(lib, "package.json"), "utf8"),
  ).version;
  assert.match(
    version,
    /^0\.11\./,
    "flexlayout-react changed to " +
      version +
      ": check double-click, rename and the maximize flag again",
  );
  const dist = collapse(
    fs.readFileSync(path.join(lib, "dist", "index.js"), "utf8"),
  );
  assert.ok(
    dist.includes(
      "const onDoubleClick = (event) => { if (tabNode.isEnableRename()) { onRename(); event.stopPropagation(); } };",
    ),
    "a double-click on a tab renames it and goes no further",
  );
  assert.ok(
    dist.includes(
      "const onDoubleClick = (_event) => { if (tabsetNode.canMaximize()) controller.maximize(tabsetNode); };",
    ),
    "a double-click that reaches the strip maximizes the group",
  );
  assert.ok(
    dist.includes(
      '"data-layout-path": path + "/tabstrip", onPointerDown, onDoubleClick,',
    ),
    "the strip carries that handler",
  );
  assert.ok(
    dist.includes(
      "maximize(tabsetNode) { this.doAction(Actions.maximizeToggle(tabsetNode.getId(), this.getLayoutId())); }",
    ),
    "the double-click flips the same flag the chord flips",
  );
  assert.ok(
    dist.includes(
      "const outcome = this._props.onAction(action); if (outcome !== void 0) return this._props.model.doAction(outcome);",
    ),
    "a double-click goes through the app onAction hook",
  );
  assert.ok(
    dist.includes(
      "const changeListener = { onAfterAction: controller.onModelChange };",
    ),
    "a direct model action reaches onModelChange too, so the chord path is saved like the double-click",
  );

  const app = appText();
  const hook = between(
    app,
    "const onAction = (action: Action) => {",
    "if (action.type === Actions.DELETE_TAB) {",
  );
  assert.ok(has(hook, "Actions.MAXIMIZE_TOGGLE,"));
  assert.ok(
    has(hook, ") remember();"),
    "a flip is remembered for Undo arrangement",
  );
  assert.equal(
    count(app, "Actions.maximizeToggle("),
    3,
    "the navigator, the new function and the open-in-maximized restore are the only direct flips",
  );
  assert.ok(
    has(
      app,
      "activeModel.doAction(Actions.maximizeToggle(maximized.getId()));",
    ),
    "Find open panels still restores before it selects a hidden panel",
  );
  assert.equal(count(app, "onAction={onAction}"), 1);
  assert.equal(count(app, "onModelChange={modelChanged}"), 1);
  assert.equal(count(app, "onDoubleClick"), 0);
  assert.equal(count(app, "onAuxMouseClick"), 0);
  const strip = between(
    app,
    "onRenderTabSet={(node, values) => {",
    "onTabSetPlaceHolder={",
  );
  assert.ok(
    !/onDoubleClick|maximize/i.test(strip),
    "the tab strip callback adds no maximize handler",
  );
  const tab = between(
    app,
    "onRenderTab={(node, values) => {",
    "onRenderTabSet={(node, values) => {",
  );
  assert.ok(
    !/onDoubleClick|maximize/i.test(tab),
    "the tab callback leaves rename alone",
  );

  const layoutSource = tight(stripComments(read("src/layout.ts")));
  assert.equal(count(layoutSource, "tabSetEnableMaximize: true,"), 1);
  assert.equal(count(layoutSource, "tabEnableRename: true,"), 1);
  assert.ok(!layoutSource.includes("enableMaximize: false"));
  assert.match(
    read("README.md"),
    /Double-click a tab-group background to maximize or restore it/,
  );
});

test("panel-maximize adds no resize traffic: the terminal still ignores a zero-size host, hidden groups are display none, and no new call can reach a PTY", () => {
  const terminal = tight(stripComments(read("src/TerminalPanel.tsx")));
  assert.ok(
    has(
      terminal,
      "if ( host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0 ) { fit.fit(); if (connected) window.hrig.resizeTerminal(id, term.cols, term.rows); }",
    ),
    "a host with no size is never fitted or resized",
  );
  assert.equal(count(terminal, "new ResizeObserver("), 1);
  assert.equal(count(terminal, "window.hrig.resizeTerminal("), 2);
  const sources = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort();
  const callers = sources.filter((name) =>
    stripComments(read("src/" + name)).includes("hrig.resizeTerminal("),
  );
  assert.deepEqual(
    callers,
    ["TerminalPanel.tsx"],
    "no other file resizes a PTY",
  );
  const layoutSource = tight(stripComments(read("src/layout.ts")));
  assert.equal(
    count(layoutSource, "tabEnableRenderOnDemand: false,"),
    1,
    "terminals stay mounted while their group is hidden: no remount, no new attach",
  );
  const lib = path.join(root, "node_modules", "flexlayout-react");
  const dist = collapse(
    fs.readFileSync(path.join(lib, "dist", "index.js"), "utf8"),
  );
  assert.ok(
    dist.includes(
      'element.style.display = visible ? "" : "none"; node.setRect(rect); node.setVisible(visible);',
    ),
    "a panel of a hidden group gets display none",
  );
  assert.ok(
    dist.includes(
      "if (this._props.model.getMaximizedTabset(this._layoutId) !== void 0 && !parent.isMaximized()) visible = false;",
    ),
    "every panel outside the maximized group is hidden that way",
  );
  const app = appText();
  const body = between(
    app,
    "const toggleMaximize = (",
    "const reopenClosedPanel = () => {",
  );
  assert.equal(count(body, "doAction("), 1);
  assert.ok(
    !/fit\(|resizeTerminal|ResizeObserver|dispatchEvent|setTimeout/.test(body),
  );
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  assert.ok(
    !/fit\(|resizeTerminal|ResizeObserver|dispatchEvent|setTimeout/.test(
      handler,
    ),
  );
});

test("panel-maximize chord, Escape and docs: the shortcut is claimed before the generic chords, acts only with no dialog open, never touches Escape, and NAVIGATION.md says what it does", () => {
  const DOT = String.fromCharCode(183);
  const app = appText();
  assert.ok(
    has(
      app,
      'import { isMaximizePanelKey, maximizeShortcutHint } from "./shortcuts";',
    ),
  );
  assert.ok(
    has(
      app,
      "hint: `Fill the workspace with the focused group " +
        DOT +
        " ${maximizeShortcutHint(window.hrig.platform)}`,",
    ),
  );
  assert.ok(
    has(
      app,
      "hint: `Show every panel group again " +
        DOT +
        " ${maximizeShortcutHint(window.hrig.platform)}`,",
    ),
  );
  const handler = between(
    app,
    "const handler = (event: KeyboardEvent) => {",
    "const windows = [",
  );
  const order = [
    "if (isHelpKey(",
    "if (isReopenPanelKey(event, window.hrig.platform)) {",
    "if (isMaximizePanelKey(event, window.hrig.platform)) {",
    "if (event.ctrlKey || event.metaKey) {",
  ].map((needle) => handler.indexOf(tight(needle)));
  assert.ok(
    order[0] >= 0 &&
      order[0] < order[1] &&
      order[1] < order[2] &&
      order[2] < order[3],
    "claim order: " + order,
  );
  assert.ok(
    has(
      handler,
      'if (isMaximizePanelKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) toggleMaximize("toggle", event.target); return; }',
    ),
  );
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
      'if (event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); openShell(); }',
    ),
  );
  assert.ok(
    has(
      handler,
      "if (isReopenPanelKey(event, window.hrig.platform)) { event.preventDefault(); event.stopPropagation(); if (modal === null && !hasOpenDialog(event.target)) reopenClosedPanel(); return; }",
    ),
    "Reopen closed panel is untouched",
  );
  assert.equal(
    count(app, "toggleMaximize("),
    4,
    "two commands, the chord and the rebound chord",
  );
  assert.equal(
    count(app, '"Escape"'),
    1,
    "no new Escape handler: Escape never restores",
  );
  assert.equal(
    count(app, 'addEventListener("keydown"'),
    2,
    "no second key handler",
  );
  const branch = between(
    handler,
    "if (isMaximizePanelKey(event, window.hrig.platform)) {",
    "if (event.ctrlKey || event.metaKey) {",
  );
  assert.ok(!/Escape/.test(branch));
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort();
  assert.deepEqual(
    files.filter((name) =>
      stripComments(read("src/" + name)).includes("isMaximizePanelKey("),
    ),
    ["App.tsx", "shortcuts.ts"],
  );
  assert.deepEqual(
    files.filter((name) =>
      stripComments(read("src/" + name)).includes("planMaximize("),
    ),
    ["App.tsx", "panel-maximize.ts"],
  );

  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff);
  assert.ok(raw.startsWith(String.fromCharCode(0xfeff) + "# Project"));
  const lines = raw.split("\n");
  const mine = lines.filter((line) =>
    line.startsWith("Double-click the empty part of a panel group's tab strip"),
  );
  assert.equal(mine.length, 1);
  assert.equal(
    lines.filter((line) =>
      line.startsWith("The command center entry Reopen closed panel"),
    ).length,
    1,
    "the reopen paragraph is still there",
  );
  assert.equal(lines.at(-1), "", "the file ends with one line feed");
  assert.ok(
    lines.indexOf(mine[0]) >
      lines.findIndex((line) =>
        line.startsWith("The command center entry Reopen closed panel"),
      ),
    "the maximize paragraph follows the reopen paragraph",
  );
  for (const fragment of [
    "press Ctrl+Shift+M (Cmd+Shift+M on macOS)",
    "choose Maximize panel in the command center",
    "make that group fill the workspace",
    "hidden, not closed",
    "their terminals keep running",
    "every tab, size and arrangement is kept exactly as it was",
    "double-clicking the strip again, pressing the same shortcut or choosing Restore panel layout brings back the previous layout",
    "Double-clicking a tab still renames it",
    "the maximize button in the group's toolbar works as before",
    "Escape never restores",
    "With only one group open there is nothing to hide, and a short message says so",
    "a view state for the current session and is not saved with the layout",
    "after a restart, when you switch projects and come back, or when you apply a saved or role layout, every group is visible again",
    "A new panel opens in the maximized group",
    "only selected there until you restore the layout",
    "Find open panels restores the layout first",
    "ignored while a dialog is open and does not repeat while held",
    "in a terminal it replaces Ctrl+Shift+M, which no longer reaches the shell",
    "plain Ctrl+M, including Monaco's Tab key moves focus toggle in the editor, is unchanged",
    "terminals in hidden groups are left alone; nothing is typed or sent",
  ]) {
    assert.ok(
      mine[0].includes(fragment),
      "NAVIGATION.md is missing: " + fragment,
    );
  }
});

test("planOpenInMaximized restores only when the new tab would land in a hidden group, never throws, and the open path calls it", () => {
  const { planOpenInMaximized } = pure;
  assert.equal(
    planOpenInMaximized({ maximizedId: null, targetId: "a" }),
    "keep",
  );
  assert.equal(
    planOpenInMaximized({ maximizedId: "a", targetId: "a" }),
    "keep",
  );
  assert.equal(
    planOpenInMaximized({ maximizedId: "a", targetId: "b" }),
    "restore",
  );
  assert.equal(
    planOpenInMaximized({ maximizedId: "a", targetId: null }),
    "keep",
  );
  for (const bad of [
    null,
    undefined,
    0,
    "x",
    [],
    {},
    { maximizedId: 5, targetId: {} },
    { maximizedId: "", targetId: "b" },
  ])
    assert.equal(planOpenInMaximized(bad), "keep");
  const app = appText();
  const open = between(
    app,
    "const addPanel = (",
    "modelChanged(model); setRecentPanels",
  );
  assert.ok(open.includes("planOpenInMaximized("));
  assert.ok(
    open.indexOf("planOpenInMaximized(") <
      open.indexOf("addTabToActiveTabSet("),
  );
});
