const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("../electron/core.cjs");
const { createWslFixture } = require("./wsl-fixture.cjs");
test("local non-repository is a normal state and real Git failures retain their reason", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-git-"));
  const c = { id: "local", kind: "local" };
  try {
    const result = await core.gitStatus(c, root);
    assert.equal(result.isRepository, false);
    assert.deepEqual(result.entries, []);
    await fs.writeFile(path.join(root, ".git"), "invalid git pointer");
    await assert.rejects(
      () => core.gitStatus(c, root),
      (e) =>
        /invalid gitfile format/i.test(e.message) &&
        !e.message.includes("Traceback"),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test(
  "WSL non-repository is normal, and corrupt Git metadata reports Git stderr without a Python traceback",
  { skip: process.platform !== "win32", timeout: 60000 },
  async (t) => {
    const fixture = await createWslFixture();
    if (!fixture) {
      t.skip("No WSL installed");
      return;
    }
    try {
      const { connection, root } = fixture;
      const result = await core.gitStatus(connection, root);
      assert.equal(result.isRepository, false);
      assert.equal(result.root, root);
      assert.deepEqual(result.entries, []);
      await require("../electron/features.cjs").edit(connection, {
        op: "create",
        root,
        path: ".git",
        content: "invalid git pointer",
      });
      await assert.rejects(
        () => core.gitStatus(connection, root),
        (e) =>
          /invalid gitfile format/i.test(e.message) &&
          !e.message.includes("Traceback"),
      );
    } finally {
      await fixture.cleanup();
    }
  },
);
