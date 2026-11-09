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
  pruneReviewed,
  reviewProgress,
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
    const calls = {
      git: 0,
      reads: [],
      other: [],
      active: 0,
      maxActive: 0,
      notRepository: false,
    };
    const bridge = {
      git: async () => {
        calls.git++;
        return {
          isRepository: !calls.notRepository,
          root: ROOT,
          entries: calls.notRepository ? [] : entries.slice(),
        };
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
      const line = () =>
        handle.text(
          handle.find(
            (n) => n.type === "div" && n.props.className === "review-progress",
          )[0].props.children[0],
        );
      assert.equal(handle.row("b.ts").disabled, false, "unknown until tried");
      assert.equal(line(), "0 of 2 reviewed \u00b7 1 cannot be checked");
      await handle.tick("b.ts");
      assert.equal(app.checks, undefined);
      assert.equal(handle.row("b.ts").checked, false);
      assert.equal(handle.row("b.ts").disabled, true);
      assert.match(handle.row("b.ts").title, /could not be read/);
      // The file that cannot be read is left out of M and counted among the files that cannot be checked.
      assert.equal(line(), "0 of 1 reviewed \u00b7 2 cannot be checked");
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

test("review-checks progress: the count is of checkable files reviewed at the revision just read, and pruning drops only the files that left the list", () => {
  const entries = [
    { path: "a.ts", status: "M" },
    { path: "b.ts", status: "M" },
    { path: "c.ts", status: "??" },
    { path: "gone.ts", status: "D" },
    { path: "rlo\u202e.ts", status: "M" },
    { path: "a.ts", status: "M" },
  ];
  const checks = deepFreeze({
    [K]: { "a.ts": "r1", "b.ts": "r2", "gone.ts": "r3", "c.ts": "r4" },
    [K2]: { "c.ts": "r5" },
  });
  const seen = (pairs) => new Map(pairs);
  // Deleted files, unusable paths and repeated entries are not counted in the total.
  assert.deepEqual(
    reviewProgress(
      entries,
      checks,
      K,
      seen([
        ["a.ts", "r1"],
        ["b.ts", "r2"],
        ["gone.ts", "r3"],
      ]),
    ),
    { reviewed: 2, total: 3 },
  );
  // A stale, failed or unread revision is not reviewed, and a revision for a file nobody ticked counts for nothing.
  assert.deepEqual(
    reviewProgress(
      entries,
      checks,
      K,
      seen([
        ["a.ts", "r1-edited"],
        ["b.ts", null],
        ["c.ts", "r9"],
      ]),
    ),
    { reviewed: 0, total: 3 },
  );
  assert.deepEqual(reviewProgress(entries, checks, K, seen([])), {
    reviewed: 0,
    total: 3,
  });
  assert.deepEqual(
    reviewProgress(entries, checks, K2, seen([["c.ts", "r5"]])),
    {
      reviewed: 1,
      total: 3,
    },
  );
  assert.deepEqual(reviewProgress([], checks, K, seen([])), {
    reviewed: 0,
    total: 0,
  });
  assert.deepEqual(reviewProgress(entries, undefined, K, seen([])), {
    reviewed: 0,
    total: 3,
  });
  assert.deepEqual(reviewProgress(entries, "junk", K, seen([["a.ts", "r1"]])), {
    reviewed: 0,
    total: 3,
  });
  // Files whose read failed when ticked are left out of the total and never counted as reviewed, so the caller's "cannot be checked" (list length minus total) includes them.
  const both = seen([
    ["a.ts", "r1"],
    ["b.ts", "r2"],
  ]);
  assert.deepEqual(
    reviewProgress(entries, checks, K, both, new Set(["b.ts"])),
    {
      reviewed: 1,
      total: 2,
    },
  );
  assert.equal(
    entries.length -
      reviewProgress(entries, checks, K, both, new Set(["b.ts"])).total,
    4,
    "list length 6 minus total 2",
  );
  // A reviewed-looking unreadable file is not counted in N either; an array works the same; duplicates and paths that are not listed change nothing.
  assert.deepEqual(
    reviewProgress(entries, checks, K, both, [
      "a.ts",
      "a.ts",
      "b.ts",
      "nope.ts",
    ]),
    { reviewed: 0, total: 1 },
  );
  assert.deepEqual(
    reviewProgress(entries, checks, K, both, new Set(["nope.ts", "gone.ts"])),
    { reviewed: 2, total: 3 },
  );
  // Prototype keys, non-strings and non-collections are harmless: nothing is excluded by them.
  for (const odd of [
    undefined,
    null,
    "a.ts",
    5,
    {},
    { has: () => true },
    { "a.ts": true },
    new Map([["a.ts", 1]]),
    new Set(["__proto__", "constructor", "toString", 1, null, {}]),
    ["__proto__", "constructor", 7, null],
  ])
    assert.deepEqual(reviewProgress(entries, checks, K, both, odd), {
      reviewed: 2,
      total: 3,
    });
  // The list of unreadable paths is never changed.
  const frozen = Object.freeze(["b.ts"]);
  assert.deepEqual(reviewProgress(entries, checks, K, both, frozen), {
    reviewed: 1,
    total: 2,
  });
  assert.deepEqual(frozen, ["b.ts"]);

  // Pruning: only this project's paths that are not in the list are dropped; the input is never changed.
  const pruned = pruneReviewed(checks, K, ["a.ts", "c.ts", "new.ts"]);
  assert.deepEqual(pruned, {
    [K]: { "a.ts": "r1", "c.ts": "r4" },
    [K2]: { "c.ts": "r5" },
  });
  assert.deepEqual(Object.keys(pruned[K]), ["a.ts", "c.ts"], "order kept");
  assert.notEqual(pruned, checks);
  assert.equal(checks[K]["b.ts"], "r2");
  // Nothing to drop: the very same object comes back, so no state is written.
  assert.equal(
    pruneReviewed(checks, K, ["a.ts", "b.ts", "gone.ts", "c.ts", "more"]),
    checks,
  );
  assert.equal(pruneReviewed(checks, "unknown", []), checks);
  const empty = {};
  assert.equal(pruneReviewed(empty, K, []), empty);
  // An empty list clears the project and only that project.
  assert.deepEqual(pruneReviewed(checks, K, []), { [K2]: { "c.ts": "r5" } });
  assert.deepEqual(pruneReviewed(checks, K2, []), { [K]: checks[K] });
  assert.deepEqual(pruneReviewed(deepFreeze({ [K]: { a: "r" } }), K, []), {});
  // A hostile key never reaches a prototype.
  assert.equal(pruneReviewed(checks, "__proto__", []), checks);
  assert.equal(pruneReviewed(checks, "constructor", []), checks);
  assert.equal(Object.keys(Object.prototype).length, 0);
});

test("review-checks list: the progress line, the unreviewed-only view and Clear all checks work on the real list, and nothing is stored for files that left it", async () => {
  const key = reviewKey("local", ROOT);
  const other = reviewKey("ssh:h", "/srv/b");
  const four = [
    { path: "a.ts", status: "M" },
    { path: "b.ts", status: "M" },
    { path: "c.ts", status: "??" },
    { path: "gone.ts", status: "D" },
  ];
  await withReview(
    {
      entries: four,
      disk: { "a.ts": "r1", "b.ts": "r2", "c.ts": "r3" },
      checks: {
        [key]: { "a.ts": "r1", "b.ts": "r2", "old.ts": "r0" },
        [other]: { "x.ts": "rx" },
      },
    },
    async ({ handle, calls, app }) => {
      const progress = () =>
        handle.text(
          handle.find(
            (n) => n.type === "div" && n.props.className === "review-progress",
          )[0].props.children[0],
        );
      // The tick of a file that left the change list is dropped on load; another project is untouched; the one write is the prune.
      assert.deepEqual(app.checks, {
        [key]: { "a.ts": "r1", "b.ts": "r2" },
        [other]: { "x.ts": "rx" },
      });
      assert.equal(app.writes, 1);
      assert.equal(progress(), "2 of 3 reviewed \u00b7 1 cannot be checked");
      // The wrapper keeps every row's own button inside .review-changes; the toolbar is outside it, so `.review-changes button` still means a file.
      const list = handle.find(
        (n) => n.type === "div" && n.props.className === "review-changes",
      )[0];
      const inside = [];
      const collect = (n) => {
        if (Array.isArray(n)) return n.forEach(collect);
        if (!n || !n.props) return;
        if (n.type === "button") inside.push(n);
        collect(n.props.children);
      };
      collect(list.props.children);
      assert.equal(inside.length, four.length);
      assert.equal(handle.rows().length, four.length);

      // Ticking changes the count at once.
      await handle.tick("c.ts");
      assert.equal(progress(), "3 of 3 reviewed \u00b7 1 cannot be checked");
      assert.equal(app.checks[key]["c.ts"], "r3");

      // The unreviewed-only view is component state: it hides reviewed files and nothing else, and writes nothing.
      const writes = app.writes;
      const filter = () =>
        handle.find(
          (n) =>
            n.type === "input" &&
            n.props.type === "checkbox" &&
            n.props.checked !== undefined &&
            !n.props["aria-label"],
        )[0];
      assert.equal(filter().props.checked, false);
      filter().props.onChange({ target: { checked: true } });
      assert.deepEqual(
        handle.rows().map((r) => r.path),
        ["gone.ts"],
        "a deleted file is still an unreviewed change",
      );
      assert.equal(progress(), "3 of 3 reviewed \u00b7 1 cannot be checked");
      filter().props.onChange({ target: { checked: false } });
      assert.equal(handle.rows().length, 4);
      assert.equal(app.writes, writes, "the view writes nothing");
      await handle.tick("c.ts");
      assert.equal(app.writes, writes + 1, "only the untick was written");
      filter().props.onChange({ target: { checked: true } });
      assert.deepEqual(
        handle.rows().map((r) => r.path),
        ["c.ts", "gone.ts"],
        "an unticked file shows in the view",
      );
      filter().props.onChange({ target: { checked: false } });
      await handle.tick("c.ts");

      // Clear all checks drops this project's ticks and only these.
      const clear = () =>
        handle.find(
          (n) => n.type === "button" && handle.text(n) === "Clear all checks",
        )[0];
      assert.equal(clear().props.disabled, false);
      clear().props.onClick();
      assert.deepEqual(app.checks, { [other]: { "x.ts": "rx" } });
      assert.ok(handle.rows().every((r) => !r.checked && !r.hint));
      assert.equal(progress(), "0 of 3 reviewed \u00b7 1 cannot be checked");
      assert.equal(clear().props.disabled, true);
      assert.deepEqual(calls.other, []);
      assert.ok(handle.rows().find((r) => r.path === "gone.ts").disabled);
    },
  );
  // Everything reviewed with the view on: the line says so; a clean tree and a folder that is not a repository show no toolbar and write nothing.
  await withReview(
    {
      entries: four.slice(0, 2),
      disk: { "a.ts": "r1", "b.ts": "r2" },
      checks: { [key]: { "a.ts": "r1", "b.ts": "r2" } },
    },
    async ({ handle, calls, app }) => {
      const toolbar = () =>
        handle.find(
          (n) => n.type === "div" && n.props.className === "review-progress",
        )[0];
      assert.equal(handle.text(toolbar().props.children[0]), "2 of 2 reviewed");
      toolbar().props.children[1].props.children[0].props.onChange({
        target: { checked: true },
      });
      assert.equal(handle.rows().length, 0);
      assert.equal(
        handle.text(toolbar().props.children[0]),
        "2 of 2 reviewed \u00b7 nothing left to review",
      );
      assert.equal(app.writes, 0, "nothing to prune, nothing written");
      calls.notRepository = true;
      await handle.refresh();
      assert.equal(
        handle.find((n) => n.props.className === "review-progress").length,
        0,
      );
      assert.equal(handle.rows().length, 0);
      assert.equal(app.writes, 0, "a non-repository never prunes");
      assert.deepEqual(app.checks, { [key]: { "a.ts": "r1", "b.ts": "r2" } });
    },
  );
  await withReview(
    { entries: [], disk: {}, checks: { [key]: { "a.ts": "r1" } } },
    async ({ handle, app }) => {
      assert.equal(
        handle.find((n) => n.props.className === "review-progress").length,
        0,
      );
      assert.equal(handle.rows().length, 0);
      // An empty list never prunes: nothing is written and the tick stays.
      assert.deepEqual(app.checks, { [key]: { "a.ts": "r1" } });
      assert.equal(app.writes, 0);
    },
  );
});

// ---- source wiring and docs ----
function collapse(text) {
  return text.replace(/\s+/g, " ");
}
function tight(text) {
  return collapse(text)
    .replace(/\( /g, "(")
    .replace(/(?:, )? ?\)/g, ")");
}
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function count(text, needle) {
  return text.split(needle).length - 1;
}
function has(text, needle) {
  return text.includes(tight(needle));
}
const printable = (text) => !/[^\t\n -~]/.test(text);

test("review-checks wiring: the module is pure, only the list, App and the state type know it, nothing is sent, written or exported, and the old selectors and message are intact", () => {
  // The module: no import, no page, storage, clock or network, the exact exports, a doc comment above each.
  const source = read("src/review-checks.ts");
  const code = stripComments(source);
  assert.ok(printable(source), "printable ASCII");
  assert.equal(count(code, "import "), 0);
  assert.equal(count(code, " from "), 0);
  assert.ok(
    !/\b(document|window|fetch|localStorage|sessionStorage|indexedDB|navigator|setTimeout|setInterval|Date|process|require|console|innerHTML)\b/.test(
      code,
    ),
  );
  const exported = [...code.matchAll(/^export (?:const|function|type) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(exported, [
    "MAX_PATHS",
    "MAX_PATH_CHARS",
    "MAX_PROJECTS",
    "MAX_RECHECK",
    "MAX_REVISION_CHARS",
    "ReviewChecks",
    "ReviewState",
    "isCheckable",
    "isReviewed",
    "normalizeReviewChecks",
    "pruneReviewed",
    "recheckPaths",
    "reviewKey",
    "reviewProgress",
    "reviewState",
    "toggleReviewed",
    "usablePath",
  ]);
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (line.startsWith("export "))
      assert.ok(
        lines[i - 1].startsWith("/** ") && lines[i - 1].endsWith(" */"),
        "a doc comment above: " + line,
      );
  });

  // Only the review list, App and the state type import it.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.tsx?$/.test(name) && name !== "review-checks.ts")
    .filter((name) => read("src/" + name).includes("./review-checks"))
    .sort();
  assert.deepEqual(users, ["App.tsx", "ReviewWorkspace.tsx", "types.ts"]);

  // The state: one optional field next to the other saved lists, through the existing save path, normalized on load.
  const types = tight(stripComments(read("src/types.ts")));
  assert.equal(
    count(types, 'reviewChecks?: import("./review-checks").ReviewChecks;'),
    1,
  );
  assert.equal(count(types, 'hostTints?: import("./host-tint").HostTints;'), 1);
  const app = tight(read("src/App.tsx"));
  assert.equal(
    count(app, 'import { normalizeReviewChecks } from "./review-checks";'),
    1,
  );
  assert.ok(
    has(
      app,
      "projectHistory: normalizeHistory(base.projectHistory), reviewChecks: normalizeReviewChecks(base.reviewChecks), connections,",
    ),
    "normalized on load next to the project history",
  );
  assert.ok(
    has(
      app,
      "checks={state.reviewChecks} onChecks={(update) => setState((s) => { const current = normalizeReviewChecks(s.reviewChecks); const next = update(current); return next === current ? s : { ...s, reviewChecks: next }; }) }",
    ),
    "written through setState, and an unchanged list writes nothing",
  );
  assert.equal(count(app, "reviewChecks"), 5);
  assert.equal(count(app, "normalizeReviewChecks("), 2);

  // The list component: reads only, writes nothing, keeps the feedback message and the old selectors.
  const raw = read("src/ReviewWorkspace.tsx");
  const list = tight(raw);
  assert.equal(count(list, "window.hrig.edit("), 5);
  assert.equal(count(list, 'op: "read"'), 5);
  assert.equal(
    count(list, "draftOperation("),
    1,
    "the draft store is not used",
  );
  for (const word of [
    "localStorage",
    "sessionStorage",
    "saveState",
    "flushState",
    "innerHTML",
    "notify",
    "rigAction",
    "window.hrig.file(",
    "window.hrig.drafts",
  ])
    assert.equal(count(list, word), 0, word);
  assert.equal(count(list, "sendMessage("), 1);
  const sent = list.slice(
    list.indexOf("await window.hrig.sendMessage("),
    list.indexOf("setSent(true);"),
  );
  assert.ok(
    has(
      sent,
      'await window.hrig.sendMessage( connection, seat!.name + "@" + seat!.rigName, "Review feedback for project " + root + "\\n\\n" + notes .map( (n) => n.path + (n.line ? ":" + n.line : "") + "\\nRevision: " + n.revision + "\\n" + n.text, ) .join("\\n\\n"), );',
    ),
    "the feedback message is the same as before",
  );
  assert.ok(
    !/check|reviewed|rkey|saved|seen|stateOf|unreadable/.test(
      sent.replace('"Review feedback for project "', ""),
    ),
    "no review check reaches the message",
  );
  assert.equal(count(list, "<h3>Review workspace</h3>"), 1);
  assert.ok(
    has(
      list,
      "checks: ReviewChecks | undefined; onChecks: (update: (current: ReviewChecks) => ReviewChecks) => void;",
    ),
  );
  assert.equal(count(list, "onChecks("), 4, "tick, untick, prune and clear");
  assert.ok(
    has(
      list,
      "const progress = reviewProgress( changes ?? [], saved, rkey, seen, unreadable, );",
    ),
    "the files that could not be read are left out of the progress line",
  );
  assert.equal(count(list, "reviewProgress("), 1);
  assert.equal(
    count(list, "const [unreviewedOnly, setUnreviewedOnly] = useState(false);"),
    1,
    "the view is component state only",
  );
  assert.ok(
    has(
      list,
      'type="checkbox" aria-label={ usablePath(c.path) ? "Mark " + c.path + " reviewed" : "Mark file reviewed" }',
    ),
  );
  assert.ok(
    has(
      list,
      "<FileCode2 size={14} /> <span>{c.path}</span> <small>{c.status}</small> </button>",
    ),
    "the row button is unchanged",
  );
  assert.equal(count(list, "onDiff(c.path)"), 1);
  for (const hint of [
    "changed since reviewed",
    "could not verify",
    "not rechecked",
  ])
    assert.equal(count(list, '"' + hint + '"'), 1, hint);
  // The toolbar sits outside .review-changes, so `.review-changes button` still means one file.
  const bar = list.indexOf('className="review-progress"');
  const box = list.indexOf('className="review-changes"');
  const row = list.indexOf('className="review-file-row"');
  assert.ok(bar > 0 && bar < box && box < row);
  assert.equal(count(list, 'className="review-changes"'), 1);
  const e2e = read("tests/e2e/roadmap.spec.ts");
  assert.ok(e2e.includes('.locator(".review-changes button")'));
  assert.ok(
    read("tests/e2e/git-folder.spec.ts").includes(
      '.locator(".review-changes")',
    ),
  );

  // The style: the direct-child button rules became the row rules, edited in place and not at the end.
  const css = read("src/styles.css");
  assert.equal(count(css, ".review-changes > button"), 0);
  const at = (needle) => {
    const i = css.indexOf(needle);
    assert.ok(i >= 0, "missing " + needle);
    assert.equal(css.indexOf(needle, i + 1), -1, "once: " + needle);
    return i;
  };
  assert.ok(
    at(".review-changes {") < at(".review-progress {") &&
      at(".review-progress {") < at(".review-file-row {") &&
      at(".review-file-row {") < at(".review-file-row > button {") &&
      at(".review-file-row > button {") < at(".review-changes small {") &&
      at(".review-changes small {") < at(".section-heading {"),
  );
  const box2 = css.slice(
    at(".review-file-row > input {"),
    at(".review-file-row > button {"),
  );
  assert.ok(
    /width: 14px;/.test(box2) && /padding: 0;/.test(box2),
    "the checkbox undoes the global input box",
  );
  assert.equal(count(css, ".review-file-row > button > span {"), 1);

  // Nothing about checks reaches the settings, the main process or the draft store.
  for (const file of [
    "src/settings.ts",
    "src/SettingsPage.tsx",
    "src/drafts.ts",
    "electron/drafts.cjs",
    "SETTINGS.md",
  ]) {
    const text = read(file);
    assert.ok(!/reviewChecks|review-checks|review check/i.test(text), file);
  }
  for (const name of fs.readdirSync(path.join(root, "electron")))
    if (name.endsWith(".cjs"))
      assert.ok(
        !/reviewChecks|review-checks/.test(read("electron/" + name)),
        name,
      );
});

test("review-checks docs: docs/review-checks.md and the README row say what a tick means, what is kept and where, what is never sent, and the limits", () => {
  const note = read("docs/review-checks.md");
  assert.ok(printable(note), "printable ASCII");
  assert.equal(count(note, "\n# "), 0);
  assert.ok(note.startsWith("# Review checks\n\nStatus: built."));
  assert.ok(note.endsWith("\n") && !note.endsWith("\n\n"));
  for (const fragment of [
    "A tick means I looked at this file as it is now.",
    "N of M reviewed",
    "Show unreviewed only",
    "it is only a view and is not remembered",
    "Clear all checks",
    "opaque hash the review notes already use",
    "at most 50 per load or refresh",
    "Same revision: the box is ticked and counts as reviewed.",
    "changed since reviewed",
    "The old tick is never kept silently.",
    "could not verify",
    "The saved tick is left as it is.",
    "not rechecked",
    "A deleted file",
    "the box is disabled and its title says why",
    "dropped when the list loads, unless the list is empty",
    "saved workspace state on this computer",
    "per connection and project folder",
    "and no file content",
    "At most 20 projects and 200 ticked files per project",
    "at most 1,024 characters and a revision at most 128",
    "They are not drafts",
    "not put in the feedback message",
    "not exported with the settings",
    "not written to the Git index",
    "not sent to a seat, a host or anywhere else",
    "Syncing checks between computers, checks per hunk",
  ])
    assert.ok(note.includes(fragment), "missing: " + fragment);

  const readme = read("README.md");
  const rows = readme
    .split("\n")
    .filter((l) => l.startsWith("| Review workspace |"));
  assert.equal(rows.length, 1);
  const rowText = rows[0];
  assert.ok(printable(rowText));
  for (const fragment of [
    "Select a feedback recipient, open a changed file beside sessions, collect file/line notes, and explicitly send feedback through OpenRig.",
    "Each changed file can be ticked as reviewed",
    "the tick stays on this computer",
    "so an edited file loses it",
    "(see [Review checks](docs/review-checks.md))",
    "Git changes belong to the project; HRig does not infer which agent authored them.",
  ])
    assert.ok(rowText.includes(fragment), "missing: " + fragment);
  assert.equal(count(readme, "docs/review-checks.md"), 1);
  assert.equal(
    count(readme, "TASKS.md"),
    1,
    "README keeps its single link to TASKS.md",
  );

  const privacy = read("PRIVACY.md");
  assert.equal(count(privacy, "review checks"), 1);
  assert.ok(
    privacy.includes(
      "workspace layouts, per-file review checks, drafts/recovery copies,",
    ),
  );
});
