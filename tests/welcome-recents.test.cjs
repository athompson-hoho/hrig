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

const history = load("src/project-history.ts");
const { welcomeRecents, normalizeHistory, visitProject } = history;

function row(id, lastOpened, pinned = false, extra = {}) {
  return {
    id,
    connectionId: "local",
    endpoint: "endpoint-" + id,
    hostName: "This computer",
    root: "/work/" + id,
    name: id,
    lastOpened,
    pinned,
    rigId: "",
    rigName: "",
    ...extra,
  };
}

function ids(rows) {
  return rows.map((r) => r.id);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test("welcome recents tracer: stored history text gives pinned first then newest, capped at five", () => {
  const stored = JSON.stringify([
    row("r1", 300),
    row("p1", 100, true),
    row("r2", 500),
    row("p2", 200, true),
    row("r3", 400),
    row("r4", 250),
    row("r5", 150),
  ]);
  const parsed = JSON.parse(stored);
  const top = welcomeRecents(parsed);
  assert.deepEqual(ids(top), ["p2", "p1", "r2", "r3", "r1"]);
  assert.deepEqual(ids(welcomeRecents(parsed, 7)), [
    "p2",
    "p1",
    "r2",
    "r3",
    "r1",
    "r4",
    "r5",
  ]);
  assert.deepEqual(Object.keys(top[0]).sort(), [
    "connectionId",
    "endpoint",
    "hostName",
    "id",
    "lastOpened",
    "name",
    "pinned",
    "rigId",
    "rigName",
    "root",
  ]);
  assert.equal(top[0].pinned, true);
  assert.equal(top[4].pinned, false);
  assert.deepEqual(welcomeRecents([]), []);
  assert.deepEqual(Object.keys(history).sort(), [
    "availableConnection",
    "connectionIdentity",
    "normalizeHistory",
    "projectIdentity",
    "visitProject",
    "welcomeRecents",
  ]);
});

test("welcome recents order: pinned first, newest first, ties keep stored order", () => {
  const input = [
    row("new", 999),
    row("old-pin", 1, true),
    row("mid", 500),
    row("new-pin", 400, true),
    row("tie-a", 300),
    row("tie-b", 300),
    row("pin-tie-a", 50, true),
    row("pin-tie-b", 50, true),
  ];
  assert.deepEqual(ids(welcomeRecents(input, 100)), [
    "new-pin",
    "pin-tie-a",
    "pin-tie-b",
    "old-pin",
    "new",
    "mid",
    "tie-a",
    "tie-b",
  ]);
  const reversed = [...input].reverse();
  const rotated = [...input.slice(3), ...input.slice(0, 3)];
  for (const variant of [reversed, rotated]) {
    const got = ids(welcomeRecents(variant, 100));
    assert.equal(got[0], "new-pin");
    assert.ok(got.indexOf("old-pin") < got.indexOf("new"));
    assert.ok(got.indexOf("new") < got.indexOf("mid"));
    assert.deepEqual(got.slice(3, 6), ["old-pin", "new", "mid"]);
  }
});

test("welcome recents limit: default five, pinned take slots first, odd limits are handled", () => {
  const nine = Array.from({ length: 9 }, (_, i) => row("r" + i, 100 + i));
  assert.deepEqual(ids(welcomeRecents(nine)), ["r8", "r7", "r6", "r5", "r4"]);
  assert.equal(welcomeRecents(nine).length, 5);

  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => row("p" + i, 10 + i, true)),
    ...Array.from({ length: 6 }, (_, i) => row("r" + i, 500 + i)),
  ];
  assert.deepEqual(ids(welcomeRecents(mixed)), ["p2", "p1", "p0", "r5", "r4"]);

  const sevenPinned = [
    ...Array.from({ length: 7 }, (_, i) => row("p" + i, 10 + i, true)),
    row("u1", 900),
    row("u2", 901),
  ];
  assert.deepEqual(ids(welcomeRecents(sevenPinned)), [
    "p6",
    "p5",
    "p4",
    "p3",
    "p2",
  ]);

  assert.deepEqual(ids(welcomeRecents(nine, 2)), ["r8", "r7"]);
  assert.deepEqual(ids(welcomeRecents(nine, 1)), ["r8"]);
  assert.deepEqual(ids(welcomeRecents(nine, 2.9)), ["r8", "r7"]);
  assert.deepEqual(welcomeRecents(nine, 0), []);
  assert.deepEqual(welcomeRecents(nine, -3), []);
  for (const bad of [NaN, Infinity, "3", null]) {
    assert.equal(welcomeRecents(nine, bad).length, 5);
  }
  assert.equal(welcomeRecents(nine, 50).length, 9);
  assert.equal(welcomeRecents(nine, undefined).length, 5);
});

