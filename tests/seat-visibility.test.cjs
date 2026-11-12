"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const core = require("../electron/core.cjs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const count = (text, part) => text.split(part).length - 1;
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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
// A tiny jsx runtime: an element is { type, props }, and a function component is called by the test.
const fakeJsx = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: "fragment",
};
// The two icons are told apart by identity.
const fakeIcons = { Eye: function Eye() {}, EyeOff: function EyeOff() {} };
const lib = load("src/seat-visibility.ts");
const ui = load("src/HiddenSeats.tsx", {
  "react/jsx-runtime": fakeJsx,
  "lucide-react": fakeIcons,
});
const activity = load("src/terminal-seat-activity.ts").terminalSeatActivity;
const kids = (element) =>
  [].concat(element.props.children).filter((child) => child);

const seat = (id, status, rigId = "r1") => ({
  id,
  name: id,
  status,
  rigId,
  rigName: rigId,
  runtime: "codex",
  model: "",
  session: null,
});
const ALL = [
  "working",
  "idle",
  "running",
  "attention",
  "failed",
  "stopped",
  "exited",
  "unknown",
  "",
];

test("seat-visibility rules: stopped and exited seats are hidden, a failed seat or one that needs input never is, a seat of an archived rig is hidden, and turning it off hands back the same array", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "hiddenCount",
    "hiddenSeatsText",
    "isStoppedSeat",
    "seatCountText",
    "visibleSeats",
  ]);
  for (const status of ALL)
    assert.equal(
      lib.isStoppedSeat({ status }),
      status === "stopped" || status === "exited",
      JSON.stringify(status),
    );
  // The same two statuses the terminal's seat activity shows as Stopped, and only failed is Stopped there as well and still kept.
  for (const status of [...ALL, "new-state", "Stopped", "EXITED"]) {
    const stopped = activity({ status }, true).label === "Stopped";
    assert.equal(
      lib.isStoppedSeat({ status }),
      stopped && status !== "failed",
      status,
    );
  }
  // Anything that is not a seat with a text status is not stopped, and nothing throws.
  for (const value of [
    undefined,
    null,
    0,
    "stopped",
    true,
    [],
    ["stopped"],
    {},
    { status: undefined },
    { status: null },
    { status: 5 },
    { status: ["stopped"] },
    { status: { toString: () => "stopped" } },
    { status: Symbol("stopped") },
    { status: " stopped" },
  ])
    assert.equal(lib.isStoppedSeat(value), false);
  assert.equal(lib.isStoppedSeat(), false);

  const seats = ALL.map((status, i) => seat("s" + i, status));
  const rigs = [{ id: "r1", name: "one", status: "running", nodeCount: 9 }];
  // Off: the very same array.
  assert.equal(lib.visibleSeats(seats, rigs, false), seats);
  assert.equal(lib.visibleSeats(seats, undefined, false), seats);
  assert.equal(lib.visibleSeats([], rigs, false).length, 0);
  // On: only the two stopped statuses leave, the order stays and the input is not changed.
  const frozen = Object.freeze(seats.map((s) => Object.freeze(s)));
  const shown = lib.visibleSeats(frozen, rigs, true);
  assert.notEqual(shown, frozen);
  assert.deepEqual(
    shown.map((s) => s.status),
    ["working", "idle", "running", "attention", "failed", "unknown", ""],
  );
  assert.equal(frozen.length, ALL.length);
  assert.equal(lib.hiddenCount(frozen, rigs), 2);
  assert.equal(lib.visibleSeats([], rigs, true).length, 0);

  // A rig the inventory calls archived hides its seats, even a running one; a stopped seat in it counts once; a failed seat or one that needs input stays whatever its rig.
  const archived = [
    { id: "r1", name: "live", status: "running", nodeCount: 1 },
    { id: "r2", name: "old", status: "archived", nodeCount: 2 },
  ];
  const mixed = [
    seat("a", "working", "r1"),
    seat("b", "working", "r2"),
    seat("c", "stopped", "r2"),
    seat("d", "stopped", "r1"),
    seat("e", "failed", "r1"),
    seat("f", "attention", "r2"),
    seat("g", "idle", "elsewhere"),
    { ...seat("h", "idle"), rigId: undefined },
  ];
  assert.deepEqual(
    lib.visibleSeats(mixed, archived, true).map((s) => s.id),
    ["a", "e", "f", "g", "h"],
  );
  assert.equal(lib.hiddenCount(mixed, archived), 3);
  // A seat whose rig is not listed, or has no rig id, is kept; and with no rig list only the stopped ones go.
  for (const none of [undefined, null, [], "r2", {}, 7])
    assert.deepEqual(
      lib.visibleSeats(mixed, none, true).map((s) => s.id),
      ["a", "b", "e", "f", "g", "h"],
    );
  // Rig entries that are not rigs, and ids that are not text, change nothing; only the exact status counts.
  const junk = [
    null,
    undefined,
    "r2",
    7,
    { id: 2, status: "archived" },
    { status: "archived" },
    { id: "r2", status: "Archived" },
    { id: "r2", status: ["archived"] },
  ];
  assert.equal(lib.visibleSeats(mixed, junk, true).length, 6);
  assert.equal(lib.hiddenCount(mixed, junk), 2);
  // The toggle does not change what is counted as hidden.
  assert.equal(lib.hiddenCount(mixed, archived), 3);
  // Not an array: nothing to list, nothing hidden, no throw.
  for (const value of [undefined, null, 5, "abc", {}]) {
    assert.deepEqual(lib.visibleSeats(value, archived, true), []);
    assert.deepEqual(lib.visibleSeats(value, archived, false), []);
    assert.equal(lib.hiddenCount(value, archived), 0);
  }
  // Seats that are not objects are kept and never throw.
  const odd = [null, undefined, 5, "stopped", seat("z", "stopped")];
  assert.equal(lib.visibleSeats(odd, archived, true).length, 4);
  assert.equal(lib.hiddenCount(odd, archived), 1);
  // The two views always add up: shown plus hidden is every seat.
  for (const list of [seats, mixed, odd, []])
    for (const rigList of [rigs, archived, junk, undefined])
      assert.equal(
        lib.visibleSeats(list, rigList, true).length +
          lib.hiddenCount(list, rigList),
        list.length,
      );
});

