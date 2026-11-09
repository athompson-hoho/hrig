const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");

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

const { filterCommands, pickFirst } = load("src/palette.ts");

const tools = [
  "Visual workspace arranger",
  "Task boards and integrations",
  "Connection doctor",
  "Attention center",
  "Project tools and text search",
  "Review workspace",
  "Problems",
  "Ports and previews",
  "Rig manager",
  "OpenRig control center",
];

const entries = [
  ["Quick Open project file", "Ctrl P"],
  ["Find open panels", "Ctrl Shift P"],
  ["Save All", "All open files"],
  ["Saved drafts and recovery", "Local recovery storage"],
  ["Open settings", "Preferences and themes"],
  ["Toggle sidebar", "Ctrl B"],
  ["Toggle status bar", "Appearance setting"],
  ["Open welcome guide", "Workspace guide"],
  ...tools.map((name) => [name, "Workspace tool"]),
  ["Undo arrangement", "Layout history"],
  ["Redo arrangement", "Layout history"],
  ["Connect a machine", "WSL / SSH"],
  ["Open project folder", "Ctrl O"],
  ["New shell", "Ctrl Shift T"],
  ["Open all rig sessions", "3 seats"],
  ["Refresh rigs and workspace", "Seats and project files"],
  ["Arrange: Team", "Grid"],
  ["Arrange: Focus", "Tabs"],
  ["Arrange: Review", "Side by side"],
  ["Task queue", "OpenRig"],
  ["Send a message", "OpenRig"],
  ["Workspace activity", "Events"],
  ["Save layout", "Named arrangement"],
  ["Open alpha", "demo-rig"],
  ["Open alpha beside current", "demo-rig · Local"],
  ["Terminal: Focus", "alpha · Local · t1"],
  ["Terminal: Clear", "alpha · Local · t1 · Ctrl Shift K"],
  [
    "Terminal: Reconnect all dropped (2)",
    "Re-attach ended or errored terminals · others untouched",
  ],
];
const catalog = entries.map(([name, hint]) => ({ name, hint }));

const names = (list) => list.map((c) => c.name);
const byName = (name) => catalog.find((c) => c.name === name);

test("palette tracer: toggle sidebar is listed first and Enter picks the same entry", () => {
  assert.deepEqual(names(filterCommands(catalog, "sidebar")), [
    "Toggle sidebar",
  ]);
  const first = filterCommands(catalog, "toggle sidebar")[0];
  assert.equal(first.name, "Toggle sidebar");
  assert.equal(first.hint, "Ctrl B");
  assert.equal(pickFirst(catalog, "toggle sidebar"), first);
  assert.equal(pickFirst(catalog, "sidebar"), byName("Toggle sidebar"));
});

test("palette blank query keeps everything in order", () => {
  for (const query of ["", " ", "  \t "]) {
    const list = filterCommands(catalog, query);
    assert.notEqual(list, catalog);
    assert.equal(list.length, catalog.length);
    list.forEach((entry, i) => assert.equal(entry, catalog[i]));
  }
  assert.equal(pickFirst(catalog, ""), catalog[0]);
  assert.equal(pickFirst(catalog, "  "), catalog[0]);
  assert.equal(pickFirst(catalog, "").name, "Quick Open project file");
  assert.equal(pickFirst([], ""), undefined);
  assert.deepEqual(filterCommands([], "x"), []);
});

test("palette matching ignores case", () => {
  assert.deepEqual(names(filterCommands(catalog, "TOGGLE SIDEBAR")), [
    "Toggle sidebar",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "tOgGlE sIdEbAr")), [
    "Toggle sidebar",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "APPEARANCE")), [
    "Toggle status bar",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "appearance")), [
    "Toggle status bar",
  ]);
  const one = [{ name: "ÄBC", hint: "x" }];
  assert.equal(filterCommands(one, "äbc").length, 1);
});

test("palette every word must appear in the name or the hint", () => {
  assert.deepEqual(names(filterCommands(catalog, "queue task")), [
    "Task queue",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "task boards")), [
    "Task boards and integrations",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "  task   queue  ")), [
    "Task queue",
  ]);
  assert.deepEqual(filterCommands(catalog, "task nonsense"), []);
  assert.equal(pickFirst(catalog, "task nonsense"), undefined);
  assert.deepEqual(names(filterCommands(catalog, "toggle ctrl")), [
    "Toggle sidebar",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "queue openrig")), [
    "Task queue",
  ]);
});

test("palette lists name matches before hint-only matches", () => {
  assert.deepEqual(names(filterCommands(catalog, "workspace")), [
    "Visual workspace arranger",
    "Review workspace",
    "Refresh rigs and workspace",
    "Workspace activity",
    "Open welcome guide",
    "Task boards and integrations",
    "Connection doctor",
    "Attention center",
    "Project tools and text search",
    "Problems",
    "Ports and previews",
    "Rig manager",
    "OpenRig control center",
  ]);
  const open = names(filterCommands(catalog, "open"));
  assert.equal(open[0], "Quick Open project file");
  assert.ok(open.indexOf("Find open panels") < open.indexOf("Save All"));
  const small = [
    { name: "Alpha", hint: "beta" },
    { name: "Beta", hint: "x" },
    { name: "Gamma", hint: "BETA" },
  ];
  assert.deepEqual(names(filterCommands(small, "beta")), [
    "Beta",
    "Alpha",
    "Gamma",
  ]);
});

