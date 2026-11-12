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
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const char = (code) => String.fromCharCode(code);

// The virtualized list of the long-list chain, drawn here as every row at once: this test is about the board's own
// behavior, and the list's windowing has its own tests.
function inlineList(props) {
  return { type: "div", props: { className: props.className, children: props.rows.map((row, i) => props.renderRow(row, i)) } };
}
inlineList.inline = true;

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
const md = load("src/markdown-safe.ts");
const core = require("../electron/core.cjs");

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Characters that must never survive into the tree, built from codes so this file stays plain ASCII.
const HIDDEN = [
  0, 7, 27, 127, 133, 0x61c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a,
  0x202e, 0x2060, 0x2066, 0x2069, 0xfeff,
].map(char);
const ZWJ = char(0x200d);
const hasHidden = (text) =>
  [...text].some((c) => {
    const code = c.codePointAt(0);
    return (
      (code < 32 && code !== 9 && code !== 10) ||
      (code >= 127 && code <= 159) ||
      HIDDEN.includes(c)
    );
  });

// ---------------------------------------------------------------------------
// What the tree may hold. The sets are the whole subset the finished feature
// can produce, so they never need to change as syntax is added.

const BLOCK_KEYS = {
  paragraph: ["children", "type"],
  heading: ["children", "level", "type"],
  code: ["text", "type"],
  list: ["items", "ordered", "start", "type"],
  quote: ["children", "type"],
  rule: ["type"],
};
const INLINE_KEYS = {
  text: ["text", "type"],
  code: ["text", "type"],
  strong: ["children", "type"],
  em: ["children", "type"],
  link: ["children", "type", "url"],
};
const URL_OK = /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i;

function checkInline(nodes, where) {
  assert.ok(Array.isArray(nodes), where + ": inline list");
  for (const node of nodes) {
    assert.ok(node && typeof node === "object", where + ": inline node");
    assert.ok(node.type in INLINE_KEYS, where + ": inline type " + node.type);
    assert.deepEqual(Object.keys(node).sort(), INLINE_KEYS[node.type], where);
    if (typeof node.text === "string") assert.ok(!hasHidden(node.text), where);
    else checkInline(node.children, where);
    if (node.type === "link") assert.match(node.url, URL_OK, where);
  }
}
/** Walks a whole result and throws on anything the subset does not allow; returns the number of nodes. */
function checkTree(result) {
  assert.deepEqual(Object.keys(result).sort(), [
    "blocks",
    "chars",
    "truncated",
  ]);
  assert.equal(typeof result.truncated, "boolean");
  assert.ok(Number.isInteger(result.chars) && result.chars >= 0);
  assert.ok(result.blocks.length <= md.MAX_MARKDOWN_BLOCKS);
  let nodes = 0;
  let characters = 0;
  const inlineCount = (list) => {
    for (const node of list) {
      nodes++;
      if (typeof node.text === "string") characters += node.text.length;
      else inlineCount(node.children);
    }
  };
  for (const block of result.blocks) {
    nodes++;
    assert.ok(block.type in BLOCK_KEYS, "block type " + block.type);
    assert.deepEqual(Object.keys(block).sort(), BLOCK_KEYS[block.type]);
    if (block.type === "code") {
      assert.equal(typeof block.text, "string");
      assert.ok(!hasHidden(block.text));
      characters += block.text.length;
    } else if (block.type === "list") {
      assert.equal(typeof block.ordered, "boolean");
      assert.ok(Number.isInteger(block.start) && block.start >= 0);
      assert.ok(block.start <= 999999999);
      for (const item of block.items) {
        checkInline(item, "list item");
        inlineCount(item);
      }
    } else if (block.type !== "rule") {
      if (block.type === "heading") assert.ok([1, 2, 3].includes(block.level));
      checkInline(block.children, block.type);
      inlineCount(block.children);
    }
  }
  assert.ok(characters <= md.MAX_MARKDOWN_CHARS, "text stays within the cap");
  return nodes;
}
/** All text the tree would show, in order, as one string. */
function plain(result) {
  const inline = (list) =>
    list
      .map((n) => (typeof n.text === "string" ? n.text : inline(n.children)))
      .join("");
  return result.blocks
    .map((b) =>
      b.type === "code"
        ? b.text
        : b.type === "list"
          ? b.items.map(inline).join("\n")
          : b.type === "rule"
            ? ""
            : inline(b.children),
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// A task as `rig queue show <id> --full --json` prints it (keys and null
// fields as read from a live queue at plan time, the body replaced by a short
// markdown text with hostile content inside), and rows as the list prints them.

const BODY = [
  "# Plan for wave 7",
  "",
  "Fix the login redirect. <script>alert(1)</script> and <img src=x onerror=alert(1)>",
  "then see [the notes](javascript:alert(1)) for details.",
  "",
  "## Steps",
  "",
  "```sh",
  "rm -rf /tmp/x   # shown, never run",
  "```",
  "",
  "### Last",
  "Done.",
].join("\n");
const DETAIL = {
  pickup: { state: "parked" },
  waiting: {
    obligation: "q-login",
    owner: "dev-a@hrig",
    state: "pending",
    actionableSince: null,
  },
  qitemId: "q-login",
  tsCreated: "2026-11-08T17:08:36.871Z",
  tsUpdated: "2026-11-08T17:08:39.041Z",
  sourceSession: "orch-lead@hrig",
  destinationSession: "dev-a@hrig",
  state: "pending",
  priority: "routine",
  tier: null,
  tags: ["slice:w2-asset-writes"],
  blockedOn: null,
  handedOffTo: null,
  chainOfRecord: null,
  body: BODY,
  summary: null,
  evidenceRef: null,
  humanIntent: null,
  humanDetail: null,
  closureReason: null,
  destinationClass: "pane-bound",
};
const raw = (id, state, destination, summary) => ({
  pickup: { state: "working" },
  qitemId: id,
  tsCreated: "2026-11-08T17:08:36.871Z",
  sourceSession: "orch-lead@hrig",
  destinationSession: destination,
  state,
  priority: "routine",
  tier: null,
  tags: null,
  blockedOn: null,
  summary,
  fieldsElided: ["body"],
});
const ROWS = core.normalizeQueue(
  [
    raw("q-login", "pending", "dev-a@hrig", "Fix the login redirect"),
    raw("q-cache", "in-progress", "dev-b@hrig", "Warm the cache"),
    raw("q-docs", "blocked", "dev-a@hrig", "Write the docs"),
  ],
  undefined,
);
const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [
  { name: "dev-a", rigName: "hrig" },
  { name: "dev-b", rigName: "hrig" },
];

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx and the real TaskDetailBody.tsx over a very small
// react: state slots, memo slots, effects that run as they are met, function
// components called while the tree is walked, elements recorded as plain
// objects. The bridge is a fake that records every call it gets.

function boardHarness({ details = [DETAIL], rows = ROWS, seats = SEATS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
  const calls = { queue: [], rigAction: [], sendMessage: [] };
  const before = {
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  let shown = 0;
  const win = {
    hrig: {
      queue: (connection, rigName) => {
        calls.queue.push([connection, rigName]);
        return Promise.resolve(rows);
      },
      rigAction: (...args) => {
        calls.rigAction.push(args);
        const next = details[Math.min(shown++, details.length - 1)];
        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(next);
      },
      sendMessage: (...args) => {
        calls.sendMessage.push(args);
        return Promise.resolve("");
      },
    },
  };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((d, k) => d === b[k]);
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
    useMemo(fn, list) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, list))
        slots[i] = { deps: list, value: fn() };
      return slots[i].value;
    },
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (!old || !same(old, list)) {
        if (cleanups[i]) cleanups[i]();
        deps[i] = list;
        cleanups[i] = fn();
      }
    },
  };
  const jsx = (type, props) =>
    typeof type === "function" && type.inline ? type(props) : { type, props };
  const Board = load("src/TaskBoard.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
    },
    "./VirtualList": { VirtualList: inlineList },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const props = {
    connection: CONNECTION,
    rigName: undefined,
    seats,
    onSeat: () => {},
  };
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    const own = node.props || {};
    if (typeof node.type === "function") return expand(node.type(own));
    if (own.children === undefined) return node;
    return {
      type: node.type,
      props: { ...own, children: expand(own.children) },
    };
  };
  function render() {
    globalThis.window = win;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    cursor = 0;
    tree = expand(Board(props));
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
  const harness = {
    calls,
    all: (node = tree) => all(node),
    text,
    byClass: (name) =>
      all(tree).filter((n) => n.props && n.props.className === name),
    byLabel: (label) =>
      all(tree).find((n) => n.props && n.props["aria-label"] === label),
    byType: (type) => all(tree).filter((n) => n.type === type),
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n).trim() === name),
    card: (title) =>
      all(tree).find(
        (n) =>
          n.props &&
          n.props.className === "task-card" &&
          text(all(n).find((c) => c.type === "strong")) === title,
      ),
    modal: () => all(tree).find((n) => n.type === "Modal"),
    async flush() {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
    unmount() {
      cleanups.forEach((c) => c && c());
      globalThis.window = before.window;
      globalThis.setInterval = before.setInterval;
      globalThis.clearInterval = before.clearInterval;
      if (before.window === undefined) delete globalThis.window;
    },
  };
  return harness;
}

