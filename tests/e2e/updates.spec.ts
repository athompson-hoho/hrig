import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
test("update controls show manual/signed modes, require confirmation and guard unsaved work before restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-updates-ui-"));
  const c = { id: "local", name: "Update QA", kind: "local", root: dir };
  await fs.writeFile(path.join(dir, "sample.ts"), "export const saved = 1;\n");
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: "local",
      roots: {},
      layouts: {},
      savedLayouts: [],
      activeRig: "",
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Updates", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Development build: use a packaged release."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restart and install update" }),
    ).toHaveCount(0);
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).qaInstalls = 0;
      ipcMain.removeHandler("updates:operation");
      ipcMain.handle("updates:operation", (_e, a) => {
        if (a.op === "install") {
          if (a.confirmed) (globalThis as any).qaInstalls++;
        }
        return {
          phase: "downloaded",
          currentVersion: "0.9.0",
          latestVersion: "0.10.0",
          notes: "Fixture notes",
          progress: 100,
          canInstall: true,
          error: "",
          mode: "in-app",
          reason: "",
          releaseUrl: "https://github.com/athompson-hoho/hrig/releases",
        };
      });
    });
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restart and install update" })
      .click();
    await page
      .getByRole("button", { name: "Keep working", exact: true })
      .click();
    expect(await app.evaluate(() => (globalThis as any).qaInstalls)).toBe(0);
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await page.getByRole("button", { name: "sample.ts", exact: true }).click();
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// unsaved guard");
    const request = () =>
      app.evaluate(
        ({ ipcMain, BrowserWindow }) =>
          new Promise((resolve) => {
            const token = "fixture-" + Date.now();
            const listener = (_e: any, result: any) => {
              if (result.token === token) {
                ipcMain.removeListener("updates:restart-ready", listener);
                resolve(result);
              }
            };
            ipcMain.on("updates:restart-ready", listener);
            BrowserWindow.getAllWindows()[0].webContents.send(
              "updates:prepare-restart",
              token,
            );
          }),
      );
    expect(await request()).toMatchObject({
      ready: false,
      error: expect.stringContaining("Save All"),
    });
    await expect(page.locator(".app")).not.toHaveAttribute("inert");
    await page.locator(".command-trigger").click();
    await page
      .getByRole("textbox", { name: "Search commands and sessions" })
      .fill("Save All");
    await page
      .locator(".command-list button")
      .filter({ hasText: "Save All" })
      .first()
      .click();
    await expect
      .poll(() => fs.readFile(path.join(dir, "sample.ts"), "utf8"))
      .toContain("unsaved guard");
    expect(await request()).toMatchObject({ ready: true });
    await expect(
      page.getByRole("alertdialog", { name: "Installing update" }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("updates:state", {
        phase: "error",
        error: "Fixture installer failure",
      }),
    );
    await expect(page.locator(".app")).not.toHaveAttribute("inert");
    expect(await app.evaluate(() => (globalThis as any).qaInstalls)).toBe(0);
  } finally {
    await app.close();
  }
});
