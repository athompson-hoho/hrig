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
const char = (code) => String.fromCodePoint(code);
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
const lib = load("src/seat-badges.ts");
const Row = load("src/SeatBadgeRow.tsx", {
  "react/jsx-runtime": fakeJsx,
}).SeatBadgeRow;
const badges = (runtime, model) => lib.seatBadges({ runtime, model });
// The badge elements of a row: the span children that are really there.
const parts = (element) =>
  element === null
    ? null
    : [].concat(element.props.children).filter((child) => child);

test("seat-badges rules: known runtimes get a short name, the generic agent runtime and empty text get none, and the model is cut at 24 characters with the longer text in the tooltip", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "MAX_BADGE_TITLE",
    "MAX_MODEL_LABEL",
    "MAX_RUNTIME_LABEL",
    "seatBadges",
  ]);
  assert.equal(lib.MAX_RUNTIME_LABEL, 16);
  assert.equal(lib.MAX_MODEL_LABEL, 24);
  assert.equal(lib.MAX_BADGE_TITLE, 80);

  assert.deepEqual(badges("claude-code", "").runtime, {
    label: "Claude",
    title: "claude-code",
  });
  assert.deepEqual(badges("codex", "").runtime, {
    label: "Codex",
    title: "codex",
  });
  // Case and padding do not matter for the two known names; the title keeps the cleaned text as given.
  assert.deepEqual(badges("  CODEX ", "").runtime, {
    label: "Codex",
    title: "CODEX",
  });
  assert.deepEqual(badges("Claude-Code", "").runtime, {
    label: "Claude",
    title: "Claude-Code",
  });
  // Any other runtime is shown as written, cut at 16 characters.
  assert.deepEqual(badges("gemini-cli", "").runtime, {
    label: "gemini-cli",
    title: "gemini-cli",
  });
  const long = badges("r".repeat(40), "").runtime;
  assert.equal(long.label, "r".repeat(16));
  assert.equal(long.title, "r".repeat(40));
  // The inventory fills in "agent" when the CLI names no runtime: that says nothing.
  for (const value of ["agent", "AGENT", " agent ", "", "   ", undefined])
    assert.equal(badges(value, "").runtime, null, JSON.stringify(value));
  // A name that only looks like a known one is not one.
  assert.equal(badges("codex-max", "").runtime.label, "codex-max");
  assert.equal(badges("claude", "").runtime.label, "claude");

  assert.equal(badges("codex", "").model, null);
  assert.equal(badges("codex", "   ").model, null);
  assert.deepEqual(badges("", "gpt-5").model, {
    label: "gpt-5",
    title: "gpt-5",
  });
  const model = "claude-opus-4-1-20250805-with-a-very-long-suffix";
  const cut = badges("", model).model;
  assert.equal(cut.label, model.slice(0, 24));
  assert.equal(cut.title, model);
  assert.equal(badges("", "m".repeat(200)).model.title, "m".repeat(80));
  assert.equal(badges("", "m".repeat(24)).model.label, "m".repeat(24));
  assert.equal(badges("", "m".repeat(25)).model.label, "m".repeat(24));
  // Runs of spaces are squeezed and the ends trimmed, also after the cut.
  assert.equal(badges("", "  gpt   5  ").model.label, "gpt 5");
  assert.equal(
    badges("", "a".repeat(23) + " bbbb").model.label,
    "a".repeat(23),
  );
  // Whole characters are counted, not UTF-16 units: an emoji is one.
  const faces = "\u{1F600}".repeat(30);
  assert.equal(Array.from(badges("", faces).model.label).length, 24);
  assert.equal(badges("", faces).model.label.length, 48);
  assert.equal(Array.from(badges("", faces.repeat(4)).model.title).length, 80);
  assert.equal(
    Array.from(badges("\u{1F600}".repeat(30), "").runtime.label).length,
    16,
  );

  // The two badges are independent, and the seat is only read, never changed.
  const seat = Object.freeze({ runtime: "codex", model: "gpt-5", name: "x" });
  const both = lib.seatBadges(seat);
  assert.equal(both.runtime.label, "Codex");
  assert.equal(both.model.label, "gpt-5");
  assert.notEqual(lib.seatBadges(seat), both);
  assert.deepEqual(lib.seatBadges(seat), both);
});

