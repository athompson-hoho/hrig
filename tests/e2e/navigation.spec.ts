import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { visitProject } from "../../src/project-history";

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-navigation-"));
  const alpha = path.join(dir, "Alpha"),
    beta = path.join(dir, "Beta");
  for (const folder of [alpha, beta]) await fs.mkdir(folder);
  await fs.mkdir(path.join(alpha, "src"));
  await fs.writeFile(
    path.join(alpha, "src", "QuickOpen.tsx"),
    'export const marker = "Alpha project";\n',
  );
  await fs.writeFile(
    path.join(alpha, "src", "QuickOtherPanel.tsx"),
    "export const other = true;\n",
  );
  await fs.writeFile(path.join(beta, "beta.txt"), "Beta project\n");
  const c = {
    id: "local",
    kind: "local" as const,
    name: "QA computer",
    root: alpha,
  };
  const changed = {
    id: "ssh",
    kind: "ssh" as const,
    name: "Changed SSH",
    host: "new-target.example.test",
    root: "/work",
  };
  let history = visitProject([], c, beta, process.platform);
  history = visitProject(history, c, path.join(dir, "Gone"), process.platform);
  history = visitProject(
    history,
    { ...changed, host: "old-target.example.test" },
    "/work/OldTarget",
    process.platform,
  );
  history = visitProject(
    history,
    { ...changed, id: "removed", name: "Removed host" },
    "/work/Removed",
    process.platform,
  );
  history = visitProject(history, c, alpha, process.platform);
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c, changed],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
      projectHistory: history,
      preferences: { "terminal.localShell": "cmd" },
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  return { dir, alpha, beta, c, env };
}
async function quick(page: Page, query: string, name: string) {
  await page.keyboard.press("Control+p");
  await page.getByLabel("Quick Open file search").fill(query);
  await expect(
    page
      .getByRole("listbox", { name: "Matching project files" })
      .getByRole("option")
      .filter({ hasText: name }),
  ).toBeVisible();
  await page.getByLabel("Quick Open file search").press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Quick Open", exact: true }),
  ).toHaveCount(0);
}

