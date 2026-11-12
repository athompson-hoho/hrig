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
const char = (code) => String.fromCharCode(code);

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
const io = () => load("src/snippet-io.ts");
const file = (snippets, extra = {}) =>
  JSON.stringify({ format: "hrig-snippets", version: 1, snippets, ...extra });

// A small react runtime: useState keeps slots and a state change renders the dialog again at once.
function dialogHarness(extra = {}) {
  const slots = [];
  let cursor = 0;
  let tree = null;
  const calls = { inserted: [], changed: [], closed: 0 };
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
  const Dialog = load("src/TerminalSnippets.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal", ErrorBox: "ErrorBox" },
  }).default;
  const props = {
    name: "Prod",
    connection: "Prod DB",
    terminalId: "t1",
    snippets: [],
    context: { host: "prod-1" },
    onChange: (next) => calls.changed.push(next),
    onInsert: (text, run) => calls.inserted.push([text, run]),
    onClose: () => {
      calls.closed++;
    },
    ...extra,
  };
  // Function components inside the dialog run in the same render pass, so their hooks take the next slots.
  const resolve = (node) => {
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === "object") {
      if (typeof node.type === "function")
        return resolve(node.type(node.props));
      if (node.props && "children" in node.props)
        return {
          ...node,
          props: { ...node.props, children: resolve(node.props.children) },
        };
    }
    return node;
  };
  function render() {
    cursor = 0;
    tree = resolve(Dialog(props));
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
  const button = (label) =>
    all(tree).find(
      (n) =>
        n.type === "button" &&
        (label instanceof RegExp ? label.test(text(n)) : text(n) === label),
    );
  return {
    calls,
    all: () => all(tree),
    text,
    button,
    textarea: () => all(tree).find((n) => n.type === "textarea"),
    statuses: () =>
      all(tree)
        .filter((n) => n.type === "div" && n.props.role === "status")
        .map(text),
    errors: () =>
      all(tree)
        .filter((n) => n.type === "ErrorBox")
        .map((n) => n.props.error),
    type: (value) =>
      all(tree)
        .find((n) => n.type === "textarea")
        .props.onChange({ target: { value } }),
  };
}