test("seat-badges hostile: control, zero-width, direction, tag and lone surrogate characters are stripped, a huge value costs a bounded read, and nothing but text gives a badge", () => {
  const dirty =
    "a" +
    char(0x202e) +
    "b" +
    char(0x2066) +
    "c" +
    char(0x200b) +
    "d" +
    char(0xfeff) +
    "e" +
    char(0x0) +
    "f" +
    "\n" +
    "g" +
    char(0x85) +
    "h" +
    char(0x061c) +
    "i" +
    char(0x2028) +
    "j" +
    char(0xe0041) +
    "k" +
    "\ud800" +
    "l";
  for (const badge of [badges(dirty, "").runtime, badges("", dirty).model]) {
    assert.equal(badge.label, "abcdefghijkl");
    assert.equal(badge.title, "abcdefghijkl");
  }
  // The hidden ranges are exact: every code inside one is dropped and the code on each side of it is not (a space of any kind squeezes to one space).
  const ranges = [
    [0, 31],
    [127, 159],
    [0x061c, 0x061c],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x206f],
    [0xd800, 0xdfff],
    [0xfeff, 0xfeff],
    [0xe0000, 0xe007f],
  ];
  const around = (code) => badges("", "a" + char(code) + "b").model.label;
  for (const [low, high] of ranges) {
    for (let code = low; code <= high; code += 1)
      assert.equal(around(code), "ab", "U+" + code.toString(16) + " is hidden");
    for (const code of [low - 1, high + 1].filter((n) => n >= 0)) {
      const shown = char(code);
      assert.equal(
        around(code),
        /\s/.test(shown) ? "a b" : "a" + shown + "b",
        "U+" + code.toString(16) + " is next to a hidden range and stays",
      );
    }
  }
  // A line break is dropped, not turned into a space, so a hostile name cannot start a second line.
  assert.equal(badges("", "one\ntwo\r\nthree").model.label, "onetwothree");
  // Text made only of hidden characters is empty text, so there is no badge.
  const onlyHidden = char(0x202e) + char(0x200b) + "\n\t" + char(0xfeff);
  assert.equal(badges(onlyHidden, onlyHidden).runtime, null);
  assert.equal(badges(onlyHidden, onlyHidden).model, null);

  // Ten thousand characters, and a million: the badge is as short as any other.
  for (const size of [10000, 1000000]) {
    const big = badges("x".repeat(size), "y".repeat(size));
    assert.equal(big.runtime.label.length, 16);
    assert.equal(big.runtime.title.length, 80);
    assert.equal(big.model.label.length, 24);
    assert.equal(big.model.title.length, 80);
  }
  // Only the first 2,000 UTF-16 units of a field are read: hidden filler under that limit still lets the text through, and filler past it does not.
  assert.equal(
    badges("", char(0x200b).repeat(1990) + "abc").model.label,
    "abc",
  );
  assert.equal(badges("", char(0x200b).repeat(2100) + "abc").model, null);
  // Cutting a pair of surrogates at the read limit leaves no broken character.
  assert.equal(
    badges("", "a".repeat(1999) + "\u{1F600}").model.label,
    "a".repeat(24),
  );

  // Markup is only text.
  assert.equal(
    badges("<img src=x onerror=alert(1)>", "</span><b>x</b>").runtime.label,
    "<img src=x onerr",
  );
  assert.equal(badges("", "</span><b>x</b>").model.label, "</span><b>x</b>");

  // Anything but a string is no text.
  for (const value of [
    null,
    undefined,
    0,
    1,
    NaN,
    true,
    {},
    [],
    ["codex"],
    () => "codex",
    Symbol("codex"),
    { toString: () => "codex" },
  ]) {
    assert.deepEqual(badges(value, value), { runtime: null, model: null });
  }
  // A seat that is not an object, or has neither field, never throws.
  for (const seat of [undefined, null, 0, "codex", true, [], {}, { name: "x" }])
    assert.deepEqual(lib.seatBadges(seat), { runtime: null, model: null });
  assert.deepEqual(lib.seatBadges(), { runtime: null, model: null });
  // Property names that exist on every object are not runtimes.
  for (const value of ["constructor", "__proto__", "toString"])
    assert.equal(badges(value, "").runtime.label, value);
});

