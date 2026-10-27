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
import http from "node:http";
import { execFileSync } from "node:child_process";
const core = require("../../electron/core.cjs");
const features = require("../../electron/features.cjs");
const { createWslFixture } = require("../wsl-fixture.cjs");
async function launch(
  connection: any,
  dir: string,
  options: Record<string, unknown> = {},
) {
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
      ...options,
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Tools", exact: true }).waitFor();
  return { app, page };
}
async function tool(page: Page, name: string) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Workspace tools" })
    .getByRole("button", { name, exact: false })
    .click();
}
test.describe("local roadmap workflows", () => {
  test.describe.configure({ mode: "serial" });
  let app: ElectronApplication;
  let page: Page;
  let dir: string;
  let root: string;
  const errors: string[] = [];
  test.beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-roadmap-ui-"));
    root = path.join(dir, "project");
    await fs.mkdir(root);
    await fs.writeFile(
      path.join(root, "hello.ts"),
      'export const message = "searchable fixture";\n',
    );
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    ({ app, page } = await launch(
      { id: "local", name: "Roadmap test", kind: "local", root },
      dir,
    ));
    page.on("pageerror", (e) => errors.push(e.message));
  });
  test.afterAll(async () => {
    await app?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });
  test("arranger supports undo/redo, equalizing, moving tabs and saved role templates", async () => {
    for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Shift+T");
    await tool(page, "Arrange workspace");
    await expect(page.locator(".arrange-preview")).toBeVisible();
    await page
      .locator(".arrange-presets")
      .getByRole("button", { name: /^Team / })
      .click();
    await expect(
      page.getByRole("button", { name: "Undo arrangement", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Undo arrangement", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Redo arrangement", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Redo arrangement", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Equalize panels", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Template name" })
      .fill("Reusable shell layout");
    await page
      .getByRole("button", { name: "Save role template", exact: true })
      .click();
    await expect(page.locator(".template-list")).toContainText(
      "Reusable shell layout",
    );
    await page.screenshot({ path: "test-results/arranger.png" });
  });
  test("project text search and external edit protection preserve disk and unsaved text", async () => {
    await tool(page, "Project tools");
    await page
      .getByRole("textbox", { name: "Project text search" })
      .fill("searchable fixture");
    await page
      .getByRole("button", { name: "Search text", exact: true })
      .click();
    await page.locator(".search-results button").first().click();
    await expect(
      page.locator(".monaco-editor .view-lines").first(),
    ).toContainText("searchable fixture");
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// unsaved local edit");
    await fs.writeFile(
      path.join(root, "hello.ts"),
      'export const message = "external update";\n',
    );
    await expect(page.locator(".external-change")).toBeVisible({
      timeout: 12000,
    });
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator(".editor-panel .error-box")).toContainText(
      "CONFLICT",
    );
    expect(await fs.readFile(path.join(root, "hello.ts"), "utf8")).toContain(
      "external update",
    );
    await page
      .locator(".flexlayout__tabset")
      .filter({ has: page.getByRole("tab", { name: "hello.ts", exact: true }) })
      .getByRole("button", { name: "Maximize tabset", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Compare with disk", exact: true })
      .click();
    await expect(page.locator(".monaco-diff-editor")).toBeVisible();
    await page
      .getByRole("button", { name: "Back to editor", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reload from disk", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard edits and reload", exact: true })
      .click();
    await expect(
      page.locator(".monaco-editor .view-lines").first(),
    ).toContainText("external update");
    await expect(page.locator(".external-change")).toHaveCount(0);
  });
  test("preview embeds a real local server and tools expose diagnostics", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<h1>HRig preview verified</h1>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as any).port;
    try {
      await tool(page, "Ports and previews");
      await page
        .getByRole("spinbutton", { name: "Preview port" })
        .fill(String(port));
      await page
        .getByRole("button", { name: "Open preview", exact: true })
        .click();
      await expect(
        page
          .frameLocator("iframe")
          .getByRole("heading", { name: "HRig preview verified" }),
      ).toBeVisible();
      await page.screenshot({ path: "test-results/preview.png" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await tool(page, "Connection doctor");
    await expect(
      page.getByText("Windows workspace", { exact: true }),
    ).toBeVisible();
    await fs.writeFile(path.join(root, "invalid.json"), "{ invalid json }");
    await page.keyboard.press("Control+k");
    await page
      .getByRole("textbox", { name: "Search commands and sessions" })
      .fill("invalid.json");
    await page
      .locator(".command-list button")
      .filter({ hasText: "invalid.json" })
      .click();
    await expect(
      page
        .locator(".monaco-editor .view-lines")
        .filter({ hasText: "invalid json" }),
    ).toBeVisible();
    await tool(page, "Problems");
    await expect(page.locator(".problem-row").first()).toContainText(
      "invalid.json",
      { timeout: 15000 },
    );
    expect(errors).toEqual([]);
  });
});
test("WSL attention, role templates, task assignment, lifecycle confirmations and session recovery", async () => {
  test.setTimeout(120000);
  test.skip(process.platform !== "win32", "Windows integration");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const { connection, root, session } = fixture;
  const replacement = session + "-replacement";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-roadmap-wsl-"));
  let app: ElectronApplication | undefined;
  try {
    await core.remote(
      connection,
      `git -C ${core.quote(root)} init && git -C ${core.quote(root)} add hello.py && git -C ${core.quote(root)} -c user.name=Fixture -c user.email=fixture@example.test commit -m baseline`,
    );
    await features.edit(connection, {
      op: "create",
      root,
      path: "attention",
      content: "",
    });
    const launched = await launch(connection, dir);
    app = launched.app;
    const page = launched.page;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".seat-row")).toContainText("builder", {
      timeout: 25000,
    });
    await tool(page, "Attention center");
    await expect(page.locator(".attention-row").first()).toContainText(
      "builder@fixture",
    );
    await page.locator("button.attention-row").click();
    await expect(page.locator(".terminal-host")).toContainText("$", {
      timeout: 25000,
    });
    await tool(page, "Arrange workspace");
    await page
      .getByRole("textbox", { name: "Template name" })
      .fill("Builder role");
    await page
      .getByRole("button", { name: "Save role template", exact: true })
      .click();
    await page.locator(".rig-row").filter({ hasText: "fixture" }).click();
    await tool(page, "Arrange workspace");
    await page
      .locator(".template-list>div")
      .filter({ hasText: "Builder role" })
      .getByRole("button", { name: "Apply to selected rig" })
      .click();
    await expect(
      page.getByRole("tab", { name: "builder", exact: true }),
    ).toHaveCount(1);
    await tool(page, "Task board");
    await page
      .getByRole("button", { name: "Assign work", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Task subject" })
      .fill("GUI assigned work");
    await page
      .getByRole("textbox", { name: "Task brief" })
      .fill("Literal $HOME text");
    await page
      .getByRole("button", { name: "Create assigned task", exact: true })
      .click();
    await expect(page.locator(".task-board")).toContainText(
      "GUI assigned work",
      { timeout: 20000 },
    );
    await tool(page, "Rig manager");
    await page
      .getByRole("combobox", { name: "Rig spec" })
      .selectOption("starter");
    await page
      .getByRole("button", { name: "Preview launch", exact: true })
      .click();
    await expect(page.locator(".operation-confirm")).toContainText("starter", {
      timeout: 20000,
    });
    await expect(
      page.getByRole("button", {
        name: "Confirm launch / restore",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Confirm rig name" })
      .fill("starter");
    await page
      .getByRole("button", { name: "Confirm launch / restore", exact: true })
      .click();
    await expect(page.locator(".json-result")).toContainText(
      '"preview": false',
      { timeout: 20000 },
    );
    const actions = (
      await core.fileOperation(connection, {
        op: "read",
        root,
        path: "actions.jsonl",
      })
    ).content
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(actions.length).toBe(2);
    expect(actions[0]).toContain("--plan");
    await page
      .locator(".rig-topology-heading")
      .filter({ hasText: "fixture" })
      .click();
    await page
      .getByRole("button", { name: "Prepare stop + snapshot", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop rig + snapshot", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Confirm rig name" })
      .fill("fixture");
    await page
      .getByRole("button", { name: "Stop rig + snapshot", exact: true })
      .click();
    await expect(page.locator(".json-result")).toContainText(
      '"operation": "down"',
      { timeout: 20000 },
    );
    await core.remote(
      connection,
      `tmux new-session -d -s ${core.quote(replacement)} -c ${core.quote(root)} 'bash --noprofile --norc'`,
    );
    await features.edit(connection, {
      op: "create",
      root,
      path: "session.txt",
      content: replacement,
    });
    await core.remote(
      connection,
      `tmux send-keys -t ${core.quote(replacement + ":0.0")} ${core.quote("printf HRIG_RECOVERED_SESSION")} Enter`,
    );
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await page.locator(".seat-row").click();
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_RECOVERED_SESSION",
      { timeout: 30000 },
    );
    await tool(page, "Connection doctor");
    await expect(
      page.getByText("Connection is ready", { exact: true }),
    ).toBeVisible({ timeout: 25000 });
    const current = await features.edit(connection, {
      op: "read",
      root,
      path: "hello.py",
    });
    await features.edit(connection, {
      op: "save",
      root,
      path: "hello.py",
      revision: current.revision,
      content: 'message = "review change"\n',
    });
    await tool(page, "Review workspace");
    await expect(page.locator(".review-changes")).toContainText("hello.py");
    await page
      .getByRole("textbox", { name: "Review note file" })
      .fill("hello.py");
    await page.getByRole("spinbutton", { name: "Review note line" }).fill("1");
    await page
      .getByRole("textbox", { name: "Review note", exact: true })
      .fill("Please explain this change.");
    await page
      .getByRole("button", { name: "Add review note", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send notes to selected seat", exact: true })
      .click();
    await expect(
      page.getByText(/Feedback accepted by OpenRig/),
    ).toBeVisible();
    const sent = (
      await core.fileOperation(connection, {
        op: "read",
        root,
        path: "sent.jsonl",
      })
    ).content;
    expect(sent).toContain("Please explain this change.");
    await page
      .locator(".review-changes button")
      .filter({ hasText: "hello.py" })
      .click();
    await expect(page.locator(".editor-panel .subtle")).toContainText("HEAD");
    await expect(page.locator(".monaco-diff-editor")).toContainText(
      "review change",
      { timeout: 15000 },
    );
    await expect(page.locator(".terminal-host")).toBeVisible();
    await page.screenshot({ path: "test-results/review.png" });
    expect(errors).toEqual([]);
    await page.screenshot({ path: "test-results/roadmap-wsl.png" });
  } finally {
    await app?.close();
    await core
      .remote(
        connection,
        `tmux kill-session -t ${core.quote("=" + replacement)}`,
      )
      .catch(() => {});
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("off-screen saved window bounds are recovered to a connected display", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-window-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const opened = await launch(
      { id: "local", name: "Window fixture", kind: "local", root: dir },
      dir,
      { windowBounds: { x: 999999, y: 999999, width: 1500, height: 900 } },
    );
    app = opened.app;
    const result = await app.evaluate(({ BrowserWindow, screen }) => ({
      bounds: BrowserWindow.getAllWindows()[0].getBounds(),
      areas: screen.getAllDisplays().map((d) => d.workArea),
    }));
    expect(
      result.areas.some(
        (a) =>
          result.bounds.x >= a.x &&
          result.bounds.y >= a.y &&
          result.bounds.x + result.bounds.width <= a.x + a.width &&
          result.bounds.y + result.bounds.height <= a.y + a.height,
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
