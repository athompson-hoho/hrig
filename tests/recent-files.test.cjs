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

const recent = load("src/recent-files.ts");
const {
  MAX_RECENT,
  MAX_RECENT_PROJECTS,
  recentKey,
  normalizeRecents,
  touchRecent,
  forgetRecent,
  recentsFor,
  recordRecent,
  removeRecent,
  recentRows,
  recentRank,
  scanResetsSelection,
} = recent;

const key = recentKey("local", "/work/app");
const names = (n) => Array.from({ length: n }, (_, i) => `f${i}.ts`);

test("recent tracer: record, list, rows, JSON round trip and export set", () => {
  const one = recordRecent(undefined, key, "src/a.ts");
  const map = recordRecent(one, key, "src/b.ts");
  const list = recentsFor(map, key);
  assert.deepEqual(list, ["src/b.ts", "src/a.ts"]);
  assert.deepEqual(recentRows("", list), [
    { name: "b.ts", path: "src/b.ts" },
    { name: "a.ts", path: "src/a.ts" },
  ]);
  assert.equal(recentRows("b", list), null);
  assert.deepEqual(recentsFor(recordRecent(map, key, "src/a.ts"), key), [
    "src/a.ts",
    "src/b.ts",
  ]);
  assert.deepEqual(recentsFor(JSON.parse(JSON.stringify(map)), key), list);
  assert.deepEqual(recentsFor(map, recentKey("local", "/work/other")), []);
  assert.deepEqual(Object.keys(recent).sort(), [
    "MAX_RECENT",
    "MAX_RECENT_PROJECTS",
    "forgetRecent",
    "normalizeRecents",
    "recentKey",
    "recentRank",
    "recentRows",
    "recentsFor",
    "recordRecent",
    "removeRecent",
    "scanResetsSelection",
    "touchRecent",
  ]);
  assert.equal(MAX_RECENT, 20);
  assert.equal(MAX_RECENT_PROJECTS, 50);
});

test("recent key: stable JSON text, no separator collisions", () => {
  assert.equal(recentKey("local", "/work/app"), '["local","/work/app"]');
  assert.equal(
    recentKey("local", "/work/app"),
    recentKey("local", "/work/app"),
  );
  assert.notEqual(recentKey("a", "/x"), recentKey("b", "/x"));
  assert.notEqual(recentKey("a", "/x"), recentKey("a", "/y"));
  assert.notEqual(recentKey("a", "b::c"), recentKey("a::b", "c"));
});

test("recent touch: move, insert, de-dupe, cap, unusable paths", () => {
  const base = Object.freeze(["b.ts", "a.ts"]);
  const added = touchRecent(base, "c.ts");
  assert.deepEqual(added, ["c.ts", "b.ts", "a.ts"]);
  assert.notEqual(added, base);
  assert.deepEqual(base, ["b.ts", "a.ts"]);
  assert.deepEqual(touchRecent(base, "a.ts"), ["a.ts", "b.ts"]);
  assert.deepEqual(touchRecent(base, "b.ts"), ["b.ts", "a.ts"]);
  assert.deepEqual(touchRecent([], "x.ts"), ["x.ts"]);
  let list = [];
  for (const name of names(25)) list = touchRecent(list, name);
  assert.equal(list.length, 20);
  assert.equal(list[0], "f24.ts");
  assert.equal(list[19], "f5.ts");
  assert.deepEqual(touchRecent(Object.freeze(["a", "b", "c"]), "d", 3), [
    "d",
    "a",
    "b",
  ]);
  const unusable = [
    "",
    " ",
    "a\0b",
    "/etc/passwd",
    "\\srv\\x",
    "C:\\x.ts",
    "c:/x.ts",
    "../up.ts",
    "a/../b.ts",
    "a\\..\\b.ts",
    "x".repeat(1001),
    5,
    null,
    undefined,
    {},
  ];
  for (const bad of unusable) {
    const out = touchRecent(base, bad);
    assert.deepEqual(out, ["b.ts", "a.ts"]);
    assert.notEqual(out, base);
  }
  for (const ok of ["a..b.ts", "..x/y.ts", "y".repeat(1000)])
    assert.equal(touchRecent([], ok)[0], ok);
});

