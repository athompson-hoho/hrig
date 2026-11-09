const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function bundle(entry, external) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    external: external || [],
  }).outputFiles[0].text;
}
function load(entry, external, require) {
  const mod = new Module(path.join(root, entry), module);
  if (require) mod.require = require;
  mod._compile(bundle(entry, external), path.join(root, entry));
  return mod.exports;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const pure = load("src/review-checks.ts");
const {
  MAX_PROJECTS,
  MAX_PATHS,
  MAX_PATH_CHARS,
  MAX_REVISION_CHARS,
  MAX_RECHECK,
  reviewKey,
  usablePath,
  isCheckable,
  normalizeReviewChecks,
  isReviewed,
  reviewState,
  toggleReviewed,
  recheckPaths,
} = pure;
const { recentKey } = load("src/recent-files.ts");

const K = reviewKey("local", "/work/a");
const K2 = reviewKey("ssh:h", "/srv/b");

test("review-checks normalize: a saved value is read defensively, capped, and never reaches an object prototype", () => {
  assert.equal(MAX_PROJECTS, 20);
  assert.equal(MAX_PATHS, 200);
  assert.equal(MAX_PATH_CHARS, 1024);
  assert.equal(MAX_REVISION_CHARS, 128);
  assert.equal(MAX_RECHECK, 50);
  // The key is the one the recent files use: connection id and project root.
  assert.equal(reviewKey("local", "/work/a"), recentKey("local", "/work/a"));
  assert.equal(K, JSON.stringify(["local", "/work/a"]));

  for (const junk of [undefined, null, 5, "x", true, [], [[K, {}]], () => 1])
    assert.deepEqual(normalizeReviewChecks(junk), {});
  const good = {
    [K]: { "src/a.ts": "r1", "b.md": "r2" },
    [K2]: { "c.py": "r3" },
  };
  assert.deepEqual(normalizeReviewChecks(good), good);
  assert.deepEqual(
    Object.keys(normalizeReviewChecks(good)),
    [K, K2],
    "the saved order (oldest first) is kept",
  );

  // A saved file can hold anything: every bad revision, path and project is dropped on its own.
  const bad = {
    [K]: {
      ok: "r1",
      num: 5,
      nul: null,
      obj: {},
      arr: ["r"],
      empty: "",
      long: "r".repeat(MAX_REVISION_CHARS + 1),
      ctl: "r\u0000x",
      "": "r1",
      ["p".repeat(MAX_PATH_CHARS + 1)]: "r1",
      "nul\u0000path": "r1",
      "rlo\u202epath": "r1",
      "zw\u200bpath": "r1",
      "line\nbreak": "r1",
      "src/constructor": "r1",
      exact: "r".repeat(MAX_REVISION_CHARS),
    },
    nothing: { only: 5 },
    notAnObject: "x",
    list: ["a"],
  };
  assert.deepEqual(normalizeReviewChecks(bad), {
    [K]: {
      ok: "r1",
      "src/constructor": "r1",
      exact: "r".repeat(MAX_REVISION_CHARS),
    },
  });
  const longest = "p".repeat(MAX_PATH_CHARS);
  assert.deepEqual(normalizeReviewChecks({ [K]: { [longest]: "r1" } }), {
    [K]: { [longest]: "r1" },
  });

  // Hostile keys (own properties made by JSON.parse) are rejected and nothing is polluted.
  const hostile = JSON.parse(
    '{"__proto__":{"a":"r1"},"constructor":{"a":"r1"},"prototype":{"a":"r1"},' +
      JSON.stringify(K) +
      ':{"__proto__":"r1","constructor":"r1","prototype":"r1","polluted":"r1"}}',
  );
  const clean = normalizeReviewChecks(hostile);
  assert.deepEqual(clean, { [K]: { polluted: "r1" } });
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  assert.equal(Object.getPrototypeOf(clean[K]), Object.prototype);
  assert.equal({}.a, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);

  // At most 20 projects (the newest, which are the last saved) of at most 200 paths (the last saved).
  const many = {};
  for (let i = 0; i < MAX_PROJECTS + 5; i++) many["p" + i] = { f: "r" + i };
  const kept = normalizeReviewChecks(many);
  assert.deepEqual(Object.keys(kept), Object.keys(many).slice(-MAX_PROJECTS));
  const wide = {};
  for (let i = 0; i < MAX_PATHS + 7; i++) wide["f" + i] = "r" + i;
  const narrow = normalizeReviewChecks({ [K]: wide })[K];
  assert.equal(Object.keys(narrow).length, MAX_PATHS);
  assert.equal(Object.keys(narrow)[0], "f7");
  assert.equal(Object.keys(narrow).at(-1), "f" + (MAX_PATHS + 6));

  // Loading is idempotent, survives the JSON the state file is written with, and never changes its input.
  assert.deepEqual(
    normalizeReviewChecks(JSON.parse(JSON.stringify(kept))),
    kept,
  );
  assert.deepEqual(normalizeReviewChecks(kept), kept);
  const frozen = deepFreeze({ [K]: { a: "r1", ["b".repeat(2000)]: "r" } });
  assert.deepEqual(normalizeReviewChecks(frozen), { [K]: { a: "r1" } });
  assert.notEqual(normalizeReviewChecks(good), good, "a new object");
});

test("review-checks toggle: ticking stores the revision, unticking removes it, caps drop the oldest, and the input is never changed", () => {
  const none = deepFreeze({});
  const one = toggleReviewed(none, K, "a.ts", "r1");
  assert.deepEqual(one, { [K]: { "a.ts": "r1" } });
  assert.deepEqual(none, {}, "the input is untouched");
  assert.notEqual(one, none);
  deepFreeze(one);

  // A second file in the same project, and a project of another connection.
  const two = toggleReviewed(one, K, "b.ts", "r2");
  assert.deepEqual(two, { [K]: { "a.ts": "r1", "b.ts": "r2" } });
  const other = toggleReviewed(two, K2, "a.ts", "r9");
  assert.deepEqual(Object.keys(other), [K, K2]);
  assert.equal(other[K2]["a.ts"], "r9");
  assert.equal(
    other[K]["a.ts"],
    "r1",
    "the same path in another project is separate",
  );

  // Ticking again replaces the revision and makes the file and its project the newest.
  const again = toggleReviewed(deepFreeze(other), K, "a.ts", "r1b");
  assert.deepEqual(Object.keys(again), [K2, K]);
  assert.deepEqual(Object.keys(again[K]), ["b.ts", "a.ts"]);
  assert.equal(again[K]["a.ts"], "r1b");

  // Unticking removes the path; an emptied project disappears; unticking nothing changes nothing.
  const off = toggleReviewed(deepFreeze(one), K, "a.ts", null);
  assert.deepEqual(off, {});
  assert.deepEqual(toggleReviewed(deepFreeze(two), K, "b.ts", null), {
    [K]: { "a.ts": "r1" },
  });
  assert.deepEqual(toggleReviewed(deepFreeze(one), K, "zzz", null), one);
  assert.deepEqual(toggleReviewed(deepFreeze(one), K2, "a.ts", null), one);

  // The 201st file of a project drops its oldest check; the 21st project drops the oldest project.
  let wide = {};
  for (let i = 0; i < MAX_PATHS; i++)
    wide = toggleReviewed(wide, K, "f" + i, "r" + i);
  assert.equal(Object.keys(wide[K]).length, MAX_PATHS);
  const full = toggleReviewed(deepFreeze(wide), K, "extra", "rx");
  assert.equal(Object.keys(full[K]).length, MAX_PATHS);
  assert.equal(full[K].f0, undefined, "the oldest check went");
  assert.equal(full[K].f1, "r1");
  assert.equal(Object.keys(full[K]).at(-1), "extra");
  let projects = {};
  for (let i = 0; i < MAX_PROJECTS; i++)
    projects = toggleReviewed(projects, "p" + i, "f", "r");
  assert.equal(Object.keys(projects).length, MAX_PROJECTS);
  const over = toggleReviewed(deepFreeze(projects), "newest", "f", "r");
  assert.equal(Object.keys(over).length, MAX_PROJECTS);
  assert.equal(over.p0, undefined, "the oldest project went");
  assert.equal(Object.keys(over).at(-1), "newest");
  // Touching an old project makes it the newest, so it is the last to go.
  const touched = toggleReviewed(deepFreeze(projects), "p0", "g", "r");
  assert.equal(Object.keys(touched).at(-1), "p0");
  assert.equal(
    Object.keys(toggleReviewed(touched, "fresh", "f", "r")).includes("p1"),
    false,
  );

  // An unusable key, path or revision changes nothing and never pollutes a prototype.
  for (const [key, file, revision] of [
    ["__proto__", "a.ts", "r1"],
    ["constructor", "a.ts", "r1"],
    ["prototype", "a.ts", "r1"],
    ["", "a.ts", "r1"],
    [K, "__proto__", "r1"],
    [K, "constructor", "r1"],
    [K, "prototype", "r1"],
    [K, "", "r1"],
    [K, "a\u0000b", "r1"],
    [K, "a\u202eb", "r1"],
    [K, "p".repeat(MAX_PATH_CHARS + 1), "r1"],
    [K, "a.ts", ""],
    [K, "a.ts", "r".repeat(MAX_REVISION_CHARS + 1)],
    [K, "a.ts", "r\nx"],
    [K, "a.ts", 5],
    [K, "a.ts", undefined],
  ])
    assert.deepEqual(
      toggleReviewed(deepFreeze({ [K]: { x: "r0" } }), key, file, revision),
      { [K]: { x: "r0" } },
      JSON.stringify([key, file, revision]),
    );
  assert.equal({}.a, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
  // A saved value that was never normalized is cleaned on the way through.
  assert.deepEqual(toggleReviewed("junk", K, "a.ts", "r1"), {
    [K]: { "a.ts": "r1" },
  });
  assert.deepEqual(toggleReviewed(undefined, K, "a.ts", null), {});
});

test("review-checks state: a tick is reviewed only at the exact revision it was made at, and a changed file is never silently kept", () => {
  const checks = deepFreeze({ [K]: { "a.ts": "r1", "b.ts": "r2" } });
  assert.equal(isReviewed(checks, K, "a.ts", "r1"), true);
  assert.equal(isReviewed(checks, K, "a.ts", "r1b"), false, "stale");
  assert.equal(isReviewed(checks, K, "a.ts", ""), false);
  assert.equal(isReviewed(checks, K, "a.ts", null), false);
  assert.equal(isReviewed(checks, K, "a.ts", undefined), false);
  assert.equal(isReviewed(checks, K, "a.ts", 1), false);
  assert.equal(isReviewed(checks, K, "c.ts", "r1"), false, "not ticked");
  assert.equal(isReviewed(checks, K2, "a.ts", "r1"), false, "other project");
  for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"])
    assert.equal(isReviewed({}, key, key, "r1"), false);
  assert.equal(isReviewed({}, "toString", "valueOf", "r1"), false);
  assert.equal(isReviewed(undefined, K, "a.ts", "r1"), false);
  assert.equal(isReviewed("junk", K, "a.ts", "r1"), false);
  assert.equal(isReviewed({ [K]: { "a.ts": 5 } }, K, "a.ts", 5), false);

  // The five row states.
  assert.equal(reviewState(checks, K, "c.ts", "r1"), "unchecked");
  assert.equal(reviewState(checks, K, "c.ts", null), "unchecked");
  assert.equal(reviewState(checks, K, "c.ts", undefined), "unchecked");
  assert.equal(reviewState(checks, K, "a.ts", "r1"), "reviewed");
  assert.equal(reviewState(checks, K, "a.ts", "other"), "stale");
  assert.equal(reviewState(checks, K, "a.ts", ""), "stale");
  assert.equal(reviewState(checks, K, "a.ts", null), "failed");
  assert.equal(reviewState(checks, K, "a.ts", undefined), "unknown");
  assert.equal(reviewState(undefined, K, "a.ts", "r1"), "unchecked");
  assert.equal(reviewState({}, "toString", "valueOf", "r1"), "unchecked");

  // Paths: text, within the cap, no hidden characters, not a reserved object key.
  for (const good of [
    "a",
    "src/a b/c.ts",
    "p".repeat(MAX_PATH_CHARS),
    "src/prototype",
    "\u00e9\u4e2d.ts",
  ])
    assert.equal(usablePath(good), true, good);
  for (const bad of [
    "",
    "p".repeat(MAX_PATH_CHARS + 1),
    "__proto__",
    "constructor",
    "prototype",
    "a\u0000",
    "a\tb",
    "a\nb",
    "a\u007fb",
    "a\u0085b",
    "a\u200bb",
    "a\u200fb",
    "a\u2028b",
    "a\u202eb",
    "a\u2066b",
    "a\ufeffb",
    5,
    null,
    undefined,
    {},
    ["a"],
  ])
    assert.equal(usablePath(bad), false, JSON.stringify(bad));
  assert.equal(isCheckable({ path: "a.ts", status: "M" }), true);
  assert.equal(isCheckable({ path: "a.ts", status: "??" }), true);
  assert.equal(isCheckable({ path: "a.ts" }), true);
  assert.equal(isCheckable({ path: "a.ts", status: "D" }), false, "deleted");
  assert.equal(isCheckable({ path: "a\u202eb", status: "M" }), false);
  assert.equal(isCheckable({ path: 5, status: "M" }), false);
});

test("review-checks paths: at most 50 ticked files of the change list are read again, in list order, and the rest are reported", () => {
  const entries = [];
  const checks = { [K]: {}, [K2]: { "only-other.ts": "r" } };
  for (let i = 0; i < MAX_RECHECK + 10; i++) {
    entries.push({ path: "f" + i + ".ts", status: "M" });
    checks[K]["f" + i + ".ts"] = "r" + i;
  }
  entries.push({ path: "plain.ts", status: "M" });
  const got = recheckPaths(entries, deepFreeze(checks), K);
  assert.equal(got.read.length, MAX_RECHECK);
  assert.equal(got.skipped.length, 10);
  assert.deepEqual(
    got.read,
    entries.slice(0, MAX_RECHECK).map((e) => e.path),
  );
  assert.deepEqual(
    got.skipped,
    entries.slice(MAX_RECHECK, MAX_RECHECK + 10).map((e) => e.path),
  );
  assert.ok(!got.read.includes("plain.ts"), "an unticked file is never read");

  // Ticks of files that are not in the list, of other projects, deleted files and repeated entries are not read.
  const list = [
    { path: "a.ts", status: "M" },
    { path: "gone.ts", status: "D" },
    { path: "a.ts", status: "M" },
    { path: "b.ts", status: "M" },
  ];
  const saved = {
    [K]: { "a.ts": "r1", "gone.ts": "r2", "away.ts": "r3" },
    [K2]: { "b.ts": "r4" },
  };
  assert.deepEqual(recheckPaths(list, deepFreeze(saved), K), {
    read: ["a.ts"],
    skipped: [],
  });
  assert.deepEqual(recheckPaths(list, deepFreeze(saved), K2), {
    read: ["b.ts"],
    skipped: [],
  });
  assert.deepEqual(recheckPaths([], saved, K), { read: [], skipped: [] });
  assert.deepEqual(recheckPaths(list, undefined, K), { read: [], skipped: [] });
  assert.deepEqual(recheckPaths(list, {}, K), { read: [], skipped: [] });
  assert.deepEqual(recheckPaths(list, "junk", K), { read: [], skipped: [] });
});

// ---- the real ReviewWorkspace, run outside React over fakes ----
// The component is bundled with the real review-checks module; react, the icon set, the shared widgets, the editor buffers and the draft store are replaced. A small hook runtime keeps state and effects (with their dependency lists) so the real change list, tick handler and re-read run as written. Every call the component makes on the bridge is recorded.
const REVIEW_ENTRY = "src/ReviewWorkspace.tsx";
const REVIEW_EXTERNAL = [
  "react",
  "react/jsx-runtime",
  "lucide-react",
  "./components",
  "./editor-buffers",
  "./drafts",
];
const connection = { id: "local", name: "This computer", kind: "local" };
const ROOT = "/work/a";
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

let reviewLoaded;
function getReview() {
  reviewLoaded ??= loadReview();
  return reviewLoaded;
}
function loadReview() {
  const world = { current: null };
  const react = {
    useState: (initial) => world.current.state(initial),
    useRef: (initial) => world.current.ref(initial),
    useEffect: (fn, deps) => world.current.effect(fn, deps),
  };
  const icon = () => null;
  const mod = load(REVIEW_ENTRY, REVIEW_EXTERNAL, (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") {
      const make = (type, props, key) => ({ type, props, key });
      return { jsx: make, jsxs: make, Fragment: "fragment" };
    }
    if (name === "lucide-react")
      return {
        GitBranch: icon,
        Send: icon,
        FileCode2: icon,
        AlertCircle: icon,
      };
    if (name === "./components")
      return {
        ErrorBox: function ErrorBox() {},
        Loading: function Loading() {},
      };
    if (name === "./editor-buffers") return { problems: new Map() };
    if (name === "./drafts")
      return {
        draftKey: () => "review-draft",
        draftOperation() {},
        useDraft: (key, kind, initial) => {
          const [value, set] = world.current.state(initial);
          return [value, set, ""];
        },
      };
    throw new Error("unexpected import " + name);
  });
  function mount(initialProps, disk, entries) {
    const calls = { git: 0, reads: [], other: [], active: 0, maxActive: 0 };
    const bridge = {
      git: async () => {
        calls.git++;
        return { isRepository: true, root: ROOT, entries: entries.slice() };
      },
      edit: async (conn, request) => {
        calls.active++;
        calls.maxActive = Math.max(calls.maxActive, calls.active);
        try {
          await Promise.resolve();
          if (request.op !== "read") {
            calls.other.push(request);
            throw new Error("unexpected edit " + request.op);
          }
          calls.reads.push(request.path);
          if (!(request.path in disk)) throw new Error("cannot read");
          return { content: "", revision: disk[request.path] };
        } finally {
          calls.active--;
        }
      },
      sendMessage: async (...args) => {
        calls.other.push(["sendMessage", ...args]);
        return "";
      },
      saveState: async (...args) => calls.other.push(["saveState", ...args]),
      flushState: (...args) => calls.other.push(["flushState", ...args]),
      drafts: (...args) => {
        calls.other.push(["drafts", ...args]);
        return {};
      },
    };
    let props = {
      connection,
      root: ROOT,
      seats: [],
      checks: undefined,
      onChecks: () => {},
      onDiff() {},
      onSeat() {},
      onProject() {},
      ...initialProps,
    };
    const slots = [];
    const effectSlots = [];
    const pending = [];
    let hook = 0;
    let flushing = false;
    let tree = null;
    const inst = {
      state(initial) {
        const i = hook++;
        if (!(i in slots)) slots[i] = initial;
        return [
          slots[i],
          (next) => {
            const value = typeof next === "function" ? next(slots[i]) : next;
            if (Object.is(value, slots[i])) return;
            slots[i] = value;
            render();
          },
        ];
      },
      ref(initial) {
        const i = hook++;
        if (!(i in slots)) slots[i] = { current: initial };
        return slots[i];
      },
      effect(fn, deps) {
        const i = hook++;
        const previous = effectSlots[i];
        const changed =
          !previous ||
          !deps ||
          deps.some((d, k) => !Object.is(d, previous.deps[k]));
        if (!changed) return;
        effectSlots[i] = { deps, cleanup: previous && previous.cleanup };
        pending.push(() => {
          if (effectSlots[i].cleanup) effectSlots[i].cleanup();
          const cleanup = fn();
          effectSlots[i].cleanup =
            typeof cleanup === "function" ? cleanup : undefined;
        });
      },
    };
    function flush() {
      if (flushing) return;
      flushing = true;
      try {
        while (pending.length) pending.shift()();
      } finally {
        flushing = false;
      }
    }
    function render() {
      const before = world.current;
      world.current = inst;
      hook = 0;
      try {
        tree = mod.ReviewWorkspace(props);
      } finally {
        world.current = before;
      }
      flush();
    }
    function walk(node, visit) {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
      if (!node || typeof node !== "object" || !node.props) return;
      visit(node);
      walk(node.props.children, visit);
    }
    function find(match) {
      const found = [];
      walk(tree, (n) => match(n) && found.push(n));
      return found;
    }
    function text(node) {
      let out = "";
      const go = (n) => {
        if (typeof n === "string" || typeof n === "number") out += n;
        else if (Array.isArray(n)) n.forEach(go);
        else if (n && n.props) go(n.props.children);
      };
      go(node);
      return out;
    }
    const handle = {
      calls,
      get props() {
        return props;
      },
      setProps(patch) {
        props = { ...props, ...patch };
        render();
      },
      rows() {
        return find(
          (n) => n.type === "div" && n.props.className === "review-file-row",
        ).map((row) => {
          const [box] = find2(row, (n) => n.type === "input");
          const [button] = find2(row, (n) => n.type === "button");
          const hint = find2(
            row,
            (n) => n.type === "small" && n.props.className === "review-hint",
          )[0];
          const [name] = find2(button, (n) => n.type === "span");
          return {
            path: text(name),
            label: box.props["aria-label"],
            checked: box.props.checked,
            disabled: box.props.disabled,
            title: box.props.title,
            hint: hint ? text(hint) : "",
            type: box.props.type,
            box,
            button,
            row,
          };
        });
      },
      row(path) {
        const row = handle.rows().find((r) => r.path === path);
        assert.ok(row, "no row for " + path);
        return row;
      },
      async tick(path) {
        const row = handle.row(path);
        assert.ok(!row.disabled, path + " is disabled");
        row.box.props.onChange({ target: { checked: !row.checked } });
        await settle();
      },
      async refresh() {
        const button = find(
          (n) => n.type === "button" && text(n) === "Refresh changes",
        )[0];
        assert.ok(button, "no refresh button");
        button.props.onClick();
        await settle();
      },
      find,
      text,
      get tree() {
        return tree;
      },
    };
    function find2(node, match) {
      const found = [];
      const go = (n) => {
        if (Array.isArray(n)) return n.forEach(go);
        if (!n || typeof n !== "object" || !n.props) return;
        if (match(n)) found.push(n);
        go(n.props.children);
      };
      go(node);
      return found;
    }
    return { handle, bridge, render };
  }
  return { mount, world };
}

async function withReview(initial, run) {
  const review = getReview();
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const disk = { ...initial.disk };
  const entries = initial.entries;
  const mounted = review.mount(initial.props || {}, disk, entries);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { hrig: mounted.bridge },
  });
  try {
    // The fake of what App does with onChecks: normalize what is saved, apply the update, and give the result back as the new prop.
    const app = { checks: initial.checks, writes: 0 };
    const norm = normalizeReviewChecks;
    const onChecks = (update) => {
      const current = norm(app.checks);
      const next = update(current);
      if (next === current) return;
      app.checks = next;
      app.writes++;
      mounted.handle.setProps({ checks: app.checks });
    };
    mounted.handle.setProps({ checks: app.checks, onChecks });
    await settle();
    return await run({
      ...mounted,
      calls: mounted.handle.calls,
      disk,
      app,
      review,
      onChecks,
      norm,
    });
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete globalThis.window;
  }
}

