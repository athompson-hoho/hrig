import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createWslFixture } = require("../wsl-fixture.cjs");
test("seat failures stop after six automatic retries and can be retried manually", async () => {
  test.setTimeout(60000);
  test.skip(process.platform !== "win32", "Windows WSL integration");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-retry-ui-"));
  const connection = fixture.connection;
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
    await expect(page.locator(".seat-row")).toBeVisible({ timeout: 20000 });
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).hrigRetryAttempts = 0;
      ipcMain.removeHandler("terminal:create");
      ipcMain.handle("terminal:create", () => {
        (globalThis as any).hrigRetryAttempts++;
        throw new Error("TEST_DISCONNECTED");
      });
    });
    await page.clock.install();
    await page.locator(".seat-row").click();
    await expect(page.locator(".terminal-panel .error-box")).toContainText(
      "TEST_DISCONNECTED",
    );
    for (let i = 0; i < 6; i++) {
      await expect(
        page.getByText(/Reconnecting to the existing seat/),
      ).toBeVisible();
      await page.clock.fastForward(16000);
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).hrigRetryAttempts))
        .toBe(i + 2);
      await expect(page.locator(".terminal-panel .error-box")).toContainText(
        "TEST_DISCONNECTED",
      );
    }
    await expect(
      page.getByText("Automatic retries paused.", { exact: false }),
    ).toBeVisible();
    await page.clock.fastForward(120000);
    expect(
      await app.evaluate(() => (globalThis as any).hrigRetryAttempts),
    ).toBe(7);
    await page
      .getByRole("button", { name: "Reconnect terminal", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).hrigRetryAttempts))
      .toBe(8);
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