test("recent normalize: malformed data gives a clean bounded list", () => {
  for (const bad of [
    undefined,
    null,
    "abc",
    5,
    true,
    {},
    { length: 2, 0: "a", 1: "b" },
  ])
    assert.deepEqual(normalizeRecents(bad), []);
  const messy = JSON.parse(
    '["a.ts","a.ts",1,null,"b.ts",{"x":1},["c"],""," ","/abs","../up"]',
  );
  assert.deepEqual(normalizeRecents(messy), ["a.ts", "b.ts"]);
  assert.deepEqual(normalizeRecents(["x", "y", "z"], 2), ["x", "y"]);
  assert.deepEqual(normalizeRecents(names(100)), names(20));
  assert.deepEqual(normalizeRecents(["a", "b", "a", "c"]), ["a", "b", "c"]);
  assert.deepEqual(normalizeRecents(["x".repeat(1001), "ok.ts"]), ["ok.ts"]);
  const input = ["a.ts"];
  assert.notEqual(normalizeRecents(input), input);
});

test("recent forget: removes one path without mutating", () => {
  const base = Object.freeze(["c.ts", "b.ts", "a.ts"]);
  assert.deepEqual(forgetRecent(base, "b.ts"), ["c.ts", "a.ts"]);
  const same = forgetRecent(base, "zzz.ts");
  assert.deepEqual(same, ["c.ts", "b.ts", "a.ts"]);
  assert.notEqual(same, base);
  assert.deepEqual(forgetRecent(["only.ts"], "only.ts"), []);
  assert.deepEqual(forgetRecent([], "a.ts"), []);
  assert.deepEqual(base, ["c.ts", "b.ts", "a.ts"]);
});

test("recent lookup: tolerant of any stored shape, own keys only", () => {
  for (const bad of [undefined, null, [], ["a"], "abc", 5, true, {}])
    assert.deepEqual(recentsFor(bad, key), []);
  assert.deepEqual(recentsFor({ [key]: "not a list" }, key), []);
  assert.deepEqual(recentsFor({ [key]: [1, "ok.ts", null] }, key), ["ok.ts"]);
  assert.deepEqual(recentsFor({}, "constructor"), []);
  assert.deepEqual(recentsFor({}, "toString"), []);
  assert.deepEqual(recentsFor({ [key]: names(30) }, key), names(20));
});

test("recent record: project order, project cap, bad maps and paths", () => {
  const map = Object.freeze({ one: ["a.ts"], two: ["b.ts"] });
  const out = recordRecent(map, "one", "z.ts");
  assert.deepEqual(out, { two: ["b.ts"], one: ["z.ts", "a.ts"] });
  assert.deepEqual(Object.keys(out), ["two", "one"]);
  assert.deepEqual(map, { one: ["a.ts"], two: ["b.ts"] });
  let many = {};
  for (let i = 0; i < 60; i++) many = recordRecent(many, `p${i}`, "a.ts");
  const keys = Object.keys(many);
  assert.equal(keys.length, 50);
  assert.equal(keys[0], "p10");
  assert.equal(keys[49], "p59");
  for (const bad of [[], ["x"], "abc", 5, null])
    assert.deepEqual(recordRecent(bad, "k", "a.ts"), { k: ["a.ts"] });
  assert.deepEqual(
    recordRecent({ a: "x", b: [1], c: ["ok.ts"] }, "d", "n.ts"),
    { c: ["ok.ts"], d: ["n.ts"] },
  );
  for (const bad of ["/abs/path", "../up", ""]) {
    assert.deepEqual(recordRecent({}, "k", bad), {});
    assert.deepEqual(recordRecent({ k: ["a.ts"] }, "k", bad), { k: ["a.ts"] });
  }
});