const ENTRIES = [
  { path: "a.ts", status: "M" },
  { path: "b.ts", status: "M" },
  { path: "gone.ts", status: "D" },
];

test("review-checks tracer: a ticked file keeps the revision it had, survives a restart, loses its tick when the file changes, and sends nothing", async () => {
  await withReview(
    { entries: ENTRIES, disk: { "a.ts": "r1", "b.ts": "r2" } },
    async ({ handle, calls, disk, app }) => {
      // Nothing is read or stored for a list nobody ticked.
      assert.deepEqual(
        handle.rows().map((r) => [r.path, r.checked, r.hint]),
        [
          ["a.ts", false, ""],
          ["b.ts", false, ""],
          ["gone.ts", false, ""],
        ],
      );
      assert.deepEqual(calls.reads, []);
      assert.equal(app.checks, undefined);
      assert.ok(handle.rows().every((r) => r.type === "checkbox"));
      assert.equal(handle.row("a.ts").label, "Mark a.ts reviewed");
      // A deleted file cannot be ticked: disabled, with a reason.
      assert.equal(handle.row("gone.ts").disabled, true);
      assert.match(handle.row("gone.ts").title, /cannot be marked reviewed/);
      assert.equal(handle.row("a.ts").disabled, false);

      // Ticking reads the file once and saves the revision under the project.
      await handle.tick("a.ts");
      assert.deepEqual(calls.reads, ["a.ts"]);
      const key = reviewKey("local", ROOT);
      assert.deepEqual(app.checks, { [key]: { "a.ts": "r1" } });
      assert.equal(app.writes, 1);
      assert.equal(handle.row("a.ts").checked, true);
      assert.equal(handle.row("a.ts").hint, "");
      assert.equal(handle.row("b.ts").checked, false);

      // A restart: what was written to the state file is loaded again, the list is reloaded and the tick is checked against the file.
      const written = JSON.parse(JSON.stringify(app.checks));
      const second = getReview().mount(
        { checks: written, onChecks() {} },
        disk,
        ENTRIES,
      );
      const before = globalThis.window;
      globalThis.window = { hrig: second.bridge };
      second.render();
      await settle();
      assert.equal(second.handle.row("a.ts").checked, true);
      assert.equal(second.handle.row("a.ts").hint, "");
      assert.deepEqual(second.handle.calls.reads, ["a.ts"]);
      globalThis.window = before;

      // The file is edited elsewhere: after Refresh changes the tick is gone and says why, and the old revision is not silently kept as a tick.
      disk["a.ts"] = "r1-edited";
      await handle.refresh();
      assert.equal(handle.row("a.ts").checked, false);
      assert.equal(handle.row("a.ts").hint, "changed since reviewed");
      assert.equal(calls.git, 2);
      assert.equal(
        app.checks[key]["a.ts"],
        "r1",
        "nothing was written by the refresh",
      );
      assert.equal(app.writes, 1);

      // Ticking it again saves the new revision and clears the hint.
      await handle.tick("a.ts");
      assert.equal(app.checks[key]["a.ts"], "r1-edited");
      assert.equal(handle.row("a.ts").checked, true);
      assert.equal(handle.row("a.ts").hint, "");

      // Unticking removes the tick; the last tick of the project removes the project.
      await handle.tick("a.ts");
      assert.deepEqual(app.checks, {});
      assert.equal(handle.row("a.ts").checked, false);
      assert.equal(handle.row("a.ts").hint, "");

      // Nothing but reads of the change list's own files left the component: no message, no write, no draft.
      assert.deepEqual(calls.other, []);
      assert.ok(calls.reads.every((p) => p === "a.ts"));
      assert.equal(calls.maxActive, 1, "one read at a time");
    },
  );
});