test("welcome recents dedupe: one row per id, the first stored row wins", () => {
  const input = [
    row("a", 5, false, { name: "first" }),
    row("a", 99, true, { name: "second" }),
    row("b", 7),
    row("c", 6),
  ];
  assert.deepEqual(ids(welcomeRecents(input, 2)), ["b", "c"]);
  const all = welcomeRecents(input, 10);
  assert.deepEqual(ids(all), ["b", "c", "a"]);
  assert.equal(all[2].name, "first");
  assert.equal(all[2].pinned, false);
  assert.equal(new Set(ids(all)).size, all.length);
});

test("welcome recents malformed: bad input and bad rows are ignored", () => {
  for (const bad of [undefined, null, "abc", 5, true, {}, { length: 2 }, []]) {
    assert.deepEqual(welcomeRecents(bad), []);
  }
  const mixed = [
    null,
    5,
    "x",
    [],
    {},
    { root: "/only/root" },
    { ...row("no-name", 10), name: undefined },
    { ...row("x", 10), id: 42 },
    { ...row("bad-rig", 10), rigName: 7 },
    row("empty-root", 10, false, { root: "" }),
    row("nul-root", 10, false, { root: "/a\0b" }),
    row("nan", NaN),
    row("negative", -1),
    row("string-time", "10"),
    row("long-name", 10, false, { name: "n".repeat(301) }),
    row("ok-old", 20),
    row("ok-new", 30),
    row("truthy", 25, 1),
    row("truthy-str", 26, "yes"),
  ];
  const before = JSON.stringify(mixed);
  const got = welcomeRecents(mixed, 100);
  assert.deepEqual(ids(got), ["ok-new", "truthy-str", "truthy", "ok-old"]);
  assert.ok(got.every((r) => r.pinned === false));
  assert.equal(JSON.stringify(mixed), before);
});

test("welcome recents stored-format compatibility with the real writer", () => {
  const local = {
    id: "local",
    name: "This computer",
    kind: "local",
  };
  const ssh = {
    id: "ssh-1",
    name: "QA box",
    kind: "ssh",
    host: "qa.example",
    port: 22,
  };
  let rows = [];
  rows = visitProject(rows, local, "/home/u/alpha", "linux");
  rows = visitProject(rows, ssh, "/srv/beta", "linux");
  rows = visitProject(rows, local, "/home/u/gamma", "linux");
  rows = rows.map((r) => (r.root === "/srv/beta" ? { ...r, pinned: true } : r));
  const got = welcomeRecents(rows, 100);
  assert.deepEqual(got, normalizeHistory(rows));
  assert.equal(got[0].name, "beta");
  assert.equal(got[0].pinned, true);
  assert.deepEqual(normalizeHistory(JSON.parse(JSON.stringify(got))), got);

  rows = got;
  for (let i = 0; i < 130; i++) {
    rows = visitProject(rows, local, "/home/u/extra" + i, "linux");
  }
  const capped = welcomeRecents(rows, 1000);
  assert.equal(capped.filter((r) => r.pinned).length, 1);
  assert.equal(capped.filter((r) => !r.pinned).length, 50);
  assert.equal(capped[0].pinned, true);
});

test("welcome recents immutability: input is never changed and rows are fresh", () => {
  const input = deepFreeze([row("a", 100), row("b", 200, true), row("c", 300)]);
  const before = JSON.stringify(input);
  const first = welcomeRecents(input);
  assert.ok(Array.isArray(first));
  assert.notEqual(first, input);
  for (const r of first) {
    assert.ok(!Object.isFrozen(r));
    assert.ok(!input.includes(r));
  }
  first[0].pinned = false;
  first[0].name = "changed";
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(ids(welcomeRecents(input)), ["b", "c", "a"]);
});

test("welcome recents invariants over a large messy history", () => {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const input = Array.from({ length: 500 }, () => {
    const n = next();
    return row("id" + (n % 120), (n >> 4) % 1000, (n >> 14) % 4 === 0);
  });
  const full = welcomeRecents(input, 500);
  assert.equal(full.length, normalizeHistory(input).length);
  for (const limit of [1, 3, 5, 8, 60, 500]) {
    const got = welcomeRecents(input, limit);
    assert.ok(got.length <= limit);
    assert.equal(new Set(ids(got)).size, got.length);
    let seenUnpinned = false;
    let lastPinned = Infinity;
    let lastUnpinned = Infinity;
    for (const r of got) {
      if (r.pinned) {
        assert.ok(!seenUnpinned);
        assert.ok(r.lastOpened <= lastPinned);
        lastPinned = r.lastOpened;
      } else {
        seenUnpinned = true;
        assert.ok(r.lastOpened <= lastUnpinned);
        lastUnpinned = r.lastOpened;
      }
    }
  }
  assert.deepEqual(welcomeRecents(input, 5), full.slice(0, 5));
});
