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
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};

function bundle(entry, external = []) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
    logLevel: "silent",
  });
  return built.outputFiles[0].text;
}
function load(entry, fakes = {}) {
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const pure = () => load("src/host-tint.ts");
// A tiny react: a context is a box, useContext reads the box, jsx records elements.
const fakeReact = {
  createContext: (value) => ({ value, Provider: {} }),
  useContext: (context) => context.value,
};
const fakeJsx = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: "fragment",
};
const ui = () =>
  load("src/HostTint.tsx", { react: fakeReact, "react/jsx-runtime": fakeJsx });
const char = (code) => String.fromCharCode(code);

test("host-tint tracer: a saved tint flows from the workspace file through the loader and the real header helpers, and with nothing saved the header is untouched", () => {
  const tint = pure();
  const view = ui();
  // A saved workspace as the main process hands it back: hostile entries included.
  const saved = JSON.parse(
    JSON.stringify({
      version: 1,
      hostTints: {
        "ssh:prod-db": { label: "  PROD  ", color: "red", extra: "<script>" },
        "ssh:dev-box": { label: "dev" },
        "wsl:Ubuntu": { color: "green" },
        "ssh:bad": { label: char(7) + char(0x202e), color: "javascript:red" },
        "ssh:junk": "red",
        "ssh:list": ["red"],
        "": { label: "empty id" },
      },
    }).replace('"hostTints":{', '"hostTints":{"__proto__":{"color":"blue"},'),
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(saved.hostTints, "__proto__"),
    "the hostile own __proto__ key really reached the parsed state",
  );
  const tints = tint.normalizeHostTints(saved.hostTints);
  assert.deepEqual(tints, {
    "ssh:prod-db": { label: "PROD", color: "red" },
    "ssh:dev-box": { label: "dev" },
    "wsl:Ubuntu": { color: "green" },
  });
  assert.equal(
    Object.getPrototypeOf(tints),
    Object.prototype,
    "no inherited tint",
  );

  // The provider hands the saved map to every terminal header through the context.
  view.HostTintContext.value = tints;
  const prod = view.useHostTint({ id: "ssh:prod-db", name: "Prod DB" });
  assert.deepEqual(prod, { label: "PROD", color: "red" });
  assert.deepEqual(view.hostTintStyle(prod), { "--host-tint": "#d64545" });
  const label = view.HostTintLabel({ tint: prod });
  assert.equal(label.type, "span");
  assert.equal(label.props.className, "host-tint-label");
  assert.equal(label.props.children, "PROD");
  assert.equal(label.props.title, "Host label: PROD");

  const dev = view.useHostTint({ id: "ssh:dev-box" });
  assert.deepEqual(dev, { label: "dev" });
  assert.equal(
    view.hostTintStyle(dev),
    undefined,
    "a label alone adds no style",
  );
  assert.equal(view.HostTintLabel({ tint: dev }).props.children, "dev");

  const green = view.useHostTint({ id: "wsl:Ubuntu" });
  assert.deepEqual(view.hostTintStyle(green), { "--host-tint": "#3fa66b" });
  assert.equal(view.HostTintLabel({ tint: green }), null, "no label, no badge");

  // Default off: no map, an empty map, an unknown connection, a damaged map.
  for (const value of [undefined, null, {}, [], "red", 7]) {
    view.HostTintContext.value = value;
    const none = view.useHostTint({ id: "ssh:prod-db" });
    assert.equal(none, null, "map " + JSON.stringify(value));
    assert.equal(view.hostTintStyle(none), undefined);
    assert.equal(view.HostTintLabel({ tint: none }), null);
  }
  view.HostTintContext.value = tints;
  assert.equal(view.useHostTint({ id: "local" }), null);
  assert.equal(view.useHostTint({ id: "constructor" }), null);
  assert.equal(view.useHostTint(null), null);
  assert.equal(view.useHostTint({ id: 5 }), null);

  // Even a map that never went through the loader cannot inject a color or a control character.
  view.HostTintContext.value = {
    x: { color: "red; background: url(x)", label: "x" + char(10) + "y" },
  };
  const rough = view.useHostTint({ id: "x" });
  assert.deepEqual(rough, { label: "xy" });
  assert.equal(view.hostTintStyle(rough), undefined);

  // The real terminal header uses exactly these helpers.
  const panel = stripComments(read("src/TerminalPanel.tsx"));
  assert.ok(panel.includes('from "./HostTint";'), "the panel imports HostTint");
  assert.equal(count(panel, "useHostTint(config.connection)"), 1);
});

