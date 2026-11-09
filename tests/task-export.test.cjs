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
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};

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
const lib = load("src/task-export.ts");

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx, with the real export module and the real download
// helper, over a very small react: state slots, effects queued and run after
// the render the way react runs them, elements recorded as plain objects. The
// bridge is a fake that records every call it gets. The page is a fake too:
// a link whose click is recorded, an object URL for each Blob, a timer list
// that only records, and a clock fixed at AT. Nothing is written anywhere.

const AT = new Date(2026, 10, 9, 14, 5, 30).getTime();
const MIN = 60000;
const HOUR = 3600000;
const ago = (ms) => new Date(AT - ms).toISOString();
const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [{ name: "dev-a", rigName: "hrig" }];
const task = (id, status, extra = {}) => ({
  id,
  status,
  title: "Task " + id,
  destination: "dev-a@hrig",
  ...extra,
});
// Five tasks with the fields a real normalized row carries, and the fields an export must never carry (a body, a body preview, a token, a question).
const ROWS = [
  task("q1", "pending", {
    title: "=cmd|' /C calc'!A0",
    tags: ["Mission:Alpha", "urgent"],
    tsCreated: ago(5 * MIN),
    body: "BODY-SECRET-1 password=hunter2",
    bodyPreview: "PREVIEW-SECRET",
    token: "sk-live-TOKEN-1",
  }),
  task("q2", "blocked", {
    title: 'Fix, "quoted" thing',
    blockedOn: "qitem-1",
    tsCreated: ago(3 * HOUR),
    humanQuestions: "QUESTION-SECRET",
  }),
  task("q3", "in-progress", {
    title: "-5 degrees",
    destination: "dev-b@hrig",
    tsCreated: ago(48 * HOUR),
  }),
  task("q4", "failed", { title: "plain failed task" }),
  task("q5", "pending", { title: "@SUM(A1)", tags: "ops, Urgent" }),
];
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};
const CSV_HEADER = "id,title,state,owner,tags,age,reason\r\n";
const CSV_ALL =
  CSV_HEADER +
  "q1,'=cmd|' /C calc'!A0,pending,dev-a@hrig,\"mission:alpha, urgent\",5m,\r\n" +
  'q2,"Fix, ""quoted"" thing",blocked,dev-a@hrig,,3h,Blocked on qitem-1\r\n' +
  "q3,'-5 degrees,in-progress,dev-b@hrig,,2d,\r\n" +
  "q4,plain failed task,failed,dev-a@hrig,,,\r\n" +
  'q5,\'@SUM(A1),pending,dev-a@hrig,"ops, urgent",,\r\n';
const CSV_BLOCKED =
  CSV_HEADER +
  'q2,"Fix, ""quoted"" thing",blocked,dev-a@hrig,,3h,Blocked on qitem-1\r\n';
const NOTE =
  "Exports only the tasks shown, without task bodies. Review before sharing.";

