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

const filtersLib = load("src/task-filters.ts");
const ageLib = load("src/task-age.ts");
const reasonLib = load("src/task-reason.ts");
const dl = load("src/download-text.ts");
const COLUMNS = ["id", "title", "state", "owner", "tags", "age", "reason"];
const READERS = {
  tags: filtersLib.itemTags,
  age: ageLib.ageOf,
  reason: reasonLib.reasonOf,
};
const row = (over = {}) => ({
  id: "i",
  title: "t",
  state: "s",
  owner: "o",
  tags: "",
  age: "",
  reason: "",
  ...over,
});
const char = (code) => String.fromCodePoint(code);

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
const randomText = (next, alphabet, max) => {
  let text = "";
  for (let n = Math.floor(next() * (max + 1)); n > 0; n--)
    text += alphabet[Math.floor(next() * alphabet.length)];
  return text;
};

// A small reader for RFC 4180: quoted cells with doubled quotes and line breaks, records ended by CRLF, LF or CR outside quotes.
function parseCsv(text) {
  const records = [];
  let record = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      i += 1;
    } else if (c === ",") {
      record.push(cell);
      cell = "";
      i += 1;
    } else if (c === "\r" || c === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += c;
      i += 1;
    }
  }
  assert.equal(quoted, false, "a quoted cell is left open");
  if (cell !== "" || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records;
}
// Outside quoted cells every line break must be a CRLF pair.
const crlfOnly = (text) =>
  !/\r(?!\n)|(?<!\r)\n/.test(text.replace(/"(?:[^"]|"")*"/g, ""));
// The cells of one markdown table line: split on pipes that are not escaped.
function mdCells(line) {
  const cells = [];
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      cell += c + (line[i + 1] ?? "");
      i += 1;
    } else if (c === "|") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells.slice(1, -1).map((x) => x.trim());
}
// A cell with its escape pairs removed holds none of the characters that make a table, code, a link, an image or HTML.
const bare = (cell) => cell.replace(/\\./g, "");
const FORMULA = /^[\t\r]|^\s*[=+\-@]/;

test("task-export rows: a row holds the seven fixed columns, read from the task's own fields and the three readers lent by the board, and never any other field", () => {
  const item = {
    ...ROWS[1],
    qitemId: "Q-RAW",
    rawBody: "RAW-BODY",
    nested: { token: "NESTED-TOKEN" },
    list: ["LIST-SECRET"],
  };
  const set = lib.exportRows([item], AT, READERS);
  assert.deepEqual(set, {
    rows: [
      {
        id: "q2",
        title: 'Fix, "quoted" thing',
        state: "blocked",
        owner: "dev-a@hrig",
        tags: "",
        age: "3h",
        reason: "Blocked on qitem-1",
      },
    ],
    total: 1,
  });
  assert.deepEqual(Object.keys(set.rows[0]), COLUMNS);
  assert.deepEqual([...lib.EXPORT_COLUMNS], COLUMNS);
  assert.ok(!/RAW|TOKEN|SECRET/.test(JSON.stringify(set)));

  // Tags come joined from the reader, age and reason from the label and the line of what the readers return.
  const q1 = lib.exportRows([ROWS[0]], AT, READERS).rows[0];
  assert.equal(q1.tags, "mission:alpha, urgent");
  assert.equal(q1.age, "5m");
  assert.equal(q1.reason, "");
  assert.equal(
    lib.exportRows([ROWS[4]], AT, READERS).rows[0].tags,
    "ops, urgent",
  );

  // Text fields: a string as it is, a finite number written out, everything else empty; only own fields count.
  const odd = lib.exportRows(
    [
      { id: 42, title: 7.5, status: NaN, destination: Infinity },
      { id: null, title: true, status: {}, destination: ["x"] },
      {
        id: 10n,
        title: undefined,
        status: () => "s",
        destination: Symbol("d"),
      },
      Object.create({ id: "inherited", title: "inherited" }),
      JSON.parse('{"__proto__": {"id": "x"}, "id": "real"}'),
      {},
    ],
    AT,
  );
  assert.deepEqual(
    odd.rows.map((r) => [r.id, r.title, r.state, r.owner]),
    [
      ["42", "7.5", "", ""],
      ["", "", "", ""],
      ["", "", "", ""],
      ["", "", "", ""],
      ["real", "", "", ""],
      ["", "", "", ""],
    ],
  );

  // Entries that are not objects are skipped and not counted; anything that is not a list gives nothing.
  const mixed = lib.exportRows([null, 3, "x", [], undefined, ROWS[3]], AT);
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.total, 1);
  for (const junk of [null, undefined, 5, "text", { 0: ROWS[0], length: 1 }])
    assert.deepEqual(lib.exportRows(junk, AT, READERS), { rows: [], total: 0 });

  // The readers are called with the task itself (and the time for the age), once per row; what they return is checked.
  const calls = [];
  const spy = lib.exportRows([ROWS[3], ROWS[4]], 123, {
    tags: (item) => (calls.push(["tags", item]), [1, "a", null, "b", {}]),
    age: (item, at) => (calls.push(["age", item, at]), { label: "9h" }),
    reason: (item) => (calls.push(["reason", item]), { line: "why" }),
  });
  assert.deepEqual(
    calls.map((c) => [c[0], c[1], c[2]]),
    [
      ["tags", ROWS[3], undefined],
      ["age", ROWS[3], 123],
      ["reason", ROWS[3], undefined],
      ["tags", ROWS[4], undefined],
      ["age", ROWS[4], 123],
      ["reason", ROWS[4], undefined],
    ],
  );
  assert.deepEqual(
    spy.rows.map((r) => [r.tags, r.age, r.reason]),
    [
      ["a, b", "9h", "why"],
      ["a, b", "9h", "why"],
    ],
  );
  const wrong = lib.exportRows([ROWS[3]], AT, {
    tags: () => "not a list",
    age: () => ({ label: 5 }),
    reason: () => ({ text: "no line" }),
  });
  assert.deepEqual(
    [wrong.rows[0].tags, wrong.rows[0].age, wrong.rows[0].reason],
    ["", "", ""],
  );
  const nothing = lib.exportRows([ROWS[3]], AT, {
    age: () => null,
    reason: () => undefined,
  });
  assert.deepEqual(
    [nothing.rows[0].tags, nothing.rows[0].age, nothing.rows[0].reason],
    ["", "", ""],
  );
  for (const readers of [undefined, null, [], "readers", {}])
    assert.deepEqual(
      lib.exportRows([ROWS[3]], AT, readers).rows[0],
      row({
        id: "q4",
        title: "plain failed task",
        state: "failed",
        owner: "dev-a@hrig",
      }),
    );
  const many = lib.exportRows([{ id: "t" }], AT, {
    tags: () => Array.from({ length: 40 }, (_, n) => "t" + n),
  });
  assert.equal(many.rows[0].tags.split(", ").length, 32);
  // A reader that throws is not hidden: the board shows the error.
  assert.throws(
    () =>
      lib.exportRows([ROWS[0]], AT, {
        age: () => {
          throw new Error("reader broke");
        },
      }),
    /reader broke/,
  );

  // List order is kept, at most 1000 rows are made (the readers run for those only) and the total counts every task.
  let reads = 0;
  const long = Array.from({ length: 1500 }, (_, n) => ({ id: "n" + n }));
  const cut = lib.exportRows(long, AT, { tags: () => (reads++, []) });
  assert.equal(lib.MAX_EXPORT_ROWS, 1000);
  assert.equal(cut.rows.length, 1000);
  assert.equal(cut.total, 1500);
  assert.equal(reads, 1000);
  assert.deepEqual(cut.rows.map((r) => r.id).slice(0, 3), ["n0", "n1", "n2"]);
  assert.equal(cut.rows[999].id, "n999");

  // The input is never changed.
  const frozen = deepFreeze(JSON.parse(JSON.stringify(ROWS)));
  lib.exportRows(frozen, AT, READERS);
  assert.deepEqual(frozen, JSON.parse(JSON.stringify(ROWS)));
});

