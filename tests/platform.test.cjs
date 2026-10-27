const { test } = require("node:test");
const assert = require("node:assert/strict");
const { localShell } = require("../electron/platform.cjs");
const core = require("../electron/core.cjs");
test("local shell defaults follow the host and cannot become command-line arguments", () => {
  assert.deepEqual(localShell("win32", "system", {}), {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoProfile"],
  });
  assert.deepEqual(localShell("win32", "cmd", {}), {
    file: "cmd.exe",
    args: ["/Q"],
  });
  assert.deepEqual(localShell("darwin", "system", { SHELL: "/bin/zsh" }), {
    file: "/bin/zsh",
    args: ["-l"],
  });
  assert.deepEqual(localShell("linux", "powershell", { SHELL: "/bin/bash" }), {
    file: "/bin/bash",
    args: ["-l"],
  });
  assert.throws(
    () => localShell("linux", "system", { SHELL: "bash -c touch /tmp/no" }),
    /absolute/,
  );
  assert.throws(() => localShell("linux", "bash -c whoami"), /Unsupported/);
});
test(
  "native local execution uses literal stdin and Unix SSH has no Windows extension",
  { skip: process.platform === "win32" },
  async () => {
    const c = { id: "native-test", kind: "local" };
    assert.equal(
      core.transport(
        { id: "remote", kind: "ssh", host: "example.test" },
        "true",
      ).file,
      "ssh",
    );
    const output = await core.remote(
      c,
      "python3 -c 'import sys;print(sys.stdin.read())'",
      { input: "literal $(never-run)" },
    );
    assert.equal(output.trim(), "literal $(never-run)");
  },
);