test("seat-visibility counts: the count reads shown of total only while hiding, never shows more than the total, and the empty list says how many are hidden", () => {
  assert.equal(lib.seatCountText(5, 5, false), "5");
  assert.equal(lib.seatCountText(2, 5, false), "5");
  assert.equal(lib.seatCountText(0, 0, false), "0");
  assert.equal(lib.seatCountText(3, 5, true), "3 of 5");
  assert.equal(lib.seatCountText(5, 5, true), "5 of 5");
  assert.equal(lib.seatCountText(0, 4, true), "0 of 4");
  assert.equal(lib.seatCountText(0, 0, true), "0 of 0");
  // More shown than the total cannot be said.
  assert.equal(lib.seatCountText(9, 5, true), "5 of 5");
  // Numbers that are not whole counts become whole counts.
  assert.equal(lib.seatCountText(2.9, 5.9, true), "2 of 5");
  for (const bad of [NaN, Infinity, -Infinity, -3, "4", null, undefined, {}]) {
    assert.equal(lib.seatCountText(bad, bad, true), "0 of 0");
    assert.equal(lib.seatCountText(bad, bad, false), "0");
    assert.equal(lib.seatCountText(bad, 4, true), "0 of 4");
    assert.equal(lib.seatCountText(2, bad, true), "0 of 0");
  }
  assert.equal(lib.hiddenSeatsText(1), "1 stopped session is hidden");
  assert.equal(lib.hiddenSeatsText(2), "2 stopped sessions are hidden");
  assert.equal(lib.hiddenSeatsText(12), "12 stopped sessions are hidden");
  assert.equal(lib.hiddenSeatsText(0), "0 stopped sessions are hidden");
  assert.equal(lib.hiddenSeatsText(2.7), "2 stopped sessions are hidden");
  for (const bad of [NaN, -1, "3", null, undefined, Infinity])
    assert.equal(lib.hiddenSeatsText(bad), "0 stopped sessions are hidden");
  // The text and the filter agree on the same seats.
  const seats = [
    seat("a", "working"),
    seat("b", "stopped"),
    seat("c", "exited"),
    seat("d", "failed"),
  ];
  const shown = lib.visibleSeats(seats, [], true);
  assert.equal(lib.seatCountText(shown.length, seats.length, true), "2 of 4");
  assert.equal(
    lib.hiddenSeatsText(lib.hiddenCount(seats, [])),
    "2 stopped sessions are hidden",
  );
});