test("host-tint list: a bounded label and palette resolver that cleans, caps, ignores junk and never trusts inherited keys", () => {
  const t = pure();
  assert.equal(t.MAX_TINT_LABEL, 24);
  assert.equal(t.MAX_HOST_TINTS, 64);
  assert.equal(t.MAX_TINT_KEY, 150);
  const names = Object.keys(t.TINT_COLORS);
  assert.deepEqual(names, ["red", "amber", "green", "blue", "violet", "gray"]);
  for (const name of names)
    assert.match(t.TINT_COLORS[name], /^#[0-9a-f]{6}$/, name);
  assert.equal(new Set(Object.values(t.TINT_COLORS)).size, names.length);

  // Labels.
  const clean = t.cleanTintLabel;
  assert.equal(clean("PROD"), "PROD");
  assert.equal(clean("  dev   box  "), "dev box");
  assert.equal(
    clean("a" + char(0) + "b" + char(7) + "c" + char(127) + char(0x9f)),
    "abc",
  );
  assert.equal(
    clean("one" + char(10) + "two" + char(13) + char(9) + "three"),
    "onetwothree",
  );
  assert.equal(clean(char(0x202e) + "dorp" + char(0x202c)), "dorp");
  assert.equal(
    clean(
      "a" + char(0x200b) + char(0x200d) + char(0xfeff) + "b" + char(0x2028),
    ),
    "ab",
  );
  assert.equal(clean("x".repeat(24)), "x".repeat(24));
  assert.equal(clean("x".repeat(25)), "x".repeat(24));
  assert.equal(clean("x".repeat(400)).length, 24);
  assert.equal(
    clean("x".repeat(23) + " yyyy"),
    "x".repeat(23),
    "no dangling space after the cut",
  );
  const smile = String.fromCodePoint(0x1f600);
  assert.equal(
    Array.from(clean(smile.repeat(30))).length,
    24,
    "counted in characters",
  );
  assert.equal(
    clean(smile.repeat(30)),
    smile.repeat(24),
    "never cuts a pair in half",
  );
  assert.equal(
    clean("caf" + char(0xe9)),
    "caf" + char(0xe9),
    "plain letters survive",
  );
  for (const bad of [
    undefined,
    null,
    5,
    true,
    {},
    [],
    ["a"],
    () => "a",
    "",
    "   ",
    char(10),
  ])
    assert.equal(clean(bad), "", String(bad));

  // One entry.
  const one = t.normalizeHostTint;
  assert.deepEqual(one({ label: " Prod ", color: "red" }), {
    label: "Prod",
    color: "red",
  });
  assert.deepEqual(one({ label: "Prod" }), { label: "Prod" });
  assert.deepEqual(one({ color: "violet" }), { color: "violet" });
  assert.deepEqual(one({ label: "ok", color: "pink" }), { label: "ok" });
  assert.deepEqual(one({ label: "", color: "gray", other: 1 }), {
    color: "gray",
  });
  for (const name of [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
    "RED",
    "Red",
    "#d64545",
    "red ",
    "",
  ])
    assert.equal(one({ color: name }), null, "color " + JSON.stringify(name));
  for (const bad of [
    null,
    undefined,
    0,
    "red",
    true,
    [],
    [{ color: "red" }],
    {},
    { label: 5 },
    { color: 5 },
    { label: char(7) },
  ])
    assert.equal(one(bad), null, JSON.stringify(bad));

  // The whole map.
  assert.deepEqual(t.normalizeHostTints(undefined), {});
  for (const bad of [null, 5, "x", true, [], [{ label: "a" }]])
    assert.deepEqual(t.normalizeHostTints(bad), {}, JSON.stringify(bad));
  const long = "k".repeat(150);
  const kept = t.normalizeHostTints({
    [long]: { color: "red" },
    ["k".repeat(151)]: { color: "red" },
    "": { color: "red" },
    constructor: { color: "blue" },
    toString: { label: "ts" },
    ok: { label: "fine" },
  });
  assert.deepEqual(
    Object.keys(kept).sort(),
    [long, "constructor", "ok", "toString"].sort(),
  );
  const parsed = JSON.parse(
    '{"__proto__":{"color":"red"},"a":{"color":"red"}}',
  );
  const safe = t.normalizeHostTints(parsed);
  assert.deepEqual(Object.keys(safe), ["a"]);
  assert.equal(Object.getPrototypeOf(safe), Object.prototype);
  assert.equal(safe.color, undefined, "nothing leaked onto the prototype");
  const many = {};
  for (let i = 0; i < 100; i++) many["c" + i] = { label: "n" + i };
  const capped = t.normalizeHostTints(many);
  assert.equal(Object.keys(capped).length, 64);
  assert.ok("c0" in capped && "c63" in capped && !("c64" in capped));
  const frozen = Object.freeze({
    a: Object.freeze({ label: " x ", color: "red" }),
  });
  assert.deepEqual(t.normalizeHostTints(frozen), {
    a: { label: "x", color: "red" },
  });
  assert.deepEqual(
    frozen.a,
    { label: " x ", color: "red" },
    "the input is never changed",
  );
  const once = t.normalizeHostTints(many);
  assert.deepEqual(
    t.normalizeHostTints(once),
    once,
    "normalizing twice changes nothing",
  );

  // Resolve: only the connection's own saved entry.
  const map = JSON.parse(
    '{"prod":{"label":"P","color":"red"},"__proto__":{"label":"inherited"}}',
  );
  assert.deepEqual(t.resolveHostTint({ id: "prod" }, map), {
    label: "P",
    color: "red",
  });
  for (const id of [
    "dev",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
    "",
    7,
    null,
    undefined,
  ])
    assert.equal(t.resolveHostTint({ id }, map), null, String(id));
  for (const conn of [null, undefined, "prod", 5, [], {}, { name: "prod" }])
    assert.equal(t.resolveHostTint(conn, map), null, JSON.stringify(conn));
  for (const bad of [null, undefined, "x", 5, [], [1]])
    assert.equal(
      t.resolveHostTint({ id: "prod" }, bad),
      null,
      JSON.stringify(bad),
    );
  assert.equal(
    t.resolveHostTint({ id: "prod" }, { prod: { color: "nope" } }),
    null,
  );
  const inherited = Object.create({
    shared: { label: "inherited", color: "red" },
  });
  inherited.own = { label: "own" };
  assert.deepEqual(t.resolveHostTint({ id: "own" }, inherited), {
    label: "own",
  });
  assert.equal(
    t.resolveHostTint({ id: "shared" }, inherited),
    null,
    "an entry that only the prototype holds is not the connection's own",
  );

  // Set.
  const base = Object.freeze({ a: Object.freeze({ label: "A" }) });
  const added = t.setHostTint(base, "b", { label: " B ", color: "blue" });
  assert.deepEqual(added, {
    a: { label: "A" },
    b: { label: "B", color: "blue" },
  });
  assert.notEqual(added, base);
  assert.deepEqual(
    base,
    { a: { label: "A" } },
    "the input map is never changed",
  );
  assert.deepEqual(t.setHostTint(added, "a", { color: "gray" }), {
    a: { color: "gray" },
    b: { label: "B", color: "blue" },
  });
  for (const empty of [
    {},
    null,
    undefined,
    { label: "  " },
    { color: "nope" },
    "red",
  ])
    assert.deepEqual(
      t.setHostTint(added, "a", empty),
      { b: { label: "B", color: "blue" } },
      JSON.stringify(empty),
    );
  assert.deepEqual(t.setHostTint(undefined, "z", { color: "amber" }), {
    z: { color: "amber" },
  });
  assert.deepEqual(t.setHostTint({ a: { label: "A" } }, "never", {}), {
    a: { label: "A" },
  });
  for (const id of ["", "x".repeat(151), "__proto__", 5, null, undefined])
    assert.deepEqual(
      t.setHostTint(base, id, { color: "red" }),
      { a: { label: "A" } },
      String(id),
    );
  assert.deepEqual(
    Object.keys(t.setHostTint(base, "k".repeat(150), { color: "red" })).length,
    2,
  );
  let full = {};
  for (let i = 0; i < 64; i++)
    full = t.setHostTint(full, "c" + i, { label: "n" + i });
  assert.equal(Object.keys(full).length, 64);
  assert.deepEqual(
    t.setHostTint(full, "extra", { color: "red" }),
    full,
    "a 65th connection is refused",
  );
  assert.equal(
    t.setHostTint(full, "c7", { color: "red" }).c7.color,
    "red",
    "an existing one can still change",
  );
  assert.equal(
    Object.keys(t.setHostTint(full, "c7", {})).length,
    63,
    "and be removed",
  );
  assert.equal(
    Object.keys(
      t.setHostTint(t.setHostTint(full, "c7", {}), "extra", { color: "red" }),
    ).length,
    64,
  );

  // The color of a tint.
  assert.equal(t.tintColor({ color: "red" }), "#d64545");
  for (const name of names)
    assert.equal(t.tintColor({ color: name }), t.TINT_COLORS[name]);
  for (const bad of [
    null,
    undefined,
    {},
    { label: "x" },
    { color: "constructor" },
    { color: "Red" },
    { color: 5 },
  ])
    assert.equal(t.tintColor(bad), null, JSON.stringify(bad));

  // A seeded walk against a plain model: set, clear and resolve over 80 ids so the cap is reached.
  let seed = 20261108;
  const next = (n) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const inputs = [
    [
      { label: "PROD", color: "red" },
      { label: "PROD", color: "red" },
    ],
    [
      { label: "  dev  box ", color: "green" },
      { label: "dev box", color: "green" },
    ],
    [{ label: "x".repeat(40) }, { label: "x".repeat(24) }],
    [{ color: "blue" }, { color: "blue" }],
    [{ label: char(7) + "t" + char(10) }, { label: "t" }],
    [{ label: "", color: "pink" }, null],
    [{}, null],
    [null, null],
    [{ label: "ok", color: "constructor" }, { label: "ok" }],
  ];
  for (let run = 0; run < 150; run++) {
    let map = {};
    const model = new Map();
    for (let step = 0; step < 40; step++) {
      const id = "id" + next(80);
      const [input, expected] = inputs[next(inputs.length)];
      const before = JSON.stringify(map);
      const out = t.setHostTint(map, id, input);
      assert.equal(JSON.stringify(map), before, "never mutates");
      if (expected === null) model.delete(id);
      else if (model.has(id) || model.size < 64) model.set(id, expected);
      map = out;
      assert.equal(Object.keys(map).length, model.size);
      for (const [key, tintValue] of model)
        assert.deepEqual(t.resolveHostTint({ id: key }, map), tintValue);
      assert.deepEqual(
        t.normalizeHostTints(map),
        map,
        "always already normalized",
      );
    }
  }
});

test("host-tint wiring: the tint lives in the saved workspace state and the terminal header only, never on a Connection, in a setting, in the main process or in the terminal", () => {
  // The pure module: ASCII, imports nothing, touches nothing outside its arguments.
  const source = read("src/host-tint.ts");
  assert.ok(!/[^\n -~]/.test(source), "module is printable ASCII");
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
    "indexedDB",
    "async",
    "await",
    "class",
  ])
    assert.ok(
      !new RegExp("\\b" + word + "\\b").test(code),
      "module avoids " + word,
    );
  assert.ok(!/Math\.random|export default/.test(code));
  assert.deepEqual(
    Object.keys(pure()).sort(),
    [
      "MAX_HOST_TINTS",
      "MAX_TINT_KEY",
      "MAX_TINT_LABEL",
      "TINT_COLORS",
      "cleanTintLabel",
      "normalizeHostTint",
      "normalizeHostTints",
      "resolveHostTint",
      "setHostTint",
      "tintColor",
    ].sort(),
  );
  assert.ok(
    !source.includes(String.fromCharCode(92) + "u"),
    "no escape sequences in the module",
  );

  // The render helpers: only react and the module; no bridge, storage or terminal access.
  const viewSource = read("src/HostTint.tsx");
  assert.ok(!/[^\n -~]/.test(viewSource), "helpers are printable ASCII");
  const view = tight(stripComments(viewSource));
  const imports = [...view.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["react", "./host-tint"]);
  assert.ok(
    !/localStorage|sessionStorage|window\.|hrig|saveState|writeTerminal|document\./.test(
      view,
    ),
  );
  assert.deepEqual(Object.keys(ui()).sort(), [
    "HostTintContext",
    "HostTintLabel",
    "hostTintStyle",
    "useHostTint",
  ]);

  // The header: default markup is exactly today's, the tint only adds a class, a variable and a label.
  const panel = tight(stripComments(read("src/TerminalPanel.tsx")));
  assert.equal(
    count(panel, "const hostTint = useHostTint(config.connection);"),
    1,
  );
  assert.equal(
    count(
      panel,
      'className={hostTint?.color ? "session-toolbar host-tinted" : "session-toolbar"} style={hostTintStyle(hostTint)}',
    ),
    1,
  );
  assert.equal(count(panel, '<div className="session-toolbar">'), 0);
  assert.equal(count(panel, "<HostTintLabel tint={hostTint} />"), 1);
  const connection = between(
    panel,
    '<span className="session-connection">',
    "</span>",
  );
  assert.ok(
    connection.includes(
      "{config.connection.name} <HostTintLabel tint={hostTint} />",
    ),
  );
  const leftover = panel
    .replace(
      'import { HostTintLabel, hostTintStyle, useHostTint } from "./HostTint";',
      "",
    )
    .replace("const hostTint = useHostTint(config.connection);", "")
    .replace(
      'className={hostTint?.color ? "session-toolbar host-tinted" : "session-toolbar"} style={hostTintStyle(hostTint)}',
      "",
    )
    .replace("<HostTintLabel tint={hostTint} />", "");
  assert.ok(
    !/hosttint/i.test(leftover),
    "the panel mentions the tint nowhere else (not in terminal, theme or write code)",
  );

  // The state: one optional field on the workspace, repaired by the normalizer wherever it is read.
  const types = stripComments(read("src/types.ts"));
  assert.equal(count(types, 'hostTints?: import("./host-tint").HostTints;'), 1);
  const connectionType = between(types, "export interface Connection {", "}");
  const panelType = between(types, "export interface PanelConfig {", "}");
  assert.ok(
    !/tint|label|color/i.test(connectionType + panelType),
    "no tint on Connection or PanelConfig",
  );
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(
    count(app, 'import { normalizeHostTints } from "./host-tint";'),
    1,
  );
  assert.equal(count(app, 'import { HostTintContext } from "./HostTint";'), 1);
  assert.equal(
    count(
      app,
      "const hostTints = useMemo(() => normalizeHostTints(state.hostTints), [state.hostTints],);",
    ),
    1,
    "the saved map is repaired every time it is read, like the preferences and the project history",
  );
  const loader = between(
    app,
    ".then(([saved, found]) => {",
    ".catch((e) => setBootError",
  );
  assert.ok(
    !/hostTint/i.test(loader),
    "the workspace load callback is untouched",
  );
  assert.ok(
    app.includes(
      '<SettingsContext.Provider value={settingsContext}> <HostTintContext.Provider value={hostTints}> <div className="app"',
    ),
  );
  assert.ok(
    app.includes("</HostTintContext.Provider> </SettingsContext.Provider>"),
  );
  assert.equal(count(app, "<HostTintContext.Provider"), 1);

  // The stylesheet: a header inset shadow and a small label; nothing that moves or recolors terminal content.
  const css = read("src/styles.css");
  const accent = between(css, ".session-toolbar.host-tinted {", "}");
  assert.equal(
    collapse(accent),
    ".session-toolbar.host-tinted { box-shadow: inset 0 2px 0 0 var(--host-tint);",
  );
  const badge = between(css, ".host-tint-label {", "}");
  assert.ok(
    !/(^|[\s;{])(position|height|width|margin|background|transform|float|display)\s*:/.test(
      badge,
    ),
    "the label does not move or recolor anything",
  );
  assert.ok(!/xterm|terminal-host|terminal-stage/.test(accent + badge));

  // Never reaches the main process, a setting or the shared connection check.
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs)$/.test(file))
      assert.ok(
        !/hostTint|host-tint/i.test(read("electron/" + file)),
        "main process: " + file,
      );
  assert.ok(!/tint/i.test(read("src/settings.ts")), "no setting");
  for (const file of fs.readdirSync(path.join(root, "src")))
    if (
      /^(Sidebar|SettingsPage|SettingsContext|RigControl|terminal-.*)\.(ts|tsx)$/.test(
        file,
      )
    )
      assert.ok(
        !/hostTint|host-tint/i.test(read("src/" + file)),
        "not in " + file,
      );
});

