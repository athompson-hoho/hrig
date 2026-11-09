const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const { buildSync } = require("esbuild");
const cs = require("../electron/content-search.cjs");
const features = require("../electron/features.cjs");

const read = (file) => require("node:fs").readFileSync(file, "utf8");
const local = { id: "local", kind: "local" };
const E_ACUTE = String.fromCodePoint(0xe9);
const KANJI = String.fromCodePoint(0x65e5, 0x672c);

function load(entry) {
  const built = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const m = new Module(entry, module);
  m._compile(built.outputFiles[0].text, entry);
  return m.exports;
}

async function project(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-search-"));
  for (const [name, data] of Object.entries(files)) {
    const full = path.join(root, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  return root;
}

const FIXTURE = () => ({
  "a.txt": "Hello World\nTODO42 fix\nfoo_bar foo bar\n",
  "src/b.ts": `const caf${E_ACUTE} = 1;\nlet foobar = 2; // foo\nTODO7\n`,
  "src/deep/c.md": `${KANJI} text\nnothing\nFOO\n`,
  ".git/ignored.txt": "foo\n",
  "node_modules/x/y.js": "foo\n",
  "bin.dat": "foo\0bar\n",
  "big.txt": "x".repeat(2000001) + "foo\n",
  "long.txt": "x".repeat(1500) + " needle\nneedle early\n",
});

// The search as it was before this phase, kept here to prove the default is unchanged.
async function legacySearch(target, query) {
  const results = [];
  let count = 0;
  const scan = async (folder, depth = 0) => {
    if (depth > 25) return;
    for (const e of await fs
      .readdir(folder, { withFileTypes: true })
      .catch(() => [])) {
      if (
        e.isSymbolicLink() ||
        [".git", "node_modules", "dist", ".next", ".venv", "release"].includes(
          e.name,
        )
      )
        continue;
      const full = path.join(folder, e.name);
      if (e.isDirectory()) await scan(full, depth + 1);
      else {
        count++;
        try {
          if ((await fs.stat(full)).size <= 2000000) {
            const data = await fs.readFile(full);
            if (!data.includes(0))
              for (const [i, line] of data
                .toString("utf8")
                .split(/\r?\n/)
                .entries()) {
                if (line.toLowerCase().includes(query.toLowerCase()))
                  results.push({
                    path: path.relative(target, full).replaceAll("\\", "/"),
                    line: i + 1,
                    text: line.slice(0, 250),
                  });
                if (results.length >= 200) break;
              }
          }
        } catch {}
      }
      if (count >= 20000 || results.length >= 200) return;
    }
  };
  await scan(target);
  return results;
}

const search = (root, query, options, hooks) =>
  features.edit(
    local,
    {
      op: "searchText",
      root,
      path: "",
      query,
      ...(options === undefined ? {} : { options }),
    },
    hooks,
  );
const at = (result) =>
  result.matches
    .map((m) => `${m.path}:${m.line}`)
    .sort()
    .join(" ");

test("content-search tracer", async () => {
  const root = await project(FIXTURE());
  try {
    const real = await fs.realpath(root);
    for (const query of ["foo", "TODO", "hello", "needle", "zzz", "x"]) {
      const old = await legacySearch(real, query);
      assert.deepEqual(await search(root, query), old, `no options: ${query}`);
      const off = await search(root, query, { regex: false, wholeWord: false });
      assert.deepEqual(off.matches, old, `options off: ${query}`);
      assert.equal(off.truncated, false);
      assert.equal(off.reason, "");
      assert.ok(off.scanned >= 1);
    }
    assert.equal(
      at(await search(root, "TODO\\d+", { regex: true, wholeWord: false })),
      "a.txt:2 src/b.ts:3",
    );
    assert.equal(
      at(await search(root, "bar", { regex: false, wholeWord: true })),
      "a.txt:3",
    );
    assert.equal(
      at(await search(root, "FOO", { regex: false, wholeWord: true })),
      "a.txt:3 src/b.ts:2 src/deep/c.md:3",
    );
    assert.equal(
      at(await search(root, "fo+", { regex: true, wholeWord: true })),
      "a.txt:3 src/b.ts:2 src/deep/c.md:3",
    );
    assert.equal(
      at(await search(root, KANJI, { regex: false, wholeWord: true })),
      "src/deep/c.md:1",
    );
    const long = await search(root, "needle", {
      regex: true,
      wholeWord: false,
    });
    assert.equal(
      at(long),
      "long.txt:2",
      "regex tests the first 1,000 characters",
    );
    const literal = await search(root, "needle", {
      regex: false,
      wholeWord: false,
    });
    assert.equal(
      at(literal),
      "long.txt:1 long.txt:2",
      "literal reads the whole line",
    );
    assert.ok(literal.matches.every((m) => m.text.length <= 250));
    const bad = [
      ["(a+)+$", { regex: true }, /without an upper limit/],
      ["(", { regex: true }, /Invalid regular expression/],
      ["(a)\\1", { regex: true }, /Backreferences/],
      ["foo", { regex: "yes" }, /Invalid search options/],
      ["foo", { regex: true, extra: 1 }, /Invalid search options/],
      ["foo", [], /Invalid search options/],
      ["foo", null, /Invalid search options/],
    ];
    for (const [query, options, message] of bad)
      await assert.rejects(() => search(root, query, options), message, query);
    await assert.rejects(
      () => search(root, "x".repeat(301), { regex: false, wholeWord: false }),
      /under 300/,
    );
    // Remote requests are validated here, before anything is sent to a host.
    const remote = { id: "remote", kind: "ssh", host: "example.test" };
    for (const [query, options, message] of [
      ["(a+)+$", { regex: true }, /upper limit/],
      ["\\p{L}", { regex: true }, /WSL and SSH/],
      ["a", { regex: "yes" }, /Invalid search options/],
      ["a", { wholeWord: 1 }, /Invalid search options/],
    ])
      await assert.rejects(
        () =>
          features.edit(remote, {
            op: "searchText",
            root: "/p",
            path: "",
            query,
            options,
          }),
        message,
      );
    const many = await project({
      "m.txt": "needle\n".repeat(300),
    });
    try {
      const capped = await search(many, "needle", {
        regex: false,
        wholeWord: false,
      });
      assert.equal(capped.matches.length, 200);
      assert.equal(capped.truncated, true);
      assert.equal(capped.reason, "matches");
      assert.equal((await search(many, "needle")).length, 200);
    } finally {
      await fs.rm(many, { recursive: true, force: true });
    }
    const stopped = await search(
      root,
      "foo",
      { regex: false, wholeWord: false },
      { budgetMs: 0 },
    );
    assert.deepEqual(
      { m: stopped.matches.length, t: stopped.truncated, r: stopped.reason },
      { m: 0, t: true, r: "time" },
    );
    let ticks = 0;
    const slow = await search(
      root,
      "foo",
      { regex: false, wholeWord: false },
      { budgetMs: 5, now: () => ticks++ },
    );
    assert.equal(slow.reason, "time");
    assert.ok(slow.scanned < 8);
    // The injected clock decides, not the real one: a clock that jumps a second per read ends a 5 second budget at once.
    let jump = 0;
    const jumpy = await search(
      root,
      "foo",
      { regex: false, wholeWord: false },
      { budgetMs: 5000, now: () => (jump += 1000) },
    );
    assert.equal(jumpy.reason, "time");
    // The clock is read between lines too: a budget can end a search in the middle of one file.
    const wide = await project({ "w.txt": "needle\n".repeat(60) });
    try {
      let t = 0;
      const cut = await search(
        wide,
        "needle",
        { regex: false, wholeWord: false },
        { budgetMs: 12, now: () => t++ },
      );
      assert.equal(cut.reason, "time");
      assert.ok(cut.matches.length > 0 && cut.matches.length < 60);
    } finally {
      await fs.rm(wide, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("content-search pattern", () => {
  const L = cs.LIMITS;
  assert.deepEqual(
    [L.MAX_QUERY, L.MAX_PATTERN, L.MAX_LINE, L.MAX_MATCHES, L.MAX_FILES],
    [300, 200, 1000, 200, 20000],
  );
  assert.deepEqual(
    [L.MAX_FILE_BYTES, L.MAX_TEXT, L.MAX_DEPTH, L.BUDGET_MS],
    [2000000, 250, 25, 10000],
  );
  assert.throws(() => {
    "use strict";
    L.MAX_LINE = 5;
  });
  const rejected = [
    ["(a+)+$", /upper limit/],
    ["(a|aa)+$", /upper limit/],
    ["(a*)*", /upper limit/],
    ["(x+x+)+y", /upper limit/],
    ["^(([a-z])+.)+[A-Z]([a-z])+$", /upper limit/],
    ["(.*a){20}", /alternatives or optional/],
    ["(a|b){2}", /alternatives or optional/],
    ["((a?)b)?", /alternatives or optional/],
    ["a?".repeat(12) + "a".repeat(12), /optional parts/],
    ["(a|a)".repeat(11) + "x", /optional parts/],
    ["a{1,1000}".repeat(2), /optional parts/],
    [".*.*.*.*x", /At most 3 unbounded/],
    ["a+b+c+d+", /At most 3 unbounded/],
    ["(?<=a+)b", /Lookbehind/],
    ["(?<!a)b", /Lookbehind/],
    ["(?<n>a)", /Named groups/],
    ["(a)\\1", /Backreferences/],
    ["(?<n>a)\\k<n>", /Named/],
    ["[]", /Empty character classes/],
    ["[^]", /Empty character classes/],
    ["a{1,1001}", /at most 1000/],
    ["a{1001}", /at most 1000/],
    ["(", /Invalid regular expression/],
    ["[a-z", /Invalid regular expression/],
    ["a**", /Invalid regular expression/],
    ["(?i)x", /Invalid regular expression/],
    ["x".repeat(201), /at most 200 characters/],
    ["a\nb", /control characters/],
    ["a\0b", /control characters/],
    ["a" + String.fromCharCode(0x2028), /control characters/],
    ["", /Enter a regular expression/],
  ];
  for (const [pattern, message] of rejected) {
    const got = cs.inspectPattern(pattern);
    assert.match(String(got.error), message, JSON.stringify(pattern));
    assert.match(
      String(cs.compileQuery({ query: pattern, regex: true }).error || ""),
      message.source === "Enter a regular expression"
        ? /search text|regular/
        : message,
    );
  }
  const accepted = [
    ["TODO\\d+", 1, 0, false],
    ["foo.*bar", 1, 0, false],
    ["\\w+@\\w+\\.\\w+", 3, 0, true],
    ["^\\s*import .* from", 2, 0, true],
    ["(foo|bar)baz", 0, 1, false],
    ["(\\d{3}-){2}\\d{4}", 0, 0, false],
    ["\\bfoo\\b", 0, 0, false],
    ["a{2,5}b", 0, 2, false],
    ["(?:ab)?c", 0, 1, false],
    ["x(?=y)", 0, 0, false],
    ["x".repeat(200), 0, 0, false],
  ];
  for (const [pattern, unbounded, doublings, risky] of accepted) {
    assert.deepEqual(
      cs.inspectPattern(pattern),
      { unbounded, doublings, risky },
      pattern,
    );
    assert.equal(cs.inspectPattern(pattern, true).error, undefined, pattern);
  }
  assert.equal(cs.inspectPattern("\\p{L}+").error, undefined);
  for (const portable of [
    "\\p{L}+",
    "[\\P{N}x]",
    String.fromCharCode(92) + "u{1F600}",
    "\\cJ",
  ])
    assert.match(cs.inspectPattern(portable, true).error, /WSL and SSH/);
  assert.match(
    cs.compileQuery({ query: "\\p{L}", regex: true, portable: true }).error,
    /WSL and SSH/,
  );
  // Literal mode is the old test, character for character.
  for (const query of ["foo", "FOO", "I", "SS", "a.c", E_ACUTE, "x y"])
    for (const line of [
      "Foo bar",
      "ISSUE",
      "a.c abc",
      `CAF${E_ACUTE.toUpperCase()}`,
      "x  y",
      "",
    ])
      assert.equal(
        cs.compileQuery({ query }).test(line),
        line.toLowerCase().includes(query.toLowerCase()),
        `${query} in ${line}`,
      );
  assert.equal(cs.compileQuery({ query: "x" }).literal, true);
  assert.match(cs.compileQuery({ query: "" }).error, /Enter search text/);
  assert.match(cs.compileQuery({ query: "x".repeat(301) }).error, /under 300/);
  // Escaping: a literal never acts as a pattern.
  for (const literal of [
    "a.b*c",
    "[x]",
    "(",
    "a|b",
    "\\",
    "/",
    "$^",
    "{1,2}",
    E_ACUTE,
  ]) {
    const word = cs.compileQuery({ query: literal, wholeWord: true });
    assert.equal(word.test(` ${literal} `), true, literal);
    assert.equal(
      new RegExp(cs.escapeRegExp(literal), "u").test(`x${literal}y`),
      true,
    );
  }
  assert.equal(
    cs.compileQuery({ query: "a.c", wholeWord: true }).test("abc"),
    false,
  );
  assert.equal(
    cs.compileQuery({ query: "a+", wholeWord: true }).test("aaa"),
    false,
  );
  // Every syntax character is escaped: the unescaped form would match the line.
  for (const [literal, line] of [
    ["a|b", " b "],
    ["[x]", " x "],
    ["^a", " a "],
    ["a$", " a "],
    ["a?", " a "],
    ["(a)", " a "],
    ["a{1}", " a "],
  ])
    assert.equal(
      cs.compileQuery({ query: literal, wholeWord: true }).test(line),
      false,
      literal,
    );
  // Whole word: letters, digits and underscore of any script count as word characters.
  const word = (query, line, regex = false) =>
    cs.compileQuery({ query, wholeWord: true, regex }).test(line);
  assert.equal(word("foo", "a foo b"), true);
  assert.equal(word("foo", "foo"), true);
  assert.equal(word("foo", "foo."), true);
  assert.equal(word("foo", "(foo)"), true);
  assert.equal(word("foo", "foobar"), false);
  assert.equal(word("foo", "barfoo"), false);
  assert.equal(word("foo", "foo_"), false);
  assert.equal(word("foo", "_foo"), false);
  assert.equal(word("foo", "foo1"), false);
  assert.equal(word("foo", "1foo"), false);
  assert.equal(word("FOO", "a foo b"), true);
  assert.equal(word("caf", `caf${E_ACUTE}`), false);
  assert.equal(word(`caf${E_ACUTE}`, `un caf${E_ACUTE} noir`), true);
  assert.equal(word(`${E_ACUTE}t${E_ACUTE}`, `x${E_ACUTE}t${E_ACUTE}`), false);
  assert.equal(word(KANJI, `a ${KANJI} b`), true);
  assert.equal(word(KANJI, `a${KANJI}`), false);
  assert.equal(word("fo+", "a foo b", true), true);
  assert.equal(word("fo+", "a fooX b", true), false);
  assert.equal(word("foo|foobar", "a foobar b", true), true);
  // The pre-check wraps what the user typed: a stray parenthesis cannot escape it.
  assert.match(
    cs.compileQuery({ query: "a)(?:b", regex: true, wholeWord: true }).error,
    /Invalid/,
  );
  // Regex and whole word read at most 1,000 characters of a line; literal reads all.
  const far = "x".repeat(1000) + "needle";
  assert.equal(
    cs.compileQuery({ query: "needle", regex: true }).test(far),
    false,
  );
  assert.equal(
    cs.compileQuery({ query: "needle", wholeWord: true }).test(far),
    false,
  );
  assert.equal(cs.compileQuery({ query: "needle" }).test(far), true);
  assert.equal(
    cs.compileQuery({ query: "x{1000}", regex: true }).test(far),
    true,
  );
  // Options: only the two booleans, nothing else.
  assert.deepEqual(cs.normalizeSearchOptions({}), {
    options: { regex: false, wholeWord: false },
  });
  assert.deepEqual(
    cs.normalizeSearchOptions({ regex: true, wholeWord: true }),
    {
      options: { regex: true, wholeWord: true },
    },
  );
  for (const bad of [
    null,
    [],
    "x",
    1,
    { regex: 1 },
    { wholeWord: "true" },
    { other: true },
  ])
    assert.match(
      cs.normalizeSearchOptions(bad).error,
      /Invalid search options/,
    );
  // A request without options keeps the old behavior and has no time limit; one with options has 10 seconds.
  const legacy = cs.prepare({ query: "x" });
  assert.deepEqual(
    [legacy.legacy, legacy.options, legacy.budgetMs],
    [true, null, Infinity],
  );
  const bounded = cs.prepare({ query: "x", options: {} });
  assert.deepEqual([bounded.legacy, bounded.budgetMs], [false, 10000]);
  assert.deepEqual(
    [
      bounded.options.regex,
      bounded.options.wholeWord,
      bounded.options.budgetMs,
    ],
    [false, false, 10000],
  );
  assert.equal(
    cs.prepare({ query: "x", options: {} }, false, { budgetMs: 7 }).budgetMs,
    7,
  );
  // Budget over an injected clock.
  let now = 100;
  const budget = cs.createBudget(() => now, 50);
  assert.equal(budget.expired(), false);
  now = 149;
  assert.equal(budget.expired(), false);
  now = 150;
  assert.equal(budget.expired(), true);
  assert.equal(cs.createBudget(() => now + 1e12, Infinity).expired(), false);
  // Fuzz: the pre-check never throws, and every cheap pattern it accepts is fast on hostile lines.
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const alphabet = [
    "a",
    "b",
    ".",
    "*",
    "+",
    "?",
    "|",
    "(",
    ")",
    "(?:",
    "[a-c]",
    "\\d",
    "\\w",
    "{2}",
    "{1,3}",
    "{2,}",
    "\\1",
    "[",
    "]",
    "^",
    "$",
  ];
  const hostile = [
    "a".repeat(1000),
    "ab".repeat(500),
    "a".repeat(999) + "!",
    "aaa|".repeat(250),
  ];
  let accepted2 = 0;
  const started = Date.now();
  for (let run = 0; run < 1500; run++) {
    let pattern = "";
    for (let k = 1 + rnd(12); k > 0; k--)
      pattern += alphabet[rnd(alphabet.length)];
    const checked = cs.inspectPattern(pattern);
    const compiled = cs.compileQuery({ query: pattern, regex: true });
    assert.equal(Boolean(checked.error), Boolean(compiled.error), pattern);
    if (checked.error || checked.risky) continue;
    accepted2++;
    for (const line of hostile) compiled.test(line);
  }
  assert.ok(accepted2 > 50, `accepted ${accepted2}`);
  assert.ok(Date.now() - started < 8000, "cheap accepted patterns stay fast");
});

test(
  "content-search python",
  { skip: spawnSync("python3", ["--version"]).status !== 0 },
  async () => {
    const program = (request) => {
      const source = features.EDIT_PY;
      const wrapped =
        "import base64;exec(base64.b64decode(" +
        JSON.stringify(Buffer.from(source).toString("base64")) +
        "))";
      const run = spawnSync("python3", ["-c", wrapped], {
        input: JSON.stringify(request),
        encoding: "utf8",
      });
      return run.status === 0 ? JSON.parse(run.stdout) : { failed: run.stderr };
    };
    const root = await project(FIXTURE());
    try {
      const key = (rows) =>
        rows
          .map((m) => `${m.path}:${m.line}:${m.text}`)
          .sort()
          .join("|");
      const cases = [
        ["todo", { regex: false, wholeWord: false }],
        ["TODO\\d+", { regex: true, wholeWord: false }],
        ["foo", { regex: false, wholeWord: true }],
        ["FOO", { regex: false, wholeWord: true }],
        ["fo+", { regex: true, wholeWord: true }],
        ["foo|foobar", { regex: true, wholeWord: true }],
        [KANJI, { regex: false, wholeWord: true }],
        [`caf${E_ACUTE}`, { regex: false, wholeWord: true }],
        ["needle", { regex: true, wholeWord: false }],
        ["needle", { regex: false, wholeWord: false }],
        ["a.c", { regex: false, wholeWord: false }],
        ["^[A-Z]+\\d+", { regex: true, wholeWord: false }],
        ["x{1000}", { regex: true, wholeWord: false }],
      ];
      for (const [query, options] of cases) {
        const node = await search(root, query, options);
        const py = program({
          op: "searchText",
          root,
          path: "",
          query,
          options: { ...options, budgetMs: 10000 },
        });
        assert.equal(py.failed, undefined, `${query}: ${py.failed}`);
        assert.equal(
          key(py.matches),
          key(node.matches),
          `${query} ${JSON.stringify(options)}`,
        );
        assert.equal(py.truncated, false);
        assert.equal(py.reason, "");
      }
      // A request without options still answers with the plain list, like before.
      const old = program({ op: "searchText", root, path: "", query: "foo" });
      assert.ok(Array.isArray(old));
      assert.equal(key(old), key(await search(root, "foo")));
      // The budget and the caps are applied on the Python side too.
      const stopped = program({
        op: "searchText",
        root,
        path: "",
        query: "foo",
        options: { regex: false, wholeWord: false, budgetMs: 0 },
      });
      assert.deepEqual(
        [stopped.matches.length, stopped.truncated, stopped.reason],
        [0, true, "time"],
      );
      const many = await project({ "m.txt": "needle\n".repeat(300) });
      try {
        const capped = program({
          op: "searchText",
          root: many,
          path: "",
          query: "needle",
          options: { regex: false, wholeWord: false, budgetMs: 10000 },
        });
        assert.deepEqual(
          [capped.matches.length, capped.truncated, capped.reason],
          [200, true, "matches"],
        );
      } finally {
        await fs.rm(many, { recursive: true, force: true });
      }
      // Whole word checks both sides of a match, on the Python side too.
      const edges = await project({
        "e.txt":
          [
            "foo bar",
            "foobar",
            "xfoo",
            "foo_x",
            "foo1",
            "(foo)",
            "x-foo-y",
          ].join("\n") + "\n",
      });
      try {
        for (const options of [
          { regex: false, wholeWord: true },
          { regex: true, wholeWord: true },
        ]) {
          const py = program({
            op: "searchText",
            root: edges,
            path: "",
            query: "foo",
            options: { ...options, budgetMs: 10000 },
          });
          assert.equal(py.failed, undefined, py.failed);
          assert.deepEqual(
            py.matches.map((m) => m.line),
            [1, 6, 7],
          );
          assert.equal(
            key(py.matches),
            key((await search(edges, "foo", options)).matches),
          );
        }
      } finally {
        await fs.rm(edges, { recursive: true, force: true });
      }
      // Python reports a pattern it cannot compile; Node refuses most of them before sending.
      const broken = program({
        op: "searchText",
        root,
        path: "",
        query: "(",
        options: { regex: true, wholeWord: false, budgetMs: 10000 },
      });
      assert.match(broken.failed, /Invalid regular expression/);
      // What the main process would send: validated options only.
      const sent = features.EDIT_PY.includes("o.get('regex')");
      assert.equal(sent, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test("content-search view", () => {
  const view = load("src/content-search-view.ts");
  assert.deepEqual(view.defaultSearchOptions, {
    regex: false,
    wholeWord: false,
  });
  assert.deepEqual(
    view.buildSearchRequest("foo", { regex: true, wholeWord: false }),
    {
      op: "searchText",
      query: "foo",
      options: { regex: true, wholeWord: false },
    },
  );
  assert.deepEqual(
    view.buildSearchRequest("foo", { regex: false, wholeWord: true }).options,
    { regex: false, wholeWord: true },
  );
  const row = { path: "a.ts", line: 3, text: "x" };
  assert.deepEqual(view.readSearchOutcome([row]), {
    matches: [row],
    truncated: false,
    reason: "",
  });
  assert.deepEqual(
    view.readSearchOutcome({ matches: [row], truncated: true, reason: "time" }),
    {
      matches: [row],
      truncated: true,
      reason: "time",
    },
  );
  for (const junk of [
    null,
    undefined,
    "x",
    4,
    {},
    { matches: "x" },
    { matches: [null, 1, {}, { path: 1, line: 2 }] },
    { reason: 7 },
  ])
    assert.deepEqual(
      view.readSearchOutcome(junk),
      { matches: [], truncated: false, reason: "" },
      JSON.stringify(junk),
    );
  assert.deepEqual(
    view.readSearchOutcome({
      matches: [{ path: "a", line: 1 }],
      reason: "other",
    }),
    {
      matches: [{ path: "a", line: 1, text: "" }],
      truncated: false,
      reason: "",
    },
  );
  assert.equal(
    view.searchNote({ regex: false, wholeWord: false }),
    "Literal, case-insensitive search. Up to 200 matches across 20,000 files; dependencies and binaries are excluded.",
  );
  assert.match(
    view.searchNote({ regex: true, wholeWord: false }),
    /^Regular expression, case-insensitive search\./,
  );
  assert.match(
    view.searchNote({ regex: false, wholeWord: true }),
    /^Literal, case-insensitive, whole word search\./,
  );
  assert.match(
    view.searchNote({ regex: true, wholeWord: true }),
    /^Regular expression, case-insensitive, whole word search\./,
  );
  assert.equal(
    view.stopNote({ matches: [], truncated: false, reason: "" }),
    "",
  );
  assert.match(
    view.stopNote({ matches: [], truncated: true, reason: "matches" }),
    /first 200 matches/,
  );
  assert.match(
    view.stopNote({ matches: [], truncated: true, reason: "files" }),
    /20,000 files/,
  );
  assert.match(
    view.stopNote({ matches: [], truncated: true, reason: "time" }),
    /time limit/,
  );
});

test("content-search wiring", () => {
  const panels = read("src/WorkbenchPanels.tsx");
  const viewSource = read("src/content-search-view.ts");
  const matcher = read("electron/content-search.cjs");
  const featuresSource = read("electron/features.cjs");
  const code = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
  assert.equal(
    (panels.match(/buildSearchRequest\(query, options\)/g) || []).length,
    2,
  );
  assert.ok(panels.includes('aria-label="Use regular expression"'));
  assert.ok(panels.includes('aria-label="Match whole word"'));
  assert.ok(panels.includes("aria-pressed={options.regex}"));
  assert.ok(panels.includes("aria-pressed={options.wholeWord}"));
  const tools = panels.slice(panels.indexOf("export function ProjectTools("));
  assert.ok(
    tools
      .slice(0, tools.indexOf('className="search-results"'))
      .includes("{error && <ErrorBox error={error} />}"),
  );
  assert.ok(panels.includes("const outcome = readSearchOutcome(result);"));
  assert.ok(panels.includes("setStopped(stopNote(outcome));"));
  assert.ok(panels.includes("{searchNote(options)}"));
  assert.ok(!panels.includes('action({ op: "searchText"'));
  assert.ok(!panels.includes("Literal, case-insensitive search."));
  for (const source of [panels, viewSource]) {
    assert.ok(
      !/content-search\.cjs/.test(source),
      "the renderer never imports the main process module",
    );
    assert.ok(
      !/new RegExp|dangerouslySetInnerHTML|innerHTML|eval\(|new Function/.test(
        code(source),
      ),
    );
  }
  assert.ok(!/localStorage|sessionStorage|window\.hrig/.test(code(viewSource)));
  const requires = [
    ...code(matcher).matchAll(/require\(["']([^"']+)["']\)/g),
  ].map((m) => m[1]);
  for (const name of requires)
    assert.ok(
      !/^(node:)?(fs|child_process|net|http|https|os|path)(\/.*)?$|electron/.test(
        name,
      ),
      name,
    );
  assert.ok(!/eval\(|new Function|process\./.test(code(matcher)));
  const editStart = featuresSource.indexOf("async function edit(");
  const body = featuresSource.slice(editStart);
  const prepared = body.indexOf("contentSearch.prepare(");
  const sentToPython = body.indexOf("EDIT_PY,");
  assert.ok(
    prepared > 0 && sentToPython > prepared,
    "validation runs before anything is sent",
  );
  assert.ok(
    body.includes("{ ...a, options: search.options }"),
    "Python only gets the validated options",
  );
  assert.ok(
    !body.includes("a.options"),
    "the raw options are never read after validation",
  );
  for (const token of [
    "re.compile(",
    "re.IGNORECASE",
    "text[:1000]",
    "time.monotonic()",
    "re.escape(query)",
  ])
    assert.ok(featuresSource.includes(token), token);
  assert.ok(featuresSource.includes("search.test(line)"));
  assert.ok(
    !featuresSource.includes(
      "line.toLowerCase().includes(a.query.toLowerCase())",
    ),
  );
});