test("seat-visibility tracer: an inventory from the CLI is filtered, counted and explained, and a rig that was archived hides its seats", () => {
  const data = core.normalizeInventory(
    [
      { rigId: "r1", name: "factory", status: "running", nodeCount: 5 },
      { rigId: "r2", name: "old", status: "archived", nodeCount: 1 },
    ],
    [
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "busy",
        sessionStatus: "running",
        terminalActive: true,
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "quiet",
        sessionStatus: "stopped",
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "gone",
        sessionStatus: "exited",
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "broken",
        startupStatus: "failed",
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "asking",
        needsAttention: true,
        sessionStatus: "stopped",
      },
      {
        rigId: "r2",
        rigName: "old",
        logicalId: "relic",
        sessionStatus: "running",
      },
    ],
  );
  // The statuses the sidebar really gets.
  assert.deepEqual(
    data.seats.map((s) => [s.name, s.status]),
    [
      ["busy", "working"],
      ["quiet", "stopped"],
      ["gone", "exited"],
      ["broken", "attention"],
      ["asking", "attention"],
      ["relic", "running"],
    ],
  );
  assert.equal(data.rigs[1].status, "archived");
  // Off: every row, the same array, the plain total.
  assert.equal(lib.visibleSeats(data.seats, data.rigs, false), data.seats);
  assert.equal(
    lib.seatCountText(data.seats.length, data.seats.length, false),
    "6",
  );
  // On: the stopped and exited ones and the archived rig's seat go; a failed one and one that asks stay.
  const shown = lib.visibleSeats(data.seats, data.rigs, true);
  assert.deepEqual(
    shown.map((s) => s.name),
    ["busy", "broken", "asking"],
  );
  assert.equal(lib.hiddenCount(data.seats, data.rigs), 3);
  assert.equal(
    lib.seatCountText(shown.length, data.seats.length, true),
    "3 of 6",
  );
  // Narrowed by a rig first (as the sidebar does), the count is of that rig's rows only.
  const factory = data.seats.filter((s) => s.rigId === "r1");
  assert.equal(lib.hiddenCount(factory, data.rigs), 2);
  assert.equal(
    lib.seatCountText(
      lib.visibleSeats(factory, data.rigs, true).length,
      factory.length,
      true,
    ),
    "3 of 5",
  );
  // Only stopped ones: the list is empty and says why, with a way back.
  const stopped = data.seats.filter(
    (s) => s.status === "stopped" || s.status === "exited",
  );
  assert.equal(lib.visibleSeats(stopped, data.rigs, true).length, 0);
  const notice = ui.HiddenSeatsNotice({
    count: lib.hiddenCount(stopped, data.rigs),
    onShow() {},
  });
  assert.equal(
    kids(notice).find((c) => c.type === "h4").props.children,
    "2 stopped sessions are hidden",
  );
});

