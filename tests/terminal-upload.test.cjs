"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const upload = require("../electron/terminal-upload.cjs");

test("terminal upload reads only bounded regular files and preserves bytes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-upload-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "a notes.txt");
  const expected = Buffer.from([0, 1, 2, 255, 10]);
  await fs.writeFile(file, expected);
  const read = await upload.readUploadFile(file);
  assert.equal(read.name, "a notes.txt");
  assert.deepEqual(read.data, expected);
  await assert.rejects(upload.readUploadFile(dir), /regular file/);
  await assert.rejects(upload.readUploadFile(path.join(dir, "missing")), /no longer available/);
});

test("terminal upload destination is private-path shaped and quoting is POSIX", () => {
  const uuid = "12345678-1234-4234-9234-123456789abc";
  const target = upload.uploadDestination("it's here.png", uuid);
  assert.equal(target, `/tmp/hrig-upload-${uuid}/it's here.png`);
  assert.equal(upload.quotedRemotePath(target), `'/tmp/hrig-upload-${uuid}/it'\\''s here.png'`);
  for (const bad of ["/tmp/nope/file", "/tmp/hrig-upload-123/file", "/tmp/hrig-upload-" + uuid + "/../x"])
    assert.throws(() => upload.quotedRemotePath(bad), /Invalid temporary upload path/);
  assert.throws(() => upload.uploadDestination("bad\nname", uuid), /safely uploaded/);
});

test("terminal upload sends the exact bytes on the existing SSH transport and only removes its own validated target", async () => {
  const calls = [];
  const remote = async (...args) => calls.push(args);
  const connection = { kind: "ssh", host: "example.test" };
  const target = upload.uploadDestination("file.bin", "12345678-1234-4234-9234-123456789abc");
  const bytes = Buffer.from([0, 255, 1]);
  await upload.saveRemote(connection, target, bytes, remote);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], connection);
  assert.ok(calls[0][1].includes("python3 -c"));
  assert.deepEqual(calls[0][2], { input: bytes });
  await upload.removeRemote(connection, target, remote);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1].includes("os.getuid()"));
  await assert.rejects(upload.saveRemote({ kind: "wsl" }, target, bytes, remote), /SSH/);
  assert.equal(calls.length, 2);
  await assert.rejects(upload.saveRemote(connection, target, Buffer.alloc(upload.MAX_UPLOAD_BYTES + 1), remote), /10 MiB/);
});

test("terminal upload IPC requires native confirmation, binds the terminal owner, and supports cleanup on failed insertion", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-upload-ipc-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "notes.txt"), bytes = Buffer.from("private bytes");
  await fs.writeFile(source, bytes);
  const handlers = {}, dialogs = [], transfers = [];
  const terminal = { connection: { kind: "ssh", name: "Build host", host: "build.example" } };
  let current = terminal, response = 0;
  upload.registerTerminalUpload({
    handle: (name, fn) => handlers[name] = fn,
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response }; } },
    getWindow: () => "window",
    getTerminal: () => current,
    remote: async (...args) => transfers.push(args),
  });
  assert.equal(await handlers["terminal:upload-file"]({}, { id: "t", source }), null);
  assert.equal(transfers.length, 0, "cancel transfers no bytes");
  assert.match(dialogs[0].message, /Build host \(build.example\)/);
  assert.match(dialogs[0].detail, /\/tmp\/hrig-upload-[^\n]+\/notes.txt/);
  assert.match(dialogs[0].detail, /13 bytes/);
  response = 1;
  const result = await handlers["terminal:upload-file"]({}, { id: "t", source });
  assert.ok(result.quotedPath.includes("notes.txt"));
  assert.equal(transfers.length, 1);
  assert.deepEqual(transfers[0][2], { input: bytes });
  await handlers["terminal:cleanup-upload"]({}, { id: "t", target: result.target });
  assert.equal(transfers.length, 2);
  assert.ok(transfers[1][1].includes("os.getuid()"));

  const stale = await handlers["terminal:upload-file"]({}, { id: "t", source });
  assert.ok(stale);
  await handlers["terminal:keep-upload"]({}, { id: "t", target: stale.target });
  await handlers["terminal:cleanup-upload"]({}, { id: "t", target: stale.target });
  assert.equal(transfers.length, 3, "keep acknowledges inserted path and suppresses cleanup");

  current = terminal;
  const before = transfers.length;
  // A changed terminal after confirmation is rejected before any SSH command.
  upload.registerTerminalUpload({
    handle: (name, fn) => handlers[name] = fn,
    dialog: { showMessageBox: async () => { current = {}; return { response: 1 }; } },
    getWindow: () => "window", getTerminal: () => current,
    remote: async (...args) => transfers.push(args),
  });
  await assert.rejects(handlers["terminal:upload-file"]({}, { id: "t", source }), /changed while confirming/);
  assert.equal(transfers.length, before);
});