test("project history preserves favorites, layouts, unsaved buffers and real shell state across folder switches and restart", async () => {
  test.setTimeout(120000);
  const f = await setup();
  let app = await electron.launch({ args: ["."], env: f.env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.keyboard.press("Control+Shift+t");
    let input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("set HRIG_NAV_STATE=kept");
    await input.press("Enter");
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).navigationWrites = [];
      ipcMain.on("terminal:write", (_e, id, data) =>
        (globalThis as any).navigationWrites.push({ id, data }),
      );
    });
    await quick(page, "qoptsx", "QuickOpen.tsx");
    await expect(
      page.locator(".monaco-editor .view-lines").first(),
    ).toContainText("Alpha");
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    expect(
      await app.evaluate(() =>
        (globalThis as any).navigationWrites.some((w: any) =>
          w.data.includes("\x10"),
        ),
      ),
    ).toBe(false);
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// unsaved navigation marker");
    await expect(page.locator(".dirty-dot")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => JSON.stringify(window.hrig.drafts({ op: "list" }))),
      )
      .toContain("unsaved navigation marker");
    await page.keyboard.press("Control+o");
    let hub = page.getByRole("dialog", { name: "Open a project", exact: true });
    await expect(
      hub.getByRole("button", {
        name: "Open project OldTarget on Changed SSH",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      hub.getByRole("button", {
        name: "Open project Removed on Removed host",
        exact: true,
      }),
    ).toBeDisabled();
    await hub
      .getByRole("button", {
        name: "Open project Gone on QA computer",
        exact: true,
      })
      .click();
    await expect(hub.locator(".error-box")).toBeVisible();
    await expect(page.locator(".dirty-dot")).toHaveCount(1);
    await hub
      .getByRole("button", { name: "Pin project Beta", exact: true })
      .click();
    await hub
      .getByRole("button", {
        name: "Open project Beta on QA computer",
        exact: true,
      })
      .click();
    await expect(hub).toHaveCount(0);
    await expect(page.locator(".sidebar")).toContainText("beta.txt");
    await expect(
      page.getByRole("tab", { name: "QuickOpen.tsx", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Control+o");
    hub = page.getByRole("dialog", { name: "Open a project", exact: true });
    await expect(hub.locator(".project-history-open").first()).toContainText(
      "Beta",
    );
    await hub.getByLabel("Search recent and favorite projects").fill("Alpha");
    await hub
      .getByRole("button", {
        name: "Open project Alpha on QA computer",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("tab", { name: "QuickOpen.tsx", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".dirty-dot")).toHaveCount(1);
    await page
      .getByRole("tab", { name: "Command Prompt", exact: true })
      .click();
    input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("echo VERIFY_%HRIG_NAV_STATE%");
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText("VERIFY_kept");
    await page.getByRole("tab", { name: "QuickOpen.tsx", exact: true }).click();
    await expect(page.locator(".monaco-editor")).toContainText(
      "unsaved navigation marker",
    );
    await page.locator(".monaco-editor textarea").first().focus();
    await page.keyboard.press("Control+s");
    await expect
      .poll(() =>
        fs.readFile(path.join(f.alpha, "src", "QuickOpen.tsx"), "utf8"),
      )
      .toContain("unsaved navigation marker");
    await page.keyboard.press("Control+o");
    await page.screenshot({
      path: "release/previews/project-hub.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.close();
    app = await electron.launch({ args: ["."], env: f.env });
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    await page.keyboard.press("Control+o");
    hub = page.getByRole("dialog", { name: "Open a project", exact: true });
    await expect(
      hub.getByRole("button", { name: "Unpin project Beta", exact: true }),
    ).toBeVisible();
    await hub
      .getByRole("button", {
        name: "Remove project Gone from history",
        exact: true,
      })
      .click();
    await expect(
      hub.getByRole("button", {
        name: "Open project Gone on QA computer",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 780, height: 680 });
    await page.screenshot({
      path: "release/previews/project-hub-narrow.png",
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test("panel navigator focuses existing tabs and native popouts, and named moves remain undoable", async () => {
  test.setTimeout(90000);
  const f = await setup();
  const app = await electron.launch({ args: ["."], env: f.env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    await page.keyboard.press("Control+p");
    await page.getByLabel("Quick Open file search").fill("qop");
    await expect(
      page
        .getByRole("listbox", { name: "Matching project files" })
        .getByRole("option"),
    ).toHaveCount(2);
    await page.getByLabel("Quick Open file search").press("ArrowDown");
    await expect(
      page
        .getByRole("listbox", { name: "Matching project files" })
        .getByRole("option")
        .nth(1),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Quick Open file search").press("ArrowUp");
    await page.screenshot({
      path: "release/previews/quick-open.png",
      animations: "disabled",
    });
    await page.getByLabel("Quick Open file search").press("Enter");
    await quick(page, "qother", "QuickOtherPanel.tsx");
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    const count = await page.getByRole("tab").count();
    await page.keyboard.press("Control+Shift+p");
    await page.getByLabel("Search open panels").fill("QuickOpen");
    await page.getByLabel("Search open panels").press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Open panels", exact: true }),
    ).toHaveCount(0);
    expect(await page.getByRole("tab").count()).toBe(count);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement
            ?.closest("[data-panel-id]")
            ?.getAttribute("data-panel-id"),
        ),
      )
      .toContain("QuickOpen.tsx");
    await page.keyboard.press("Control+Shift+p");
    await expect(
      page
        .getByRole("listbox", { name: "Open workspace panels" })
        .getByRole("option")
        .first(),
    ).toContainText("QuickOpen.tsx");
    await page.getByLabel("Search open panels").fill("QuickOther");
    const before = await page.locator(".flexlayout__tabset").count();
    await page
      .getByRole("button", { name: "Split right (Alt Right)", exact: true })
      .click();
    await page.getByLabel("Search open panels").press("Escape");
    await expect(page.locator(".flexlayout__tabset")).toHaveCount(before + 1);
    await page.keyboard.press("Control+k");
    await page
      .getByLabel("Search commands and sessions")
      .fill("Visual workspace arranger");
    await page.getByLabel("Search commands and sessions").press("Enter");
    await page.getByLabel("Destination group name").fill("Implementation");
    await page
      .getByRole("button", { name: "Rename group", exact: true })
      .click();
    await expect(page.locator(".navigation-group-name")).toContainText(
      "Implementation",
    );
    await page
      .getByRole("button", { name: "Undo arrangement", exact: true })
      .click();
    await expect(
      page
        .locator(".navigation-group-name")
        .filter({ hasText: "Implementation" }),
    ).toHaveCount(0);
    await page.keyboard.press("Control+Shift+p");
    await page.getByLabel("Search open panels").fill("QuickOpen");
    await page.getByLabel("Search open panels").press("Enter");
    const childPromise = app.waitForEvent("window");
    const group = page
      .locator(".flexlayout__tabset")
      .filter({
        has: page.getByRole("tab", { name: "QuickOpen.tsx", exact: true }),
      });
    await group
      .getByRole("button", { name: "Popout selected tab", exact: true })
      .click();
    const child = await childPromise;
    await expect(child.locator(".monaco-editor")).toBeVisible();
    await page.getByRole("button", { name: "Panels", exact: true }).click();
    await page.getByLabel("Search open panels").fill("QuickOpen");
    await expect(
      page.getByRole("listbox", { name: "Open workspace panels" }),
    ).toContainText("Detached window");
    await page.screenshot({
      path: "release/previews/panel-navigator.png",
      animations: "disabled",
    });
    await page.getByLabel("Search open panels").press("Enter");
    await expect
      .poll(() => child.evaluate(() => document.hasFocus()))
      .toBe(true);
    await child.close();
    expect(errors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test("canceled project opens and superseded Quick Open responses cannot change the current context", async () => {
  test.setTimeout(60000);
  const f = await setup();
  const app = await electron.launch({ args: ["."], env: f.env });
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("files:operation");
      ipcMain.handle("files:operation", (_e, _c, request) => {
        if (request.op === "list" && request.root.endsWith("Slow"))
          return new Promise((resolve) => {
            (globalThis as any).resolveSlow = () => resolve([]);
          });
        if (request.op === "quickOpen") {
          if (request.query === "old")
            return new Promise((resolve) => {
              (globalThis as any).resolveOld = () =>
                resolve({
                  files: [{ name: "Old.ts", path: "Old.ts", score: 1 }],
                  matches: 1,
                  scannedFiles: 1,
                });
            });
          return {
            files: [{ name: "New.ts", path: "New.ts", score: 1 }],
            matches: 1,
            scannedFiles: 1,
            partial: true,
            limited: true,
          };
        }
        return [];
      });
    });
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    await page.keyboard.press("Control+o");
    await page
      .getByLabel("Project directory", { exact: true })
      .fill(path.join(f.dir, "Slow"));
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await expect(
      page.getByText(
        "Checking the folder on its host… Your current workspace stays open.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.evaluate(() => (globalThis as any).resolveSlow());
    await expect(page.locator(".project-card")).toContainText("Alpha");
    await page.keyboard.press("Control+p");
    await page.getByLabel("Quick Open file search").fill("old");
    await expect
      .poll(() => app.evaluate(() => !!(globalThis as any).resolveOld))
      .toBe(true);
    await page.getByLabel("Quick Open file search").fill("new");
    await app.evaluate(() => (globalThis as any).resolveOld());
    await expect(
      page.getByRole("listbox", { name: "Matching project files" }),
    ).toContainText("New.ts");
    await expect(
      page.getByRole("listbox", { name: "Matching project files" }),
    ).not.toContainText("Old.ts");
    await expect(page.getByRole("status")).toContainText("Partial scan");
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
