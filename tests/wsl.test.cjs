const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/core.cjs");
const { createWslFixture } = require("./wsl-fixture.cjs");
test(
  "WSL discovers a rig through the CLI contract and reads/writes confined project files",
  { skip: process.platform !== "win32", timeout: 60000 },
  async (context) => {
    const fixture = await createWslFixture();
    if (!fixture) {
      context.skip("No WSL distribution installed");
      return;
    }
    try {
      const { connection, root, session } = fixture;
      const inventory = await core.inventory(connection);
      assert.equal(inventory.seats[0].session, session);
      assert.equal(inventory.rigs[0].name, "fixture");
      const queue = await core.queue(connection, "fixture");
      assert.equal(queue[0].title, "Review the transport fixture");
      assert.equal(queue[0].status, "pending");
      assert.deepEqual(await core.queue(connection, "other-rig"), []);
      const files = await core.fileOperation(connection, { op: "list", root });
      assert.ok(files.some((f) => f.name === "hello.py"));
      const matches = await core.fileOperation(connection, {
        op: "search",
        root,
        query: "hello",
      });
      assert.equal(matches[0].path, "hello.py");
      assert.equal(
        (
          await core.fileOperation(connection, {
            op: "read",
            root,
            path: "hello.py",
          })
        ).content,
        'message = "Hello from WSL"\n',
      );
      await core.fileOperation(connection, {
        op: "write",
        root,
        path: "hello.py",
        content: 'message = "Saved through WSL"\n',
      });
      assert.match(
        (
          await core.fileOperation(connection, {
            op: "read",
            root,
            path: "hello.py",
          })
        ).content,
        /Saved through WSL/,
      );
      await assert.rejects(
        () =>
          core.fileOperation(connection, {
            op: "read",
            root,
            path: "../outside",
          }),
        /outside/,
      );
      await core.remote(
        connection,
        `tmux has-session -t ${core.quote("=" + session)}`,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);