test("snippet-io tracer: the real dialog exports name and text only, previews imports, and adds nothing until Import is chosen", () => {
  const saved = [
    { id: "a1", name: "status", text: "git status" },
    { id: "a2", name: "attach", text: "tmux attach" },
  ];
  const d = dialogHarness({ snippets: saved });

  // Export: selectable JSON with the format and version, no ids or workspace data.
  d.button("Export snippets").props.onClick();
  const out = d.textarea();
  assert.equal(out.props.readOnly, true);
  assert.deepEqual(JSON.parse(out.props.value), {
    format: "hrig-snippets",
    version: 1,
    snippets: [
      { name: "status", text: "git status" },
      { name: "attach", text: "tmux attach" },
    ],
  });
  assert.ok(!out.props.value.includes("a1"), "no ids in an export");
  assert.ok(d.button("Copy JSON"));
  assert.ok(d.button("Save to file"));
  assert.ok(d.all().some((n) => d.text(n).includes("do not keep passwords")));
  assert.deepEqual(d.calls.inserted, []);
  assert.deepEqual(d.calls.changed, []);
  d.button("Back").props.onClick();
  assert.ok(d.button("Insert"), "back on the snippet list");

  // Import: nothing happens until the text is checked, and again until Import is chosen.
  d.button("Import snippets").props.onClick();
  assert.equal(d.textarea().props.maxLength, 262145);
  assert.equal(d.button("Import").props.disabled, true);
  const pasted = file([
    { name: "status", text: "git status" },
    { name: "attach", text: "tmux attach -t x" },
    { name: "logs", text: "journalctl -f" },
    { name: "logs", text: "journalctl -f" },
    { name: "bad", text: "a" + char(10) + "b" },
    { name: "", text: "x" },
    { id: "a1", name: "fresh", text: "ls", path: "/etc", host: "h" },
  ]);
  d.type(pasted);
  assert.deepEqual(d.statuses(), [], "typing previews nothing");
  assert.deepEqual(d.calls.changed, []);
  d.button("Check import").props.onClick();
  const [report] = d.statuses();
  assert.ok(report.includes("3 snippets can be imported"), report);
  assert.ok(report.includes("1 of them under a numbered name"), report);
  assert.ok(report.includes("2 already saved or repeated"), report);
  assert.ok(report.includes("2 rejected"), report);
  assert.ok(report.includes("Item 5: "), "says which item and why");
  assert.ok(report.includes("Item 6: The name is empty."), report);
  assert.deepEqual(d.calls.changed, [], "checking changes nothing");
  assert.equal(d.button("Import 3 snippets").props.disabled, false);

  // Editing the text drops the stale preview.
  d.type(pasted + " ");
  assert.deepEqual(d.statuses(), []);
  d.button("Check import").props.onClick();
  assert.equal(d.statuses().length, 1);

  d.button("Import 3 snippets").props.onClick();
  assert.equal(d.calls.changed.length, 1);
  const merged = d.calls.changed[0];
  assert.equal(merged.length, 5);
  assert.equal(merged[0], saved[0], "saved snippets are the same objects");
  assert.equal(merged[1], saved[1]);
  assert.deepEqual(
    merged.slice(2).map((s) => [s.name, s.text]),
    [
      ["attach (2)", "tmux attach -t x"],
      ["logs", "journalctl -f"],
      ["fresh", "ls"],
    ],
  );
  const ids = merged.map((s) => s.id);
  assert.equal(new Set(ids).size, 5, "every id is unique");
  assert.ok(!merged.slice(2).some((s) => s.id === "a1" || s.id === "a2"));
  for (const s of merged.slice(2)) {
    assert.deepEqual(Object.keys(s).sort(), ["id", "name", "text"]);
    assert.equal(typeof s.id, "string");
  }
  assert.deepEqual(d.calls.inserted, [], "importing never sends");
  assert.equal(d.calls.closed, 0);
  assert.ok(d.statuses()[0].includes("Imported 3 snippets"));
  assert.equal(d.textarea().props.value, "", "the pasted text is cleared");

  // Bad text is explained and cannot be imported.
  d.type("{ nope");
  d.button("Check import").props.onClick();
  assert.deepEqual(d.errors(), ["That is not valid JSON."]);
  assert.equal(d.button("Import").props.disabled, true);
  d.type(
    file([
      { name: "x", text: "ls" },
      { name: "", text: "y" },
    ]),
  );
  d.button("Check import").props.onClick();
  assert.deepEqual(d.errors(), []);
  d.button("Back").props.onClick();
  assert.deepEqual(d.calls.inserted, []);
  assert.equal(d.calls.changed.length, 1, "nothing more was saved");
});

