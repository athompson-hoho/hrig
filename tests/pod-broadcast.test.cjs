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
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const built = buildSync({
  entryPoints: ["src/pod-broadcast.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("pod-broadcast", module);
mod.paths = module.paths;
mod._compile(built.outputFiles[0].text, "pod-broadcast");
const {
  MAX_RECIPIENTS,
  MAX_TEXT_CHARS,
  podGroups,
  previewRecipients,
  validateBroadcastText,
  confirmationPhrase,
  confirmed,
} = mod.exports;

// A seat as the app holds it after normalizeInventory.
const seat = (over = {}) => ({
  id: "r1:dev-impl",
  rigId: "r1",
  rigName: "alpha",
  name: "dev-impl",
  pod: "dev",
  runtime: "claude-code",
  model: "",
  session: "dev-impl@alpha",
  status: "idle",
  activity: "",
  error: "",
  workCount: 0,
  ...over,
});
const named = (name, over = {}) =>
  seat({ id: "r1:" + name, name, session: name + "@alpha", ...over });
const ids = (list) => list.map((s) => s.id);
const empty = { recipients: [], excluded: [], unread: 0 };
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

test("pod-broadcast exports: exactly the seven names, the cap is 8 and the text limit is 10000", () => {
  assert.deepEqual(Object.keys(mod.exports).sort(), [
    "MAX_RECIPIENTS",
    "MAX_TEXT_CHARS",
    "confirmationPhrase",
    "confirmed",
    "podGroups",
    "previewRecipients",
    "validateBroadcastText",
  ]);
  assert.equal(MAX_RECIPIENTS, 8);
  assert.equal(MAX_TEXT_CHARS, 10000);
});

test("pod-broadcast groups: by rig and pod, never by pod name alone, sorted, and a seat says why it is blocked", () => {
  const input = deepFreeze([
    named("dev-qa"),
    named("dev-impl"),
    named("ops-1", { pod: "ops" }),
    named("lead", { pod: "" }),
    named("solo", { pod: 7 }),
    named("odd", { pod: "(no pod)" }),
    seat({ id: "r2:dev-impl", rigId: "r2", rigName: "beta" }),
    named("dev-old", { status: "stopped" }),
    named("dev-nosession", { session: null }),
    named("human", { runtime: "human" }),
    named("shell", { runtime: "terminal" }),
  ]);
  const groups = podGroups(input);
  assert.deepEqual(
    groups.map((g) => [g.rigId, g.rigName, g.pod, ids(g.seats)]),
    [
      ["r1", "alpha", "(no pod)", ["r1:lead", "r1:solo"]],
      ["r1", "alpha", "(no pod)", ["r1:odd"]],
      [
        "r1",
        "alpha",
        "dev",
        [
          "r1:dev-impl",
          "r1:dev-nosession",
          "r1:dev-old",
          "r1:dev-qa",
          "r1:human",
          "r1:shell",
        ],
      ],
      ["r1", "alpha", "ops", ["r1:ops-1"]],
      ["r2", "beta", "dev", ["r2:dev-impl"]],
    ],
  );
  const dev = groups[2].seats;
  assert.deepEqual(
    dev.map((s) => s.blocked),
    ["", "no session", "stopped", "", "person", "terminal seat"],
  );
  assert.deepEqual(dev[0], {
    id: "r1:dev-impl",
    name: "dev-impl",
    address: "dev-impl@alpha",
    runtime: "claude-code",
    status: "idle",
    blocked: "",
  });
  // Two seats with one name sort by id; a repeated id counts once, the first row wins.
  const tie = podGroups([
    seat({ id: "r1:b", name: "same" }),
    seat({ id: "r1:a", name: "same" }),
    seat({ id: "r1:a", name: "other", status: "stopped" }),
  ]);
  assert.equal(tie.length, 1);
  assert.deepEqual(ids(tie[0].seats), ["r1:a", "r1:b"]);
  assert.equal(tie[0].seats[0].name, "same");
  for (const bad of [undefined, null, 5, "x", {}, () => 1, Symbol("s"), 10n])
    assert.deepEqual(podGroups(bad), []);
});

test("pod-broadcast names: hostile names are cleaned, cut to 64, and a seat whose shown name differs from its real one is blocked", () => {
  const tricky = seat({
    id: "r1:tricky",
    name: "de\u200bv-im\u202epl\u0000\u0007",
    rigName: "al\u202ephA",
  });
  const long = seat({ id: "r1:long", name: "n".repeat(100) });
  const dashed = seat({ id: "r1:dash", name: "--rig" });
  const spaced = seat({ id: "r1:space", name: "two words" });
  const hosted = seat({ id: "r1:host", name: "a@b" });
  const comma = seat({ id: "r1:comma", name: "a,b" });
  const bare = seat({ id: "r1:bare", name: "", rigName: "  " });
  const padded = seat({ id: "r1:pad", name: " padded " });
  const groups = podGroups([
    tricky,
    long,
    dashed,
    spaced,
    hosted,
    comma,
    bare,
    padded,
  ]);
  assert.equal(groups.length, 1);
  const seats = Object.fromEntries(
    groups.flatMap((g) => g.seats.map((s) => [s.id, s])),
  );
  assert.equal(seats["r1:tricky"].address, "dev-impl@alphA");
  assert.equal(seats["r1:long"].name, "n".repeat(64));
  assert.equal(seats["r1:long"].address, "n".repeat(64) + "@alpha");
  assert.equal(seats["r1:pad"].name, "padded");
  for (const id of [
    "tricky",
    "long",
    "dash",
    "space",
    "host",
    "comma",
    "bare",
    "pad",
  ])
    assert.equal(seats["r1:" + id].blocked, "unsafe name", id);
  assert.equal(JSON.stringify(groups).includes("\u202e"), false);
  assert.equal(JSON.stringify(groups).includes("\u0007"), false);
  // Emoji are cut on a code point boundary, never in the middle of a pair.
  const emoji = podGroups([seat({ id: "r1:e", name: "\u{1F600}".repeat(70) })]);
  assert.equal(Array.from(emoji[0].seats[0].name).length, 64);
  assert.ok(!emoji[0].seats[0].name.includes("\ufffd"));
  // A huge value is only read at its start.
  const huge = podGroups([seat({ id: "r1:h", name: "a".repeat(5e6) })]);
  assert.equal(huge[0].seats[0].name.length, 64);
  // Ids over 200 characters count as missing; at most 500 rows are read.
  assert.deepEqual(podGroups([seat({ id: "x".repeat(201) })]), []);
  const rows = Array.from({ length: 500 }, (_, i) => seat({ id: "r1:" + i }));
  let touched = false;
  Object.defineProperty(rows, 500, {
    enumerable: true,
    get() {
      touched = true;
      return seat({ id: "r1:late" });
    },
  });
  rows.length = 501;
  const all = podGroups(rows);
  assert.equal(touched, false);
  assert.equal(all[0].seats.length, 500);
});

test("pod-broadcast preview: every selected id lands in one list, in the order ticked, with a reason and a fixed order of checks", () => {
  const list = deepFreeze([
    named("a"),
    named("b", { status: "working" }),
    named("j", { status: "attention" }),
    named("c", { status: "stopped" }),
    named("d", { status: "exited" }),
    named("e", { status: "failed" }),
    named("f", { session: null }),
    named("human"),
    named("shell", { runtime: "terminal" }),
    named("-evil"),
    named("both", { runtime: "human", status: "stopped", session: null }),
    named("up", { status: " STOPPED " }),
  ]);
  const pick = [
    "r1:a",
    "r1:c",
    "r1:nope",
    "r1:a",
    "r1:d",
    "r1:e",
    "r1:f",
    "r1:human",
    "r1:shell",
    "r1:-evil",
    "r1:both",
    "r1:up",
    "r1:b",
    "r1:j",
  ];
  assert.deepEqual(previewRecipients(list, deepFreeze(pick)), {
    recipients: [
      {
        id: "r1:a",
        address: "a@alpha",
        runtime: "claude-code",
        status: "idle",
      },
      {
        id: "r1:b",
        address: "b@alpha",
        runtime: "claude-code",
        status: "working",
      },
      {
        id: "r1:j",
        address: "j@alpha",
        runtime: "claude-code",
        status: "attention",
      },
    ],
    excluded: [
      { id: "r1:c", address: "c@alpha", reason: "stopped" },
      { id: "r1:nope", address: "", reason: "unknown seat" },
      { id: "r1:a", address: "a@alpha", reason: "duplicate" },
      { id: "r1:d", address: "d@alpha", reason: "exited" },
      { id: "r1:e", address: "e@alpha", reason: "failed" },
      { id: "r1:f", address: "f@alpha", reason: "no session" },
      { id: "r1:human", address: "human@alpha", reason: "person" },
      { id: "r1:shell", address: "shell@alpha", reason: "terminal seat" },
      { id: "r1:-evil", address: "-evil@alpha", reason: "unsafe name" },
      { id: "r1:both", address: "both@alpha", reason: "person" },
      { id: "r1:up", address: "up@alpha", reason: "stopped" },
    ],
    unread: 0,
  });
  // The recipients are the people a seat would be sent to; two rigs, one name.
  const mixed = previewRecipients(
    [seat(), seat({ id: "r2:dev-impl", rigId: "r2", rigName: "beta" })],
    ["r2:dev-impl", "r1:dev-impl"],
  );
  assert.deepEqual(
    mixed.recipients.map((r) => r.address),
    ["dev-impl@beta", "dev-impl@alpha"],
  );
  // Nothing selected, or no list: nothing to send to.
  assert.deepEqual(previewRecipients(list, []), empty);
  assert.deepEqual(previewRecipients([], ["r1:a"]).excluded, [
    { id: "r1:a", address: "", reason: "unknown seat" },
  ]);
  for (const bad of [undefined, null, 5, "r1:a", {}, () => 1])
    assert.deepEqual(previewRecipients(list, bad), empty);
  for (const bad of [undefined, null, 5, "x", {}, () => 1])
    assert.deepEqual(previewRecipients(bad, ["r1:a"]), empty);
});

test("pod-broadcast cap: at most 8 recipients, the rest reported as over cap, and a long selection is only counted past 100", () => {
  const many = Array.from({ length: 12 }, (_, i) => named("s" + (i + 10)));
  const pick = many.map((s) => s.id);
  const all = previewRecipients(many, pick);
  assert.equal(all.recipients.length, MAX_RECIPIENTS);
  assert.deepEqual(ids(all.recipients), pick.slice(0, 8));
  assert.deepEqual(
    all.excluded.map((e) => [e.id, e.reason]),
    pick.slice(8).map((id) => [id, "over cap"]),
  );
  // Past the cap a seat still gets its own reason, and a repeat is a repeat.
  const stopped = named("old", { status: "stopped" });
  const past = previewRecipients(
    [...many, stopped],
    [...pick, stopped.id, pick[0], "r1:nope"],
  );
  assert.deepEqual(
    past.excluded.slice(4).map((e) => e.reason),
    ["stopped", "duplicate", "unknown seat"],
  );
  assert.equal(past.recipients.length, 8);
  // Seven fit with room to spare; exactly eight is allowed.
  assert.equal(previewRecipients(many, pick.slice(0, 7)).excluded.length, 0);
  assert.equal(previewRecipients(many, pick.slice(0, 8)).excluded.length, 0);
  // 150 ids: the first 100 are read, the other 50 are only counted and never recipients.
  const same = Array.from({ length: 150 }, () => pick[0]);
  const long = previewRecipients(many, same);
  assert.equal(long.recipients.length + long.excluded.length, 100);
  assert.equal(long.unread, 50);
  const far = [...pick.slice(0, 8), ...Array(92).fill("x"), "r1:s18"];
  const beyond = previewRecipients(many, far);
  assert.equal(beyond.unread, 1);
  assert.ok(!beyond.recipients.some((r) => r.id === "r1:s18"));
  assert.ok(!beyond.excluded.some((e) => e.id === "r1:s18"));
  // At most 500 rows of the seat list are read: seat 501 is unknown.
  const rows = Array.from({ length: 501 }, (_, i) => seat({ id: "r1:" + i }));
  const read = previewRecipients(rows, ["r1:499", "r1:500"]);
  assert.deepEqual(ids(read.recipients), ["r1:499"]);
  assert.equal(read.excluded[0].reason, "unknown seat");
  // The first row with an id wins.
  const dup = previewRecipients(
    [
      seat({ id: "r1:x", name: "first" }),
      seat({ id: "r1:x", status: "stopped" }),
    ],
    ["r1:x"],
  );
  assert.equal(dup.recipients[0].address, "first@alpha");
});

test("pod-broadcast text: the exact text or a reason, with the limit counted in characters", () => {
  const ok = [
    "hello",
    "  lead and trail \n",
    "a\tb\nc\n\nd",
    "x",
    "x".repeat(10000),
    "\u{1F600}".repeat(10000),
    "caf\u00e9 \u20ac \u2764\ufe0f",
    "- starts with a dash",
  ];
  for (const text of ok) {
    const r = validateBroadcastText(text);
    assert.equal(r.ok, true, JSON.stringify(text.slice(0, 20)));
    assert.equal(r.text, text);
  }
  const refused = (value, reason) =>
    assert.deepEqual(validateBroadcastText(value), { ok: false, reason });
  for (const v of [undefined, null, 5, {}, [], () => 1, Symbol("s"), 10n])
    refused(v, "not text");
  for (const v of ["", " ", "   ", "\n\t ", "\u00a0", "\u2003 "])
    refused(v, "empty");
  refused("x".repeat(10001), "too long");
  refused("x".repeat(20001), "too long");
  refused("\u{1F600}".repeat(10001), "too long");
  refused("\u0000" + "x".repeat(10001), "too long");
  for (const v of [
    "a\u0000b",
    "\u001b[31mred",
    "a\r\nb",
    "a\rb",
    "a\u007fb",
    "a\u0085b",
    "a\u009bb",
    "a\u2028b",
    "a\u2029b",
    "a\u0007b",
    "a\u000bb",
  ])
    refused(v, "control characters");
  for (const v of [
    "a\u200bb",
    "a\u200db",
    "a\u200eb",
    "a\u202eb",
    "a\u2066b",
    "a\ufeffb",
    "a\u2060b",
    "a\u00adb",
    "a\u{E0041}b",
    "a\ud800b",
    "\u{1F468}\u200d\u{1F469}",
  ])
    refused(v, "hidden characters");
  // A control character is named before a hidden one.
  refused("\u0000\u200b", "control characters");
});

test("pod-broadcast confirm: the phrase is the count as typed, exact, and only for 1 to 8", () => {
  for (let n = 1; n <= 8; n++) {
    assert.equal(confirmationPhrase(n), String(n));
    assert.equal(confirmed(String(n), n), true);
  }
  for (const n of [
    0,
    9,
    -1,
    1.5,
    NaN,
    Infinity,
    -0,
    "3",
    null,
    undefined,
    {},
    [],
  ])
    assert.equal(confirmationPhrase(n), "", String(n));
  for (const [phrase, count] of [
    ["03", 3],
    ["08", 8],
    [" 3", 3],
    ["3 ", 3],
    ["3\n", 3],
    ["\u00a03", 3],
    [3, 3],
    ["\uff13", 3],
    ["\u0663", 3],
    ["3", 4],
    ["4", 3],
    ["", 3],
    ["", 0],
    ["0", 0],
    ["9", 9],
    ["3", "3"],
    [undefined, 1],
    [null, 1],
    [{}, 1],
    [["3"], 3],
  ])
    assert.equal(
      confirmed(phrase, count),
      false,
      JSON.stringify([phrase, count]),
    );
  assert.equal(confirmed(Symbol("p"), Symbol("c")), false);
  assert.equal(confirmed("8", MAX_RECIPIENTS), true);
});

test("pod-broadcast hostile: odd rows, throwing getters and proxies never throw, never change the input and never reach the prototype", () => {
  const junk = [undefined, null, 5, "x", {}, [], () => 1, Symbol("s"), 10n];
  assert.deepEqual(podGroups([...junk, { id: 5 }, { id: "" }, [seat()]]), []);
  assert.deepEqual(
    previewRecipients([...junk, { id: 5 }], ["x"]).recipients,
    [],
  );
  // A row whose field throws is skipped; the others still work.
  const boom = {
    get id() {
      throw new Error("boom");
    },
  };
  const boomName = seat({ id: "r1:boom" });
  Object.defineProperty(boomName, "name", {
    get() {
      throw new Error("boom");
    },
  });
  const good = seat({ id: "r1:good" });
  assert.deepEqual(ids(podGroups([boom, boomName, good])[0].seats), [
    "r1:good",
  ]);
  assert.deepEqual(
    ids(previewRecipients([boom, boomName, good], ["r1:good"]).recipients),
    ["r1:good"],
  );
  // A list or a selection that throws gives nothing, and nothing to send to.
  const hostile = new Proxy([seat()], {
    get(target, key) {
      if (key === "length") throw new Error("boom");
      return target[key];
    },
  });
  assert.deepEqual(podGroups(hostile), []);
  assert.deepEqual(previewRecipients(hostile, ["r1:dev-impl"]), empty);
  const picked = ["r1:dev-impl"];
  Object.defineProperty(picked, 1, {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  picked.length = 2;
  assert.deepEqual(previewRecipients([seat()], picked), empty);
  // Ids that look like object keys are ordinary ids.
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const keys = ["__proto__", "constructor", "toString", "hasOwnProperty"];
  const rows = keys.map((id) => seat({ id, name: id.replace(/_/g, "x") }));
  const out = previewRecipients(rows, keys);
  assert.deepEqual(ids(out.recipients), keys);
  assert.deepEqual(ids(podGroups(rows)[0].seats).sort(), [...keys].sort());
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);
  assert.equal({}.recipients, undefined);
  // Selected values that are not text name no seat; a frozen input is never written to.
  const odd = previewRecipients(deepFreeze([seat()]), [
    5,
    null,
    {},
    [],
    "r1:dev-impl",
  ]);
  assert.deepEqual(
    odd.excluded.map((e) => e.reason),
    ["unknown seat", "unknown seat", "unknown seat", "unknown seat"],
  );
  assert.equal(odd.recipients.length, 1);
  // The result is fresh each time: changing one never changes the next.
  const first = previewRecipients([seat()], ["r1:dev-impl"]);
  first.recipients[0].address = "changed";
  assert.equal(
    previewRecipients([seat()], ["r1:dev-impl"]).recipients[0].address,
    "dev-impl@alpha",
  );
  // A very long selection and a very long text are read in bounded time.
  const flood = previewRecipients(
    [seat()],
    new Array(200000).fill("r1:dev-impl"),
  );
  assert.equal(flood.unread, 199900);
  assert.equal(validateBroadcastText("x".repeat(5e6)).ok, false);
});

test("pod-broadcast tracer: a CLI inventory through the real normalizer, a pod chosen, a preview, a checked text and a typed count, and nothing is sent", () => {
  const cli = (logicalId, over = {}) => ({
    rigId: "rig-1",
    rigName: "alpha",
    logicalId,
    podNamespace: "dev",
    canonicalSessionName: logicalId + "@alpha",
    runtime: "claude-code",
    sessionStatus: "running",
    agentActivity: { state: "idle" },
    ...over,
  });
  const inventory = core.normalizeInventory(
    [
      { rigId: "rig-1", name: "alpha" },
      { rigId: "rig-2", name: "beta" },
    ],
    [
      cli("dev-impl"),
      cli("dev-qa", { agentActivity: { state: "running" } }),
      cli("dev-old", { sessionStatus: "stopped" }),
      cli("dev-shell", { runtime: "terminal" }),
      cli("human", { runtime: "human" }),
      cli("orch", { podNamespace: undefined }),
      cli("dev-impl", { rigId: "rig-2", rigName: "beta" }),
    ],
  );
  const calls = [];
  const bridge = new Proxy(
    {},
    {
      get(_, key) {
        calls.push(String(key));
        throw new Error("the bridge must not be touched");
      },
    },
  );
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const keep = globalThis.window;
  globalThis.window = { hrig: bridge };
  try {
    const groups = podGroups(inventory.seats);
    assert.deepEqual(
      groups.map((g) => g.rigName + "/" + g.pod),
      ["alpha/(no pod)", "alpha/dev", "beta/dev"],
    );
    const dev = groups[1];
    const preview = previewRecipients(
      inventory.seats,
      dev.seats.map((s) => s.id),
    );
    assert.deepEqual(
      preview.recipients.map((r) => [r.address, r.status]),
      [
        ["dev-impl@alpha", "idle"],
        ["dev-qa@alpha", "working"],
      ],
    );
    assert.deepEqual(
      preview.excluded.map((e) => [e.address, e.reason]),
      [
        ["dev-old@alpha", "stopped"],
        ["dev-shell@alpha", "terminal seat"],
        ["human@alpha", "person"],
      ],
    );
    const text = validateBroadcastText("Please pause and wait for review.");
    assert.equal(text.ok, true);
    const phrase = confirmationPhrase(preview.recipients.length);
    assert.equal(phrase, "2");
    assert.equal(confirmed("2", preview.recipients.length), true);
    assert.equal(confirmed("02", preview.recipients.length), false);
    assert.deepEqual(calls, []);
  } finally {
    if (had) globalThis.window = keep;
    else delete globalThis.window;
  }
});

test("pod-broadcast inert: no app source imports it, nothing sends, and no setting or shortcut names it", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|cjs|mjs|js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "src"));
  walk(path.join(root, "electron"));
  assert.ok(files.length > 20, "found the sources");
  for (const file of files) {
    if (path.basename(file) === "pod-broadcast.ts") continue;
    assert.ok(
      !fs.readFileSync(file, "utf8").includes("pod-broadcast"),
      path.relative(root, file) + " must not import pod-broadcast",
    );
  }
  for (const file of ["src/settings.ts", "src/shortcuts.ts"])
    assert.ok(
      !/broadcast/i.test(read(file)),
      file + " must not name a broadcast setting or shortcut",
    );
  const source = read("src/pod-broadcast.ts");
  assert.ok(!/[^\n -~]/.test(source), "the module is printable ASCII");
  const code = stripComments(source);
  assert.ok(!/^\s*import\b/m.test(code) && !/ from "/.test(code), "no import");
  assert.ok(
    !/(^|[^A-Za-z.])(window|document|fetch|process|require|localStorage|sessionStorage|navigator|clipboard|setTimeout|setInterval|console|hrig|sendMessage|writeTerminal|sendTerminalCommand|innerHTML)([^A-Za-z]|$)/.test(
      code,
    ) && !/Date\.now|new Date|Math\.random/.test(code),
    "no page, bridge, clock or randomness",
  );
  const lines = source.split("\n");
  const exported = lines.filter((line) => /^export /.test(line)).length;
  assert.equal(exported, 16, "sixteen exports");
  lines.forEach((line, i) => {
    if (/^export /.test(line))
      assert.ok(/\*\/\s*$/.test(lines[i - 1]), "documented: " + line);
  });
});