test("seat-visibility component: the toggle keeps its name and says its state with aria-pressed, the tooltip says what a click does, and the notice names the count and offers the way back", () => {
  let toggled = 0;
  const off = ui.HideStoppedButton({
    hiding: false,
    onToggle: () => (toggled += 1),
  });
  assert.equal(off.type, "button");
  assert.deepEqual(Object.keys(off.props).sort(), [
    "aria-label",
    "aria-pressed",
    "children",
    "onClick",
    "title",
    "type",
  ]);
  assert.equal(off.props.type, "button");
  assert.equal(off.props["aria-pressed"], false);
  assert.equal(off.props["aria-label"], "Hide stopped sessions");
  assert.equal(off.props.title, "Hide stopped sessions");
  assert.equal(off.props.children.type, fakeIcons.Eye);
  off.props.onClick();
  assert.equal(toggled, 1);

  const on = ui.HideStoppedButton({
    hiding: true,
    onToggle: () => (toggled += 10),
  });
  assert.equal(on.props["aria-pressed"], true);
  assert.equal(on.props["aria-label"], "Hide stopped sessions");
  assert.equal(on.props.title, "Show stopped sessions");
  assert.equal(on.props.children.type, fakeIcons.EyeOff);
  on.props.onClick();
  assert.equal(toggled, 11);

  let shown = 0;
  const notice = ui.HiddenSeatsNotice({ count: 3, onShow: () => (shown += 1) });
  assert.equal(notice.type, "div");
  assert.equal(notice.props.className, "connection-empty");
  assert.equal(notice.props.role, "status");
  assert.deepEqual(Object.keys(notice.props).sort(), [
    "children",
    "className",
    "role",
  ]);
  const list = kids(notice);
  assert.deepEqual(
    list.map((c) => (typeof c.type === "string" ? c.type : "icon")),
    ["icon", "h4", "p", "button"],
  );
  assert.equal(list[0].type, fakeIcons.EyeOff);
  assert.equal(list[1].props.children, "3 stopped sessions are hidden");
  assert.equal(
    ui
      .HiddenSeatsNotice({ count: 1, onShow() {} })
      .props.children.find((c) => c.type === "h4").props.children,
    "1 stopped session is hidden",
  );
  const text = list[2].props.children.replace(/\s+/g, " ");
  assert.ok(
    text.includes(
      "Failed sessions and sessions that need input are always shown",
    ),
  );
  assert.equal(list[3].props.className, "small-button");
  assert.equal(list[3].props.children, "Show stopped sessions");
  assert.equal(
    Object.keys(list[3].props).sort().join(),
    "children,className,onClick",
  );
  list[3].props.onClick();
  assert.equal(shown, 1);
});

