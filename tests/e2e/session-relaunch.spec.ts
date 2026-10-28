import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("session actions separate reconnect from confirmed fresh relaunch and show blockers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-relaunch-ui-"));
  const c = {
    id: "qa-host",
    name: "Session QA",
    kind: "ssh",
    host: "fixture.invalid",
    root: dir,
  };
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: "qa-host",
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
    await page.locator(".app").waitFor();
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as any;
      g.relaunchCalls = [];
      g.relaunchBlocked = false;
      g.terminalStarts = 0;
      ipcMain.removeHandler("rig:inventory");
      ipcMain.handle("rig:inventory", () => ({
        rigs: [
          { id: "qa-rig", name: "design", status: "running", nodeCount: 2 },
        ],
        seats: [
          {
            id: "qa-rig:dev",
            rigId: "qa-rig",
            rigName: "design",
            name: "dev",
            pod: "build",
            runtime: "claude-code",
            model: "",
            session: "dev@design",
            status: "idle",
            activity: "",
            error: "",
            workCount: 0,
          },
          {
            id: "qa-rig:review",
            rigId: "qa-rig",
            rigName: "design",
            name: "review",
            pod: "build",
            runtime: "codex",
            model: "",
            session: "review@design",
            status: "idle",
            activity: "",
            error: "",
            workCount: 0,
          },
        ],
        sampledAt: new Date().toISOString(),
      }));
      ipcMain.removeHandler("rig:action");
      ipcMain.handle("rig:action", (_e, _c, a) => {
        g.relaunchCalls.push(a);
        if (a.op === "relaunchPlan") {
          if (g.relaunchBlocked)
            throw Error("Unmanaged seat cannot be replaced");
          return { token: "preview" };
        }
        if (a.confirmation !== "dev") throw Error("Wrong confirmation");
        return { ok: true };
      });
      ipcMain.removeHandler("terminal:create");
      ipcMain.handle("terminal:create", () => {
        g.terminalStarts++;
        return { session: "dev@design" };
      });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Relaunch session dev", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Relaunch session",
      exact: true,
    });
    await expect(
      dialog.getByText("Ready for a fresh relaunch.", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Relaunch fresh session",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).relaunchCalls.filter(
            (a: any) => a.op === "relaunch",
          ).length,
      ),
    ).toBe(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator(".seat-row").filter({ hasText: "dev" }).click();
    await expect(
      page.getByRole("button", { name: "Reconnect terminal", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Relaunch session", exact: true })
      .click();
    await dialog.getByLabel("Confirm session name").fill("dev");
    await expect(
      dialog.getByRole("button", {
        name: "Relaunch fresh session",
        exact: true,
      }),
    ).toBeEnabled();
    await fs.mkdir("release", { recursive: true });
    await page.screenshot({
      path: "release/session-relaunch-dialog.png",
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Relaunch fresh session", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).relaunchCalls.filter(
            (a: any) => a.op === "relaunch",
          ).length,
      ),
    ).toBe(1);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).terminalStarts))
      .toBeGreaterThan(1);
    await app.evaluate(() => ((globalThis as any).relaunchBlocked = true));
    await page
      .getByRole("button", { name: "Relaunch session review", exact: true })
      .click();
    await expect(
      dialog.getByText("Unmanaged seat cannot be replaced", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Relaunch fresh session",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await app.close();
  }
});
