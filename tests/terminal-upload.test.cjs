"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
  assert.ok(calls[0][1].endsWith(`'${target}' ${bytes.length}`));
  assert.deepEqual(calls[0][2], { input: bytes, timeout: 26000 });
  await upload.removeRemote(connection, target, remote);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1].includes("os.getuid()"));
  await assert.rejects(upload.saveRemote({ kind: "wsl" }, target, bytes, remote), /SSH/);
  assert.equal(calls.length, 2);
  await assert.rejects(upload.saveRemote(connection, target, Buffer.alloc(upload.MAX_UPLOAD_BYTES + 1), remote), /10 MiB/);
});

test("terminal upload rejects truncated streams and removes their partial remote directory", (t) => {
  const target = upload.uploadDestination("truncated.bin");
  const result = spawnSync("python3", ["-c", upload.saveProgram, target, "5"], { input: Buffer.from("abc"), encoding: "utf8" });
  assert.notEqual(result.status, 0, "a short stream fails the expected-length check");
  assert.match(result.stderr, /Upload length mismatch/);
  assert.equal(require("node:fs").existsSync(path.dirname(target)), false, "failed transfer removes the newly created directory");
});

test("terminal upload best-effort removes remote destination when transport reports failure", async () => {
  const calls = [];
  const remote = async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw new Error("truncated transport");
  };
  const connection = { kind: "ssh", host: "example.test" };
  const target = upload.uploadDestination("file.bin", "12345678-1234-4234-9234-123456789abc");
  await assert.rejects(upload.saveRemote(connection, target, Buffer.from("abc"), remote), /truncated transport/);
  assert.equal(calls.length, 2, "failure path attempts safe cleanup");
  assert.ok(calls[1][1].includes("os.getuid()"));
});

test("source path display truncates in the middle and retains the identifying tail", () => {
  const value = "/home/person/" + "long-directory/".repeat(30) + "private-key.pem";
  const shown = upload.middleTruncate(value, 60);
  assert.equal(shown.length, 60);
  assert.ok(shown.startsWith("/home/person/"));
  assert.ok(shown.endsWith("private-key.pem"));
  assert.ok(shown.includes("..."));
});

test("SSH upload confirmation escapes line and bidi controls in a directory path without changing the file name", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-upload-dialog-path-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const hostileDir = path.join(dir, "safe\nLocal source: /etc/harmless\u202E");
  await fs.mkdir(hostileDir, { recursive: true });
  const source = path.join(hostileDir, "notes.txt");
  await fs.writeFile(source, "contents");
  const handlers = {}, listeners = {}, dialogs = [];
  const sender = {};
  const terminal = { sender, connection: { kind: "ssh", host: "host.example" } };
  upload.registerTerminalUpload({
    handle: (channel, fn) => handlers[channel] = fn,
    ipcMain: { on: (channel, fn) => listeners[channel] = fn },
    trusted: (event) => { if (event.sender !== sender) throw Error("Untrusted"); },
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => "window",
    getTerminal: () => terminal,
    remote: async () => { assert.fail("cancel must not transfer"); },
  });
  const registration = { sender, returnValue: "" };
  listeners["terminal:register-upload-path"](registration, source);
  await handlers["terminal:upload-file"]({ sender }, { id: "t", token: registration.returnValue });
  assert.match(dialogs[0].message, /^Upload notes\.txt to host\.example\?$/);
  assert.match(dialogs[0].detail, /safe\\u000ALocal source: \/etc\/harmless\\u202E/);
  assert.equal(dialogs[0].detail.split("\n").length, 3, "the source path cannot add native dialog lines");
});

test("terminal upload IPC requires native confirmation, binds the terminal owner, and supports cleanup on failed insertion", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-upload-ipc-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "notes.txt"), bytes = Buffer.from("private bytes");
  await fs.writeFile(source, bytes);
  const handlers = {}, dialogs = [], transfers = [], ipcListeners = {};
  const sender = {};
  const terminal = { sender, connection: { kind: "ssh", name: "Build host", host: "build.example" } };
  let current = terminal, response = 0;
  const registerPath = (pathToRegister = source, eventSender = sender) => {
    const event = { sender: eventSender, returnValue: "" };
    ipcListeners["terminal:register-upload-path"](event, pathToRegister);
    return event.returnValue;
  };
  upload.registerTerminalUpload({
    handle: (name, fn) => handlers[name] = fn,
    ipcMain: { on: (name, fn) => ipcListeners[name] = fn },
    trusted: (event) => { if (event.sender !== sender) throw Error("Untrusted"); },
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response }; } },
    getWindow: () => "window",
    getTerminal: () => current,
    remote: async (...args) => transfers.push(args),
  });
  assert.equal(await handlers["terminal:upload-file"]({ sender }, { id: "t", token: registerPath() }), null);
  assert.equal(transfers.length, 0, "cancel transfers no bytes");
  assert.match(dialogs[0].message, /Build host \(build.example\)/);
  assert.match(dialogs[0].detail, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(dialogs[0].detail, /\/tmp\/hrig-upload-[^\n]+\/notes.txt/);
  assert.match(dialogs[0].detail, /13 bytes/);
  response = 1;
  const result = await handlers["terminal:upload-file"]({ sender }, { id: "t", token: registerPath() });
  assert.ok(result.quotedPath.includes("notes.txt"));
  assert.equal(transfers.length, 1);
  assert.deepEqual(transfers[0][2], { input: bytes, timeout: 26000 });
  await handlers["terminal:cleanup-upload"]({}, { id: "t", target: result.target });
  assert.equal(transfers.length, 2);
  assert.ok(transfers[1][1].includes("os.getuid()"));

  const stale = await handlers["terminal:upload-file"]({ sender }, { id: "t", token: registerPath() });
  assert.ok(stale);
  await handlers["terminal:keep-upload"]({}, { id: "t", target: stale.target });
  await handlers["terminal:cleanup-upload"]({}, { id: "t", target: stale.target });
  assert.equal(transfers.length, 3, "keep acknowledges inserted path and suppresses cleanup");

  current = terminal;
  const before = transfers.length;
  // A changed terminal after confirmation is rejected before any SSH command.
  upload.registerTerminalUpload({
    handle: (name, fn) => handlers[name] = fn,
    ipcMain: { on: (name, fn) => ipcListeners[name] = fn }, trusted: () => {},
    dialog: { showMessageBox: async () => { current = {}; return { response: 1 }; } },
    getWindow: () => "window", getTerminal: () => current,
    remote: async (...args) => transfers.push(args),
  });
  await assert.rejects(handlers["terminal:upload-file"]({ sender }, { id: "t", token: registerPath() }), /changed while confirming/);
  assert.equal(transfers.length, before);
  await assert.rejects(handlers["terminal:upload-file"]({ sender }, { id: "t", source }), /Invalid file upload request/);
  await assert.rejects(handlers["terminal:upload-file"]({ sender }, { id: "t", token: "not-registered" }), /not registered/);
  await assert.rejects(handlers["terminal:upload-file"]({ sender: {} }, { id: "t", token: registerPath() }), /not registered/);
});
