const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  externalUrl,
  registerTerminalTools,
} = require("../electron/terminal-tools.cjs");

test("terminal links require safe protocols and explicit native confirmation", async () => {
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "vscode://file/a",
  ])
    assert.throws(() => externalUrl(value));
  const handlers = {},
    opened = [];
  let response = 0;
  registerTerminalTools({
    handle: (name, fn) => (handlers[name] = fn),
    getWindow: () => null,
    dialog: { showMessageBox: async () => ({ response }) },
    shell: { openExternal: async (url) => opened.push(url) },
  });
  await handlers["terminal:open-link"]({}, "https://example.com");
  assert.deepEqual(opened, []);
  response = 1;
  await handlers["terminal:open-link"]({}, "https://example.com");
  assert.deepEqual(opened, ["https://example.com/"]);
});
test("terminal export cancels cleanly and preserves write errors", async () => {
  const handlers = {};
  let canceled = true,
    writes = 0;
  registerTerminalTools({
    handle: (name, fn) => (handlers[name] = fn),
    getWindow: () => null,
    dialog: {
      showSaveDialog: async () => ({ canceled, filePath: "chosen.txt" }),
    },
    fs: {
      writeFile: async () => {
        writes++;
        throw Error("disk full");
      },
    },
  });
  assert.deepEqual(await handlers["terminal:export"]({}, "output"), {
    saved: false,
  });
  assert.equal(writes, 0);
  canceled = false;
  await assert.rejects(handlers["terminal:export"]({}, "output"), /disk full/);
  await assert.rejects(
    handlers["terminal:export"]({}, "x".repeat(32 * 1024 * 1024 + 1)),
    /32 MiB/,
  );
});

test("snippet export uses a JSON save dialog, writes only after selection, and enforces a bound", async () => {
  const handlers = {};
  let canceled = true;
  const dialogs = [];
  const writes = [];
  registerTerminalTools({
    handle: (name, fn) => (handlers[name] = fn),
    getWindow: () => "main-window",
    dialog: {
      showSaveDialog: async (window, options) => {
        dialogs.push([window, options]);
        return { canceled, filePath: "/tmp/snippets.json" };
      },
    },
    fs: { writeFile: async (...args) => writes.push(args) },
  });
  assert.deepEqual(
    await handlers["snippets:export"]({}, '{"format":"hrig-snippets"}'),
    { saved: false },
  );
  assert.equal(writes.length, 0);
  canceled = false;
  assert.deepEqual(
    await handlers["snippets:export"]({}, '{"format":"hrig-snippets"}'),
    { saved: true },
  );
  assert.deepEqual(writes, [["/tmp/snippets.json", '{"format":"hrig-snippets"}', "utf8"]]);
  assert.equal(dialogs[1][0], "main-window");
  assert.equal(dialogs[1][1].defaultPath, "terminal-snippets.json");
  assert.deepEqual(dialogs[1][1].filters[0].extensions, ["json"]);
  await assert.rejects(
    handlers["snippets:export"]({}, "x".repeat(32 * 1024 * 1024 + 1)),
    /32 MiB/,
  );
});

test("plain text export rejoins soft wraps, preserves interior blank lines and trims unused rows", () => {
  const ts = require("typescript"),
    fs = require("node:fs"),
    vm = require("node:vm");
  const source = ts.transpileModule(
    fs.readFileSync(require.resolve("../src/terminal-output.ts"), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports });
  const rows = [
    ["hello ", false],
    ["world", true],
    ["", false],
    ["last row   ", false],
    ["", false],
    ["", false],
  ];
  const buffer = {
    length: rows.length,
    getLine: (index) =>
      rows[index] && {
        isWrapped: rows[index][1],
        translateToString: (trim) =>
          trim ? rows[index][0].trimEnd() : rows[index][0],
      },
  };
  assert.equal(
    exports.terminalText({ buffer: { active: buffer } }),
    "hello world\n\nlast row",
  );
});

test("clipboard text is read in the main process and non-text is empty", async () => {
  const handlers = {};
  registerTerminalTools({
    handle: (name, fn) => (handlers[name] = fn),
    getWindow: () => null,
    clipboard: { readText: () => "pasted\ntext" },
  });
  assert.equal(await handlers["terminal:read-clipboard"]({}), "pasted\ntext");
  registerTerminalTools({ handle: (n, f) => (handlers[n] = f), getWindow: () => null });
  assert.equal(await handlers["terminal:read-clipboard"]({}), "");
});