test("seat-visibility wiring: the setting is off by default and sits after the reopen setting, the sidebar filters after its own filter and writes only the user scope, the count and notice are drawn from the pure module, and the stylesheet rules are the two small ones", () => {
  const key = "workspace.hideStoppedSeats";
  const settings = load("src/settings.ts");
  assert.equal(settings.defaults[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "workspace.restoreLastProject");
  const order = Object.keys(settings.defaults);
  assert.equal(order[order.indexOf(key) - 1], "workspace.restoreLastProject");
  assert.equal(
    keys[keys.indexOf("workspace.restoreLastProject") - 1],
    "workspace.refreshInterval",
  );
  assert.equal(settings.schema[keys.indexOf(key)].category, "Workspace");
  assert.deepEqual(settings.validateOverrides({ [key]: true }), {
    [key]: true,
  });
  for (const value of ["true", 1, null, {}])
    assert.throws(() => settings.validateOverrides({ [key]: value }));
  assert.equal(keys[keys.length - 1], "shortcuts.overrides");

  const raw = stripComments(read("src/Sidebar.tsx"));
  const sidebar = raw.replace(/\s+/g, " ");
  assert.equal(
    count(
      sidebar,
      'import { HiddenSeatsNotice, HideStoppedButton } from "./HiddenSeats";',
    ),
    1,
  );
  assert.equal(
    count(
      sidebar,
      'import { hiddenCount, seatCountText, visibleSeats } from "./seat-visibility";',
    ),
    1,
  );
  // The existing filter keeps its own const, untouched, and the new one composes after it.
  const own = sidebar.indexOf("const statusSeats = filterSeatsByStatus(searchResult.seats, statusFilter);"); // the search and status filters of the long-list chain
  const hide = sidebar.indexOf(
    'const hideStopped = settings.user?.["workspace.hideStoppedSeats"] === true;',
  );
  assert.ok(own > 0 && hide > own);
  assert.equal(count(sidebar, "const hideStopped = "), 1);
  assert.equal(
    count(
      sidebar,
      "visibleSeats(statusSeats, rigs, hideStopped),", // inside the sort and pin partition of the long-list chain
    ),
    1,
  );
  assert.equal(
    count(
      sidebar,
      "const hiddenSeats = hideStopped ? hiddenCount(statusSeats, rigs) : 0;",
    ),
    1,
  );
  assert.equal(
    count(
      sidebar,
      'settings.update("user", "workspace.hideStoppedSeats", value)',
    ),
    1,
  );
  assert.equal(count(sidebar, 'update("project"'), 0);
  assert.equal(count(sidebar, "workspace.hideStoppedSeats"), 2);
  // The label, the list and the empty states.
  assert.ok(
    /<span title="[^"]*">SESSIONS<\/span> <span className="section-tools"> <span className="count"> \{seatCountText\(seats\.length, statusSeats\.length, hideStopped\)\} <\/span> <HideStoppedButton hiding=\{hideStopped\} onToggle=\{\(\) => setHideStopped\(!hideStopped\)\} \/> <\/span> <\/div>/.test(
      sidebar,
    ),
    "the SESSIONS label",
  );
  // The list is the long-list chain's windowed list over the already filtered seats; the notice branch follows it.
  assert.equal(count(sidebar, ") : seats.length ? ("), 1);
  assert.equal(count(sidebar, "<VirtualList rows={sessionRows}"), 1);
  assert.ok(
    /\) : hiddenSeats \? \( <HiddenSeatsNotice count=\{hiddenSeats\} onShow=\{\(\) => setHideStopped\(false\)\} \/> \) : \( <div className="connection-empty"> <Bot size=\{26\} \/> <h4>\{busy \? "Discovering seats\u2026" : "No seats yet"\}<\/h4>/.test(
      sidebar,
    ),
    "the notice comes before the old empty state, which stays",
  );
  // Nothing else about a seat row, a drag or a relaunch changed.
  for (const part of [
    "onDragStart={(event) => onDrag(event, s)}",
    "onClick={() => onSeat(s)}",
    "onClick={() => onRelaunch(s)}",
    "onClick={() => onSeatBeside(s)}",
  ])
    assert.equal(count(sidebar, part), 1, part);

  // The modules: the notice and toggle are the only users of the pure text, the sidebar the only user of both.
  const names = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(
    names
      .filter((name) => /\.\/seat-visibility"/.test(read("src/" + name)))
      .sort(),
    ["HiddenSeats.tsx", "Sidebar.tsx"],
  );
  assert.deepEqual(
    names.filter((name) => /\.\/HiddenSeats"/.test(read("src/" + name))).sort(),
    ["Sidebar.tsx"],
  );
  // The command center, the panels and the app do not know the setting: only the sidebar list changes.
  for (const name of names.filter(
    (n) => !["Sidebar.tsx", "settings.ts", "seat-visibility.ts"].includes(n),
  ))
    assert.ok(
      !/hideStoppedSeats|hiddenCount|visibleSeats/.test(read("src/" + name)),
      name,
    );
  const code = stripComments(read("src/seat-visibility.ts"));
  assert.ok(!/^import /m.test(code), "no import");
  assert.ok(
    !/\b(window|document|fetch|localStorage|sessionStorage|navigator|setTimeout|setInterval|require|process|console)\b|Date\.now|new Date|Math\.random|innerHTML/.test(
      code,
    ),
  );
  assert.ok(!/[^\n -~]/.test(read("src/seat-visibility.ts")), "plain ASCII");
  const view = stripComments(read("src/HiddenSeats.tsx"));
  assert.ok(!/innerHTML|dangerouslySetInnerHTML|href|style=/.test(view));
  assert.equal(count(view, "import "), 2);

  // The stylesheet: two rules directly after the section label button rule and before the count rule, one color in them, a token that already exists.
  const css = read("src/styles.css");
  const button = css.indexOf(".section-label button {");
  const open = css.indexOf(".section-label .section-tools {");
  const close = css.indexOf("\n.count {");
  assert.ok(button > 0 && open > button && close > open);
  assert.equal(
    css.slice(button, open).split("}").length,
    2,
    "the button rule is directly before",
  );
  const block = css.slice(open, close);
  assert.deepEqual(
    block
      .split("{")
      .slice(0, -1)
      .map((s) => s.trim().split("\n").pop().trim()),
    [
      ".section-label .section-tools",
      '.section-label button[aria-pressed="true"]',
    ],
  );
  assert.equal(count(block, "var(--color-86cdb0)"), 1);
  assert.equal(count(block, "var("), 1);
  assert.ok(!/background|border|#[0-9a-f]{3}|!important|url\(/i.test(block));
  assert.equal(count(css, ".section-label .section-tools {"), 1);
});
