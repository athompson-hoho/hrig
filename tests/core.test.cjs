const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  quote,
  transport,
  validateConnection,
  sessionCommand,
  normalizeInventory,
  parseJson,
  localPath,
  fileOperation,
  parseGitStatus,
} = require("../electron/core.cjs");

test("SSH command arguments cannot become local shell options or remote shell syntax", () => {
  const c = { id: "remote", kind: "ssh", host: "dev@example.test", port: 2222 };
  const command = sessionCommand("build@rig'; touch /tmp/nope; '");
  assert.equal(
    command,
    "exec tmux attach-session -t '=build@rig'\\''; touch /tmp/nope; '\\'''",
  );
  const t = transport(c, command, true);
  assert.equal(t.file, "ssh.exe");
  assert.ok(t.args.includes("-tt"));
  assert.equal(t.args.at(-2), "dev@example.test");
  assert.throws(() =>
    validateConnection({ ...c, host: "-oProxyCommand=malicious" }),
  );
  assert.throws(() => validateConnection({ ...c, host: "host;whoami" }));
  assert.throws(() => validateConnection({ ...c, port: 70000 }));
  assert.equal(quote("a b"), "'a b'");
});
test("WSL preserves distribution names and requests an exact existing session", () => {
  const c = { id: "wsl", kind: "wsl", distro: "Ubuntu Work" };
  assert.deepEqual(transport(c, sessionCommand("builder@factory")).args, [
    "-d",
    "Ubuntu Work",
    "--exec",
    "bash",
    "-lc",
    "exec tmux attach-session -t '=builder@factory'",
  ]);
  assert.throws(() => sessionCommand("bad\ncommand"));
});
test("OpenRig inventory supports array and scope-envelope contracts without inventing activity", () => {
  const data = normalizeInventory(
    [{ rigId: "r", name: "factory", status: "running", nodeCount: 2 }],
    {
      entries: [
        {
          rigId: "r",
          rigName: "factory",
          logicalId: "builder",
          canonicalSessionName: "builder@factory",
          sessionStatus: "running",
          terminalActive: true,
        },
        {
          rigId: "r",
          rigName: "factory",
          logicalId: "reviewer",
          canonicalSessionName: null,
          needsAttention: true,
        },
      ],
    },
  );
  assert.equal(data.rigs[0].name, "factory");
  assert.equal(data.seats[0].status, "working");
  assert.equal(data.seats[1].status, "attention");
  assert.equal(data.seats[1].session, null);
  const compact = normalizeInventory(
    [],
    [
      {
        rigId: "r",
        rigName: "factory",
        logicalId: "builder",
        sessionStatus: "running",
        agentActivity: { state: "running" },
      },
      {
        rigId: "r",
        rigName: "factory",
        logicalId: "unknown",
        sessionStatus: "running",
      },
    ],
  );
  assert.equal(compact.seats[0].status, "working");
  assert.equal(compact.seats[1].status, "running");
  assert.deepEqual(parseJson('login banner\n[{"id":1}]'), [{ id: 1 }]);
  assert.throws(() => normalizeInventory({ unexpected: true }, []));
});
test("local project operations reject traversal and symlink escapes and save actual files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-core-"));
  const root = path.join(dir, "project");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "code.ts"), "const value = 1;");
  await fs.writeFile(path.join(dir, "outside.txt"), "outside");
  const c = { id: "local", kind: "local" };
  try {
    await assert.rejects(() => localPath(root, "../outside.txt"), /outside/);
    await fs.symlink(dir, path.join(root, "escape"), "junction");
    await assert.rejects(
      () => localPath(root, "escape/outside.txt"),
      /outside/,
    );
    const files = await fileOperation(c, { op: "list", root });
    assert.equal(files.length, 1);
    await fileOperation(c, {
      op: "write",
      root,
      path: "code.ts",
      content: "const value = 2;",
    });
    assert.equal(
      (await fileOperation(c, { op: "read", root, path: "code.ts" })).content,
      "const value = 2;",
    );
    await assert.rejects(
      () =>
        fileOperation(c, { op: "write", root, path: "code.ts", content: 42 }),
      /content/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Git porcelain parsing preserves spaces and skips rename source records", () => {
  assert.deepEqual(
    parseGitStatus(" M a file.ts\0R  new.ts\0old.ts\0?? untracked.md\0"),
    [
      { path: "a file.ts", status: "M" },
      { path: "new.ts", status: "R" },
      { path: "untracked.md", status: "??" },
    ],
  );
});