// The element types, props and classes the rendered body may use.
const TAGS = new Set([
  "div",
  "p",
  "h3",
  "h4",
  "h5",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "strong",
  "em",
  "span",
]);
const PROPS = new Set([
  "children",
  "className",
  "role",
  "aria-label",
  "tabIndex",
  "start",
]);
const CLASSES = new Set(["task-markdown", "md-code", "md-url"]);
/** Asserts the rendered body holds only plain elements: no raw HTML prop, no link or image attribute, no handler, no style. */
function assertPlainElements(harness, region) {
  const nodes = harness.all(region);
  for (const node of nodes) {
    if (typeof node.type !== "string") continue;
    assert.ok(TAGS.has(node.type), "element " + node.type);
    for (const [key, value] of Object.entries(node.props || {})) {
      assert.ok(PROPS.has(key), "prop " + key + " on " + node.type);
      if (key === "className") assert.ok(CLASSES.has(value), "class " + value);
      if (key === "start")
        assert.ok(Number.isInteger(value) && value >= 0 && value <= 999999999);
    }
  }
  return nodes;
}

test("markdown-safe tracer: a task opened on the real board shows its body as safe markdown with a Raw JSON switch, the handoff controls stay as they were, and nothing is sent", async () => {
  // The body comes from the taskShow result, read defensively.
  assert.deepEqual(md.pickTaskBody(DETAIL), { field: "body", text: BODY });

  const details = [
    DETAIL,
    { qitemId: "q-cache", body: 12, bodyPreview: "  ", summary: "Short note" },
    new Error("boom"),
    { qitemId: "q-login", body: "x".repeat(100001) },
  ];
  const board = boardHarness({ details });
  try {
    await board.flush();
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.modal(), undefined);

    // Open the first task: one taskShow call, and the dialog shows the rendered body.
    board.card("Fix the login redirect").props.onClick();
    await board.flush();
    assert.deepEqual(board.calls.rigAction, [
      [CONNECTION, { op: "taskShow", id: "q-login" }],
    ]);
    assert.equal(board.modal().props.title, "Task details");
    assert.equal(board.modal().props.subtitle, "q-login");
    const region = board.byLabel("Task body");
    assert.equal(region.props.className, "task-markdown");
    assert.equal(region.props.role, "region");
    assert.equal(region.props.tabIndex, 0);
    const nodes = assertPlainElements(board, region);
    const types = nodes.map((n) => n.type);
    assert.deepEqual(
      nodes
        .filter((n) => /^h[345]$/.test(n.type))
        .map((n) => [n.type, board.text(n)]),
      [
        ["h3", "Plan for wave 7"],
        ["h4", "Steps"],
        ["h5", "Last"],
      ],
    );
    assert.equal(types.filter((t) => t === "pre").length, 1);
    assert.equal(
      board.text(nodes.find((n) => n.type === "code")),
      "rm -rf /tmp/x   # shown, never run",
    );
    // The hostile text is on the page as plain text, not as elements.
    const shown = board.text(region);
    assert.ok(shown.includes("<script>alert(1)</script>"));
    assert.ok(shown.includes("<img src=x onerror=alert(1)>"));
    assert.ok(shown.includes("[the notes](javascript:alert(1))"));
    assert.equal(board.byClass("json-result").length, 0);
    const rendered = board.button("Rendered");
    const rawButton = board.button("Raw JSON");
    assert.equal(rendered.props["aria-pressed"], true);
    assert.equal(rawButton.props["aria-pressed"], false);
    assert.equal(rendered.props.className, "selected");

    // The handoff area is the one the board always had.
    assert.ok(board.byLabel("Task destination"));
    const handoff = board.button("Request handoff from owner");
    assert.equal(handoff.props.disabled, true);
    assert.ok(board.button("Open owning seat"));
    assert.equal(board.modal().props.wide, true);

    // Raw JSON: the whole result, exactly as before, and the rendered body is gone.
    rawButton.props.onClick();
    const pre = board.byClass("json-result");
    assert.equal(pre.length, 1);
    assert.equal(board.text(pre[0]), JSON.stringify(DETAIL, null, 2));
    assert.equal(board.byLabel("Task body"), undefined);
    assert.equal(board.button("Raw JSON").props["aria-pressed"], true);
    board.button("Rendered").props.onClick();
    assert.ok(board.byLabel("Task body"));
    assert.equal(board.byClass("json-result").length, 0);

    // A task with no body field shows its summary and says so; a body that is not text is ignored.
    board.modal().props.onClose();
    board.card("Warm the cache").props.onClick();
    await board.flush();
    assert.equal(board.calls.rigAction.length, 2);
    assert.equal(board.calls.rigAction[1][1].id, "q-cache");
    assert.ok(
      board
        .byClass("field-note")
        .some((n) =>
          board.text(n).includes("no body; showing its summary field"),
        ),
    );
    assert.ok(board.text(board.byLabel("Task body")).includes("Short note"));
    assertPlainElements(board, board.byLabel("Task body"));

    // A failed read keeps the JSON view with no switch at all.
    board.modal().props.onClose();
    board.card("Write the docs").props.onClick();
    await board.flush();
    assert.equal(board.byLabel("Task body"), undefined);
    assert.equal(board.button("Rendered"), undefined);
    assert.equal(
      board.text(board.byClass("json-result")[0]),
      JSON.stringify({ error: "boom" }, null, 2),
    );

    // A text over the limit shows its start with a note that points to Raw JSON.
    board.modal().props.onClose();
    board.card("Fix the login redirect").props.onClick();
    await board.flush();
    assert.ok(
      board
        .byClass("field-note")
        .some(
          (n) =>
            board.text(n).includes("100,000 characters and 2,000 blocks") &&
            board.text(n).includes("Raw JSON has all of it"),
        ),
    );
    assert.equal(board.text(board.byLabel("Task body")).length, 100000);

    // Read only: the board only ever asked for task details, and sent nothing.
    assert.equal(board.calls.rigAction.length, 4);
    assert.ok(board.calls.rigAction.every((c) => c[1].op === "taskShow"));
    assert.equal(board.calls.sendMessage.length, 0);
    assert.equal(board.calls.queue.length, 1);
  } finally {
    board.unmount();
  }
});