test("seat-badges tracer: an inventory row from the CLI reaches the sidebar as a runtime and a model badge, and a row that names neither shows none", () => {
  const data = core.normalizeInventory(
    [{ rigId: "r1", name: "factory", status: "running", nodeCount: 3 }],
    [
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "builder",
        canonicalSessionName: "builder@factory",
        sessionStatus: "running",
        runtime: "claude-code",
        model: "claude-opus-4-1-20250805",
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "reviewer",
        canonicalSessionName: "reviewer@factory",
        sessionStatus: "running",
        runtime: "codex",
        model: "gpt-5-codex",
      },
      {
        rigId: "r1",
        rigName: "factory",
        logicalId: "plain",
        canonicalSessionName: "plain@factory",
        sessionStatus: "running",
      },
    ],
  );
  // What the inventory hands the sidebar: the generic runtime and an empty model when the row names none.
  assert.deepEqual(
    data.seats.map((seat) => [seat.runtime, seat.model]),
    [
      ["claude-code", "claude-opus-4-1-20250805"],
      ["codex", "gpt-5-codex"],
      ["agent", ""],
    ],
  );
  const drawn = data.seats.map((seat) => {
    const list = parts(Row({ seat }));
    return list && list.map((child) => child.props.children);
  });
  assert.deepEqual(drawn, [
    ["Claude", "claude-opus-4-1-20250805"],
    ["Codex", "gpt-5-codex"],
    null,
  ]);
  // The tooltip is the full text, and the badge says which kind it is.
  const first = parts(Row({ seat: data.seats[0] }));
  assert.deepEqual(
    first.map((child) => [child.props["data-kind"], child.props.title]),
    [
      ["runtime", "claude-code"],
      ["model", "claude-opus-4-1-20250805"],
    ],
  );
});

test("seat-badges component: the row draws plain text spans only, runtime before model, a lone badge alone and nothing when there is none", () => {
  const element = Row({ seat: { runtime: "codex", model: "gpt-5" } });
  assert.equal(element.type, "span");
  assert.deepEqual(Object.keys(element.props).sort(), [
    "children",
    "className",
  ]);
  assert.equal(element.props.className, "seat-badges");
  const list = parts(element);
  assert.equal(list.length, 2);
  for (const child of list) {
    assert.equal(child.type, "span");
    assert.equal(child.props.className, "badge");
    // Only these four props: no markup, link, style or handler can come with a badge.
    assert.deepEqual(Object.keys(child.props).sort(), [
      "children",
      "className",
      "data-kind",
      "title",
    ]);
    assert.equal(typeof child.props.children, "string");
    assert.equal(typeof child.props.title, "string");
  }
  assert.deepEqual(
    list.map((child) => child.props["data-kind"]),
    ["runtime", "model"],
  );
  assert.deepEqual(
    parts(Row({ seat: { runtime: "agent", model: "gpt-5" } })).map(
      (child) => child.props["data-kind"],
    ),
    ["model"],
  );
  assert.deepEqual(
    parts(Row({ seat: { runtime: "claude-code", model: "" } })).map(
      (child) => child.props["data-kind"],
    ),
    ["runtime"],
  );
  for (const seat of [{ runtime: "agent", model: "" }, {}, null, undefined])
    assert.equal(Row({ seat }), null);
  // Hostile text arrives as a string child and a string tooltip, cleaned.
  const hostile = parts(
    Row({
      seat: {
        runtime: "<b onmouseover=1>" + char(0x202e) + "x",
        model: "</span><script>1</script>",
      },
    }),
  );
  assert.equal(hostile[0].props.children, "<b onmouseover=1");
  assert.equal(hostile[0].props.title, "<b onmouseover=1>x");
  assert.equal(hostile[1].props.children, "</span><script>1</script");
  assert.equal(hostile[1].props.title, "</span><script>1</script>");
});

