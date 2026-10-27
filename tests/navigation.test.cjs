const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const {
  scanProject,
  PYTHON_QUICK_OPEN,
} = require("../electron/navigation.cjs");
const core = require("../electron/core.cjs");
function bundle(file) {
  const result = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const m = new Module(file, module);
  m._compile(result.outputFiles[0].text, file);
  return m.exports;
}
const history = bundle("src/project-history.ts");
const connection = {
  id: "local",
  kind: "local",
  name: "This computer",
  root: ".",
};

test("project history keeps endpoint identity, Windows aliases, pins and bounded metadata", () => {
  let rows = history.visitProject(
    [],
    connection,
    "C:\\Projects\\App",
    "win32",
    "rig-1",
    "API rig",
  );
  rows[0].pinned = true;
  rows = history.visitProject(
    rows,
    connection,
    "c:/projects/app/",
    "win32",
    "rig-2",
    "UI rig",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].root, "C:\\Projects\\App");
  assert.equal(rows[0].pinned, true);
  assert.equal(rows[0].rigId, "rig-2");
  const ssh = {
    ...connection,
    id: "remote",
    kind: "ssh",
    host: "build-a",
    root: "/work",
  };
  rows = history.visitProject(rows, ssh, "/work/app", "linux");
  assert.ok(
    history.availableConnection(
      rows.find((p) => p.connectionId === "remote"),
      [ssh],
      "linux",
    ),
  );
  assert.equal(
    history.availableConnection(
      rows.find((p) => p.connectionId === "remote"),
      [{ ...ssh, host: "build-b" }],
      "linux",
    ),
    undefined,
  );
  assert.notEqual(
    history.projectIdentity(ssh, "/work/App", "linux"),
    history.projectIdentity(ssh, "/work/app", "linux"),
  );
  for (let i = 0; i < 130; i++)
    rows = history.visitProject(rows, connection, "C:/Projects/" + i, "win32");
  assert.equal(rows.filter((p) => !p.pinned).length, 50);
  assert.equal(rows.filter((p) => p.pinned).length, 1);
  assert.deepEqual(history.normalizeHistory([{ root: "broken" }, null]), []);
});

test("Quick Open ranks subsequences and reports incomplete scans without traversing generated folders or symlinks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-quick-open-"));
  try {
    for (const name of [
      "src/QuickOpen.tsx",
      "src/QuickOpen.test.ts",
      "folder with spaces/Café.ts",
      "README.md",
      "node_modules/QuickOpen.tsx",
    ]) {
      await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await fs.writeFile(path.join(dir, name), "fixture");
    }
    try {
      await fs.symlink(
        path.join(dir, "README.md"),
        path.join(dir, "linked-readme.md"),
      );
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    }
    const result = await core.fileOperation(connection, {
      op: "quickOpen",
      root: dir,
      query: "qoptsx",
    });
    assert.deepEqual(
      result.files.map((f) => f.path),
      ["src/QuickOpen.tsx"],
    );
    assert.equal(result.partial, false);
    assert.equal(result.scannedFiles, 4);
    const limited = await scanProject(dir, "", { maxResults: 2 });
    assert.equal(limited.files.length, 2);
    assert.equal(limited.limited, true);
    assert.equal(limited.matches, 4);
    const partial = await scanProject(dir, "", { budget: 2 });
    assert.equal(partial.partial, true);
    assert.equal(partial.scannedEntries, 2);
    await assert.rejects(
      core.fileOperation(connection, {
        op: "quickOpen",
        root: dir,
        query: "x".repeat(301),
      }),
      /300/,
    );
    await assert.rejects(
      core.fileOperation(connection, {
        op: "quickOpen",
        root: path.join(dir, "README.md"),
        query: "",
      }),
      /folder/,
    );
    let python;
    for (const candidate of [["python3"], ["python"], ["py", "-3"]]) {
      const probe = cp.spawnSync(
        candidate[0],
        [...candidate.slice(1), "--version"],
        { encoding: "utf8" },
      );
      if (probe.status === 0) {
        python = candidate;
        break;
      }
    }
    assert.ok(
      python,
      "Python is required for the remote scanner parity check.",
    );
    for (const query of [
      "",
      "qop",
      "Café",
      "folder spaces",
      "README",
      "'; touch not-executed",
    ]) {
      const local = await scanProject(dir, query, { maxResults: 2 });
      const remote = cp.spawnSync(
        python[0],
        [...python.slice(1), "-c", PYTHON_QUICK_OPEN],
        {
          input: JSON.stringify({ root: dir, query, maxResults: 2 }),
          encoding: "utf8",
          windowsHide: true,
        },
      );
      assert.equal(remote.status, 0, remote.stderr);
      assert.deepEqual(
        JSON.parse(remote.stdout),
        local,
        "Scanner parity: " + query,
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