test("markdown-safe parser: the first-slice blocks, the limits and the hostile text, as tables", () => {
  const shape = (text, caps) => {
    const result = md.parseMarkdown(text, caps);
    checkTree(result);
    return result.blocks.map((b) =>
      b.type === "code"
        ? "code:" + b.text
        : (b.type === "heading" ? "h" + b.level : b.type) +
          ":" +
          plain({ blocks: [b] }),
    );
  };
  // Blocks.
  assert.deepEqual(shape(""), []);
  assert.deepEqual(shape("   \n\n  \n"), []);
  assert.deepEqual(shape("one\ntwo  \n\nthree"), [
    "paragraph:one\ntwo",
    "paragraph:three",
  ]);
  assert.deepEqual(shape("# A\n## B ##\n### C #\n#### D"), [
    "h1:A",
    "h2:B",
    "h3:C",
    "paragraph:#### D",
  ]);
  assert.deepEqual(shape("#nospace\n#\n# \n##"), [
    "paragraph:#nospace\n#\n#\n##",
  ]);
  assert.deepEqual(shape("C# and #"), ["paragraph:C# and #"]);
  assert.deepEqual(shape("## C#"), ["h2:C#"]);
  assert.deepEqual(shape("text\n# head\nmore"), [
    "paragraph:text",
    "h1:head",
    "paragraph:more",
  ]);
  assert.deepEqual(shape("a\n```\nx\n```\nb"), [
    "paragraph:a",
    "code:x",
    "paragraph:b",
  ]);
  // Fences: both markers, a longer closing run, an info text that is never used, unterminated, and an inline-looking line.
  assert.deepEqual(shape("```js title=x\nconst a = 1;\n\n  indented\n```"), [
    "code:const a = 1;\n\n  indented",
  ]);
  assert.deepEqual(shape("~~~\n```\nstill code\n~~~"), [
    "code:```\nstill code",
  ]);
  assert.deepEqual(shape("````\n```\n````"), ["code:```"]);
  assert.deepEqual(shape("```\nopen\n# not a head"), [
    "code:open\n# not a head",
  ]);
  assert.deepEqual(shape("```"), ["code:"]);
  assert.deepEqual(shape("```a`b\ntext"), ["paragraph:```a`b\ntext"]);
  assert.deepEqual(shape("``\nx\n``"), ["paragraph:``\nx\n``"]);
  assert.deepEqual(shape("```\n<script>alert(1)</script>\n```"), [
    "code:<script>alert(1)</script>",
  ]);
  assert.deepEqual(shape("```<script>alert(1)</script>\nx\n```"), ["code:x"]);
  // Line ends, hidden characters and tabs.
  assert.deepEqual(shape("a\r\nb\rc"), ["paragraph:a\nb\nc"]);
  assert.deepEqual(shape("a" + HIDDEN.join("") + "b"), ["paragraph:ab"]);
  assert.deepEqual(shape("e" + ZWJ + "f"), ["paragraph:e" + ZWJ + "f"]);
  assert.deepEqual(shape("a\tb"), ["paragraph:a\tb"]);
  assert.deepEqual(shape("```\n" + char(27) + "[31mred\n```"), [
    "code:[31mred",
  ]);

  // Nothing but a string is read.
  for (const value of [undefined, null, 7, {}, [], true, () => "x"])
    assert.deepEqual(md.parseMarkdown(value), {
      blocks: [],
      truncated: false,
      chars: 0,
    });

  // Limits: the text is cut at the cap, a caller can lower the caps and never raise them, junk caps mean the defaults.
  assert.equal(md.MAX_MARKDOWN_CHARS, 100000);
  assert.equal(md.MAX_MARKDOWN_BLOCKS, 2000);
  const long = "x".repeat(150000);
  const cut = md.parseMarkdown(long);
  assert.equal(cut.truncated, true);
  assert.equal(cut.chars, 150000);
  assert.equal(plain(cut).length, 100000);
  assert.equal(md.parseMarkdown("x".repeat(100000)).truncated, false);
  assert.equal(md.parseMarkdown("x".repeat(100001)).truncated, true);
  const small = md.parseMarkdown("abcdefghij", { maxChars: 4 });
  assert.equal(plain(small), "abcd");
  assert.equal(small.truncated, true);
  assert.equal(small.chars, 10);
  assert.equal(md.parseMarkdown("abcd", { maxChars: 4 }).truncated, false);
  for (const junk of [1e9, Infinity, NaN, 0, -3, "7", null, {}, undefined])
    assert.equal(
      plain(md.parseMarkdown(long, { maxChars: junk })).length,
      100000,
    );
  const many = Array.from({ length: 10 }, (_, i) => "p" + i).join("\n\n");
  const few = md.parseMarkdown(many, { maxBlocks: 3 });
  assert.equal(few.blocks.length, 3);
  assert.equal(few.truncated, true);
  assert.equal(md.parseMarkdown(many, { maxBlocks: 10 }).truncated, false);
  assert.equal(md.parseMarkdown(many, { maxBlocks: 10 }).blocks.length, 10);
  assert.equal(md.parseMarkdown(many, { maxBlocks: 1e9 }).blocks.length, 10);
  assert.equal(
    md.parseMarkdown(many + "\n\n\n", { maxBlocks: 10 }).truncated,
    false,
  );
  const blocks = Array.from({ length: 2500 }, (_, i) => "# h" + i).join("\n");
  const capped = md.parseMarkdown(blocks);
  assert.equal(capped.blocks.length, 2000);
  assert.equal(capped.truncated, true);
  // A cut never leaves half of a surrogate pair.
  const pair = char(0xd83d) + char(0xde00);
  assert.equal(plain(md.parseMarkdown("ab" + pair, { maxChars: 3 })), "ab");
  assert.equal(
    plain(md.parseMarkdown("ab" + pair, { maxChars: 4 })),
    "ab" + pair,
  );

  // Hostile text stays text: every payload is in the tree verbatim, in paragraphs, headings and code only.
  const payloads = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    "[x](javascript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "![x](javascript:alert(1))",
    "<svg onload=alert(1)>",
    '<iframe src="https://evil.example/"></iframe>',
    "<style>* { display: none }</style>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "<!-- comment -->",
    "javascript:alert(1)",
    '"><script>alert(1)</script>',
    "<math><mtext></mtext></math>",
    "<details open ontoggle=alert(1)>",
    "<form action=https://evil.example><input name=x></form>",
  ];
  for (const payload of payloads) {
    for (const wrap of [
      (p) => p,
      (p) => "# " + p,
      (p) => "intro\n" + p + "\noutro",
      (p) => "```\n" + p + "\n```",
      (p) => "```\n" + p,
      (p) => "~~~\n" + p + "\n~~~",
    ]) {
      const result = md.parseMarkdown(wrap(payload));
      checkTree(result);
      assert.ok(plain(result).includes(payload), "kept: " + payload);
      for (const block of result.blocks)
        assert.ok(["paragraph", "heading", "code"].includes(block.type));
    }
  }

  // The body picker: first of body, bodyPreview, summary that is a string with something in it.
  const pick = md.pickTaskBody;
  assert.deepEqual(md.TASK_BODY_FIELDS, ["body", "bodyPreview", "summary"]);
  assert.deepEqual(pick({ body: "a", bodyPreview: "b", summary: "c" }), {
    field: "body",
    text: "a",
  });
  assert.deepEqual(pick({ body: "", bodyPreview: "b" }), {
    field: "bodyPreview",
    text: "b",
  });
  assert.deepEqual(pick({ body: "   ", bodyPreview: null, summary: "c" }), {
    field: "summary",
    text: "c",
  });
  assert.deepEqual(pick({ body: " keep spaces " }), {
    field: "body",
    text: " keep spaces ",
  });
  for (const value of [
    null,
    undefined,
    "text",
    7,
    true,
    [],
    ["body"],
    {},
    { error: "boom" },
    { output: "plain text" },
    { body: 5, bodyPreview: {}, summary: ["x"] },
    { body: null, summary: null },
    { body: "  \n " },
    Object.create({ body: "inherited" }),
    Object.assign(["x"], { body: "text on an array" }),
  ])
    assert.equal(pick(value), null);
});