function boardHarness({ rows = ROWS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let pending = [];
  let cursor = 0;
  let tree = null;
  let current = deepFreeze(rows);
  const calls = { queue: [], rigAction: [], sendMessage: [] };
  const saved = { blobs: [], anchors: [], timers: [], revoked: [], fail: null };
  const before = {
    window: globalThis.window,
    document: globalThis.document,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const win = {
    hrig: {
      queue: (connection, rigName) => {
        calls.queue.push([connection, rigName]);
        return current instanceof Error
          ? Promise.reject(current)
          : Promise.resolve(current);
      },
      rigAction: (...args) => {
        calls.rigAction.push(args);
        return Promise.resolve({});
      },
      sendMessage: (...args) => {
        calls.sendMessage.push(args);
        return Promise.resolve("");
      },
    },
  };
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
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (
        !old ||
        list.length !== old.length ||
        list.some((d, k) => d !== old[k])
      ) {
        deps[i] = list;
        pending.push(() => {
          if (cleanups[i]) cleanups[i]();
          cleanups[i] = fn();
        });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const Board = load("src/TaskBoard.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
      Download: "Download",
    },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const props = {
    connection: CONNECTION,
    rigName: undefined,
    seats: SEATS,
    onSeat: () => {},
  };
  function render() {
    globalThis.window = win;
    globalThis.document = {
      get activeElement() {
        return null;
      },
      createElement(tag) {
        assert.equal(tag, "a", "only a link is ever created");
        return {
          tag,
          href: "",
          download: "",
          clicks: 0,
          click() {
            this.clicks += 1;
            saved.anchors.push(this);
          },
        };
      },
    };
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    const realNow = Date.now;
    Date.now = () => AT;
    try {
      cursor = 0;
      tree = Board(props);
    } finally {
      Date.now = realNow;
    }
    const run = pending;
    pending = [];
    run.forEach((fn) => fn());
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
  const byClass = (name) =>
    all(tree).filter((n) => n.props && n.props.className === name);
  const harness = {
    calls,
    saved,
    all: () => all(tree),
    text,
    byClass,
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n) === name),
    /** The two export buttons, in the order the header shows them. */
    exports: () =>
      all(tree).filter(
        (n) =>
          n.type === "button" &&
          typeof n.props.title === "string" &&
          /^Export /.test(text(n)),
      ),
    titles: () =>
      byClass("task-card").map((card) =>
        text(all(card).find((n) => n.type === "strong")),
      ),
    notice: () => byClass("success-note").map(text),
    errors: () => all(tree).filter((n) => n.type === "ErrorBox"),
    /** Change one filter box the way a person does: the select or input with that label. */
    change(label, value) {
      const box = all(tree).find(
        (n) => n.props && n.props["aria-label"] === label && n.props.onChange,
      );
      assert.ok(box, "no filter named " + label);
      box.props.onChange({ target: { value } });
    },
    async flush() {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
    /** Press a button with the page's download pieces faked; an error to throw can be given. */
    click(button, { fail } = {}) {
      const keep = {
        create: URL.createObjectURL,
        revoke: URL.revokeObjectURL,
        timeout: globalThis.setTimeout,
      };
      saved.fail = fail || null;
      URL.createObjectURL = (blob) => {
        if (saved.fail) throw saved.fail;
        saved.blobs.push(blob);
        return "blob:fake-" + saved.blobs.length;
      };
      URL.revokeObjectURL = (url) => saved.revoked.push(url);
      globalThis.setTimeout = (fn, ms) => {
        saved.timers.push({ fn, ms });
        return saved.timers.length;
      };
      try {
        button.props.onClick();
      } finally {
        URL.createObjectURL = keep.create;
        URL.revokeObjectURL = keep.revoke;
        globalThis.setTimeout = keep.timeout;
        saved.fail = null;
      }
    },
    /** Run the recorded timers (the release of each object URL) with the page's release call faked. */
    fireTimers() {
      const keep = URL.revokeObjectURL;
      URL.revokeObjectURL = (url) => saved.revoked.push(url);
      try {
        saved.timers.splice(0).forEach((t) => t.fn());
      } finally {
        URL.revokeObjectURL = keep;
      }
    },
    /** The file the last (or given) click saved: its name, media type and exact bytes as text. */
    async file(index = saved.blobs.length - 1) {
      const blob = saved.blobs[index];
      const bytes = Buffer.from(await blob.arrayBuffer());
      return {
        name: saved.anchors[index].download,
        url: saved.anchors[index].href,
        type: blob.type,
        bytes,
        text: bytes.toString("utf8"),
      };
    },
    unmount() {
      cleanups.forEach((c) => c && c());
      globalThis.window = before.window;
      globalThis.document = before.document;
      globalThis.setInterval = before.setInterval;
      globalThis.clearInterval = before.clearInterval;
      if (before.window === undefined) delete globalThis.window;
      if (before.document === undefined) delete globalThis.document;
    },
  };
  return harness;
}

test("task-export tracer: on the real task board Export CSV saves exactly the tasks the filters leave, in the seven fixed columns, with formula cells defanged and no body text, and nothing is sent", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.titles().length, 5);
    const [csv] = board.exports();
    assert.equal(board.text(csv), "Export CSV (5)");
    assert.equal(csv.props.disabled, false);
    assert.equal(csv.props.title, NOTE);

    // With the state filter on blocked the board shows one task, the button says so and the file holds that task only.
    board.change("Filter task state", "blocked");
    assert.deepEqual(board.titles(), ['Fix, "quoted" thing']);
    const blocked = board.exports()[0];
    assert.equal(board.text(blocked), "Export CSV (1)");
    board.click(blocked);
    const one = await board.file();
    assert.equal(one.name, "hrig-tasks-20261109-1405.csv");
    assert.equal(one.type, "text/csv;charset=utf-8");
    assert.equal(one.text, CSV_BLOCKED);
    assert.equal(one.url, "blob:fake-1");
    assert.deepEqual(board.notice(), [
      "Started the download of 1 task as CSV. " + NOTE,
    ]);

    // With no filter every task is exported: the header is the seven fixed columns, a cell a spreadsheet could read as a formula starts with a single quote, and no body, preview, token or question is in the file.
    board.change("Filter task state", "");
    const everything = board.exports()[0];
    assert.equal(board.text(everything), "Export CSV (5)");
    board.click(everything);
    const all = await board.file();
    assert.equal(all.text, CSV_ALL);
    assert.equal(all.text.split("\r\n")[0], lib.EXPORT_COLUMNS.join(","));
    assert.equal(lib.EXPORT_COLUMNS.length, 7);
    assert.ok(!/SECRET|TOKEN|hunter2|PREVIEW/.test(all.text));
    assert.notEqual(all.bytes[0], 0xef, "no byte order mark");
    assert.equal(all.name, "hrig-tasks-20261109-1405.csv");
    assert.deepEqual(board.notice(), [
      "Started the download of 5 tasks as CSV. " + NOTE,
    ]);

    // The link is clicked once per export and the object URL is released a second later; no task was read twice, claimed or sent.
    assert.deepEqual(
      board.saved.anchors.map((a) => a.clicks),
      [1, 1],
    );
    assert.deepEqual(
      board.saved.timers.map((t) => t.ms),
      [1000, 1000],
    );
    board.fireTimers();
    assert.deepEqual(board.saved.revoked, ["blob:fake-1", "blob:fake-2"]);
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);
  } finally {
    board.unmount();
  }
});