test("task-export csv: a header and one line per row, CRLF line ends, RFC 4180 quoting with quotes doubled and line breaks kept inside the cell, UTF-8 text without a byte order mark", () => {
  assert.equal(lib.toCsv([]), CSV_HEADER);
  for (const junk of [null, undefined, 3, "text", {}, { length: 2 }])
    assert.equal(lib.toCsv(junk), CSV_HEADER);
  assert.equal(
    lib.toCsv([row()]),
    CSV_HEADER + "i,t,s,o,,,\r\n",
    "every record ends in CRLF, the last one too",
  );

  const cases = [
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['"', '""""'],
    ["a\nb", '"a\nb"'],
    ["a\r\nb", '"a\r\nb"'],
    ["a\rb", '"a\rb"'],
    [" lead and trail ", " lead and trail "],
    ["", ""],
    ["x;y", "x;y"],
    ["tab\there", "tab\there"],
    ["a'b", "a'b"],
    ["'quoted", "'quoted"],
    ["\u00e9\u65e5\u672c\u{1f600}", "\u00e9\u65e5\u672c\u{1f600}"],
  ];
  for (const [cell, encoded] of cases) {
    const csv = lib.toCsv([row({ title: cell })]);
    assert.equal(csv, CSV_HEADER + "i," + encoded + ",s,o,,,\r\n", cell);
    assert.deepEqual(parseCsv(csv)[1], ["i", cell, "s", "o", "", "", ""]);
  }

  // Seven cells in every column are quoted on their own.
  const wide = lib.toCsv([row({ id: "a,1", tags: 'b"2', reason: "c\n3" })]);
  assert.equal(wide, CSV_HEADER + '"a,1",t,s,o,"b""2",,"c\n3"\r\n');

  // Whatever text the cells hold, the file reads back as the same table, and outside quotes every line break is a CRLF pair.
  const next = seeded(7);
  const alphabet = [
    "x",
    "y",
    " ",
    ",",
    '"',
    "\r",
    "\n",
    "\t",
    ";",
    "'",
    "\u00e9",
  ];
  for (let n = 0; n < 300; n++) {
    const cells = COLUMNS.map(() => "x" + randomText(next, alphabet, 10));
    const input = Object.fromEntries(COLUMNS.map((c, k) => [c, cells[k]]));
    const csv = lib.toCsv([input, input]);
    assert.ok(crlfOnly(csv), JSON.stringify(csv));
    assert.deepEqual(parseCsv(csv), [COLUMNS, cells, cells]);
  }

  // Only the seven columns are written; other keys, non-text cells and inherited cells are not.
  const extra = lib.toCsv([
    row({ body: "SECRET-BODY", token: "SECRET-TOKEN", extra: 1 }),
    row({ title: 5, state: null, owner: { x: 1 }, tags: ["a"], age: true }),
    Object.create({ title: "INHERITED" }),
  ]);
  assert.equal(
    extra,
    CSV_HEADER + "i,t,s,o,,,\r\n" + "i,,,,,,\r\n" + ",,,,,,\r\n",
  );
  assert.ok(!/SECRET|INHERITED/.test(extra));
  // Entries that are not objects are skipped.
  assert.equal(
    lib.toCsv([null, 3, "x", [], row()]),
    CSV_HEADER + "i,t,s,o,,,\r\n",
  );
  assert.ok(!lib.toCsv([row()]).startsWith("\ufeff"));
  const frozen = deepFreeze([row({ title: "=1" })]);
  lib.toCsv(frozen);
});