test("markdown-safe bounds: huge, deeply repeated, unterminated and random input stays inside the limits and the time budget, and the tree stays well formed", () => {
  const timed = (label, text, limitMs = 2000) => {
    const start = process.hrtime.bigint();
    const result = md.parseMarkdown(text);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < limitMs, label + " took " + ms + " ms");
    const nodes = checkTree(result);
    assert.ok(nodes <= 20000, label + " built " + nodes + " nodes");
    return result;
  };
  const big = 1000000;
  const cases = {
    "one huge line": "a".repeat(big),
    "only hashes": "#".repeat(big),
    "hash then spaces then text":
      "# " + " ".repeat(big / 2) + "x" + " ".repeat(big / 2),
    "heading with a long closing run": "# a " + "#".repeat(big),
    "heading of spaces and hashes": "# a" + " #".repeat(big / 2),
    "endless open fences": "```\n".repeat(big / 4),
    "one open fence and a huge body": "```\n" + "line\n".repeat(big / 5),
    tildes: "~~~\n".repeat(big / 4),
    "backtick runs": "`".repeat(big),
    "quote markers": "> ".repeat(big / 2),
    "nested quote lines": "> > > > ".repeat(big / 8),
    "list markers": "- ".repeat(big / 2),
    "list lines": "- item\n".repeat(big / 7),
    "numbered lines": "1. item\n".repeat(big / 8),
    "indented list ladder": Array.from(
      { length: 2000 },
      (_, i) => " ".repeat(i % 200) + "- x",
    ).join("\n"),
    "emphasis openers": "*a ".repeat(big / 3),
    "double openers": "**a ".repeat(big / 4),
    "underscore openers": "_a ".repeat(big / 3),
    "bracket openers": "[".repeat(big),
    "link starts": "[a](".repeat(big / 4),
    "image starts": "![a](".repeat(big / 5),
    "nested brackets": "[".repeat(big / 2) + "]".repeat(big / 2),
    "html tags": "<a ".repeat(big / 3),
    "script tags": "<script>".repeat(big / 8),
    "only blank lines": "\n".repeat(big),
    "only spaces": " ".repeat(big),
    "many headings": "# a\n".repeat(big / 4),
    "many tiny paragraphs": "a\n\n".repeat(big / 3),
    "hidden characters": (HIDDEN.join("") + "a").repeat(big / 20),
    "carriage returns": "a\r".repeat(big / 2),
    rules: "---\n".repeat(big / 4),
    "mixed markers": "# - > * ` [ ] ( ) _ ~ ".repeat(big / 22),
  };
  for (const [label, text] of Object.entries(cases)) {
    const result = timed(label, text);
    if (text.length > md.MAX_MARKDOWN_CHARS)
      assert.equal(result.truncated, true, label);
  }
  // A cap of 100,000 characters bounds even the worst of these.
  const worst = timed(
    "a full-size pathological body",
    "*a [b](c `d ".repeat(8300),
  );
  assert.ok(worst.chars <= 100000);

  // Random walks over the syntax pieces: nothing throws, the same text gives the same tree, and the tree is well formed.
  const pieces = [
    "#",
    "##",
    "###",
    "####",
    " ",
    "  ",
    "    ",
    "\t",
    "\n",
    "\n\n",
    "\r\n",
    "```",
    "````",
    "~~~",
    "`",
    "``",
    "**",
    "*",
    "_",
    "__",
    "[",
    "]",
    "(",
    ")",
    "![",
    "](",
    "http://x.y",
    "https://a.b/c?d=1",
    "javascript:alert(1)",
    "<script>",
    "</script>",
    "<img src=x onerror=1>",
    "- ",
    "* ",
    "+ ",
    "1. ",
    "2) ",
    "> ",
    ">>",
    "---",
    "***",
    "___",
    "text",
    "word",
    "a",
    "&amp;",
    "|",
    "\\",
    ZWJ,
    HIDDEN[1],
    HIDDEN[5],
    HIDDEN[7],
    HIDDEN[13],
  ];
  const rand = seeded(20261108);
  const start = process.hrtime.bigint();
  for (let run = 0; run < 600; run++) {
    let text = "";
    const length = 1 + Math.floor(rand() * 80);
    for (let k = 0; k < length; k++)
      text += pieces[Math.floor(rand() * pieces.length)];
    const first = md.parseMarkdown(text);
    checkTree(first);
    assert.deepEqual(md.parseMarkdown(text), first);
    const caps = {
      maxChars: 1 + Math.floor(rand() * 60),
      maxBlocks: 1 + Math.floor(rand() * 5),
    };
    const lowered = md.parseMarkdown(text, caps);
    checkTree(lowered);
    assert.ok(lowered.blocks.length <= caps.maxBlocks);
    assert.ok(plain(lowered).length <= caps.maxChars);
  }
  assert.ok(
    Number(process.hrtime.bigint() - start) / 1e6 < 5000,
    "the random walk stays quick",
  );
});

