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