test("task-export inject: a CSV cell that a spreadsheet could read as a formula gets a single quote in front, in every column, whatever hidden or space characters come first", () => {
  const cell = (value) => parseCsv(lib.toCsv([row({ title: value })]))[1][1];
  const defended = [
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["=1+1", "'=1+1"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["=", "'="],
    ["+", "'+"],
    ["-", "'-"],
    ["@", "'@"],
    ["-5 degrees", "'-5 degrees"],
    ['=HYPERLINK("http://x","y")', '\'=HYPERLINK("http://x","y")'],
    ["\t=1", "'\t=1"],
    ["\tplain", "'\tplain"],
    ["\r=1", "'\r=1"],
    ["\rplain", "'\rplain"],
    ["\n=1", "'\n=1"],
    [" =1", "' =1"],
    ["   +1", "'   +1"],
    [" \t -1", "' \t -1"],
    // Hidden and unusual space characters are removed or made plain before the first character is looked at.
    ["\u00a0=1", "' =1"],
    ["\u3000@x", "' @x"],
    ["\u200b=1", "'=1"],
    ["\ufeff+1", "'+1"],
    ["\u202e-1", "'-1"],
    ["\u0000=1", "'=1"],
    ["\u0007@x", "'@x"],
    ["\u00ad=1", "'=1"],
    ["\u061c+1", "'+1"],
    ["\u2060=1", "'=1"],
    ["\u180e=1", "'=1"],
    ["\u0080=1", "'=1"],
    ["\u009f+1", "'+1"],
    ["\u007f-1", "'-1"],
    ["\u{e0001}=1", "'=1"],
    ["\ud800=1", "'=1"],
    ["\u200b \u200b=1", "' =1"],
  ];
  for (const [input, expected] of defended)
    assert.equal(cell(input), expected, JSON.stringify(input));
  // The quote goes inside the quotes of a cell that needs them.
  assert.equal(
    lib.toCsv([row({ title: '=HYPERLINK("http://x","y")' })]),
    CSV_HEADER + 'i,"\'=HYPERLINK(""http://x"",""y"")",s,o,,,\r\n',
  );
  assert.equal(
    lib.toCsv([row({ title: "\r=1" })]),
    CSV_HEADER + 'i,"\'\r=1",s,o,,,\r\n',
  );

  // Text that is not a formula is left alone, a quote that is already there is not doubled, and a full-width sign is not one a spreadsheet reads.
  const plainText = [
    "a=b",
    "1+1",
    "x-y",
    "me@example.com",
    "'=1",
    "5m",
    "<1m",
    "/etc/passwd",
    "#tag",
    "ab=",
    "\uff1d1",
    "",
  ];
  for (const input of plainText)
    assert.equal(cell(input), input, JSON.stringify(input));

  // Every column is defended, not only the title.
  const all = lib.toCsv([Object.fromEntries(COLUMNS.map((c) => [c, "=x"]))]);
  assert.deepEqual(
    parseCsv(all)[1],
    COLUMNS.map(() => "'=x"),
  );
  assert.equal(parseCsv(all)[0].join(","), COLUMNS.join(","));
  // A markdown table is not a spreadsheet: its cells are not given a quote.
  assert.ok(lib.toMarkdown([row({ title: "=1+1" })]).includes("| =1+1 |"));

  // The rule that matters: whatever the text, no cell of the file starts (after spaces) with = + - @ or with a tab or carriage return.
  const next = seeded(11);
  const alphabet = [
    "=",
    "+",
    "-",
    "@",
    "\t",
    "\r",
    "\n",
    " ",
    "a",
    "1",
    '"',
    ",",
    "\u200b",
    "\u00a0",
    "\ufeff",
    "\u0000",
    "|",
    "'",
    "\u00e9",
    "\u202e",
    "\u00ad",
    "\u3000",
  ];
  for (let n = 0; n < 3000; n++) {
    const input = Object.fromEntries(
      COLUMNS.map((c) => [c, randomText(next, alphabet, 8)]),
    );
    const records = parseCsv(lib.toCsv([input]));
    assert.equal(records.length, 2);
    assert.equal(records[1].length, 7);
    for (const value of records[1])
      assert.ok(!FORMULA.test(value), JSON.stringify([input, value]));
  }
});

test("task-export markdown: a pipe table with one line per row, every cell one line, and the characters that make a table, code, a link, an image or HTML escaped", () => {
  const header = "| " + COLUMNS.join(" | ") + " |\n";
  const rule = "| " + COLUMNS.map(() => "---").join(" | ") + " |\n";
  assert.equal(lib.toMarkdown([]), header + rule);
  for (const junk of [null, undefined, 3, "text", {}])
    assert.equal(lib.toMarkdown(junk), header + rule);
  assert.equal(
    lib.toMarkdown([row(), row({ id: "j", tags: "a, b", age: "5m" })]),
    header +
      rule +
      "| i | t | s | o |  |  |  |\n" +
      "| j | t | s | o | a, b | 5m |  |\n",
  );
  const cell = (value) =>
    mdCells(lib.toMarkdown([row({ title: value })]).split("\n")[2])[1];
  const cases = [
    ["a|b", "a\\|b"],
    ["a`b`", "a\\`b\\`"],
    ["a\\b", "a\\\\b"],
    ["a\\|b", "a\\\\\\|b"],
    ["trailing\\", "trailing\\\\"],
    ["<script>alert(1)</script>", "\\<script\\>alert(1)\\</script\\>"],
    ["<img src=x onerror=alert(1)>", "\\<img src=x onerror=alert(1)\\>"],
    ["[click](javascript:alert(1))", "\\[click\\](javascript:alert(1))"],
    ["![i](http://h.example/p.png)", "!\\[i\\](http://h.example/p.png)"],
    ["[ref]: http://h.example", "\\[ref\\]: http://h.example"],
    ["&lt;b&gt; &amp;", "&lt;b&gt; &amp;"],
    ["=1+1", "=1+1"],
    ["-x @y +z", "-x @y +z"],
    ["a\nb", "a b"],
    ["a\r\nb", "a b"],
    ["a\rb", "a b"],
    ["a\tb", "a b"],
    ["a\u2028b\u0085c\u00a0d\u3000e", "a b c d e"],
    ["a\u000bb\u000cc", "a b c"],
    ["a\u2000b\u2003c\u200ad", "a b c d"],
    ["a\u180eb\u0080c\u009fd\u007fe", "abcde"],
    ["a \n \n b", "a b"],
    ["  padded  ", "padded"],
    ["a\u200bb\u202ec\u0007d\ufeffe\u00adf", "abcdef"],
    ["\u00e9\u65e5\u672c\u{1f600}", "\u00e9\u65e5\u672c\u{1f600}"],
    ["", ""],
    ["   ", ""],
  ];
  for (const [input, expected] of cases)
    assert.equal(cell(input), expected, JSON.stringify(input));
  // The cell is trimmed in the file itself, not only when it is read back.
  assert.equal(
    lib
      .toMarkdown([row({ title: "  padded  ", owner: "\t o \n" })])
      .split("\n")[2],
    "| i | padded | s | o |  |  |  |",
  );

  // A title cannot start another cell or another row.
  const trick = lib.toMarkdown([
    row({ title: "x |\n| --- | --- |\n| evil | row" }),
  ]);
  const lines = trick.split("\n");
  assert.equal(lines.length, 4, "header, rule, one row, the final line end");
  assert.equal(lines[3], "");
  for (const line of lines.slice(0, 3)) assert.equal(mdCells(line).length, 7);
  assert.ok(!trick.includes("\r"));

  // Whatever the text, each row is one line of seven cells, and no cell holds an unescaped pipe, backtick, angle bracket or square bracket.
  const next = seeded(13);
  const alphabet = [
    "|",
    "\\",
    "`",
    "<",
    ">",
    "[",
    "]",
    "!",
    "(",
    ")",
    "\n",
    "\r",
    "a",
    " ",
    "=",
    "\u200b",
    "\u00e9",
  ];
  for (let n = 0; n < 2000; n++) {
    const input = Object.fromEntries(
      COLUMNS.map((c) => [c, randomText(next, alphabet, 10)]),
    );
    const out = lib.toMarkdown([input]).split("\n");
    assert.equal(out.length, 4);
    for (const line of out.slice(2, 3)) {
      const cells = mdCells(line);
      assert.equal(cells.length, 7, JSON.stringify([input, line]));
      for (const value of cells)
        assert.ok(
          !/[|`<>[\]]/.test(bare(value)),
          JSON.stringify([input, value]),
        );
    }
  }
  const frozen = deepFreeze([row({ title: "<b>" })]);
  lib.toMarkdown(frozen);
});

test("task-export caps: a cell is cut to 200 characters with three dots, whole characters only; at most 1000 rows are written; the size is bounded", () => {
  assert.equal(lib.MAX_CELL, 200);
  assert.equal(lib.MAX_CELL_READ, 2000);
  const csvCell = (value) => parseCsv(lib.toCsv([row({ title: value })]))[1][1];
  const mdCell = (value) =>
    mdCells(lib.toMarkdown([row({ title: value })]).split("\n")[2])[1];
  for (const make of [csvCell, mdCell]) {
    assert.equal(make("a".repeat(200)), "a".repeat(200));
    assert.equal(make("a".repeat(201)), "a".repeat(197) + "...");
    assert.equal(make("a".repeat(1000000)), "a".repeat(197) + "...");
    // A space just before the cut does not stay in front of the dots.
    assert.equal(
      make("a".repeat(196) + " " + "b".repeat(50)),
      "a".repeat(196) + "...",
    );
    // The cut counts characters, not UTF-16 units, and never splits a pair.
    const emoji = make("\u{1f600}".repeat(300));
    assert.deepEqual(Array.from(emoji), [
      ...Array(197).fill("\u{1f600}"),
      ".",
      ".",
      ".",
    ]);
    assert.equal(Buffer.from(emoji, "utf8").toString("utf8"), emoji);
    assert.equal(Array.from(make("\u{1f600}".repeat(200))).length, 200);
    // Nothing past the first 2000 characters is ever read: when those are all dropped characters the cell is empty.
    assert.equal(
      make("x".repeat(2000) + "TAIL-SECRET").includes("TAIL"),
      false,
    );
    assert.equal(make("\u200b".repeat(2000) + "VISIBLE"), "");
    assert.equal(make("\u200b".repeat(1999) + "VISIBLE"), "V");
  }
  // The cut happens before the quotes and the escapes are added: 197 quotes and three dots make 394 + 3 characters in a CSV cell, 2 more for its quotes.
  const quotes = lib.toCsv([row({ title: '"'.repeat(500) })]).split("\r\n")[1];
  assert.equal(quotes.length, 2 + (2 + 394 + 3) + 7);

  // At most 1000 rows are written, in list order, by both formats.
  const many = Array.from({ length: 1500 }, (_, n) => row({ id: "n" + n }));
  const records = parseCsv(lib.toCsv(many));
  assert.equal(records.length, 1001);
  assert.equal(records[1][0], "n0");
  assert.equal(records[1000][0], "n999");
  const table = lib.toMarkdown(many).split("\n");
  assert.equal(table.length, 1000 + 2 + 1);
  assert.equal(mdCells(table[2])[0], "n0");
  assert.equal(mdCells(table[1001])[0], "n999");

  // The size is bounded by construction: 1000 rows of seven cells of 200 characters. The worst cases are cells of quotes (doubled) or backslashes (doubled) for the length, and four-byte characters for the bytes.
  const worst = (text) =>
    Array.from({ length: 1500 }, () =>
      Object.fromEntries(COLUMNS.map((c) => [c, text])),
    );
  for (const [text, chars] of [
    ['"'.repeat(500), 3000000],
    ["\\".repeat(500), 3000000],
    ["\ud83d\ude00".repeat(500), 3000000],
  ]) {
    assert.ok(lib.toCsv(worst(text)).length <= chars);
    assert.ok(lib.toMarkdown(worst(text)).length <= chars);
  }
  const bytes = "\ud83d\ude00".repeat(500);
  assert.ok(Buffer.byteLength(lib.toCsv(worst(bytes)), "utf8") <= 6000000);
  assert.ok(Buffer.byteLength(lib.toMarkdown(worst(bytes)), "utf8") <= 6000000);
});

test("task-export file: the file name is hrig-tasks, the local date and time and the extension, never a connection or rig name; the file, the button text and the notice are what the docs say", () => {
  const local = (...parts) => new Date(...parts).getTime();
  for (const [format, at, expected] of [
    ["csv", AT, "hrig-tasks-20261109-1405.csv"],
    ["md", AT, "hrig-tasks-20261109-1405.md"],
    ["csv", local(2026, 0, 2, 3, 4), "hrig-tasks-20260102-0304.csv"],
    ["md", local(2026, 11, 31, 23, 59, 59), "hrig-tasks-20261231-2359.md"],
    ["csv", local(2026, 5, 1, 0, 0), "hrig-tasks-20260601-0000.csv"],
    ["csv", local(9999, 11, 31, 23, 59), "hrig-tasks-99991231-2359.csv"],
  ])
    assert.equal(lib.exportName(format, at), expected);
  // The wall clock of the computer decides, whatever its zone: the same local time gives the same name in any zone.
  const zone = process.env.TZ;
  try {
    for (const tz of [
      "UTC",
      "America/Los_Angeles",
      "Asia/Kolkata",
      "Pacific/Auckland",
    ]) {
      process.env.TZ = tz;
      assert.equal(
        lib.exportName("csv", new Date(2026, 10, 9, 14, 5, 30).getTime()),
        "hrig-tasks-20261109-1405.csv",
        tz,
      );
      assert.equal(
        lib.exportName("md", new Date(2026, 0, 1, 0, 7).getTime()),
        "hrig-tasks-20260101-0007.md",
        tz,
      );
      // The start of 1970 is no time in any zone.
      for (const at of [0, -1, -3600000])
        assert.equal(
          lib.exportName("csv", at),
          "hrig-tasks.csv",
          tz + " " + at,
        );
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  // A time that is not a usable date gives the plain name.
  for (const at of [
    NaN,
    Infinity,
    -Infinity,
    -1,
    0,
    "x",
    null,
    undefined,
    {},
    8.64e15,
    -8.64e15,
    1e20,
    local(10000, 0, 1),
  ]) {
    assert.equal(lib.exportName("csv", at), "hrig-tasks.csv", String(at));
    assert.equal(lib.exportName("md", at), "hrig-tasks.md", String(at));
  }
  const next = seeded(5);
  for (let n = 0; n < 500; n++) {
    const at = 1e12 + Math.floor(next() * 3e12);
    for (const format of ["csv", "md"])
      assert.match(
        lib.exportName(format, at),
        /^hrig-tasks-\d{8}-\d{4}\.(csv|md)$/,
      );
  }

  // The file holds the name, the text of the rows in that format and the media type; any other format throws.
  const rows = [row({ title: "=1" })];
  assert.deepEqual(lib.exportFile("csv", rows, AT), {
    name: "hrig-tasks-20261109-1405.csv",
    text: lib.toCsv(rows),
    type: "text/csv;charset=utf-8",
  });
  assert.deepEqual(lib.exportFile("md", rows, AT), {
    name: "hrig-tasks-20261109-1405.md",
    text: lib.toMarkdown(rows),
    type: "text/markdown;charset=utf-8",
  });
  assert.equal(lib.exportFile("csv", [], AT).text, CSV_HEADER);
  for (const format of [
    "xlsx",
    "",
    "CSV",
    "json",
    "__proto__",
    null,
    undefined,
    1,
  ])
    assert.throws(
      () => lib.exportFile(format, rows, AT),
      /Unsupported export format/,
      String(format),
    );

  // The button text carries the count of tasks shown; with none shown the tooltip says so instead of the note.
  assert.equal(lib.EXPORT_NOTE, NOTE);
  assert.deepEqual(lib.exportButton("csv", 12), {
    text: "Export CSV (12)",
    title: NOTE,
  });
  assert.deepEqual(lib.exportButton("md", 1), {
    text: "Export Markdown (1)",
    title: NOTE,
  });
  for (const shown of [0, -3, NaN, Infinity, "5", null, undefined, 0.5])
    assert.deepEqual(lib.exportButton("md", shown), {
      text: "Export Markdown (0)",
      title: "No tasks are shown to export.",
    });
  assert.equal(lib.exportButton("csv", 7.9).text, "Export CSV (7)");

  // The notice says how many tasks went into which format, says so when the list was cut, and ends with the note.
  assert.equal(
    lib.exportNotice("csv", 1, 1),
    "Started the download of 1 task as CSV. " + NOTE,
  );
  assert.equal(
    lib.exportNotice("csv", 12, 12),
    "Started the download of 12 tasks as CSV. " + NOTE,
  );
  assert.equal(
    lib.exportNotice("md", 2, 2),
    "Started the download of 2 tasks as markdown. " + NOTE,
  );
  assert.equal(
    lib.exportNotice("md", 1000, 1200),
    "Started the download of the first 1000 of 1200 tasks as markdown. " + NOTE,
  );
  assert.equal(
    lib.exportNotice("csv", 5, 3),
    "Started the download of 5 tasks as CSV. " + NOTE,
  );
  assert.equal(
    lib.exportNotice("csv", NaN, "x"),
    "Started the download of 0 tasks as CSV. " + NOTE,
  );
});

test("task-export download: the helper saves text through a temporary link and object URL as the Settings export does, clicks it once, releases the URL a second later, and lets what the page throws through", async () => {
  const keep = {
    document: globalThis.document,
    timeout: globalThis.setTimeout,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const log = [];
  const timers = [];
  const blobs = [];
  const fail = { click: null, url: null };
  globalThis.document = {
    createElement(tag) {
      log.push(["create", tag]);
      return {
        href: "",
        download: "",
        click() {
          log.push(["click", this.href, this.download]);
          if (fail.click) throw fail.click;
        },
      };
    },
  };
  URL.createObjectURL = (blob) => {
    if (fail.url) throw fail.url;
    blobs.push(blob);
    log.push(["url", blob.type, blob.size]);
    return "blob:one";
  };
  URL.revokeObjectURL = (url) => log.push(["revoke", url]);
  globalThis.setTimeout = (fn, ms) => {
    log.push(["timer", ms]);
    timers.push(fn);
    return 1;
  };
  try {
    assert.deepEqual(Object.keys(dl), ["downloadText"]);
    dl.downloadText("hrig-tasks-x.csv", "a,b\r\n", "text/csv;charset=utf-8");
    assert.deepEqual(log, [
      ["url", "text/csv;charset=utf-8", 5],
      ["create", "a"],
      ["click", "blob:one", "hrig-tasks-x.csv"],
      ["timer", 1000],
    ]);
    assert.equal(await blobs[0].text(), "a,b\r\n");
    timers.pop()();
    assert.deepEqual(log.at(-1), ["revoke", "blob:one"]);

    // A click that throws still schedules the release, and the error is the caller's to show.
    log.length = 0;
    fail.click = new Error("no click");
    assert.throws(
      () => dl.downloadText("n.md", "x", "text/markdown"),
      /no click/,
    );
    assert.deepEqual(log.at(-1), ["timer", 1000]);
    timers.pop()();
    assert.deepEqual(log.at(-1), ["revoke", "blob:one"]);

    // An object URL that cannot be made throws before any link or timer exists.
    log.length = 0;
    fail.click = null;
    fail.url = new Error("no url");
    assert.throws(
      () => dl.downloadText("n.md", "x", "text/markdown"),
      /no url/,
    );
    assert.deepEqual(log, []);
    assert.equal(timers.length, 0);
  } finally {
    globalThis.document = keep.document;
    globalThis.setTimeout = keep.timeout;
    URL.createObjectURL = keep.create;
    URL.revokeObjectURL = keep.revoke;
    if (keep.document === undefined) delete globalThis.document;
  }
});

test("task-export board: the two buttons sit between Refresh and Assign work, say how many tasks are shown, follow the filters, are disabled with nothing to export and change nothing", async () => {
  const snapshot = JSON.stringify(ROWS);
  const board = boardHarness();
  try {
    // Before the queue answers nothing is shown.
    assert.deepEqual(
      board
        .exports()
        .map((b) => [board.text(b), b.props.disabled, b.props.title]),
      [
        ["Export CSV (0)", true, "No tasks are shown to export."],
        ["Export Markdown (0)", true, "No tasks are shown to export."],
      ],
    );
    await board.flush();
    const buttons = board.all().filter((n) => n.type === "button");
    assert.deepEqual(buttons.slice(0, 4).map(board.text), [
      "Refresh",
      "Export CSV (5)",
      "Export Markdown (5)",
      "Assign work",
    ]);
    for (const b of buttons.slice(0, 3))
      assert.equal(b.props.className, "small-button");
    for (const b of board.exports()) {
      assert.equal(b.props.disabled, false);
      assert.equal(b.props.title, NOTE);
    }

    // Markdown: the same rows as the board shows, as a table.
    board.change("Filter task state", "pending");
    assert.deepEqual(board.titles(), ["=cmd|' /C calc'!A0", "@SUM(A1)"]);
    const [, markdown] = board.exports();
    assert.equal(board.text(markdown), "Export Markdown (2)");
    board.click(markdown);
    const md = await board.file();
    assert.equal(md.name, "hrig-tasks-20261109-1405.md");
    assert.equal(md.type, "text/markdown;charset=utf-8");
    assert.equal(
      md.text,
      "| id | title | state | owner | tags | age | reason |\n" +
        "| --- | --- | --- | --- | --- | --- | --- |\n" +
        "| q1 | =cmd\\|' /C calc'!A0 | pending | dev-a@hrig | mission:alpha, urgent | 5m |  |\n" +
        "| q5 | @SUM(A1) | pending | dev-a@hrig | ops, urgent |  |  |\n",
    );
    assert.deepEqual(board.notice(), [
      "Started the download of 2 tasks as markdown. " + NOTE,
    ]);

    // Each filter narrows what is exported, and the file is made from the filters as they are when the button is pressed.
    const exported = async (format) => {
      board.click(board.exports()[format === "csv" ? 0 : 1]);
      return parseCsv((await board.file()).text)
        .slice(1)
        .map((r) => r[0]);
    };
    board.change("Filter task state", "");
    board.change("Filter tasks", "FIX");
    assert.equal(board.text(board.exports()[0]), "Export CSV (1)");
    assert.deepEqual(await exported("csv"), ["q2"]);
    board.change("Filter tasks", "");
    board.change("Filter task owner", "dev-a@hrig");
    assert.deepEqual(await exported("csv"), ["q1", "q2", "q4", "q5"]);
    board.change("Filter task owner", "");
    board.change("Filter task tag", "urgent");
    assert.deepEqual(await exported("csv"), ["q1", "q5"]);
    board.change("Filter task state", "pending");
    board.change("Filter task tag", "");
    assert.deepEqual(await exported("csv"), ["q1", "q5"]);
    board.change("Filter task state", "failed");
    board.change("Filter tasks", "plain");
    assert.deepEqual(await exported("csv"), ["q4"]);
    board.change("Filter task state", "");
    board.change("Filter tasks", "");
    assert.deepEqual(await exported("csv"), ["q1", "q2", "q3", "q4", "q5"]);

    // With nothing shown both buttons are disabled, say so, and the count is zero.
    board.change("Filter tasks", "no task has this");
    assert.deepEqual(board.titles(), []);
    for (const b of board.exports()) {
      assert.equal(b.props.disabled, true);
      assert.equal(b.props.title, "No tasks are shown to export.");
    }
    assert.deepEqual(board.exports().map(board.text), [
      "Export CSV (0)",
      "Export Markdown (0)",
    ]);
    board.change("Filter tasks", "");

    // Exporting is read only: the same tasks, the same cards, one queue read, no action, no message, and the files were each saved once.
    assert.equal(JSON.stringify(ROWS), snapshot);
    assert.equal(board.titles().length, 5);
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);
    assert.equal(board.errors().length, 0);
    assert.ok(board.saved.anchors.every((a) => a.clicks === 1));
    assert.equal(board.saved.anchors.length, board.saved.blobs.length);
  } finally {
    board.unmount();
  }

  // A save that fails is shown as an error and is not reported as an export.
  const failing = boardHarness();
  try {
    await failing.flush();
    failing.click(failing.exports()[0], { fail: new Error("disk is full") });
    assert.deepEqual(failing.notice(), []);
    assert.deepEqual(
      failing.errors().map((e) => e.props.error),
      ["Could not export: disk is full"],
    );
    assert.equal(failing.saved.blobs.length, 0);
    assert.equal(failing.calls.rigAction.length, 0);
  } finally {
    failing.unmount();
  }

  // A queue that cannot be read leaves nothing to export.
  const broken = boardHarness({ rows: new Error("rig offline") });
  try {
    await broken.flush();
    for (const b of broken.exports()) assert.equal(b.props.disabled, true);
  } finally {
    broken.unmount();
  }
});

test("task-export hostile: tasks full of formulas, markup, line breaks, control characters and huge text still give a table of seven cells per row in both formats, and a list longer than the board's own cap is cut and says so", async () => {
  const HOSTILE = [
    task("h1", "pending", { title: '=HYPERLINK("http://evil.example","x")' }),
    task("h2", "pending", {
      title:
        "a|b `c` <script>alert(1)</script> [x](javascript:alert(1)) ![i](http://h.example/p.png)",
    }),
    task("h3", "blocked", {
      title: "line1\nline2\r\n=cmd",
      blockedOn: "\u202e=EVIL\u0007",
    }),
    task("h4", "failed", { title: "x".repeat(1000000) }),
    task("h5", "pending", {
      title: 12345,
      destination: "dev|x@h",
      id: 'id,with"quote',
    }),
    task("h6", "pending", {
      title: "\u200b@SUM",
      tags: ["=evil", "a,b"],
      tsCreated: "not a date",
      body: "SECRET-BODY",
    }),
    { id: "h7", title: "no status and no owner" },
    null,
    "a string is not a task",
  ];
  const board = boardHarness({ rows: HOSTILE });
  try {
    await board.flush();
    assert.equal(board.text(board.exports()[0]), "Export CSV (7)");
    board.click(board.exports()[0]);
    const csv = await board.file();
    assert.ok(crlfOnly(csv.text));
    const records = parseCsv(csv.text);
    assert.equal(records.length, 8);
    for (const record of records) {
      assert.equal(record.length, 7);
      for (const value of record) assert.ok(value.length <= 203);
    }
    for (const record of records.slice(1))
      for (const value of record)
        assert.ok(!FORMULA.test(value), JSON.stringify(value));
    assert.deepEqual(
      records.slice(1).map((r) => r[0]),
      ["h1", "h2", "h3", "h4", 'id,with"quote', "h6", "h7"],
    );
    assert.equal(records[3][6], "Blocked on =EVIL");
    assert.equal(records[5][1], "12345");
    assert.equal(records[6][4], "'=evil, a,b");
    assert.ok(!csv.text.includes("SECRET"));
    assert.ok(csv.bytes.length < 6000000);

    board.click(board.exports()[1]);
    const md = await board.file();
    const lines = md.text.split("\n");
    assert.equal(lines.length, 7 + 2 + 1);
    for (const line of lines.slice(0, -1))
      assert.equal(mdCells(line).length, 7);
    for (const line of lines.slice(2, -1))
      for (const value of mdCells(line))
        assert.ok(!/[|`<>[\]]/.test(bare(value)), value);
    assert.ok(!md.text.includes("<script>"));
    assert.ok(!md.text.includes("SECRET"));
    assert.deepEqual(board.notice(), [
      "Started the download of 7 tasks as markdown. " + NOTE,
    ]);
  } finally {
    board.unmount();
  }

  // More tasks than the board lists (it reads 1000) are cut to 1000 rows, and the notice says so.
  const long = Array.from({ length: 1200 }, (_, n) => task("n" + n, "pending"));
  const big = boardHarness({ rows: long });
  try {
    await big.flush();
    assert.equal(big.text(big.exports()[0]), "Export CSV (1200)");
    big.click(big.exports()[0]);
    const file = await big.file();
    assert.equal(parseCsv(file.text).length, 1001);
    assert.deepEqual(big.notice(), [
      "Started the download of the first 1000 of 1200 tasks as CSV. " + NOTE,
    ]);
  } finally {
    big.unmount();
  }
});

test("task-export wiring: the module is pure with the exports that are pinned, the board reads it in one place with the readers it already has, the download is the Settings mechanism in its own small file, and no channel, setting, style or main process file knows about it", () => {
  const source = read("src/task-export.ts");
  const code = stripComments(source);
  // Pure: no import, no page, clock, timer, network, storage, program-environment or bridge name, and no clock read.
  assert.ok(!/^import /m.test(code), "no imports");
  assert.ok(
    !/\b(document|window|setTimeout|setInterval|clearTimeout|fetch|process|require|Blob|URL|localStorage|sessionStorage|navigator|clipboard|XMLHttpRequest|WebSocket|Math\.random)\b/.test(
      code,
    ),
  );
  assert.equal(count(code, "Date.now"), 0);
  assert.equal(count(code, "new Date()"), 0);
  assert.equal(count(code, "new Date("), 1, "the injected time only");
  // The other board modules pin that only the board names them: this one reads nothing of theirs.
  assert.ok(!/task-age|task-reason|task-board-nav|task-filters/.test(source));

  const exported = [
    ...source.matchAll(/^export (?:const|function|type) (\w+)/gm),
  ]
    .map((m) => m[1])
    .sort();
  const types = [
    "ExportColumn",
    "ExportFile",
    "ExportFormat",
    "ExportReaders",
    "ExportRow",
    "ExportSet",
  ];
  const names = [
    "EXPORT_COLUMNS",
    "EXPORT_NOTE",
    "MAX_CELL",
    "MAX_CELL_READ",
    "MAX_EXPORT_ROWS",
    "MAX_ROW_TAGS",
    "exportButton",
    "exportFile",
    "exportName",
    "exportNotice",
    "exportRows",
    "toCsv",
    "toMarkdown",
  ];
  assert.deepEqual(exported, [...types, ...names].sort());
  assert.deepEqual(Object.keys(lib).sort(), [...names].sort());
  const lines = source.split("\n");
  for (const [index, line] of lines.entries())
    if (/^export /.test(line))
      assert.ok(lines[index - 1].startsWith("/** "), "doc comment: " + line);
  assert.ok(!/\bexport default\b/.test(source));

  // The download helper: the Settings mechanism in a few lines, nothing more.
  const helperSource = read("src/download-text.ts");
  const helper = stripComments(helperSource);
  assert.deepEqual(
    [...helperSource.matchAll(/^export (?:const|function|type) (\w+)/gm)].map(
      (m) => m[1],
    ),
    ["downloadText"],
  );
  assert.ok(!/^import /m.test(helper));
  for (const [part, times] of [
    ["URL.createObjectURL(", 1],
    ["URL.revokeObjectURL(", 1],
    ['document.createElement("a")', 1],
    [".click()", 1],
    ["setTimeout(", 1],
    [", 1000)", 1],
    ["appendChild", 0],
    ["document.body", 0],
    ["innerHTML", 0],
    ["window.", 0],
    ["fetch(", 0],
    ["localStorage", 0],
    ["navigator", 0],
  ])
    assert.equal(count(helper, part), times, part);
  const settings = read("src/SettingsPage.tsx");
  assert.equal(count(settings, "URL.createObjectURL("), 1);
  assert.equal(
    count(settings, 'a.download = "hrig-" + scope + "-settings.json"'),
    1,
  );
  assert.ok(
    !settings.includes("download-text"),
    "Settings keeps its own code, untouched",
  );

  // The board: one import of each, the readers it already uses lent to the module, one handler that only reads the list, two buttons.
  const boardSource = read("src/TaskBoard.tsx");
  const board = collapse(stripComments(boardSource)).replace(/, \}/g, " }");
  assert.equal(
    count(
      board,
      'import { exportButton, exportFile, exportNotice, exportRows, type ExportFormat } from "./task-export";',
    ),
    1,
  );
  assert.equal(
    count(board, 'import { downloadText } from "./download-text";'),
    1,
  );
  assert.equal(count(board, "downloadText("), 1);
  assert.equal(count(board, "exportRows("), 1);
  assert.equal(
    count(
      board,
      "exportRows(list, at, { tags: itemTags, age: ageOf, reason: reasonOf })",
    ),
    1,
    "the readers are the board's own, lent as they are",
  );
  assert.equal(count(board, "exportFile(format, set.rows, at)"), 1);
  assert.equal(
    count(board, "exportNotice(format, set.rows.length, set.total)"),
    1,
  );
  assert.equal(count(board, 'exportShown("csv", visible, now)'), 1);
  assert.equal(count(board, 'exportShown("md", visible, now)'), 1);
  assert.equal(
    count(board, "Date.now()"),
    1,
    "the clock is still read once, for the ages",
  );
  assert.equal(count(board, "disabled={!shown}"), 2);
  assert.equal(
    count(
      board,
      "const shown = columns.reduce((n, c) => n + c.items.length, 0);",
    ),
    1,
    "the count in the buttons is the number of cards",
  );
  const handler = between(board, "const exportShown =", "const visible =");
  assert.ok(
    !/hrig|rigAction|sendMessage|mutate|setRefresh|setBusy|setSelected|setCreate|setItems|JSON\.stringify|innerHTML|localStorage|navigator|clipboard|\.click\(|document|Blob|URL/.test(
      handler,
    ),
    "the handler only reads the list, saves a file and reports",
  );
  assert.ok(
    !/\.(pop|push|shift|unshift|splice|sort|reverse|fill|copyWithin)\(/.test(
      handler,
    ),
    "the handler never changes the list it is given",
  );
  assert.equal(count(handler, "setNotice("), 1);
  assert.equal(count(handler, "setError("), 1);
  assert.ok(
    !/\b(Blob|createObjectURL|revokeObjectURL|createElement|\.click\()/.test(
      stripComments(boardSource),
    ),
    "the file is saved by the helper, not by the board",
  );
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  assert.equal(count(boardSource, "style="), 0);
  assert.equal(count(boardSource, "className={"), 0);
  assert.equal(count(boardSource, "dangerouslySetInnerHTML"), 0);

  // Nothing else uses either file, and no channel, setting, shortcut, stylesheet or main process file mentions the feature.
  const users = (name, self) =>
    fs
      .readdirSync(path.join(root, "src"))
      .filter((f) => /\.tsx?$/.test(f) && f !== self)
      .filter((f) => read("src/" + f).includes(name));
  assert.deepEqual(users("task-export", "task-export.ts"), ["TaskBoard.tsx"]);
  assert.deepEqual(users("download-text", "download-text.ts"), [
    "TaskBoard.tsx",
  ]);
  const feature =
    /task-export|download-text|exportShown|exportRows|exportTasks|exportFile/;
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs|js)$/.test(file))
      assert.ok(!feature.test(read("electron/" + file)), file);
  for (const file of [
    "src/types.ts",
    "src/settings.ts",
    "src/shortcuts.ts",
    "src/styles.css",
    "src/SettingsPage.tsx",
    "src/App.tsx",
  ])
    assert.ok(!feature.test(read(file)), file);
  assert.equal(count(read("README.md"), "TASKS.md"), 1);
});

test("task-export docs: TASKS.md has one Exporting tasks section that says which tasks and columns are exported, what is left out and why a title needs a look, how the file is saved and named, the CSV and markdown rules and the formula quote", () => {
  const doc = read("TASKS.md");
  const heading = "\n### Exporting tasks\n";
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, heading), 1);
  assert.equal(
    count(doc, "\n## "),
    2,
    "the level 2 headings other tests count",
  );
  const at = doc.indexOf(heading);
  assert.ok(at > doc.indexOf("separate, explicit actions."), "after the intro");
  assert.ok(
    at < doc.indexOf("\n### Keyboard navigation\n"),
    "before the sections other tests read to the next heading",
  );
  assert.ok(at < doc.indexOf("\n### Card details\n"));
  const next = doc.indexOf("\n### ", at + 1);
  assert.ok(next > at && next < doc.indexOf("\n## "));
  const section = doc.slice(at + 1, next);
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 3);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const say = (paragraph, parts) => {
    const flat = collapse(paragraph);
    for (const part of parts)
      assert.ok(flat.includes(part), "TASKS.md says: " + part);
  };
  const rows = 1000;
  say(paragraphs[0], [
    "Two buttons in the header of the Task queue panel, Export CSV and Export Markdown, save the tasks the board shows right now as a file",
    "What is exported is what you see after the filters",
    "the number in each button is the number of tasks that go into the file",
    "with no task shown the buttons are disabled",
    "the same browser style download as Export JSON in Settings",
    "your computer asks where to put it",
    "`hrig-tasks-YYYYMMDD-HHMM` with the extension csv or md",
    "in your computer's local time",
    "never with a connection, rig or host name",
    "Exporting is read only",
    "nothing is sent to OpenRig or to a seat",
    "no task is changed",
    "the board makes no extra request",
  ]);
  say(paragraphs[1], [
    "Every row has the same seven columns: " +
      lib.EXPORT_COLUMNS.slice(0, -1).join(", ") +
      " and " +
      lib.EXPORT_COLUMNS.at(-1),
    "the tags are its tags as the filter reads them (lower case, joined with a comma and a space)",
    "the age is the card's age since creation, as the card shows it (`<1m`, `5m`, `3h`, `2d`, as of the last refresh)",
    "the reason is the line a blocked or held card shows",
    "Nothing else of a task is exported: not its body, not its details, not any other field that OpenRig sends",
    "The title is the title the card shows",
    "OpenRig fills it from the task's subject, else its summary, else in some versions a body preview",
    "a title can hold text that someone pasted into a task, secrets included",
    "The tooltip of the buttons and the line shown when the download starts say: " +
      lib.EXPORT_NOTE,
    "Every cell is cut after " + lib.MAX_CELL + " characters with three dots",
    "control, zero-width and direction-changing characters are removed",
    "at most " +
      rows.toLocaleString("en-US") +
      " rows are written, which is the most the board lists",
  ]);
  say(paragraphs[2], [
    "In a CSV file, a cell is quoted when it holds a comma, a quote or a line break (a quote is doubled and a line break stays inside the cell)",
    "lines end in CRLF",
    "UTF-8 without a byte order mark",
    "(in Excel, Data, From Text/CSV)",
    "A cell that a spreadsheet could read as a formula, because after any spaces it starts with `=`, `+`, `-` or `@`, or it starts with a tab or a carriage return, gets a single quote in front of it so that it opens as text",
    "this also marks plain text that starts with a minus sign, which is accepted, and the quote shows in the cell",
    "A markdown file is a pipe table: line breaks become spaces",
    "pipes, backslashes, backticks, angle brackets and square brackets are escaped",
    "a title cannot add a column, a link, an image or HTML",
    "(a viewer may still turn a plain web address into a link)",
  ]);

  // The names and numbers the page uses are the code's and the real download is the Settings one.
  assert.equal(lib.MAX_EXPORT_ROWS, rows);
  assert.equal(lib.MAX_CELL, 200);
  assert.equal(lib.exportButton("csv", 3).text, "Export CSV (3)");
  assert.equal(lib.exportButton("md", 3).text, "Export Markdown (3)");
  assert.match(lib.exportName("csv", AT), /^hrig-tasks-\d{8}-\d{4}\.csv$/);
  assert.ok(read("src/SettingsPage.tsx").includes("Export JSON"));
  assert.equal(count(read("README.md"), "TASKS.md"), 1);
});
