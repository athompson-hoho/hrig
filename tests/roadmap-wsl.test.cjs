const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createWslFixture } = require("./wsl-fixture.cjs");
const core = require("../electron/core.cjs");
const features = require("../electron/features.cjs");
test(
  "doctor, safe file revisions, task creation and confirmed lifecycle use real WSL transport with isolated fixture",
  { skip: process.platform !== "win32", timeout: 120000 },
  async (t) => {
    const fixture = await createWslFixture();
    if (!fixture) {
      t.skip("No WSL installed");
      return;
    }
    const { connection, root } = fixture;
    try {
      const literal = "$HOME $(printf unwanted)";
      assert.equal(
        await core.remote(connection, "printf %s " + core.quote(literal)),
        literal,
      );
      const report = await features.diagnose(connection);
      assert.ok(report.checks.some((c) => c.name === "OpenRig daemon" && c.ok));
      const first = await features.edit(connection, {
        op: "read",
        root,
        path: "hello.py",
      });
      const large = "Large file $HOME stays literal\n".repeat(3500);
      await features.edit(connection, {
        op: "create",
        root,
        path: "large.txt",
        content: large,
      });
      const largeRead = await features.edit(connection, {
        op: "read",
        root,
        path: "large.txt",
      });
      assert.equal(largeRead.content, large);
      await features.edit(connection, {
        op: "save",
        root,
        path: "large.txt",
        revision: largeRead.revision,
        content: large + "saved",
      });
      await features.edit(connection, {
        op: "save",
        root,
        path: "hello.py",
        revision: first.revision,
        content: 'value = "changed"\n',
      });
      await assert.rejects(
        () =>
          features.edit(connection, {
            op: "save",
            root,
            path: "hello.py",
            revision: first.revision,
            content: "old",
          }),
        /CONFLICT/,
      );
      await features.edit(connection, {
        op: "create",
        root,
        path: "new.txt",
        content: "searchable phrase",
      });
      assert.equal(
        (
          await features.edit(connection, {
            op: "searchText",
            root,
            query: "searchable",
          })
        )[0].path,
        "new.txt",
      );
      const task = await features.rigAction(connection, {
        op: "taskCreate",
        destination: "builder@fixture",
        title: "Test assignment",
        body: "Literal $HOME and `backticks`",
      });
      assert.equal(task.subject, "Test assignment");
      assert.equal(task.body, "Literal $HOME and `backticks`");
      const specs = await features.rigAction(connection, { op: "specs" });
      assert.equal(specs[0].name, "starter");
      const plan = await features.rigAction(connection, {
        op: "plan",
        name: "starter",
        root: "~",
      });
      assert.equal(plan.preview, true);
      await assert.rejects(
        () =>
          features.rigAction(connection, {
            op: "start",
            name: "starter",
            root,
            confirmation: "wrong",
          }),
        /confirm/,
      );
      const launch = await features.rigAction(connection, {
        op: "start",
        name: "starter",
        root,
        confirmation: "starter",
      });
      assert.equal(launch.preview, false);
      const stop = await features.rigAction(connection, {
        op: "stop",
        name: "starter",
        confirmation: "starter",
      });
      assert.equal(stop.operation, "down");
      const actions = (
        await core.fileOperation(connection, {
          op: "read",
          root,
          path: "actions.jsonl",
        })
      ).content
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(actions.length, 3);
      assert.ok(actions[0].includes("--plan"));
      assert.ok(actions[0][actions[0].indexOf("--cwd") + 1].startsWith("/"));
      assert.ok(actions[2].includes("--snapshot"));
    } finally {
      await fixture.cleanup();
    }
  },
);
