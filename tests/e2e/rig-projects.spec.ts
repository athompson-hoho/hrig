import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createWslFixture } = require("../wsl-fixture.cjs");
test("opens a live rig folder without typing a path", async () => {
  test.skip(process.platform !== "win32");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-project-picker-"));
  const c = { ...fixture.connection, root: "~" };
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: c.id,
      roots: {},
      activeRig: "test-rig",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.locator(".project-card").click();
    const dialog = page.getByRole("dialog", { name: "Open a project" });
    await expect(dialog.locator(".attached-project")).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(dialog.locator(".attached-project")).toContainText(
      fixture.root,
    );
    await expect(dialog.locator(".attached-project")).toContainText("fixture");
    await dialog.locator(".attached-project").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".sidebar")).toContainText("hello.py");
    await page.keyboard.press("Control+p");
    await page.getByLabel("Quick Open file search").fill("hpy");
    await expect(
      page.getByRole("listbox", { name: "Matching project files" }),
    ).toContainText("hello.py");
    await page.getByLabel("Quick Open file search").press("Enter");
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      "Hello from WSL",
    );
    await page.keyboard.press("Control+o");
    await expect(
      page
        .getByRole("dialog", { name: "Open a project" })
        .getByLabel("Project directory", { exact: true }),
    ).toHaveValue(fixture.root);
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
