import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("terminal tools search, copy and export without sending search text or replacing the shell", async () => {
  test.setTimeout(120000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-terminal-tools-"));
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        { id: "local", name: "Terminal QA", kind: "local", root: dir },
      ],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
      preferences: { "terminal.localShell": "cmd" },
    }),
  );
  await fs.writeFile(
    path.join(dir, "demo.ts"),
    "const terminalFileLink = true;\nconst secondLine = 2;\n",
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    await page.keyboard.press("Control+Shift+T");
    const input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("set HRIG_TOOLS_SESSION=still_here");
    await input.press("Enter");
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      (globalThis as any).terminalWrites = [];
      (globalThis as any).terminalResizes = [];
      ipcMain.on("terminal:resize", (_e, ...size) =>
        (globalThis as any).terminalResizes.push(size),
      );
      ipcMain.on("terminal:write", (_e, id, data) => {
        (globalThis as any).terminalWrites.push({ id, data });
      });
      const w = BrowserWindow.getAllWindows()[0];
      // Obtain the existing terminal ID from renderer-persisted layout in the next step.
      (globalThis as any).qaWindow = w;
    });
    await input.pressSequentially("echo ready");
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText("ready");
    await input.pressSequentially(
      "echo ToolNee^dle one & echo toolnee^dle two & echo ToolNee^dle three",
    );
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "ToolNeedle three",
    );
    const before = await app.evaluate(() => (globalThis as any).terminalWrites);
    expect(before.length).toBeGreaterThan(0);
    const dimensionsBefore = await app.evaluate(
      () => (globalThis as any).terminalResizes,
    );
    await input.press("Control+f");
    const search = page.getByRole("search", { name: "Terminal search" });
    await page
      .getByLabel("Find in terminal", { exact: true })
      .fill("ToolNeedle");
    await expect(search.getByRole("status")).toContainText("of 3");
    await page.getByRole("button", { name: "Match case", exact: true }).click();
    await expect(search.getByRole("status")).toContainText("of 2");
    await page.getByRole("button", { name: "Next terminal match" }).click();
    await page.getByRole("button", { name: "Previous terminal match" }).click();
    await page.getByRole("button", { name: "Copy terminal selection" }).click();
    await expect(
      page.getByText("Selection copied.", { exact: true }),
    ).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "ToolNeedle",
    );
    await page.getByRole("button", { name: "Use regular expression" }).click();
    await page.getByLabel("Find in terminal", { exact: true }).fill("[");
    await expect(search.getByRole("status")).toHaveText(
      "Invalid regular expression",
    );
    await page
      .getByLabel("Find in terminal", { exact: true })
      .fill("ToolNeedle (one|three)");
    await expect(search.getByRole("status")).toContainText("of 2");
    const after = await app.evaluate(() => (globalThis as any).terminalWrites);
    // ConPTY enables focus reporting; only native focus-out/in reports may reach the shell.
    expect(
      after
        .slice(before.length)
        .filter((event: any) => !["\x1b[O", "\x1b[I"].includes(event.data)),
    ).toEqual([]);
    await page.getByLabel("Find in terminal", { exact: true }).press("Escape");
    await expect(search).toHaveCount(0);
    await expect(input).toBeFocused();
    expect(
      await app.evaluate(() => (globalThis as any).terminalResizes),
    ).toEqual(dimensionsBefore);
    await page
      .getByRole("button", { name: "Copy output", exact: true })
      .click();
    await expect(
      page.getByText("Output copied.", { exact: true }),
    ).toBeVisible();
    const output = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(output).toContain("ToolNeedle one");
    expect(output).not.toContain("\x1b");
    const exported = path.join(dir, "export.txt");
    await app.evaluate(({ dialog }, file) => {
      (dialog as any).showSaveDialog = async () => ({
        canceled: false,
        filePath: file,
      });
    }, exported);
    await page.getByRole("button", { name: "Export terminal output" }).click();
    await expect(
      page.getByText("Output exported.", { exact: true }),
    ).toBeVisible();
    expect(await fs.readFile(exported, "utf8")).toBe(
      output.replace(/\r\n/g, "\n"),
    );
    await app.evaluate(({ dialog }) => {
      (dialog as any).showSaveDialog = async () => ({ canceled: true });
    });
    await page.getByRole("button", { name: "Export terminal output" }).click();
    await expect(
      page.getByText("Export canceled.", { exact: true }),
    ).toBeVisible();
    await input.focus();
    await input.pressSequentially("echo VERIFY_%HRIG_TOOLS_SESSION%");
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "VERIFY_still_here",
    );
    await input.pressSequentially("echo demo.^ts:2");
    await input.press("Enter");
    const fileRow = page
      .locator(".xterm-rows > div")
      .filter({ hasText: /^demo\.ts:2$/ });
    await expect(fileRow).toBeVisible();
    const bounds = await fileRow.boundingBox();
    await page.mouse.move(bounds!.x + 30, bounds!.y + 8);
    await expect(page.locator(".xterm-cursor-pointer")).toBeVisible();
    await page.mouse.click(bounds!.x + 30, bounds!.y + 8);
    await expect(
      page.getByRole("tab", { name: "demo.ts", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await page
      .getByRole("tab", { name: "Command Prompt", exact: true })
      .click();
    await app.evaluate(({ dialog, shell }) => {
      (globalThis as any).openedTerminalLinks = [];
      (globalThis as any).linkConfirmation = 0;
      (dialog as any).showMessageBox = async () => ({
        response: (globalThis as any).linkConfirmation,
      });
      shell.openExternal = async (url) => {
        (globalThis as any).openedTerminalLinks.push(url);
      };
    });
    await input.focus();
    await input.pressSequentially("echo https://example.^com/docs");
    await input.press("Enter");
    const urlRow = page
      .locator(".xterm-rows > div")
      .filter({ hasText: /^https:\/\/example\.com\/docs$/ });
    await expect(urlRow).toBeVisible();
    const urlBounds = await urlRow.boundingBox();
    await page.mouse.move(urlBounds!.x + 35, urlBounds!.y + 8);
    await expect(page.locator(".xterm-cursor-pointer")).toBeVisible();
    await page.mouse.click(urlBounds!.x + 35, urlBounds!.y + 8);
    expect(
      await app.evaluate(() => (globalThis as any).openedTerminalLinks),
    ).toEqual([]);
    await app.evaluate(() => {
      (globalThis as any).linkConfirmation = 1;
    });
    await page.mouse.click(urlBounds!.x + 35, urlBounds!.y + 8);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).openedTerminalLinks))
      .toEqual(["https://example.com/docs"]);
    await page.setViewportSize({ width: 780, height: 680 });
    await page
      .getByRole("button", { name: "Find in terminal (Ctrl/Cmd+F)" })
      .click();
    await page.getByRole("button", { name: "Dismiss terminal notice" }).click();
    await page
      .getByLabel("Find in terminal", { exact: true })
      .fill("ToolNeedle");
    await expect(search.getByRole("status")).toContainText("of 2");
    await expect(
      page.locator(".xterm-find-result-decoration").first(),
    ).toBeVisible();
    await page.screenshot({ path: "release/previews/terminal-tools.png" });
    expect(errors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
