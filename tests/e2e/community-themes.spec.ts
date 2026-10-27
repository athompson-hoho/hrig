import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { communityThemes } from "../../src/community-themes";
test("community themes apply to app, editor, terminals and popouts while preserving settings and session state", async () => {
  test.setTimeout(120000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-community-ui-"));
  await fs.writeFile(
    path.join(dir, "theme-preview.ts"),
    '// Community syntax palette\nconst greeting = "Hello, rig";\nexport function welcome(count: number) { return greeting.repeat(count); }\n',
  );
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        { id: "local", name: "Community theme demo", kind: "local", root: dir },
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
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await page.keyboard.press("Control+k");
    await page
      .getByRole("textbox", { name: "Search commands and sessions" })
      .fill("theme-preview.ts");
    await page
      .locator(".command-list button")
      .filter({ hasText: "theme-preview.ts" })
      .click();
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.keyboard.press("Control+Shift+T");
    let input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("$global:themeSession='LIVE_THEME_SESSION'");
    await input.press("Enter");
    await page.keyboard.press("Control+,");
    await expect(
      page.getByRole("group", { name: "Community theme previews" }),
    ).toBeVisible();
    for (const [id, palette] of Object.entries(communityThemes)) {
      await page
        .getByRole("button", {
          name: "Use " + palette.name + " theme",
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", id);
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue("--color-14161b")
              .trim(),
          ),
        )
        .toBe(palette.panel);
      await expect(
        page.getByLabel("Accent color", { exact: true }),
      ).toHaveValue("theme");
      if (
        ["catppuccin-mocha", "catppuccin-latte", "nord", "dracula"].includes(id)
      )
        await page.screenshot({
          path: "release/previews/community-" + id + ".png",
          animations: "disabled",
        });
    }
    await page
      .getByRole("button", { name: "Use Dracula theme", exact: true })
      .click();
    await expect(
      page.locator(".monaco-editor .monaco-editor-background").first(),
    ).toHaveCSS("background-color", "rgb(40, 42, 54)");
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await page
      .getByLabel("Terminal color theme", { exact: true })
      .selectOption("nord");
    await page.getByRole("tab", { name: "PowerShell", exact: true }).click();
    await expect(
      page.locator(".xterm .xterm-scrollable-element").first(),
    ).toHaveCSS("background-color", "rgb(46, 52, 64)");
    input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("echo ('PRESERVED_' + $global:themeSession)");
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "PRESERVED_LIVE_THEME_SESSION",
    );
    const opened = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Popout selected tab", exact: true })
      .first()
      .click();
    const child = await opened;
    await expect(child.locator("html")).toHaveAttribute(
      "data-theme",
      "dracula",
    );
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page
      .getByRole("button", { name: "Use Catppuccin Mocha theme", exact: true })
      .click();
    await expect(child.locator("html")).toHaveAttribute(
      "data-theme",
      "catppuccin-mocha",
    );
    await child.close();
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page
      .getByRole("button", { name: "Use Catppuccin Latte theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "catppuccin-latte",
    );
    await page
      .getByRole("button", { name: "Reset Color theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "catppuccin-mocha",
    );
    await page.getByRole("button", { name: "User", exact: true }).click();
    await page.getByLabel("Accent color", { exact: true }).selectOption("blue");
    await expect(page.getByLabel("Accent color", { exact: true })).toHaveValue(
      "blue",
    );
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "catppuccin-mocha",
    );
    await expect(page.getByLabel("Accent color", { exact: true })).toHaveValue(
      "blue",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