test("snippet-io parse: pasted text is refused or filtered defensively and never trusted", () => {
  const {
    parseSnippets,
    MAX_IMPORT_CHARS,
    MAX_IMPORT_SNIPPETS,
    MAX_SNIPPET_NAME,
    SNIPPET_FORMAT,
    SNIPPET_VERSION,
  } = io();
  assert.equal(SNIPPET_FORMAT, "hrig-snippets");
  assert.equal(SNIPPET_VERSION, 1);
  assert.equal(MAX_IMPORT_CHARS, 262144);
  assert.equal(MAX_IMPORT_SNIPPETS, 200);
  assert.equal(MAX_SNIPPET_NAME, 80);
  const refused = (input, part) => {
    const r = parseSnippets(input);
    assert.ok(
      r.error.includes(part),
      String(input).slice(0, 40) + " -> " + r.error,
    );
    assert.deepEqual(r.snippets, []);
    assert.deepEqual(r.rejected, []);
    return r;
  };
  for (const nothing of [
    undefined,
    null,
    5,
    {},
    [],
    true,
    "",
    "   ",
    char(10),
    char(0xfeff),
  ])
    refused(nothing, "Paste the exported snippet text first.");
  // Size: the cap itself is read (and is not JSON here), one more is refused first.
  refused("x".repeat(262144), "valid JSON");
  refused("x".repeat(262145), "256 KB");
  const big = file([{ name: "a", text: "b" }], { pad: "x".repeat(262144) });
  refused(big, "256 KB");
  // JSON: malformed text and hostile nesting never throw.
  for (const bad of [
    "{",
    "nope",
    "[1,2",
    "{'a':1}",
    "undefined",
    "{} {}",
    '{"a":}',
    "[".repeat(100000),
    '{"a":'.repeat(50000),
  ])
    refused(bad, "valid JSON");
  // Shape: only the exact format object is an export.
  for (const other of [
    "[]",
    "null",
    "5",
    '"hrig-snippets"',
    "{}",
    "true",
    '[{"name":"a","text":"b"}]',
  ])
    refused(other, "not an HRig snippet export");
  refused(
    JSON.stringify({ format: "other", version: 1, snippets: [] }),
    "not an HRig snippet export",
  );
  refused(
    JSON.stringify({ format: "HRIG-SNIPPETS", version: 1, snippets: [] }),
    "not an HRig snippet export",
  );
  refused(
    JSON.stringify({ format: ["hrig-snippets"], version: 1, snippets: [] }),
    "not an HRig snippet export",
  );
  refused(
    '{"__proto__":{"format":"hrig-snippets"},"version":1,"snippets":[]}',
    "not an HRig snippet export",
  );
  for (const version of [2, 0, -1, 1.5, "1", null, [1], true, {}])
    refused(
      JSON.stringify({ format: "hrig-snippets", version, snippets: [] }),
      "version",
    );
  refused('{"format":"hrig-snippets","snippets":[]}', "version");
  for (const list of [{}, "x", null, 5, true])
    refused(
      JSON.stringify({ format: "hrig-snippets", version: 1, snippets: list }),
      "no snippets list",
    );
  refused('{"format":"hrig-snippets","version":1}', "no snippets list");
  // Count: the cap is read, one more refuses the whole file even when every item is junk.
  const many = (n, make) => file(Array.from({ length: n }, (_, i) => make(i)));
  const at = parseSnippets(
    many(200, (i) => ({ name: "n" + i, text: "t" + i })),
  );
  assert.equal(at.error, "");
  assert.equal(at.snippets.length, 200);
  refused(
    many(201, () => null),
    "201 snippets",
  );
  refused(
    many(5000, () => 1),
    "5000 snippets",
  );

  // Items: each is checked on its own with the existing validator; the rest are kept in order.
  const mixed = parseSnippets(
    file([
      { name: "good", text: "ls -l" },
      null,
      5,
      "text",
      [],
      true,
      {},
      { name: "no text" },
      { text: "no name" },
      { name: 5, text: "x" },
      { name: "num text", text: 5 },
      { name: "   ", text: "x" },
      { name: "a".repeat(81), text: "x" },
      { name: "line" + char(10) + "break", text: "x" },
      { name: "bell" + char(7), text: "x" },
      { name: "zero" + char(0x200b) + "width", text: "x" },
      { name: "bidi" + char(0x202e), text: "x" },
      { name: "t", text: "" },
      { name: "t", text: "   " },
      { name: "t", text: "a" + char(10) + "b" },
      { name: "t", text: "a" + char(13) },
      { name: "t", text: "a" + char(9) + "b" },
      { name: "t", text: char(27) + "[200~" },
      { name: "t", text: "a" + char(0x2028) + "b" },
      { name: "t", text: "a" + char(0x200d) + "b" },
      { name: "t", text: "x".repeat(10001) },
      { name: "also good", text: "pwd" },
    ]),
  );
  assert.equal(mixed.error, "");
  assert.deepEqual(mixed.snippets, [
    { name: "good", text: "ls -l" },
    { name: "also good", text: "pwd" },
  ]);
  assert.deepEqual(
    mixed.rejected.map((r) => r.index),
    Array.from({ length: 25 }, (_, i) => i + 2),
    "positions count from 1 and keep file order",
  );
  for (const r of mixed.rejected) {
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
  }
  assert.equal(mixed.rejected[0].reason, "Not a snippet object.");
  assert.ok(
    mixed.rejected[6].reason.includes("name is missing") ||
      mixed.rejected[6].reason.includes("text"),
  );
  // Limits that are allowed.
  const edge = parseSnippets(
    file([
      { name: "a".repeat(80), text: "x".repeat(10000) },
      { name: "  padded  ", text: " keep my spaces " },
    ]),
  );
  assert.equal(edge.rejected.length, 0);
  assert.equal(edge.snippets[0].name.length, 80);
  assert.equal(edge.snippets[0].text.length, 10000);
  assert.deepEqual(edge.snippets[1], {
    name: "padded",
    text: " keep my spaces ",
  });
  // A byte order mark in front is not data.
  assert.equal(
    parseSnippets(char(0xfeff) + file([{ name: "a", text: "b" }])).snippets
      .length,
    1,
  );
  // Repeats inside the file are dropped and counted; the same name with other text is kept.
  const rep = parseSnippets(
    file([
      { name: "a", text: "x" },
      { name: " a ", text: "x" },
      { name: "a", text: "y" },
      { name: "a", text: "x" },
    ]),
  );
  assert.deepEqual(rep.snippets, [
    { name: "a", text: "x" },
    { name: "a", text: "y" },
  ]);
  assert.equal(rep.duplicates, 2);
  // Extra keys, ids and prototype keys never come through, and nothing is polluted.
  const hostile = parseSnippets(
    '{"__proto__":{"polluted":1},"format":"hrig-snippets","version":1,"snippets":[' +
      '{"id":"x","name":"a","text":"ls","host":"h","path":"/p","__proto__":{"polluted":2},"constructor":{"name":"evil"}},' +
      '{"constructor":{"name":"evil"},"text":"ls"},' +
      '{"__proto__":{"name":"inherited","text":"ls"}}' +
      "]}",
  );
  assert.equal(hostile.error, "");
  assert.equal(hostile.snippets.length, 1);
  assert.deepEqual(Object.keys(hostile.snippets[0]), ["name", "text"]);
  assert.equal(Object.getPrototypeOf(hostile.snippets[0]), Object.prototype);
  assert.equal(hostile.rejected.length, 2);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);

  // A seeded fuzz: any mix of fragments is explained or filtered, never thrown, and what survives is clean.
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const parts = [
    '{"format":"hrig-snippets"',
    ',"version":1',
    ',"snippets":[',
    '{"name":"a","text":"b"}',
    '{"name":"","text":"b"}',
    '{"name":"c","text":"d\\ne"}',
    ",",
    "]",
    "}",
    "{",
    "[",
    "null",
    '"',
    "\\",
    "1e999",
    "-",
  ];
  for (let run = 0; run < 300; run++) {
    let text = "";
    for (let n = 1 + Math.floor(next() * 14); n > 0; n--)
      text += parts[Math.floor(next() * parts.length)];
    const r = parseSnippets(text);
    assert.equal(typeof r.error, "string");
    if (r.error) assert.deepEqual(r.snippets, [], text);
    for (const s of r.snippets) {
      assert.equal(typeof s.name, "string");
      assert.ok(s.name === s.name.trim() && s.name.length > 0);
      assert.ok(!/[\x00-\x1f\x7f]/.test(s.text));
    }
  }
});

