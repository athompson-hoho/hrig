import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("new versions prompt, snooze per version, and require an explicit unsigned restart confirmation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-update-prompt-"));
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.locator(".app").waitFor();
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        phase: "available",
        currentVersion: "0.11.0",
        latestVersion: "0.12.0",
        releaseUrl:
          "https://github.com/athompson-hoho/hrig/releases/tag/v0.12.0",
        notes: "Fixture release notes",
        progress: 0,
        canInstall: true,
        requiresUnsignedConsent: true,
        error: "",
        mode: "in-app",
        reason: "Updates are checksum-verified but unsigned.",
      };
      (globalThis as any).fixtureUpdate = state;
      (globalThis as any).updateInstalls = 0;
      ipcMain.removeHandler("updates:operation");
      ipcMain.handle("updates:operation", (_e, a) => {
        if (a.op === "download") state.phase = "downloaded";
        if (a.op === "install") {
          if (!a.confirmed || !a.allowUnsigned) throw Error("Consent missing");
          (globalThis as any).updateInstalls++;
          state.phase = "installing";
        }
        BrowserWindow.getAllWindows()[0].webContents.send(
          "updates:state",
          state,
        );
        return state;
      });
      BrowserWindow.getAllWindows()[0].webContents.send("updates:state", state);
    });
    await expect(
      page.getByRole("dialog", { name: "HRig 0.12.0 is available" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Remind me tomorrow" }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "updates:state",
        (globalThis as any).fixtureUpdate,
      ),
    );
    await expect(
      page.getByRole("dialog", { name: "HRig 0.12.0 is available" }),
    ).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => {
      (globalThis as any).fixtureUpdate.latestVersion = "0.13.0";
      BrowserWindow.getAllWindows()[0].webContents.send(
        "updates:state",
        (globalThis as any).fixtureUpdate,
      );
    });
    await expect(
      page.getByRole("dialog", { name: "HRig 0.13.0 is available" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Download update", exact: true })
      .click();
    expect(await app.evaluate(() => (globalThis as any).updateInstalls)).toBe(
      0,
    );
    await page
      .getByRole("button", { name: "Restart and install update", exact: true })
      .click();
    const confirm = page.getByRole("dialog", {
      name: "Restart HRig to update?",
    });
    await expect(confirm).toContainText("publisher identity is not verified");
    await page.screenshot({
      path: "release/previews/update-prompt.png",
      animations: "disabled",
    });
    await confirm
      .getByRole("button", { name: "Confirm restart and install", exact: true })
      .click();
    expect(await app.evaluate(() => (globalThis as any).updateInstalls)).toBe(
      1,
    );
  } finally {
    await app.close();
  }
});
