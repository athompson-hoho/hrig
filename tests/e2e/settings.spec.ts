import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("settings apply live themes, scoped values and validated imports, persist, and preserve terminal sessions", async () => {
  test.setTimeout(120000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-settings-ui-"));
  const c = { id: "local", name: "Settings demo", kind: "local", root: dir };
  await fs.writeFile(
    path.join(dir, "demo.ts"),
    'const message = "Settings stay live";\n',
  );
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
      desktopNotifications: true,
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use Daylight theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const panelColor = await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(panelColor).not.toBe("rgb(24, 26, 32)");
    await page.screenshot({
      path: "release/previews/settings-light.png",
      animations: "disabled",
    });
    await page
      .getByLabel("Color theme", { exact: true })
      .selectOption("system");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "hrig-dark",
    );
    await page.getByRole("button", { name: "Use Midnight theme" }).click();
    await page.screenshot({
      path: "release/previews/settings-midnight.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 800, height: 900 });
    await expect
      .poll(() =>
        page
          .locator(".settings-page")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: "release/previews/settings-narrow.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1510, height: 980 });
    const search = page.getByRole("textbox", { name: "Search settings" });
    await search.fill("editor font size");
    let font = page.getByLabel("Editor font size", { exact: true });
    await font.fill("18");
    await font.press("Tab");
    await expect(font).toHaveValue("18");
    await page.keyboard.press("Control+k");
    await page
      .getByRole("textbox", { name: "Search commands and sessions" })
      .fill("demo.ts");
    await page
      .locator(".command-list button")
      .filter({ hasText: "demo.ts" })
      .click();
    await expect(page.locator(".monaco-editor .view-lines").first()).toHaveCSS(
      "font-size",
      "18px",
    );
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await font.fill("20");
    await font.press("Tab");
    await expect(font).toHaveValue("20");
    await page.getByRole("tab", { name: "demo.ts", exact: true }).click();
    await expect(page.locator(".monaco-editor .view-lines").first()).toHaveCSS(
      "font-size",
      "20px",
    );
    await page.keyboard.press("Control+,");
    await page
      .getByRole("button", { name: "Reset Editor font size", exact: true })
      .click();
    await expect(font).toHaveValue("18");
    await page.getByRole("button", { name: "User", exact: true }).click();
    await search.fill("Desktop attention");
    await expect(
      page.getByLabel("Desktop attention notifications", { exact: true }),
    ).toBeChecked();
    await search.fill("does-not-exist");
    await expect(page.getByText("No matching settings")).toBeVisible();
    await page
      .getByRole("button", { name: "Settings JSON", exact: true })
      .click();
    const json = page.getByRole("textbox", {
      name: "Settings JSON",
      exact: true,
    });
    await json.fill(
      JSON.stringify({ version: 1, settings: { "editor.fontSize": 1000 } }),
    );
    await page.getByRole("button", { name: "Apply JSON", exact: true }).click();
    await expect(page.locator(".settings-json .error-box")).toContainText(
      "range",
    );
    await json.fill(
      JSON.stringify({
        version: 1,
        settings: {
          "appearance.theme": "midnight",
          "editor.fontSize": 18,
          "terminal.fontSize": 17,
          "notifications.desktop": true,
        },
      }),
    );
    await page.getByRole("button", { name: "Apply JSON", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Applied");
    await page.keyboard.press("Control+Shift+T");
    await expect(page.locator(".terminal-host .xterm")).toBeVisible();
    const term = page.locator(".xterm-helper-textarea").first();
    await term.fill("");
    await term.pressSequentially(
      "$global:hrigSettingsMarker='HRIG_SETTINGS_SESSION'; echo $global:hrigSettingsMarker",
    );
    await term.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_SETTINGS_SESSION",
    );
    await page.keyboard.press("Control+,");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Use Graphite theme" }).click();
    await page.getByRole("tab", { name: "PowerShell", exact: true }).click();
    await term.pressSequentially(
      "echo ('VERIFY_' + $global:hrigSettingsMarker)",
    );
    await term.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "VERIFY_HRIG_SETTINGS_SESSION",
    );
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_SETTINGS_SESSION",
    );
    await page.keyboard.press("Control+,");
    await expect(
      page.locator(".flexlayout__tab_button").filter({ hasText: "Settings" }),
    ).toHaveCount(1);
    await page.getByRole("tab", { name: "PowerShell", exact: true }).click();
    const opened = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Popout selected tab", exact: true })
      .first()
      .click();
    const child = await opened;
    await expect(child.locator("html")).toHaveAttribute(
      "data-theme",
      "graphite",
    );
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Use Midnight theme" }).click();
    await expect(child.locator("html")).toHaveAttribute(
      "data-theme",
      "midnight",
    );
    await child.close();
    await page.getByRole("button", { name: "Use Graphite theme" }).click();
    await page.getByRole("button", { name: "Editor", exact: true }).click();
    await expect(
      page.getByLabel("Editor font size", { exact: true }),
    ).toHaveValue("18");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByLabel("Editor font size", { exact: true }).fill("21");
    await page.getByLabel("Editor font size", { exact: true }).press("Tab");
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "graphite",
    );
    await page.getByRole("button", { name: "Editor", exact: true }).click();
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await expect(
      page.getByLabel("Editor font size", { exact: true }),
    ).toHaveValue("21");
    await page
      .getByRole("button", { name: "Reset project settings", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Reset project settings?" })
      .getByRole("button", { name: "Reset settings", exact: true })
      .click();
    await expect(
      page.getByLabel("Editor font size", { exact: true }),
    ).toHaveValue("18");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("new local shell preference starts Command Prompt without changing existing shells", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-settings-shell-"));
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        {
          id: "local",
          name: "Local settings fixture",
          kind: "local",
          root: dir,
        },
      ],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
      preferences: { "terminal.localShell": "cmd" },
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    await page.keyboard.press("Control+Shift+T");
    await expect(
      page.getByRole("tab", { name: "Command Prompt", exact: true }),
    ).toBeVisible();
    const input = page.locator(".xterm-helper-textarea").first();
    await input.pressSequentially("echo HRIG_CMD_SETTINGS_OK");
    await input.press("Enter");
    await expect(page.locator(".terminal-host")).toContainText(
      "HRIG_CMD_SETTINGS_OK",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