test("snippet-io export and merge: an export is name and text only and reads back whole, and a merge adds fresh ids, skips repeats and never touches what is saved", () => {
  const {
    exportSnippets,
    describeExport,
    exportableSnippets,
    mergeSnippets,
    parseSnippets,
    nameError,
  } = io();
  // nameError mirrors the name box and the snippet check.
  assert.equal(nameError("ok"), "");
  assert.equal(nameError("a".repeat(80)), "");
  assert.equal(nameError("  a  "), "");
  for (const bad of [
    undefined,
    null,
    5,
    {},
    "",
    "   ",
    "a".repeat(81),
    "a" + char(10) + "b",
    "a" + char(0x200b),
    "a" + char(0x202e),
  ])
    assert.notEqual(nameError(bad), "", String(bad));

  // Export: only format, version, name and text; invalid stored items are left out; order kept.
  const saved = [
    {
      id: "a1",
      name: " status ",
      text: "git status",
      connection: "c",
      path: "/p",
      secret: "s",
    },
    null,
    5,
    { id: "a2", name: "multi", text: "a" + char(10) + "b" },
    { id: "a3", name: "", text: "x" },
    { id: "a4", name: "bell" + char(7), text: "x" },
    { id: "a5", name: "tail", text: "ls " },
    { name: "no id", text: "pwd" },
  ];
  const json = exportSnippets(saved);
  assert.ok(
    json.startsWith(
      '{\n  "format": "hrig-snippets",\n  "version": 1,\n  "snippets": [',
    ),
    "pretty printed",
  );
  const data = JSON.parse(json);
  assert.deepEqual(Object.keys(data), ["format", "version", "snippets"]);
  assert.deepEqual(data.snippets, [
    { name: "status", text: "git status" },
    { name: "tail", text: "ls " },
    { name: "no id", text: "pwd" },
  ]);
  const keys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) {
        keys.add(k);
        walk(v);
      }
  };
  walk(data);
  assert.deepEqual([...keys].sort(), [
    "format",
    "name",
    "snippets",
    "text",
    "version",
  ]);
  for (const secret of ["a1", "a5", "/p", "secret", "connection"])
    assert.ok(!json.includes(secret));
  for (const none of [undefined, null, 5, "x", {}, []])
    assert.deepEqual(JSON.parse(exportSnippets(none)).snippets, []);
  assert.deepEqual(describeExport(saved), { json, count: 3, fits: true });
  assert.deepEqual(exportableSnippets(saved), data.snippets);
  assert.notEqual(exportableSnippets(saved)[0], saved[0], "fresh objects");
  assert.deepEqual(
    exportableSnippets([Object.create({ name: "n", text: "t" })]),
    [],
    "only a snippet's own name and text count, never ones inherited from a prototype",
  );
  // Whether one import can read it back whole.
  const lots = Array.from({ length: 201 }, (_, i) => ({
    id: "i" + i,
    name: "n" + i,
    text: "t",
  }));
  assert.equal(describeExport(lots).fits, false);
  assert.equal(describeExport(lots.slice(0, 200)).fits, true);
  const heavy = Array.from({ length: 30 }, (_, i) => ({
    id: "i" + i,
    name: "n" + i,
    text: "x".repeat(10000),
  }));
  assert.equal(describeExport(heavy).fits, false);
  // The round trip reads back exactly what was exported.
  const back = parseSnippets(json);
  assert.equal(back.error, "");
  assert.deepEqual(back.snippets, exportableSnippets(saved));
  assert.equal(back.rejected.length, 0);

  // Merge: fresh ids, repeats skipped, same name with other text renamed, nothing saved changed.
  let n = 0;
  const makeId = () => "new-" + n++;
  const existing = Object.freeze([
    Object.freeze({ id: "a1", name: "status", text: "git status" }),
    Object.freeze({ id: "a2", name: "attach", text: "tmux attach" }),
  ]);
  const incoming = Object.freeze([
    Object.freeze({ name: "status", text: "git status" }),
    Object.freeze({ name: "attach", text: "tmux attach -t x", id: "a1" }),
    Object.freeze({ name: "attach", text: "tmux attach -t y" }),
    Object.freeze({ name: "attach", text: "tmux attach -t x" }),
    Object.freeze({ name: "fresh", text: "ls", id: "a2" }),
  ]);
  const m = mergeSnippets(existing, incoming, makeId);
  assert.deepEqual(
    m.snippets.map((s) => [s.id, s.name, s.text]),
    [
      ["a1", "status", "git status"],
      ["a2", "attach", "tmux attach"],
      ["new-0", "attach (2)", "tmux attach -t x"],
      ["new-1", "attach (3)", "tmux attach -t y"],
      ["new-2", "fresh", "ls"],
    ],
  );
  assert.deepEqual([m.added, m.duplicates, m.renamed, m.invalid], [3, 2, 2, 0]);
  assert.equal(n, 3, "an id is made only for an added snippet");
  assert.equal(m.snippets[0], existing[0]);
  assert.equal(m.snippets[1], existing[1]);
  assert.equal(existing.length, 2, "the saved list is not changed");
  // A name at the limit stays within it, and a numbered name is free of the taken ones.
  const longName = "a".repeat(80);
  const cut = mergeSnippets(
    [{ id: "x", name: longName, text: "one" }],
    [{ name: longName, text: "two" }],
    makeId,
  );
  assert.equal(cut.snippets[1].name, "a".repeat(76) + " (2)");
  assert.equal(cut.snippets[1].name.length, 80);
  const pair = "a".repeat(78) + String.fromCodePoint(0x1f600);
  const pairCut = mergeSnippets(
    [{ id: "x", name: pair, text: "one" }],
    [{ name: pair, text: "two" }],
    makeId,
  );
  assert.ok(pairCut.snippets[1].name.length <= 80);
  const stem = pairCut.snippets[1].name.replace(/ \(2\)$/, "");
  const lastUnit = stem.charCodeAt(stem.length - 1);
  assert.ok(!(lastUnit >= 0xd800 && lastUnit <= 0xdbff), "no half of a pair");
  const free = mergeSnippets(
    [
      { id: "x", name: "a", text: "1" },
      { id: "y", name: "a (2)", text: "2" },
    ],
    [{ name: "a", text: "3" }],
    makeId,
  );
  assert.equal(free.snippets[2].name, "a (3)");
  // Odd saved lists: junk stays and is ignored for the comparison; nothing throws.
  for (const odd of [undefined, null, "x", 5, {}])
    assert.deepEqual(
      mergeSnippets(odd, [{ name: "a", text: "b" }], makeId).snippets.length,
      1,
    );
  const junk = mergeSnippets(
    [null, 5, { id: "j" }, { id: "k", name: "a", text: "b" }],
    [
      { name: "a", text: "b" },
      { name: "c", text: "d" },
    ],
    makeId,
  );
  assert.equal(junk.snippets.length, 5);
  assert.deepEqual([junk.added, junk.duplicates], [1, 1]);
  // An entry that fails the checks again is skipped and counted, never added.
  const bad = mergeSnippets(
    [],
    [
      null,
      5,
      { name: "", text: "x" },
      { name: "a", text: "a" + char(10) + "b" },
      { name: "a", text: 5 },
      { name: "ok", text: "ls" },
    ],
    makeId,
  );
  assert.deepEqual([bad.added, bad.invalid], [1, 5]);
  assert.deepEqual(mergeSnippets([], undefined, makeId).snippets, []);

  // A seeded walk against a plain model: the saved prefix never changes, names stay unique, counts add up.
  let seed = 20261108;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(next() * list.length)];
  for (let run = 0; run < 150; run++) {
    const names = ["a", "b", "c", "d"];
    const texts = ["t1", "t2", "t3"];
    const lib = [];
    for (let i = 0, k = Math.floor(next() * 5); i < k; i++) {
      const name = "n" + i + pick(names);
      lib.push({ id: "e" + i, name, text: pick(texts) });
    }
    const inc = [];
    for (let i = 0, k = Math.floor(next() * 12); i < k; i++)
      inc.push({
        name: pick(["n0a", "n1b", "n2c", "x", "y"]),
        text: pick(texts),
      });
    let ids = 0;
    const r = mergeSnippets(lib, inc, () => "w" + ids++);
    // The model: a plain loop with its own name search; a pair that was offered once is never added twice.
    const model = lib.map((s) => ({ name: s.name, text: s.text }));
    const offered = new Set(model.map((s) => s.name + "|" + s.text));
    let dup = 0;
    let ren = 0;
    for (const e of inc) {
      if (offered.has(e.name + "|" + e.text)) {
        dup++;
        continue;
      }
      offered.add(e.name + "|" + e.text);
      let name = e.name;
      if (model.some((s) => s.name === name)) {
        let k = 2;
        while (model.some((s) => s.name === e.name + " (" + k + ")")) k++;
        name = e.name + " (" + k + ")";
        ren++;
      }
      model.push({ name, text: e.text });
      offered.add(name + "|" + e.text);
    }
    assert.deepEqual(
      r.snippets.map((s) => ({ name: s.name, text: s.text })),
      model,
    );
    assert.deepEqual(
      [r.duplicates, r.renamed, r.added],
      [dup, ren, model.length - lib.length],
    );
    assert.deepEqual(r.snippets.slice(0, lib.length), lib);
    assert.equal(new Set(r.snippets.map((s) => s.id)).size, r.snippets.length);
    assert.equal(
      new Set(r.snippets.map((s) => s.name)).size,
      new Set(lib.map((s) => s.name)).size + r.added,
      "added names are new",
    );
  }
});

