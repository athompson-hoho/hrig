const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const features = require("../electron/features.cjs");
test("editor rejects stale saves and preserves disk content; supports safe create, rename and text search", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-edit-"));
  const connection = { id: "local", kind: "local" };
  try {
    await features.edit(connection, {
      op: "create",
      root,
      path: "example.ts",
      content: 'const example = "original";\n',
    });
    const first = await features.edit(connection, {
      op: "read",
      root,
      path: "example.ts",
    });
    await fs.writeFile(path.join(root, "example.ts"), "external change\n");
    await assert.rejects(
      () =>
        features.edit(connection, {
          op: "save",
          root,
          path: "example.ts",
          revision: first.revision,
          content: "overwrite",
        }),
      /CONFLICT/,
    );
    assert.equal(
      await fs.readFile(path.join(root, "example.ts"), "utf8"),
      "external change\n",
    );
    const latest = await features.edit(connection, {
      op: "read",
      root,
      path: "example.ts",
    });
    await features.edit(connection, {
      op: "save",
      root,
      path: "example.ts",
      revision: latest.revision,
      content: "merged change\n",
    });
    await assert.rejects(
      () =>
        features.edit(connection, {
          op: "create",
          root,
          path: "../escape.ts",
          content: "",
        }),
      /outside/,
    );
    await features.edit(connection, {
      op: "rename",
      root,
      path: "example.ts",
      destination: "renamed.ts",
    });
    const matches = await features.edit(connection, {
      op: "searchText",
      root,
      path: "",
      query: "merged",
    });
    assert.equal(matches[0].path, "renamed.ts");
    assert.equal(matches[0].line, 1);
    await assert.rejects(
      () =>
        features.edit(connection, {
          op: "rename",
          root,
          path: "renamed.ts",
          destination: "../escape.ts",
        }),
      /outside/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("lifecycle operations require confirmation and reject unsupported actions before remote execution", async () => {
  const connection = { id: "remote", kind: "ssh", host: "example.test" };
  await assert.rejects(
    () =>
      features.rigAction(connection, {
        op: "start",
        name: "production",
        root: "~",
        confirmation: "wrong",
      }),
    /confirm/,
  );
  await assert.rejects(
    () =>
      features.rigAction(connection, {
        op: "stop",
        name: "production",
        confirmation: "",
      }),
    /confirm/,
  );
  await assert.rejects(
    () => features.rigAction(connection, { op: "arbitrary-command" }),
    /Unsupported/,
  );
  await assert.rejects(
    () =>
      features.rigAction(connection, { op: "plan", name: "--bad", root: "~" }),
    /dash/,
  );
});