test("review-checks verify: a failed or unreadable read never invents a tick, and a long list of ticks is read in bounds", async () => {
  const key = reviewKey("local", ROOT);
  // A tick whose file cannot be read on refresh stays as saved and says so.
  await withReview(
    {
      entries: ENTRIES,
      disk: { "a.ts": "r1", "b.ts": "r2" },
      checks: { [key]: { "a.ts": "r1", "b.ts": "r2" } },
    },
    async ({ handle, calls, disk, app }) => {
      assert.equal(handle.row("a.ts").checked, true);
      assert.equal(handle.row("b.ts").checked, true);
      delete disk["b.ts"];
      await handle.refresh();
      assert.equal(handle.row("a.ts").checked, true);
      assert.equal(
        handle.row("b.ts").checked,
        false,
        "not claimed as reviewed",
      );
      assert.equal(handle.row("b.ts").hint, "could not verify");
      assert.deepEqual(app.checks, { [key]: { "a.ts": "r1", "b.ts": "r2" } });
      assert.equal(app.writes, 0, "a failed read changes nothing");
      assert.deepEqual(calls.other, []);
    },
  );
  // Ticking a file that cannot be read stores nothing and disables the box with a reason.
  await withReview(
    { entries: ENTRIES, disk: { "a.ts": "r1" } },
    async ({ handle, app }) => {
      assert.equal(handle.row("b.ts").disabled, false, "unknown until tried");
      await handle.tick("b.ts");
      assert.equal(app.checks, undefined);
      assert.equal(handle.row("b.ts").checked, false);
      assert.equal(handle.row("b.ts").disabled, true);
      assert.match(handle.row("b.ts").title, /could not be read/);
    },
  );
  // A revision that is not a string, or is empty, is not a revision.
  await withReview(
    { entries: ENTRIES, disk: { "a.ts": 5, "b.ts": "" } },
    async ({ handle, app }) => {
      await handle.tick("a.ts");
      await handle.tick("b.ts");
      assert.equal(app.checks, undefined);
      assert.equal(handle.row("a.ts").disabled, true);
      assert.equal(handle.row("b.ts").disabled, true);
    },
  );
  // 60 ticks in a 70 file list: 50 are read again, one at a time and in list order; the rest say not rechecked.
  const entries = [];
  const disk = {};
  const ticks = {};
  for (let i = 0; i < 70; i++) {
    entries.push({ path: "f" + i + ".ts", status: "M" });
    disk["f" + i + ".ts"] = "r" + i;
    if (i < 60) ticks["f" + i + ".ts"] = "r" + i;
  }
  await withReview(
    { entries, disk, checks: { [key]: ticks } },
    async ({ handle, calls }) => {
      assert.equal(calls.reads.length, MAX_RECHECK);
      assert.deepEqual(
        calls.reads,
        entries.slice(0, MAX_RECHECK).map((e) => e.path),
      );
      assert.equal(calls.maxActive, 1, "no parallel burst");
      const rows = handle.rows();
      assert.equal(
        rows.slice(0, MAX_RECHECK).every((r) => r.checked && !r.hint),
        true,
      );
      for (const r of rows.slice(MAX_RECHECK, 60)) {
        assert.equal(r.checked, false, r.path);
        assert.equal(r.hint, "not rechecked", r.path);
      }
      for (const r of rows.slice(60)) assert.equal(r.hint, "", r.path);
      await handle.refresh();
      assert.equal(
        calls.reads.length,
        2 * MAX_RECHECK,
        "a refresh reads at most 50 again",
      );
      assert.equal(calls.maxActive, 1);
    },
  );
});