// A small react runtime: useState keeps slots and a state change renders again at once.
function dialogHarness(connections, tints, extra = {}) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  const calls = { saved: [], closed: 0 };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
          render();
        },
      ];
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Dialog = load("src/HostTintDialog.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal" },
  }).default;
  const props = {
    connections,
    tints,
    onSave: (next) => calls.saved.push(next),
    onClose: () => {
      calls.closed++;
    },
    ...extra,
  };
  function render() {
    cursor = 0;
    tree = Dialog(props);
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
  const find = (type, label) =>
    all(tree).find(
      (n) => n.type === type && (!label || n.props["aria-label"] === label),
    );
  const button = (text) =>
    all(tree).find((n) => n.type === "button" && n.props.children === text);
  return {
    calls,
    tree: () => tree,
    all: () => all(tree),
    find,
    button,
    value: (type, label) => find(type, label).props.value,
    set: (type, label, value) =>
      find(type, label).props.onChange({ target: { value } }),
  };
}

test("host-tint dialog: the real dialog lists every connection, keeps edits to itself until Save and saves only clean labels and palette colors", () => {
  const connections = [
    { id: "local", name: "This computer", kind: "local", root: "." },
    { id: "ssh:prod", name: "Prod DB", kind: "ssh", host: "prod", root: "~" },
    { id: "ssh:dev", name: "Dev box", kind: "ssh", host: "dev", root: "~" },
  ];
  const saved = Object.freeze({
    "ssh:prod": Object.freeze({ label: "PROD", color: "red" }),
    "ssh:gone": Object.freeze({ label: "old", color: "gray" }),
  });
  const d = dialogHarness(connections, saved);

  // One row per connection, filled from what is saved; nothing set shows empty.
  assert.equal(d.tree().type, "Modal");
  assert.equal(d.tree().props.title, "Host label and tint");
  assert.equal(typeof d.tree().props.onClose, "function");
  const inputs = d.all().filter((n) => n.type === "input");
  const selects = d.all().filter((n) => n.type === "select");
  assert.deepEqual(
    inputs.map((n) => n.props["aria-label"]),
    ["Label for This computer", "Label for Prod DB", "Label for Dev box"],
  );
  assert.deepEqual(
    selects.map((n) => n.props["aria-label"]),
    ["Tint for This computer", "Tint for Prod DB", "Tint for Dev box"],
  );
  assert.deepEqual(
    inputs.map((n) => n.props.value),
    ["", "PROD", ""],
  );
  assert.deepEqual(
    selects.map((n) => n.props.value),
    ["", "red", ""],
  );
  for (const input of inputs) assert.equal(input.props.maxLength, 24);
  const options = d
    .all()
    .filter((n) => n.type === "option" && n.props.value !== "")
    .slice(0, 6)
    .map((n) => n.props.value);
  assert.deepEqual(options, Object.keys(pure().TINT_COLORS));
  assert.equal(
    d.all().filter((n) => n.type === "option" && n.props.value === "").length,
    3,
    "each row can choose no tint",
  );
  assert.deepEqual(
    d
      .all()
      .filter((n) => n.type === "option")
      .slice(0, 7)
      .map((n) => n.props.children),
    ["No tint", "Red", "Amber", "Green", "Blue", "Violet", "Gray"],
  );

  // Typing changes the row, not the saved map: nothing is saved until Save.
  d.set("input", "Label for Dev box", "  QA  ");
  d.set("select", "Tint for Dev box", "amber");
  assert.equal(d.value("input", "Label for Dev box"), "  QA  ");
  assert.equal(d.value("select", "Tint for Dev box"), "amber");
  assert.equal(d.calls.saved.length, 0);
  assert.equal(d.calls.closed, 0);

  // Save writes the cleaned map and keeps the tint of a connection that is no longer listed.
  d.button("Save").props.onClick();
  assert.equal(d.calls.saved.length, 1);
  assert.deepEqual(d.calls.saved[0], {
    "ssh:prod": { label: "PROD", color: "red" },
    "ssh:gone": { label: "old", color: "gray" },
    "ssh:dev": { label: "QA", color: "amber" },
  });
  assert.deepEqual(
    saved["ssh:prod"],
    { label: "PROD", color: "red" },
    "the saved map prop is never changed",
  );

  // Clearing a row removes it; a hostile label and an unknown color are never saved.
  const e = dialogHarness(connections, saved);
  e.set("input", "Label for Prod DB", "");
  e.set("select", "Tint for Prod DB", "");
  e.set(
    "input",
    "Label for This computer",
    "L" + char(7) + "o" + char(0x202e) + "cal",
  );
  e.set("select", "Tint for This computer", "red; background: url(x)");
  e.set("input", "Label for Dev box", "x".repeat(60));
  e.button("Save").props.onClick();
  assert.deepEqual(e.calls.saved[0], {
    "ssh:gone": { label: "old", color: "gray" },
    local: { label: "Local" },
    "ssh:dev": { label: "x".repeat(24) },
  });

  // Saving without a change keeps every saved entry; Cancel saves nothing and just closes.
  const f = dialogHarness(connections, saved);
  f.button("Save").props.onClick();
  assert.deepEqual(f.calls.saved[0], {
    "ssh:prod": { label: "PROD", color: "red" },
    "ssh:gone": { label: "old", color: "gray" },
  });
  const g = dialogHarness(connections, undefined);
  assert.deepEqual(
    g
      .all()
      .filter((n) => n.type === "input")
      .map((n) => n.props.value),
    ["", "", ""],
  );
  g.set("input", "Label for Prod DB", "PROD");
  g.button("Cancel").props.onClick();
  assert.equal(g.calls.saved.length, 0);
  assert.equal(g.calls.closed, 1);
  g.button("Save").props.onClick();
  g.calls.saved.length = 0;
  const h = dialogHarness(connections, undefined);
  h.button("Save").props.onClick();
  assert.deepEqual(
    h.calls.saved[0],
    {},
    "an untouched dialog on a fresh install saves an empty map",
  );

  // The dialog source: the pure helpers and the shared Modal only; no bridge, storage or terminal access.
  const source = read("src/HostTintDialog.tsx");
  assert.ok(!/[^\n -~]/.test(source), "dialog is printable ASCII");
  const code = tight(stripComments(source));
  assert.deepEqual(
    [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
    ["react", "./components", "./host-tint", "./types"],
  );
  assert.ok(
    !/localStorage|sessionStorage|window\.|hrig|saveState|writeTerminal|sendTerminalCommand|document\./.test(
      code,
    ),
  );
  assert.equal(count(code, "maxLength={MAX_TINT_LABEL}"), 1);

  // The App: one palette command, one modal kind, and Save writes the map into the workspace state.
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(count(app, '| "hostTint" | null;'), 1);
  assert.equal(count(app, 'import HostTintDialog from "./HostTintDialog";'), 1);
  assert.equal(count(app, 'name: "Set host label and tint"'), 1);
  assert.ok(
    app.includes(
      'hint: "Mark production or development hosts in terminal headers", icon: <Network size={16} />, action: openHostTint }',
    ),
  );
  assert.ok(
    app.includes(
      'const openHostTint = () => { projectIntent.current++; setModal("hostTint"); };',
    ),
  );
  const block = between(
    app,
    '{modal === "hostTint" && (',
    '{modal === "guide" && (',
  );
  assert.equal(
    collapse(block),
    '{modal === "hostTint" && (<HostTintDialog connections={state.connections} tints={hostTints} onSave={(next) => { setState((s) => ({ ...s, hostTints: next })); setModal(null); notify("Host labels and tints saved"); }} onClose={() => setModal(null)} />)}',
  );
  assert.equal(
    count(app, "hostTints: next"),
    1,
    "the workspace state gets the tints in one place",
  );
  assert.ok(
    !/window\.hrig\.[a-zA-Z]+\(/.test(block),
    "saving calls nothing outside the state",
  );
});

test("host-tint docs: TERMINALS.md and SETTINGS.md say it is opt-in, header only, saved per connection and not a setting", () => {
  for (const file of ["TERMINALS.md", "SETTINGS.md"]) {
    const text = read(file);
    assert.ok(text.charCodeAt(0) !== 0xfeff, file + " has no byte order mark");
    assert.ok(
      text.endsWith("\n") && !text.endsWith("\n\n"),
      file + " ends with one line feed",
    );
    assert.ok(!text.includes("\r"), file + " has no carriage return");
  }
  const lines = (file) => read(file).split("\n");

  const terminals = lines("TERMINALS.md");
  const at = terminals.findIndex((l) =>
    l.startsWith("Host label and tint is off until you set one"),
  );
  assert.ok(at > 0, "TERMINALS.md has the paragraph");
  assert.equal(
    terminals.filter((l) => l.startsWith("Host label and tint")).length,
    1,
  );
  assert.ok(
    terminals[at - 1] === "" && terminals[at + 1] === "",
    "blank lines around it",
  );
  assert.ok(
    terminals[at - 2].startsWith("Seat terminals show the seat name"),
    "right after the seat header paragraph",
  );
  assert.ok(
    terminals[at + 2].startsWith(
      "Command center lists Focus, Clear, Find, Reconnect",
    ),
    "right before the command center paragraph",
  );
  assert.ok(!/[^ -~]/.test(terminals[at]), "the paragraph is printable ASCII");
  for (const part of [
    "is off until you set one, and it changes nothing else",
    "Run Set host label and tint in the command center",
    "short label (up to " + pure().MAX_TINT_LABEL + " characters",
    "red, amber, green, blue, violet or gray",
    "shows the label beside the connection name in its header",
    "a thin colored line along the top of the header",
    "Only the header changes: terminal text, colors and size, the panel layout and the tab titles stay as they are",
    "the header keeps its height",
    "choose No tint to remove it",
    "saved per connection in HRig's workspace file, not in the settings and not in the Settings export",
    "never sent to a terminal, a host or a seat",
    "a connection with nothing set looks exactly as before",
    "HRig does not guess which host is production; you choose.",
  ])
    assert.ok(terminals[at].includes(part), "TERMINALS.md must say: " + part);

  const settings = lines("SETTINGS.md");
  const row = settings.findIndex((l) =>
    l.startsWith("Host label and tint: there is no settings row for it."),
  );
  assert.ok(row > 0, "SETTINGS.md has the paragraph");
  assert.equal(
    settings.filter((l) => l.includes("Host label and tint")).length,
    1,
  );
  assert.ok(settings[row - 1] === "" && settings[row + 1] === "");
  assert.ok(
    settings[row - 2].startsWith("Terminal bell: `terminal.bellStyle`"),
    "after the bell paragraph",
  );
  assert.ok(
    settings[row + 2].startsWith("## Follow-up ideas"),
    "before the follow-up ideas",
  );
  for (const part of [
    "not in the table above, not in the user or project scopes and not in the Settings JSON export or import",
    "Run Set host label and tint in the command center",
    "saved under `hostTints` in workspace.json, keyed by connection ID",
    "a connection without one is not marked at all",
    "See TERMINALS.md",
  ])
    assert.ok(settings[row].includes(part), "SETTINGS.md must say: " + part);
  assert.ok(!/[^ -~]/.test(settings[row]));
  // No setting was added: the catalog has no tint key and the settings module never mentions one.
  assert.ok(!settings.some((l) => /^\| `[a-z.]*[tT]int[a-zA-Z.]*` \|/.test(l)));
  assert.ok(!/tint/i.test(read("src/settings.ts")));
});