test("snippet-io direct transfer: copy/save export and chosen-file import preserve validation and explicit apply", async () => {
  const d = dialogHarness({ snippets: [{ id: "saved", name: "status", text: "git status" }] });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const written = [];
  const saved = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { hrig: { exportSnippets: async (text) => { saved.push(text); return { saved: true }; } } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (text) => written.push(text) } },
  });
  try {
    d.button("Export snippets").props.onClick();
    const expected = d.textarea().props.value;
    await d.button("Copy JSON").props.onClick();
    assert.deepEqual(written, [expected]);
    assert.ok(d.statuses().some((status) => status.includes("copied")));
    await d.button("Save to file").props.onClick();
    assert.deepEqual(saved, [expected]);
    assert.ok(d.statuses().some((status) => status.includes("saved")));

    d.button("Back").props.onClick();
    d.button("Import snippets").props.onClick();
    const chosen = file([{ name: "build", text: "npm run build" }]);
    const fileInput = d.all().find((node) => node.type === "input" && node.props.type === "file");
    const target = { files: [{ size: Buffer.byteLength(chosen), text: async () => chosen }], value: "chosen.json" };
    await fileInput.props.onChange({ currentTarget: target });
    assert.equal(target.value, "");
    assert.equal(d.textarea().props.value, chosen);
    assert.ok(d.statuses().some((status) => status.includes("1 snippet can be imported")));
    assert.deepEqual(d.calls.changed, [], "file selection only validates and previews");
    d.button("Import 1 snippet").props.onClick();
    assert.equal(d.calls.changed.length, 1);
    assert.deepEqual(d.calls.changed[0].map((item) => item.name), ["status", "build"]);
    assert.deepEqual(d.calls.inserted, [], "file import never sends to a terminal");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});