test("recent remove: forgets one path, drops emptied projects", () => {
  const map = Object.freeze({ one: ["b.ts", "a.ts"], two: ["c.ts"] });
  const out = removeRecent(map, "one", "b.ts");
  assert.deepEqual(out, { one: ["a.ts"], two: ["c.ts"] });
  assert.deepEqual(Object.keys(out), ["one", "two"]);
  assert.deepEqual(removeRecent(map, "two", "c.ts"), { one: ["b.ts", "a.ts"] });
  assert.deepEqual(removeRecent(map, "one", "nope.ts"), map);
  assert.deepEqual(removeRecent(map, "nope", "b.ts"), map);
  for (const bad of [undefined, null, [], "abc", 5])
    assert.deepEqual(removeRecent(bad, "k", "a.ts"), {});
  assert.deepEqual(map, { one: ["b.ts", "a.ts"], two: ["c.ts"] });
  const healed = removeRecent(recordRecent({}, "k", "a.ts"), "k", "a.ts");
  assert.deepEqual(recentsFor(healed, "k"), []);
  assert.equal(recentRows("", recentsFor(healed, "k")), null);
});

test("recent rows: only for the exactly empty query with something remembered", () => {
  const list = ["README.md", "src/ui/Deep.tsx", "dir/"];
  const rows = recentRows("", list);
  assert.deepEqual(rows, [
    { name: "README.md", path: "README.md" },
    { name: "Deep.tsx", path: "src/ui/Deep.tsx" },
    { name: "dir/", path: "dir/" },
  ]);
  for (const q of [" ", "a", ":12", "src", "  ", "\t"])
    assert.equal(recentRows(q, list), null);
  assert.equal(recentRows("", []), null);
  assert.notEqual(recentRows("", list), list);
});

test("recent rank: navigator empty-query ordering pin", () => {
  const ranked = ["d", "b"];
  assert.equal(recentRank(ranked, "d"), 1);
  assert.equal(recentRank(ranked, "b"), 2);
  assert.equal(recentRank(ranked, "a"), 999);
  const ids = ["a", "b", "c", "d", "e"];
  const by = (r, list) =>
    [...list].sort((x, y) => recentRank(r, x) - recentRank(r, y));
  assert.deepEqual(by(["d", "b"], ids), ["d", "b", "a", "c", "e"]);
  assert.deepEqual(by([], ids), ids);
  assert.deepEqual(by(["gone", "c", "also-gone", "a"], ["a", "b", "c"]), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(by(["a"], []), []);
});

test("recent hostile stored data: prototype keys stay plain data", () => {
  const parsed = JSON.parse(
    '{"local::/w":["ok.ts",5,null,"../x","/abs"],"bad":"str","__proto__":["p.ts"]}',
  );
  assert.deepEqual(recentsFor(parsed, "local::/w"), ["ok.ts"]);
  const out = recordRecent(parsed, "local::/w", "n.ts");
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal({}["p.ts"], undefined);
  assert.deepEqual(recentsFor(out, "local::/w"), ["n.ts", "ok.ts"]);
  assert.equal(Object.hasOwn(out, "bad"), false);
  const proto = recordRecent({}, "__proto__", "a.ts");
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.deepEqual(recentsFor(proto, "__proto__"), ["a.ts"]);
});

test("recent scan reset: only the recents view keeps the selection", () => {
  assert.equal(scanResetsSelection("", ["a.ts"]), false);
  assert.equal(scanResetsSelection("", ["a.ts", "b.ts"]), false);
  assert.equal(scanResetsSelection("", []), true);
  for (const q of [" ", "a", ":12", "src"]) {
    assert.equal(scanResetsSelection(q, ["a.ts"]), true);
    assert.equal(scanResetsSelection(q, []), true);
  }
  for (const q of ["", " ", "a", ":3"])
    for (const list of [[], ["a.ts"], ["a.ts", "b.ts"]])
      assert.equal(scanResetsSelection(q, list), recentRows(q, list) === null);
});
