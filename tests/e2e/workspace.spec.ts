import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
let app: ElectronApplication;
let page: Page;
let dir: string;
let project: string;
const errors: string[] = [];
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-e2e-"));
  project = path.join(dir, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "hello.ts"),
    'export const message = "Hello, rig";\n',
  );
  execFileSync("git", ["init"], { cwd: project });
  execFileSync("git", ["add", "."], { cwd: project });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=HRig Test",
      "-c",
      "user.email=hrig@example.test",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: project },
  );
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        { id: "local", name: "Test workstation", kind: "local", root: project },
      ],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByText("Your rig.", { exact: false })).toBeVisible();
});
test.afterAll(async () => {
  if (app) await app.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});
test("desktop renders the workspace and detected connection controls", async () => {
  await expect(
    page.getByRole("button", { name: "Connect a machine", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New panel", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/workspace.png" });
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connect your workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "SSH", exact: true }).click();
  await expect(
    page.getByPlaceholder("user@server or dev-server"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
test("real Windows PTY, layout presets, and named restore work", async () => {
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator(".terminal-host .xterm")).toBeVisible();
  await expect(page.locator(".terminal-host")).toContainText("PS ", {
    timeout: 15000,
  });
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("Write-Output HRIG_TERMINAL_VERIFIED");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-host")).toContainText(
    "HRIG_TERMINAL_VERIFIED",
  );
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page.getByRole("button", { name: "Team Grid of sessions" }).click();
  await expect(page.locator(".terminal-host")).toHaveCount(2);
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page
    .getByRole("button", { name: "Save current layout", exact: true })
    .click();
  await page.getByRole("textbox").last().fill("My test layout");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page.getByRole("button", { name: "Focus One tab group" }).click();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page
    .locator(".layout-dropdown > button")
    .filter({ hasText: "My test layout" })
    .click();
  await expect(page.locator(".terminal-host")).toHaveCount(2);
  await page.screenshot({ path: "test-results/sessions.png" });
});
test("editor saves files, warns on unsaved close, and Git displays changes", async () => {
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("button", { name: "hello.ts", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "export",
  );
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("// HRIG_EDITOR_VERIFIED");
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  const fileTab = page
    .locator(".flexlayout__tab_button")
    .filter({ hasText: "hello.ts" });
  await fileTab.locator(".flexlayout__tab_button_trailing").click();
  await expect(
    page.getByRole("dialog", { name: "Save your changes?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  expect(await fs.readFile(path.join(project, "hello.ts"), "utf8")).toContain(
    "HRIG_EDITOR_VERIFIED",
  );
  await page
    .getByRole("button", { name: "Source control", exact: true })
    .first()
    .click();
  await expect(page.locator(".change-row")).toContainText("hello.ts");
  await page.locator(".change-row").click();
  await expect(page.getByText("HEAD ↔ working tree")).toBeVisible();
  await page.screenshot({ path: "test-results/editor.png" });
});
test("command palette and empty task queue work without renderer exceptions", async () => {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands and sessions" })
    .waitFor();
  await page.keyboard.type("hello.ts");
  await expect(
    page
      .locator(".command-list")
      .getByRole("button")
      .filter({ hasText: "hello.ts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search commands and sessions" }),
  ).toHaveValue("hello.ts");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands and sessions" })
    .fill("Task queue");
  await page.getByRole("button", { name: "Task queue OpenRig" }).click();
  await expect(page.getByText("Room for your next idea")).toBeVisible();
  expect(errors).toEqual([]);
});
test("tabs drag between groups, split, float, and open a native window", async () => {
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page.getByRole("button", { name: "Team Grid of sessions" }).click();
  const tabs = page.getByRole("tab", { name: "PowerShell", exact: true });
  const first = await tabs.first().boundingBox();
  const second = await tabs.nth(1).boundingBox();
  if (!first || !second) throw new Error("Session tabs are missing");
  await page.mouse.move(first.x + 30, first.y + 15);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 5, second.y + 15, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(
    page.locator(".flexlayout__tabset").filter({
      has: page.getByRole("tab", { name: "PowerShell", exact: true }),
    }),
  ).toHaveCount(1);
  const tab = page
    .getByRole("tab", { name: "PowerShell", exact: true })
    .first();
  const source = await tab.boundingBox();
  const panel = await page.locator(".terminal-panel").first().boundingBox();
  if (!source || !panel) throw new Error("Dock panel is missing");
  await page.mouse.move(source.x + 25, source.y + 15);
  await page.mouse.down();
  await page.mouse.move(
    panel.x + panel.width - 10,
    panel.y + panel.height / 2,
    { steps: 25 },
  );
  await page.mouse.up();
  await expect(
    page.locator(".flexlayout__tabset").filter({
      has: page.getByRole("tab", { name: "PowerShell", exact: true }),
    }),
  ).toHaveCount(2);
  const popout = page
    .getByRole("button", { name: "Popout selected tab", exact: true })
    .first();
  const newWindow = app.waitForEvent("window");
  await popout.click();
  const child = await newWindow;
  await child.waitForLoadState();
  await expect(child.locator(".terminal-panel")).toBeVisible();
  await child.screenshot({ path: "test-results/popout.png" });
  await child.close();
  await page
    .getByRole("button", { name: "Float selected tab", exact: true })
    .first()
    .click();
  await expect(page.locator(".flexlayout__float_window")).toBeVisible();
  expect(errors).toEqual([]);
});
test("workspace tabs and named arrangements survive an application restart", async () => {
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page.getByRole("button", { name: "Focus One tab group" }).click();
  const count = await page.getByRole("tab").count();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, "workspace.json"), "utf8"))
          .savedLayouts.length,
    )
    .toBe(1);
  await app.close();
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  await expect(page.getByRole("tab")).toHaveCount(count);
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(
    page
      .locator(".layout-dropdown > button")
      .filter({ hasText: "My test layout" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