test("snippet-io wiring: the pure module stays isolated and the transfer view never calls a terminal", () => {
  const moduleSource = read("src/snippet-io.ts");
  const code = stripComments(moduleSource);
  assert.ok(!/[^ -~\n]/.test(moduleSource), "printable ASCII only");
  assert.ok(!moduleSource.includes(char(92) + "u"), "no escape sequence");
  assert.deepEqual(
    [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]),
    ["./terminal-commands"],
  );
  for (const banned of [
    /\bwindow\b/,
    /\bdocument\b/,
    /\bReact\b/,
    /window\.hrig/,
    /\bDate\b/,
    /setTimeout/,
    /\bfetch\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\basync\b|\bawait\b/,
    /Math\.random|randomUUID/,
    /\bconsole\b/,
    /export default/,
    /\brequire\b/,
  ])
    assert.ok(!banned.test(code), "the module stays pure: " + banned);
  assert.deepEqual(
    [...code.matchAll(/^export (?:const|function|type|interface) (\w+)/gm)]
      .map((m) => m[1])
      .sort(),
    [
      "MAX_IMPORT_CHARS",
      "MAX_IMPORT_SNIPPETS",
      "MAX_SNIPPET_NAME",
      "MergeResult",
      "ParseResult",
      "SNIPPET_FORMAT",
      "SNIPPET_VERSION",
      "SnippetEntry",
      "describeExport",
      "exportSnippets",
      "exportableSnippets",
      "mergeSnippets",
      "nameError",
      "parseSnippets",
    ],
  );
  assert.ok(
    count(code, "snippetError(") >= 3,
    "every item goes through the existing validator",
  );

  // The view file: text in, text out, one state write, no other outlet.
  const viewSource = read("src/SnippetTransfer.tsx");
  const view = tight(stripComments(viewSource));
  assert.ok(!/[^ -~\n]/.test(viewSource), "printable ASCII only");
  assert.ok(!viewSource.includes(char(92) + "u"), "no escape sequence");
  assert.deepEqual(
    [
      ...stripComments(viewSource).matchAll(
        /^import [\s\S]*? from "([^"]+)";$/gm,
      ),
    ].map((m) => m[1]),
    ["react", "./components", "./terminal-commands", "./snippet-io"],
  );
  assert.deepEqual(
    [...view.matchAll(/export function (\w+)/g)].map((m) => m[1]),
    ["SnippetExport", "SnippetImport"],
  );
  assert.ok(view.includes("navigator.clipboard.writeText(out.json)"));
  assert.ok(view.includes("window.hrig.exportSnippets(out.json)"));
  assert.ok(view.includes('type="file"'));
  assert.ok(view.includes("file.text()"));
  assert.ok(!/sendTerminalCommand|writeTerminal|terminal\.paste|onInsert\(/.test(view));
  assert.equal(
    count(view, "onChange(merged.snippets)"),
    1,
    "the one write, after Import",
  );
  assert.equal(count(view, "crypto.randomUUID()"), 1);
  assert.equal(count(view, "maxLength={MAX_IMPORT_CHARS + 1}"), 1);
  assert.equal(count(view, "<textarea readOnly"), 1);
  assert.ok(view.includes("disabled={!plan || plan.added === 0}"));
  assert.ok(view.includes("onClick={() => setChecked(text)}"));

  // The dialog only switches between the list, the export view and the import view.
  const dialog = tight(stripComments(read("src/TerminalSnippets.tsx")));
  assert.equal(
    count(
      dialog,
      'import { SnippetExport, SnippetImport } from "./SnippetTransfer";',
    ),
    1,
  );
  assert.equal(
    count(
      dialog,
      '<SnippetExport snippets={snippets} onBack={() => setView("list")} />',
    ),
    1,
  );
  assert.equal(
    count(
      dialog,
      '<SnippetImport snippets={snippets} onChange={onChange} onBack={() => setView("list")} />',
    ),
    1,
  );
  assert.equal(
    count(
      dialog,
      '<button onClick={() => {setError("");setView("export");}}>Export snippets</button>',
    ),
    1,
  );
  assert.equal(
    count(
      dialog,
      '<button onClick={() => {setError("");setView("import");}}>Import snippets</button>',
    ),
    1,
  );
  assert.equal(count(dialog, "onInsert("), 2, "no new way to insert");
  assert.equal(count(dialog, "setView("), 4);
});

