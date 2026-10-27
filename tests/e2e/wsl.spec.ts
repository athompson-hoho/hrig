import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const { createWslFixture } = require("../wsl-fixture.cjs");
const core = require("../../electron/core.cjs");
test("WSL seat opens as an independent panel and survives detaching the GUI", async () => {
  test.skip(process.platform !== "win32", "Windows WSL integration");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL distribution installed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-wsl-ui-"));
  const { connection, root, session } = fixture;
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [connection],
      activeConnection: connection.id,
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".seat-row")).toContainText("builder", {
      timeout: 25000,
    });
    await page.locator(".seat-row").click();
    await expect(page.locator(".terminal-host")).toContainText("$", {
      timeout: 15000,
    });
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf HRIG_WSL_TERMINAL_VERIFIED");
    await page.keyboard.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_WSL_TERMINAL_VERIFIED",
    );
    const tab = page.getByRole("tab", { name: "builder", exact: true });
    await tab.locator(".flexlayout__tab_button_trailing").click();
    await core.remote(
      connection,
      `tmux has-session -t ${core.quote("=" + session)}`,
    );
    await page.locator(".seat-row").click();
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_WSL_TERMINAL_VERIFIED",
    );
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await page.getByRole("button", { name: "hello.py", exact: true }).click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      "Hello from WSL",
    );
    await page.screenshot({ path: "test-results/wsl.png" });
    await page.getByRole("button", { name: "Task queue", exact: true }).click();
    await expect(page.getByText("Review the transport fixture")).toBeVisible();
    await expect(page.locator(".task-board .badge")).toHaveText("pending");
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