test("markdown-safe wiring: the module is pure, the component only uses react and that module, the board changes in one place, the bridge calls are the ones it always had, and no dependency was added", () => {
  const exportsOf = (text) =>
    [
      ...text.matchAll(
        /^export (?:default )?(?:const|function|type|interface) (\w+)/gm,
      ),
    ]
      .map((m) => m[1])
      .sort();
  const noImports = (text) => !/^import /m.test(text);
  const hostile =
    /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.|window\.|globalThis|localStorage|sessionStorage|indexedDB|eval\(|new Function|setTimeout|setInterval|fetch\(|href|src=|style=|<a |<img|<iframe|<script|hrig|openTerminalLink|rigAction|sendMessage|Date\.|Math\.random|performance\./;

  const mdSource = stripComments(read("src/markdown-safe.ts"));
  assert.ok(noImports(mdSource), "markdown-safe has no import");
  assert.ok(!hostile.test(mdSource), "markdown-safe is pure");
  const mdExports = exportsOf(read("src/markdown-safe.ts"));
  for (const name of [
    "MAX_MARKDOWN_BLOCKS",
    "MAX_MARKDOWN_CHARS",
    "MdBlock",
    "MdCaps",
    "MdInline",
    "MdResult",
    "TASK_BODY_FIELDS",
    "TaskBody",
    "parseMarkdown",
    "pickTaskBody",
  ])
    assert.ok(mdExports.includes(name), "markdown-safe exports " + name);
  assert.ok(!/^export default/m.test(mdSource));

  const componentText = read("src/TaskDetailBody.tsx");
  const component = stripComments(componentText);
  assert.deepEqual(
    [...component.matchAll(/^import [^;]*?from "([^"]+)";/gms)].map(
      (m) => m[1],
    ),
    ["react", "./markdown-safe"],
  );
  assert.ok(
    !hostile.test(component),
    "the component has no HTML sink, link, image, style or bridge",
  );
  assert.equal(count(component, "useState("), 1);
  assert.equal(count(component, "export default function TaskDetailBody("), 1);
  assert.deepEqual(exportsOf(componentText), ["TaskDetailBody"]);

  // The board: one import, one element, the old raw view kept as its child, the bridge calls unchanged.
  const boardSource = read("src/TaskBoard.tsx");
  const board = collapse(stripComments(boardSource));
  assert.equal(
    count(board, 'import TaskDetailBody from "./TaskDetailBody";'),
    1,
  );
  assert.equal(count(board, "<TaskDetailBody detail={detail}>"), 1);
  assert.equal(count(board, "</TaskDetailBody>"), 1);
  assert.equal(
    count(
      board.replace(/ /g, ""),
      '<preclassName="json-result">{JSON.stringify(detail,null,2)}</pre>',
    ),
    1,
  );
  // The detail dump is still the one place that prints a task as JSON; the other calls build list keys (long-list chain).
  assert.equal(count(board, "JSON.stringify(detail"), 1);
  assert.equal(count(board, "JSON.stringify("), 4);
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  assert.equal(count(board, '{ op: "taskShow", id: item.id }'), 1);
  assert.equal(
    count(board, 'mutate(create ? "taskCreate" : "taskHandoff")'),
    1,
  );
  assert.equal(count(board, "Please hand off OpenRig task"), 1);
  assert.equal(count(board, "Request handoff from owner"), 1);
  assert.equal(count(board, "Open owning seat"), 1);
  assert.equal(count(board, "dangerouslySetInnerHTML"), 0);

  // No dependency was added: the three runtime packages stay, and no markdown or sanitizer package is named anywhere.
  const pkg = JSON.parse(read("package.json"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    "electron-updater",
    "node-pty",
    "selfsigned",
  ]);
  const names = Object.keys(pkg.dependencies).concat(
    Object.keys(pkg.devDependencies),
  );
  assert.ok(
    !names.some((n) =>
      /marked|remark|micromark|mdast|markdown|showdown|snarkdown|commonmark|sanitize|purify/i.test(
        n,
      ),
    ),
  );
  assert.deepEqual(pkg.overrides, { dompurify: "3.4.17" });

  // The block of styles is self contained: no import, no url, no generated content.
  const css = read("src/styles.css");
  const open = "/* Task details: rendered markdown body */";
  const close = "/* end of Task details */";
  assert.equal(count(css, open), 1);
  assert.equal(count(css, close), 1);
  const block = css.slice(css.indexOf(open), css.indexOf(close));
  assert.ok(block.includes(".task-markdown {"));
  // The bounded scroll box, its keyboard focus ring and the code block scroll are part of the design.
  for (const piece of [
    "max-height: 320px;",
    "overflow: auto;",
    ".task-markdown:focus-visible {",
    "outline: 2px solid var(--color-86cdb0);",
    ".task-markdown pre {",
    "overflow-x: auto;",
    ".task-markdown h3,",
  ])
    assert.ok(block.includes(piece), "style: " + piece);
  assert.ok(!/@import|url\(|expression\(|content:/.test(block));
  assert.ok(
    !/(^|[^-\w])(?:#[0-9a-f]{3,8})\b/i.test(
      block.replace(/var\(--color-[0-9a-f]+\)/gi, ""),
    ),
  );
});

// ---------------------------------------------------------------------------
// Second slice: helpers for the syntax, inline and docs tests.

const walk = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    walk(node.props && node.props.children, out);
  }
  return out;
};
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : node && typeof node === "object"
      ? textOf(node.props && node.props.children)
      : typeof node === "string" || typeof node === "number"
        ? String(node)
        : "";
const expandTree = (node) => {
  if (Array.isArray(node)) return node.map(expandTree);
  if (!node || typeof node !== "object") return node;
  const own = node.props || {};
  if (typeof node.type === "function") return expandTree(node.type(own));
  if (own.children === undefined) return node;
  return {
    type: node.type,
    props: { ...own, children: expandTree(own.children) },
  };
};
/** The real TaskDetailBody over the small react, on its own, for a task result or a body text. */
function bodyView(input) {
  const detail = typeof input === "string" ? { body: input } : input;
  const slots = [];
  let cursor = 0;
  let tree = null;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((d, k) => d === b[k]);
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (value) => {
          slots[i] = value;
          render();
        },
      ];
    },
    useMemo(fn, list) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, list))
        slots[i] = { deps: list, value: fn() };
      return slots[i].value;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Body = load("src/TaskDetailBody.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
  }).default;
  const fallback = {
    type: "pre",
    props: {
      className: "json-result",
      children: JSON.stringify(detail, null, 2),
    },
  };
  function render() {
    cursor = 0;
    tree = expandTree(Body({ detail, children: fallback }));
  }
  render();
  return {
    tree: () => tree,
    all: (node = tree) => walk(node),
    region: () =>
      walk(tree).find((n) => n.props && n.props["aria-label"] === "Task body"),
    button: (name) =>
      walk(tree).find((n) => n.type === "button" && textOf(n) === name),
  };
}
const markup = (node) =>
  Array.isArray(node)
    ? node.map(markup).join("")
    : node && typeof node === "object"
      ? "<" +
        node.type +
        (node.props.className && node.type !== "div"
          ? "." + node.props.className
          : "") +
        (node.props.start !== undefined ? " start=" + node.props.start : "") +
        ">" +
        markup(node.props.children) +
        "</" +
        node.type +
        ">"
      : typeof node === "string"
        ? node
        : "";
/** The rendered blocks of a body text as simple markup. */
const html = (text) => markup(bodyView(text).region().props.children);

const inl = (list) =>
  list
    .map((n) =>
      n.type === "text"
        ? n.text
        : n.type === "code"
          ? "`" + n.text + "`"
          : n.type === "strong"
            ? "<b>" + inl(n.children) + "</b>"
            : n.type === "em"
              ? "<i>" + inl(n.children) + "</i>"
              : "<a " + n.url + ">" + inl(n.children) + "</a>",
    )
    .join("");