test("snippet-io docs: TERMINALS.md and PRIVACY.md say what an export holds, that secrets are the person's to keep out, and that import checks first and sends nothing", () => {
  for (const name of ["TERMINALS.md", "PRIVACY.md"]) {
    const doc = read(name);
    assert.ok(!doc.startsWith(char(0xfeff)), name + ": no byte order mark");
    assert.ok(
      doc.endsWith("\n") && !doc.endsWith("\n\n"),
      name + ": one final line feed",
    );
    assert.ok(!doc.includes("\r"), name + ": no carriage return");
  }
  const lines = read("TERMINALS.md").split("\n");
  const hits = lines
    .map((line, i) => [line, i])
    .filter(([line]) => line.startsWith("Snippet export and import"));
  assert.equal(hits.length, 1, "one paragraph");
  const [para, at] = hits[0];
  assert.ok(
    para.startsWith(
      "Snippet export and import: Saved snippets has Export snippets and Import snippets.",
    ),
  );
  assert.ok(!/[^ -~]/.test(para), "printable ASCII on one line");
  assert.equal(lines[at - 1], "");
  assert.equal(lines[at + 1], "");
  const first = lines.findIndex((l) => l.startsWith("Snippet placeholders: "));
  const keys = lines.findIndex((l) =>
    l.startsWith("While a terminal has keyboard focus, Ctrl+Shift+K"),
  );
  assert.ok(first >= 0 && keys > first, "anchors exist");
  assert.ok(
    at > first && at < keys,
    "after the placeholders paragraph, inside the snippet area",
  );
  for (const fragment of [
    "Export shows the saved snippets as plain JSON text with a format name and version and, for each snippet, only its name and text, exactly as saved",
    "it holds no ids, host names, paths or other workspace state",
    "Copy JSON writes that text to your system clipboard",
    "Save to file opens a native save dialog for a JSON file",
    "Import accepts pasted text or a JSON file you choose",
    "keep passwords, tokens and other secrets out of snippets; HRig does not try to detect them",
    "Import accepts pasted text or a JSON file you choose, and first checks it without changing anything",
    "it refuses text over 256 KB",
    "a file with more than 200 snippets",
    "whose name is empty, over 80 characters or holds control or invisible characters",
    "whose text is not one printable line under 10,000 characters",
    "The check shows how many snippets can be imported, how many are already saved or repeated, and how many were rejected and why",
    "Import adds them only when you choose it",
    "Imported snippets get new ids",
    "a snippet with the same name and text as one you already have is skipped",
    "a snippet whose name is already used with different text is added under a numbered name such as name (2)",
    "the snippets you already have are never changed or replaced",
    "Importing never sends anything to a terminal.",
  ])
    assert.ok(para.includes(fragment), "missing: " + fragment);

  const privacy = read("PRIVACY.md").split("\n");
  const heading = privacy.indexOf("## Snippet export and import");
  assert.ok(heading > 0, "the heading exists once");
  assert.equal(
    privacy.filter((l) => l === "## Snippet export and import").length,
    1,
  );
  assert.equal(privacy[heading - 1], "");
  assert.equal(privacy[heading + 1], "");
  const body = privacy[heading + 2];
  assert.ok(!/[^ -~]/.test(body), "printable ASCII on one line");
  assert.equal(privacy[heading + 3], "");
  assert.equal(privacy[heading + 4], undefined, "last section in the file");
  const logs = privacy.indexOf("## Optional terminal logs");
  assert.ok(logs > 0 && heading > logs, "after the terminal logs section");
  for (const fragment of [
    "Saved terminal snippets are stored locally in the workspace settings.",
    "only each snippet's name and text, exactly as saved",
    "Copy JSON writes that text to the system clipboard",
    "Save to file writes it only to the path you choose in the native save dialog",
    "keep passwords and tokens out of snippets",
    "Import reads text you paste or a JSON file you choose",
    "the file is read into the app for that check and is not uploaded",
    "adds nothing until you confirm",
    "never sends anything to a terminal",
  ])
    assert.ok(body.includes(fragment), "missing: " + fragment);
});
