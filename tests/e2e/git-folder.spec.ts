import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
test("non-repository source control offers a project picker and recovers when a repository is selected", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-git-ui-"));
  const repo = path.join(dir, "repository");
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, "hello.txt"), "fixture");
  execFileSync("git", ["init"], { cwd: repo });
  const c = { id: "local", name: "Git folder test", kind: "local", root: dir };
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: c.id,
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
    await page
      .getByRole("button", { name: "Source control", exact: true })
      .first()
      .click();
    await expect(
      page.locator(".sidebar").getByText("Open a Git project", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".sidebar .error-box")).toHaveCount(0);
    await expect(
      page.getByText("Working tree clean", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Workspace tools" })
      .getByRole("button", { name: "Review workspace", exact: false })
      .click();
    await expect(page.locator(".review-changes")).toContainText(
      "Open a Git project",
    );
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Choose project folder", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Open a project" });
    await dialog.getByRole("textbox").fill(repo);
    await dialog
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Source control", exact: true })
      .first()
      .click();
    await expect(page.locator(".change-row")).toContainText("hello.txt");
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