test("seat-badges wiring: the setting is off by default and sits after the window title setting, the sidebar draws the row only when it is on, the stylesheet rules carry no color, and nothing else uses the module", () => {
  const key = "appearance.seatBadges";
  const settings = load("src/settings.ts");
  assert.equal(settings.defaults[key], false);
  const keys = settings.schema.map((row) => row.key);
  assert.equal(keys.filter((k) => k === key).length, 1);
  assert.equal(keys[keys.indexOf(key) - 1], "appearance.windowTitleDetails");
  const order = Object.keys(settings.defaults);
  assert.equal(order[order.indexOf(key) - 1], "appearance.windowTitleDetails");
  assert.equal(
    keys[keys.indexOf("appearance.windowTitleDetails") - 1],
    "appearance.statusBarHidden",
  );
  assert.equal(settings.schema[keys.indexOf(key)].category, "Appearance");
  assert.deepEqual(settings.validateOverrides({ [key]: true }), {
    [key]: true,
  });
  assert.throws(() => settings.validateOverrides({ [key]: "true" }));

  // The sidebar: two imports, the settings read once, the row drawn behind the setting inside the details, and the row text, the avatar and the status dot as before.
  const sidebar = stripComments(read("src/Sidebar.tsx")).replace(/\s+/g, " ");
  assert.equal(count(sidebar, 'from "./SeatBadgeRow"'), 1);
  assert.equal(
    count(sidebar, 'import { SeatBadgeRow } from "./SeatBadgeRow";'),
    1,
  );
  assert.equal(
    count(sidebar, 'import { useSettings } from "./SettingsContext";'),
    1,
  );
  assert.equal(count(sidebar, "const settings = useSettings();"), 1);
  const guard =
    /<small> \{s\.rigName\} \u00b7 \{s\.runtime\} <\/small> \{settings\.effective\["appearance\.seatBadges"\] && \(? ?<SeatBadgeRow seat=\{s\} \/> ?\)?\} <\/span> <StatusDot status=\{s\.status\} \/>/;
  assert.ok(
    guard.test(sidebar),
    "the row sits under the small text, behind the setting",
  );
  assert.equal(count(sidebar, "<SeatBadgeRow"), 1);
  assert.equal(
    count(
      sidebar,
      'seat-avatar ${s.runtime?.includes("codex") ? "purple" : ""}',
    ),
    1,
  );
  assert.equal(count(sidebar, "appearance.seatBadges"), 1);

  // The row component: the two imports it needs, text only.
  const rowSource = stripComments(read("src/SeatBadgeRow.tsx"));
  assert.equal(count(rowSource, 'from "./seat-badges"'), 1);
  assert.equal(count(rowSource, 'import type { Seat } from "./types";'), 1);
  assert.equal(count(rowSource, "import "), 2);
  assert.ok(
    !/innerHTML|dangerouslySetInnerHTML|href|style=|onClick/.test(rowSource),
  );

  // The module: pure, no import, no page, no clock.
  const code = stripComments(read("src/seat-badges.ts"));
  assert.ok(!/^import /m.test(code), "no import");
  assert.ok(
    !/\b(window|document|fetch|localStorage|sessionStorage|navigator|setTimeout|setInterval|require|process|console)\b|Date\.now|new Date|Math\.random|innerHTML/.test(
      code,
    ),
  );
  assert.ok(!/[^\n -~]/.test(read("src/seat-badges.ts")), "plain ASCII");

  // Only the row component uses the module, and only the sidebar uses the row.
  const names = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(
    names.filter((name) => /\.\/seat-badges"/.test(read("src/" + name))).sort(),
    ["SeatBadgeRow.tsx"],
  );
  assert.deepEqual(
    names
      .filter((name) => /\.\/SeatBadgeRow"/.test(read("src/" + name)))
      .sort(),
    ["Sidebar.tsx"],
  );

  // The stylesheet: three rules directly after the small text rule and before the grip rule, and not one color, background or border in them (the badge keeps the colors of its own rule, which the High Contrast check already measures).
  const css = read("src/styles.css");
  const small = css.indexOf(".seat-details small {");
  const open = css.indexOf(".seat-details .seat-badges {");
  const close = css.indexOf(".seat-row .grip {");
  assert.ok(small > 0 && open > small && close > open);
  assert.equal(
    css.slice(small, open).split("}").length,
    2,
    "the small rule is directly before",
  );
  const block = css.slice(open, close);
  assert.deepEqual(
    block
      .split("{")
      .slice(0, -1)
      .map((s) => s.trim().split("\n").pop().trim()),
    [
      ".seat-details .seat-badges",
      ".seat-details .badge",
      '.seat-details .badge[data-kind="runtime"]',
    ],
  );
  assert.ok(
    !/color|background|border|#[0-9a-f]{3}|var\(|!important|url\(/i.test(block),
  );
  assert.equal(count(css, ".seat-details .badge {"), 1);
  // The layout decisions that keep a 264px sidebar tidy: the row clips what does not fit, a badge shrinks and ends in an ellipsis on one line, the runtime badge never shrinks.
  const rule = (selector) => {
    const start = css.indexOf(selector + " {", open);
    const end = css.indexOf("}", start);
    return css
      .slice(css.indexOf("{", start) + 1, end)
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean);
  };
  for (const [selector, wanted] of [
    [
      ".seat-details .seat-badges",
      ["display: flex", "min-width: 0", "overflow: hidden"],
    ],
    [
      ".seat-details .badge",
      [
        "min-width: 0",
        "overflow: hidden",
        "text-overflow: ellipsis",
        "white-space: nowrap",
      ],
    ],
    ['.seat-details .badge[data-kind="runtime"]', ["flex-shrink: 0"]],
  ])
    for (const line of wanted)
      assert.ok(rule(selector).includes(line), selector + " has " + line);
});