test("palette existing command names still resolve to themselves first", () => {
  const existing = [
    "Quick Open project file",
    "Find open panels",
    "Save All",
    "Saved drafts and recovery",
    "Open settings",
    "Visual workspace arranger",
    "Task boards and integrations",
    "Connection doctor",
    "Review workspace",
    "Undo arrangement",
    "Redo arrangement",
    "Connect a machine",
    "Open project folder",
    "New shell",
    "Open all rig sessions",
    "Task queue",
    "Send a message",
    "Workspace activity",
    "Save layout",
    "Arrange: Team",
    "Terminal: Clear",
  ];
  assert.equal(existing.length, 21);
  for (const name of existing) {
    assert.equal(filterCommands(catalog, name)[0].name, name, name);
    assert.equal(pickFirst(catalog, name).name, name, name);
  }
  const queue = pickFirst(catalog, "Task queue");
  assert.equal(`${queue.name} ${queue.hint}`, "Task queue OpenRig");
  assert.deepEqual(filterCommands(catalog, "hello.ts"), []);
  assert.deepEqual(filterCommands(catalog, "invalid.json"), []);
});

test("palette list and Enter always agree", () => {
  const queries = [
    "",
    " ",
    "s",
    "t",
    "e",
    "a b",
    "terminal",
    "ctrl",
    "rig",
    "open",
    "open all",
    "workspace",
    "tool",
    "toggle",
    "refresh",
    "welcome",
    "guide",
    "status",
    "alpha",
    "TERMINAL",
    "x y z",
    "Task queue",
    "arrangement",
    "(2)",
    "no-such-command",
  ];
  for (const q of queries) {
    const list = filterCommands(catalog, q);
    assert.equal(pickFirst(catalog, q), list[0], q);
    assert.equal(new Set(list).size, list.length, q);
    for (const entry of list) assert.ok(catalog.includes(entry), q);
  }
  assert.equal(pickFirst(catalog, "no-such-command"), undefined);
});

test("palette keeps entry objects and never changes its input", () => {
  const items = [
    { name: "B one", hint: "h", icon: "i1", action: () => 1 },
    { name: "A two", hint: "h two", icon: "i2", action: () => 2 },
  ];
  const before = items.slice();
  const hit = filterCommands(items, "two")[0];
  assert.equal(hit, items[1]);
  assert.equal(hit.icon, "i2");
  assert.equal(hit.action(), 2);
  assert.equal(items.length, before.length);
  items.forEach((entry, i) => assert.equal(entry, before[i]));

  const frozen = Object.freeze(items.slice());
  assert.doesNotThrow(() => filterCommands(frozen, "h"));
  assert.doesNotThrow(() => filterCommands(frozen, ""));
  assert.equal(pickFirst(frozen, "h").action(), 1);
  assert.deepEqual(
    filterCommands(frozen, "h").map((c) => c.name),
    ["B one", "A two"],
  );
});

test("palette treats query characters as literal text", () => {
  assert.deepEqual(names(filterCommands(catalog, "(2)")), [
    "Terminal: Reconnect all dropped (2)",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "Arrange:")), [
    "Arrange: Team",
    "Arrange: Focus",
    "Arrange: Review",
  ]);
  for (const q of [".*", "[", "(", "\\", "^", "$", "a|b", "+", "?", "{1}"]) {
    assert.doesNotThrow(() => filterCommands(catalog, q), q);
  }
  assert.deepEqual(filterCommands(catalog, ".*"), []);
  assert.deepEqual(filterCommands(catalog, "t.s"), []);
});

test("palette hint text is searchable", () => {
  assert.deepEqual(names(filterCommands(catalog, "ctrl")), [
    "Quick Open project file",
    "Find open panels",
    "Toggle sidebar",
    "Open project folder",
    "New shell",
    "Terminal: Clear",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "wsl")), [
    "Connect a machine",
  ]);
  assert.deepEqual(names(filterCommands(catalog, "layout history")), [
    "Undo arrangement",
    "Redo arrangement",
  ]);
});

test("palette finds the four app commands", () => {
  const expected = [
    ["toggle sidebar", "Toggle sidebar"],
    ["status bar", "Toggle status bar"],
    ["toggle status", "Toggle status bar"],
    ["refresh", "Refresh rigs and workspace"],
    ["refresh rigs", "Refresh rigs and workspace"],
    ["welcome", "Open welcome guide"],
    ["welcome guide", "Open welcome guide"],
    ["guide", "Open welcome guide"],
  ];
  for (const [query, name] of expected) {
    assert.equal(filterCommands(catalog, query)[0].name, name, query);
    assert.equal(pickFirst(catalog, query).name, name, query);
  }
  assert.deepEqual(names(filterCommands(catalog, "toggle")), [
    "Toggle sidebar",
    "Toggle status bar",
  ]);
  for (const [, name] of expected) {
    assert.equal(catalog.filter((c) => c.name === name).length, 1, name);
  }
  const keys = catalog.map((c) => c.name + c.hint);
  assert.equal(new Set(keys).size, keys.length);
});