/** Blocks of a body text as short strings: p:, h1:, ul[ | ], ol3[ | ], code:, quote:, hr. */
const show = (text, caps) => {
  const result = md.parseMarkdown(text, caps);
  checkTree(result);
  return result.blocks.map((b) =>
    b.type === "code"
      ? "code:" + b.text
      : b.type === "rule"
        ? "hr"
        : b.type === "list"
          ? (b.ordered ? "ol" + b.start : "ul") +
            "[" +
            b.items.map(inl).join(" | ") +
            "]"
          : b.type === "heading"
            ? "h" + b.level + ":" + inl(b.children)
            : b.type + ":" + inl(b.children),
  );
};
const formatted = (result) => {
  let n = 0;
  let deepest = 0;
  const inline = (list, depth) => {
    for (const node of list)
      if (node.type !== "text") {
        n++;
        deepest = Math.max(deepest, depth);
        if (node.children) inline(node.children, depth + 1);
      }
  };
  for (const b of result.blocks) {
    if (b.children) inline(b.children, 1);
    if (b.items) b.items.forEach((item) => inline(item, 1));
  }
  return { count: n, depth: deepest };
};

test("markdown-safe syntax: bullet and numbered lists, block quotes and rules read as tables, the limits count list items, and the rendered blocks are plain elements", () => {
  const eq = (text, expected) =>
    assert.deepEqual(show(text), expected, JSON.stringify(text));
  // Lists.
  eq("- a\n- b", ["ul[a | b]"]);
  eq("* a\n+ b\n- c", ["ul[a | b | c]"]);
  eq("1. a\n2. b", ["ol1[a | b]"]);
  eq("3) a\n4) b", ["ol3[a | b]"]);
  eq("- a\n1. b", ["ul[a]", "ol1[b]"]);
  eq("1. a\n- b", ["ol1[a]", "ul[b]"]);
  eq("123456789. a", ["ol123456789[a]"]);
  eq("1234567890. a", ["paragraph:1234567890. a"]);
  eq("-a\n-", ["paragraph:-a\n-"]);
  eq("- -", ["ul[-]"]);
  eq("* *", ["ul[*]"]);
  eq("- a\n  > b", ["ul[a]", "quote:b"]);
  eq(">   a  \n>\tb", ["quote:a\nb"]);
  eq("- ", ["paragraph:-"]);
  eq("- a\n  more\n- b", ["ul[a\nmore | b]"]);
  eq("- a\nlazy", ["ul[a]", "paragraph:lazy"]);
  eq("- a\n    - deep", ["ul[a\n- deep]"]);
  eq("- a\n  - b", ["ul[a | b]"]);
  eq("- a\n\n- b", ["ul[a]", "ul[b]"]);
  eq("- a\n# h\n- b", ["ul[a]", "h1:h", "ul[b]"]);
  eq("- a\n---\n- b", ["ul[a]", "hr", "ul[b]"]);
  eq("- a\n```\nx\n```", ["ul[a]", "code:x"]);
  eq("- a\n> q", ["ul[a]", "quote:q"]);
  eq("text\n- a\nmore", ["paragraph:text", "ul[a]", "paragraph:more"]);
  eq("- [x] done\n- [ ] open", ["ul[[x] done | [ ] open]"]);
  eq("- **a** and `b`", ["ul[<b>a</b> and `b`]"]);
  // Quotes.
  eq("> a\n> b", ["quote:a\nb"]);
  eq(">a", ["quote:a"]);
  eq("> > x", ["quote:> x"]);
  eq(">\n>", []);
  eq("> a\n\n> b", ["quote:a", "quote:b"]);
  eq("text\n> q\nmore", ["paragraph:text", "quote:q", "paragraph:more"]);
  eq("> **b** and `c`", ["quote:<b>b</b> and `c`"]);
  // Rules.
  for (const rule of [
    "---",
    "***",
    "___",
    "- - -",
    "* * *",
    "_ _ _ _",
    " ---  ",
  ])
    eq(rule, ["hr"]);
  eq("--", ["paragraph:--"]);
  eq("-*-", ["paragraph:-*-"]);
  eq("Title\n---", ["paragraph:Title", "hr"]);
  eq("a\n***\nb", ["paragraph:a", "hr", "paragraph:b"]);
  eq("---\n---", ["hr", "hr"]);
  // Everything together.
  eq(
    "# T\n\nintro *x*\n\n- one\n- two\n\n1. a\n2. b\n\n> q\n\n---\n\n```\ncode\n```",
    [
      "h1:T",
      "paragraph:intro <i>x</i>",
      "ul[one | two]",
      "ol1[a | b]",
      "quote:q",
      "hr",
      "code:code",
    ],
  );

  // List items count against the block limit together with the blocks.
  const items = md.parseMarkdown("- x\n".repeat(3000));
  checkTree(items);
  assert.equal(items.blocks.length, 1);
  assert.equal(items.blocks[0].items.length, 2000);
  assert.equal(items.truncated, true);
  const mixed = md.parseMarkdown("- a\n- b\n\ntext\n\nmore", { maxBlocks: 3 });
  assert.equal(mixed.blocks.length, 1);
  assert.equal(mixed.truncated, true);
  assert.equal(
    md.parseMarkdown("- a\n- b\n\ntext", { maxBlocks: 4 }).truncated,
    false,
  );
  assert.equal(
    md.parseMarkdown("> a\n> b\n\ntext", { maxBlocks: 2 }).truncated,
    false,
  );

  // Rendered: plain elements only.
  assert.equal(html("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(html("3. a\n4. b"), "<ol start=3><li>a</li><li>b</li></ol>");
  assert.equal(html("> q"), "<blockquote>q</blockquote>");
  assert.equal(html("a\n---\nb"), "<p>a</p><hr></hr><p>b</p>");
  assert.equal(html("# T\n\ntext"), "<h3>T</h3><p>text</p>");
  assert.equal(
    html("## S\n\n```\nx < y\n```"),
    "<h4>S</h4><pre><code>x < y</code></pre>",
  );
  for (const [body, shown] of [
    ["- <script>alert(1)</script>\n- b", "<script>alert(1)</script>"],
    ["1. <img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"],
    ["> <svg onload=alert(1)>\n> more", "<svg onload=alert(1)>"],
    ["---\n- [x](javascript:alert(1))", "[x](javascript:alert(1))"],
  ]) {
    const view = bodyView(body);
    assertPlainElements(view, view.region());
    assert.ok(textOf(view.region()).includes(shown), "kept: " + shown);
  }
  const all = bodyView("# a\n\n- b\n\n1. c\n\n> d\n\n---\n\n```\ne\n```\n\nf");
  assert.deepEqual(
    [...new Set(all.all(all.region()).map((n) => n.type))].sort(),
    ["blockquote", "code", "div", "h3", "hr", "li", "ol", "p", "pre", "ul"],
  );

  // Every class the component sets by name is defined in the Task details block of the stylesheet.
  const css = read("src/styles.css");
  const block = css.slice(
    css.indexOf("/* Task details: rendered markdown body */"),
    css.indexOf("/* end of Task details */"),
  );
  const used = [
    ...read("src/TaskDetailBody.tsx").matchAll(/className="([^"]+)"/g),
  ].map((m) => m[1]);
  for (const name of used.filter((c) => /^(task|md)-/.test(c)))
    assert.ok(block.includes("." + name), "styled: " + name);
  assert.deepEqual(used.filter((c) => /^(task|md)-/.test(c)).sort(), [
    "md-code",
    "md-url",
    "task-markdown",
  ]);

  // The module exports: the original names, and the new limits with their values.
  const names = [
    ...read("src/markdown-safe.ts").matchAll(
      /^export (?:const|function|type|interface) (\w+)/gm,
    ),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(names, [
    "MAX_INLINE_DEPTH",
    "MAX_INLINE_LINE",
    "MAX_INLINE_NODES",
    "MAX_INLINE_SCAN",
    "MAX_MARKDOWN_BLOCKS",
    "MAX_MARKDOWN_CHARS",
    "MAX_URL_LENGTH",
    "MdBlock",
    "MdCaps",
    "MdInline",
    "MdResult",
    "TASK_BODY_FIELDS",
    "TaskBody",
    "parseMarkdown",
    "pickTaskBody",
  ]);
  assert.deepEqual(
    [
      md.MAX_MARKDOWN_CHARS,
      md.MAX_MARKDOWN_BLOCKS,
      md.MAX_INLINE_LINE,
      md.MAX_INLINE_NODES,
      md.MAX_INLINE_SCAN,
      md.MAX_INLINE_DEPTH,
      md.MAX_URL_LENGTH,
    ],
    [100000, 2000, 4000, 5000, 400000, 3, 2000],
  );
});

test("markdown-safe inline: code, bold, italic and plain-address links parse as tables, a link is only its text and its visible address, everything hostile stays text, and the inline limits hold", () => {
  const eq = (text, expected) =>
    assert.deepEqual(
      show(text),
      ["paragraph:" + expected],
      JSON.stringify(text),
    );
  const literal = (text) => eq(text, text);
  // Emphasis.
  eq("**b**", "<b>b</b>");
  eq("__b__", "<b>b</b>");
  eq("*i*", "<i>i</i>");
  eq("_i_", "<i>i</i>");
  eq("a **b** c *d* e", "a <b>b</b> c <i>d</i> e");
  eq("**a *b* c**", "<b>a <i>b</i> c</b>");
  eq("*a **b** c*", "<i>a <b>b</b> c</i>");
  eq("__init__.py", "<b>init</b>.py");
  for (const text of [
    "**a",
    "a** b",
    "a * b * c",
    "2 * 3 * 4",
    "snake_case_name",
    "a_b_ c",
    "***x***",
    "**",
    "** a **",
    "_ a _",
    "x *",
  ])
    literal(text);
  // Code spans keep their content as typed.
  eq("`a`", "`a`");
  eq("``a`b``", "`a`b`");
  eq("` a `", "`a`");
  eq("`  a`", "`  a`");
  eq("` `", "` `");
  eq("`**x**` and `<script>`", "`**x**` and `<script>`");
  eq("a `b` c `d`", "a `b` c `d`");
  for (const text of ["`a", "``a`", "``", "`"]) literal(text);
  // Links: only plain http and https addresses, shown as text and address.
  eq("[t](https://x.y/z?a=1&b=2)", "<a https://x.y/z?a=1&b=2>t</a>");
  eq("[t](http://x.y)", "<a http://x.y>t</a>");
  eq("[t](HTTPS://X.Y)", "<a HTTPS://X.Y>t</a>");
  eq("[**t**](https://x.y)", "<a https://x.y><b>t</b></a>");
  eq(
    "see [a](https://x.y) and [b](http://z.w).",
    "see <a https://x.y>a</a> and <a http://z.w>b</a>.",
  );
  eq("[a [b] c](https://x.y)", "<a https://x.y>a [b] c</a>");
  eq("[[a](http://x.y)](http://z.w)", "<a http://z.w>[a](http://x.y)</a>");
  eq("[t](https://x.y)(more)", "<a https://x.y>t</a>(more)");
  eq(
    "[t](https://x.y/" + "a".repeat(1980) + ")",
    "<a https://x.y/" + "a".repeat(1980) + ">t</a>",
  );
  eq(
    "[t](https://x.y/a" + char(0x200b) + "b" + char(0x202e) + ")",
    "<a https://x.y/ab>t</a>",
  );
  for (const text of [
    "[t](javascript:alert(1))",
    "[t](JaVaScRiPt:alert(1))",
    "[t](data:text/html;base64,PHNjcmlwdD4=)",
    "[t](vbscript:msgbox(1))",
    "[t](file:///etc/passwd)",
    "[t](ftp://x.y)",
    "[t](/relative)",
    "[t](#frag)",
    "[t](mailto:a@b.c)",
    '[t](https://x.y "title")',
    "[t](https://x.y/a(b))",
    "[t]( https://x.y)",
    "[t](https://x.y/'q')",
    "[t](https://x.y/<b>)",
    "[](https://x.y)",
    "[t](https://x.y",
    "[t]",
    "[t] (https://x.y)",
    "![i](https://x.y/i.png)",
    "![i](javascript:alert(1))",
    "[a](<https://x.y>)",
    "https://bare.example/x",
    "<https://auto.example>",
    "javascript:alert(1)",
    "[t](https://x.y/" + "a".repeat(2000) + ")",
  ])
    literal(text);

  // Hostile inline text: every payload is on the page as text, and the elements stay plain.
  const payloads = [
    ["**<script>alert(1)</script>**", "<script>alert(1)</script>"],
    [
      "[<img src=x onerror=alert(1)>](https://x.y)",
      "<img src=x onerror=alert(1)> (https://x.y)",
    ],
    ["`<script>alert(1)</script>`", "<script>alert(1)</script>"],
    ["*<b onmouseover=alert(1)>x</b>*", "<b onmouseover=alert(1)>x</b>"],
    [
      '[x](https://x.y" onclick="alert(1))',
      '[x](https://x.y" onclick="alert(1))',
    ],
    [
      "[x](https://x.y/><script>alert(1)</script>)",
      "[x](https://x.y/><script>alert(1)</script>)",
    ],
    [
      "[x](https://x.y/%22%20onclick=alert(1))",
      "[x](https://x.y/%22%20onclick=alert(1))",
    ],
    ["- <iframe src=x></iframe>", "<iframe src=x></iframe>"],
    ["> <svg onload=1>", "<svg onload=1>"],
    [
      "# <a href=javascript:alert(1)>x</a>",
      "<a href=javascript:alert(1)>x</a>",
    ],
    ["__<style>*{display:none}</style>__", "<style>*{display:none}</style>"],
  ];
  for (const [payload, shown] of payloads) {
    const view = bodyView(payload);
    const nodes = assertPlainElements(view, view.region());
    assert.ok(
      nodes.every(
        (n) =>
          typeof n.type !== "string" ||
          !/^(a|img|script|iframe|svg|style)$/.test(n.type),
      ),
    );
    assert.ok(textOf(view.region()).includes(shown), "kept: " + payload);
  }
  // A link shows its text and its address and nothing is clickable.
  assert.equal(
    html("Use **bold**, *italic*, `code` and [a link](https://x.y/z)."),
    "<p>Use <strong>bold</strong>, <em>italic</em>, <code.md-code>code</code> and <span>a link<span.md-url> (https://x.y/z)</span></span>.</p>",
  );
  const spoof = bodyView("[https://good.example](https://evil.example)");
  const spoofText = textOf(spoof.region());
  assert.ok(spoofText.includes("https://good.example"));
  assert.ok(spoofText.includes("(https://evil.example)"));
  assertPlainElements(spoof, spoof.region());

  // Limits: formatted nodes, depth, a long line and the search budget.
  const manyLines = ("*a* ".repeat(900) + "\n").repeat(20);
  const many = md.parseMarkdown(manyLines);
  checkTree(many);
  assert.equal(formatted(many).count, md.MAX_INLINE_NODES);
  assert.ok(plain(many).includes("*a* "), "syntax past the limit stays text");
  const nested = md.parseMarkdown(
    "*a **b *c **d *e **f** e* d** c* b** a*\n" +
      "[x [y](https://a.b)](https://c.d)",
  );
  checkTree(nested);
  assert.ok(formatted(nested).depth <= md.MAX_INLINE_DEPTH);
  const deep = md.parseMarkdown("**a *b __c _d d_ c__ b* a**");
  checkTree(deep);
  assert.equal(formatted(deep).depth, md.MAX_INLINE_DEPTH);
  assert.ok(plain(deep).includes("_d d_"), "a level past the limit stays text");
  assert.deepEqual(show("_a_b_"), ["paragraph:<i>a_b</i>"]);
  const run = md.parseMarkdown("`a``b`").blocks[0].children;
  assert.deepEqual(
    run.map((n) => n.type + ":" + n.text),
    ["code:a``b"],
  );
  const label = (n) => "[" + "a".repeat(n) + "](https://x.y)";
  assert.equal(md.parseMarkdown(label(999)).blocks[0].children[0].type, "link");
  assert.deepEqual(show(label(1000)), ["paragraph:" + label(1000)]);
  const lineLimit = "x".repeat(md.MAX_INLINE_LINE);
  assert.deepEqual(show(lineLimit + "**b**"), [
    "paragraph:" + lineLimit + "**b**",
  ]);
  assert.deepEqual(show("**b** " + lineLimit), [
    "paragraph:<b>b</b> " + lineLimit,
  ]);
  const tail = md.parseMarkdown(
    "a".repeat(md.MAX_INLINE_LINE - 2) + "**b**" + "c".repeat(50),
  );
  assert.equal(
    plain(tail).length,
    md.MAX_INLINE_LINE - 2 + 5 + 50 - formatted(tail).count * 4,
  );

  // Pathological inline lines stay quick and bounded.
  const start = process.hrtime.bigint();
  for (const line of [
    "[".repeat(3990),
    "[a".repeat(1990),
    "*a ".repeat(1300),
    "`a ".repeat(1300),
    "[a](http://x.y/ ".repeat(240),
    "*a [b](c `d _e __f ".repeat(200),
    "[a](https://x.y) ".repeat(240),
    "**a *b ".repeat(500),
    "![a](".repeat(700),
  ]) {
    const text = (line + "\n").repeat(25);
    const result = md.parseMarkdown(text);
    const nodes = checkTree(result);
    assert.ok(nodes <= 20000, "nodes " + nodes);
    assert.ok(formatted(result).count <= md.MAX_INLINE_NODES);
  }
  assert.ok(
    Number(process.hrtime.bigint() - start) / 1e6 < 5000,
    "inline lines stay quick",
  );

  // Random walks over inline pieces: well formed, deterministic, and no character is ever invented.
  const pieces = [
    "[",
    "](",
    "https://a.b",
    "http://c.d/e",
    ")",
    "(",
    "**",
    "*",
    "__",
    "_",
    "`",
    "``",
    "x",
    "yz",
    " ",
    " ",
    "\n",
    "- ",
    "1. ",
    "> ",
    "# ",
    "![",
    "!",
    "<b>",
    "javascript:",
    "\\",
    "|",
    "&amp;",
  ];
  const rand = seeded(8112026);
  const began = process.hrtime.bigint();
  for (let run = 0; run < 800; run++) {
    let text = "";
    const length = 1 + Math.floor(rand() * 60);
    for (let k = 0; k < length; k++)
      text += pieces[Math.floor(rand() * pieces.length)];
    const result = md.parseMarkdown(text);
    checkTree(result);
    assert.deepEqual(md.parseMarkdown(text), result);
    const seen = new Set(text + "\n");
    for (const c of plain(result))
      assert.ok(
        seen.has(c),
        "invented " + JSON.stringify(c) + " in " + JSON.stringify(text),
      );
  }
  assert.ok(
    Number(process.hrtime.bigint() - began) / 1e6 < 5000,
    "the random walk stays quick",
  );
});

test("markdown-safe docs: TASKS.md has one Task details section that says what is shown, the supported subset, that nothing is HTML or clickable, the limits and that viewing sends nothing", () => {
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n## Task board filters\n"), 1);
  assert.equal(count(doc, "\n## Task details\n"), 1);
  // The new section sits before the filters section, which stays last: the filters test reads from its heading to the end of the page.
  assert.ok(
    doc.indexOf("## Task details") < doc.indexOf("## Task board filters"),
  );
  assert.equal(count(doc, "\n## "), 2);
  assert.ok(
    collapse(doc.slice(0, doc.indexOf("## Task details"))).includes(
      "This page describes the task details dialog and the panel's filters.",
    ),
  );
  const section = doc.slice(
    doc.indexOf("## Task details"),
    doc.indexOf("## Task board filters"),
  );
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 4);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line each");
  const flat = collapse(section);
  const chars = md.MAX_MARKDOWN_CHARS.toLocaleString("en-US");
  const blocks = md.MAX_MARKDOWN_BLOCKS.toLocaleString("en-US");
  for (const part of [
    "Selecting a task on the board opens its details.",
    "taken from the first of its body, bodyPreview and summary fields that holds text",
    "when only the summary is used, the dialog says so",
    "The Raw JSON button switches to the whole item exactly as OpenRig returns it",
    "a task with no text, or a failed read, shows only that JSON",
    "Viewing a task is read only: nothing is sent to OpenRig, no task or seat is changed",
    "the owner and handoff controls below the text work as before",
    "a small fixed subset of Markdown",
    "headings (`#` to `###`)",
    "bullet lists (`-`, `*` or `+`) and numbered lists with one level",
    "block quotes (`>`) with one level",
    "rules (`---`)",
    "fenced code blocks (three backticks or `~~~`)",
    "inline code, bold (`**text**`), italic (`*text*` or `_text_`) and links",
    "A line break inside a paragraph is kept as a line break.",
    "Wrap names such as `__init__` or `src/*.ts` in inline code so their marks stay visible.",
    "Nothing in the text is ever treated as HTML or as a program.",
    "HTML such as script or img tags, entities and comments are shown exactly as typed.",
    "shows its text followed by its address in parentheses and cannot be clicked, so HRig never opens anything from a task",
    "only plain http and https addresses count as links",
    "(javascript:, data:, file:, relative paths) stays as typed, as do images",
    "Tables, nested lists, setext headings, backslash escapes and syntax highlighting are not supported and show as typed.",
    "Control, zero-width and direction-changing characters are removed.",
    "A text longer than " +
      chars +
      " characters or " +
      blocks +
      " blocks (a list item counts as a block) is cut with a note",
    "very long or very repetitive lines show their formatting only in part, always as plain text. Raw JSON has the whole item.",
  ])
    assert.ok(flat.includes(part), "docs say: " + part);
  // The claims in the docs match the limits in the code.
  assert.equal(chars, "100,000");
  assert.equal(blocks, "2,000");
});
