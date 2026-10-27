import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-native-smoke-"));
const c = { id: "native-qa", name: "Native QA", kind: "local", root: dir };
await fs.writeFile(
  path.join(dir, "sample.ts"),
  'export const nativeCheck = "HRig native editor";\n',
);
if (process.platform !== "win32") {
  c.rigBinary = path.join(dir, "rig-fixture");
  await fs.writeFile(
    c.rigBinary,
    '#!/usr/bin/env python3\nimport json,sys\nif "--version" in sys.argv: print("OpenRig native fixture")\nelif "--nodes" in sys.argv: print("[]")\nelse: print(json.dumps([{ "id":"native-fixture", "name":"Native QA", "status":"running" }]))\n',
    { mode: 0o700 },
  );
}
await fs.writeFile(
  path.join(dir, "workspace.json"),
  JSON.stringify({
    version: 1,
    connections: [c],
    activeConnection: c.id,
    roots: {},
    activeRig: "",
    layouts: {},
    savedLayouts: [],
  }),
);
const env = { ...process.env, HRIG_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const args = process.platform === "linux" ? ["--no-sandbox"] : [];
let app = await electron.launch({
  executablePath: process.argv[2] || latest.executable,
  args,
  env,
});
const errors = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New panel", exact: true }).waitFor();
  const runtime = await app.evaluate(() => ({
    platform: process.platform,
    arch: process.arch,
  }));
  if (runtime.platform !== latest.platform || runtime.arch !== latest.arch)
    throw new Error(
      "Packaged runtime architecture differs from the build manifest.",
    );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+t" : "Control+Shift+t",
  );
  const input = page.locator(".xterm-helper-textarea");
  await input.waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".session-toolbar .status-dot.idle"),
  );
  await input.focus();
  await page.keyboard.type(
    process.platform === "win32"
      ? "Write-Output __HRIG_NATIVE_PTY_OK__"
      : "printf '__HRIG_NATIVE_PTY_OK__\\n'",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector(".terminal-host")
          ?.textContent?.match(/__HRIG_NATIVE_PTY_OK__/g) || []
      ).length >= 2,
  );
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("button", { name: "sample.ts", exact: true }).click();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "HRig native editor",
  );
  const checks = await page.evaluate(async (c) => {
    const old = await window.hrig.edit(c, {
      op: "read",
      root: c.root,
      path: "sample.ts",
    });
    await window.hrig.edit(c, {
      op: "save",
      root: c.root,
      path: "sample.ts",
      content: old.content + "// native save\n",
      revision: old.revision,
    });
    let conflict = false;
    try {
      await window.hrig.edit(c, {
        op: "save",
        root: c.root,
        path: "sample.ts",
        content: "stale",
        revision: old.revision,
      });
    } catch {
      conflict = true;
    }
    if (!conflict) throw new Error("Stale save was not rejected.");
    const key = "native-smoke-draft";
    const put = window.hrig.drafts({
      op: "put",
      key,
      value: { kind: "message", data: { message: "Native durable draft" } },
    });
    if (put.error) throw new Error(put.error);
    const git = await window.hrig.git(c, c.root);
    if (git.isRepository !== false)
      throw new Error("Non-repository Git check failed.");
    const doctor = await window.hrig.doctor(c);
    if (!Array.isArray(doctor.checks)) throw new Error("Doctor check failed.");
    const credentials = await window.hrig.integrate({ op: "credentials" });
    const updates = await window.hrig.updates({ op: "status" });
    if (updates.mode === "manual" && updates.canInstall)
      throw new Error("Unsigned/manual build enabled installation.");
    if (window.hrig.platform !== "win32") {
      const inventory = await window.hrig.inventory(c);
      if (inventory.rigs.length !== 1)
        throw new Error("Native OpenRig discovery failed.");
    }
    return {
      conflictProtected: conflict,
      updatePolicy: true,
      secureStorageAvailable: credentials.secureStorage,
      doctor: true,
      nativeInventory: window.hrig.platform !== "win32",
    };
  }, c);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Workspace tools" })
    .getByRole("button", {
      name: "Project boards and integrations",
      exact: false,
    })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Issue title").fill("Native board fixture");
  await page.getByRole("button", { name: "Confirm create" }).click();
  await expect(
    page.getByRole("button", { name: /Native board fixture/ }),
  ).toBeVisible();
  await app.close();
  app = await electron.launch({
    executablePath: process.argv[2] || latest.executable,
    args,
    env,
  });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "New panel", exact: true }).waitFor();
  await expect(
    page.getByRole("button", { name: /Native board fixture/ }),
  ).toBeVisible();
  const persisted = await page.evaluate(
    () =>
      window.hrig.drafts({ op: "list" }).result?.["native-smoke-draft"]?.data
        ?.message,
  );
  if (persisted !== "Native durable draft")
    throw new Error("Draft did not survive application restart.");
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    `release/native-smoke-${process.platform}-${process.arch}.json`,
    JSON.stringify(
      {
        version: latest.version,
        platform: process.platform,
        arch: process.arch,
        passed: true,
        checks: {
          ...checks,
          pty: true,
          editor: true,
          boardRestart: true,
          draftRestart: true,
        },
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Native packaged QA passed: ${process.platform}/${process.arch}: PTY, editor, conflict guards, Git, doctor, native inventory, boards and durable drafts.`,
  );
} finally {
  await app.close();
}
