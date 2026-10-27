import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createWslFixture } = require("../wsl-fixture.cjs");
test("guided designer saves, revises and previews before launch; deletion requires the exact name", async () => {
  test.setTimeout(120000);
  test.skip(process.platform !== "win32");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-designer-ui-"));
  const c = fixture.connection;
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: c.id,
      roots: {},
      activeRig: "test-rig",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Workspace tools" })
      .getByRole("button", { name: "Rig manager", exact: false })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete fixture", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("button", { name: "Design a new rig", exact: true })
      .click();
    const wizard = page.getByRole("region", { name: "Rig designer" });
    await wizard
      .getByRole("textbox", { name: "New rig name", exact: true })
      .fill("new-team");
    await wizard
      .getByRole("textbox", { name: "Rig goal", exact: true })
      .fill("Build a reliable project");
    await wizard
      .getByRole("button", { name: "Recommend a team", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Seat 1 agent", { exact: true }),
    ).toHaveValue("implementer");
    await expect(
      wizard.getByLabel("Seat 2 agent", { exact: true }),
    ).toHaveValue("reviewer");
    await wizard
      .getByRole("button", { name: "Review design", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Launch designed rig" }),
    ).toHaveCount(0);
    await wizard
      .getByRole("button", { name: "Save and preview design", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Launch designed rig", exact: true }),
    ).toBeDisabled({ timeout: 20000 });
    await page.screenshot({ path: "test-results/rig-designer.png" });
    await wizard
      .getByRole("button", { name: "Back to team", exact: true })
      .click();
    await wizard
      .getByLabel("Seat 2 runtime", { exact: true })
      .selectOption("claude-code");
    await wizard
      .getByRole("button", { name: "Review design", exact: true })
      .click();
    await expect(
      wizard.getByRole("textbox", {
        name: "Confirm new rig name",
        exact: true,
      }),
    ).toHaveCount(0);
    await wizard
      .getByRole("button", { name: "Save and preview design", exact: true })
      .click();
    await wizard
      .getByRole("textbox", { name: "Confirm new rig name", exact: true })
      .fill("new-team", { timeout: 20000 });
    await wizard
      .getByRole("button", { name: "Launch designed rig", exact: true })
      .click();
    await expect(wizard.getByRole("status")).toContainText("Rig launched", {
      timeout: 20000,
    });
    await page
      .getByRole("button", { name: "Close rig designer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete fixture", exact: true })
      .click();
    const deletion = page.getByRole("region", {
      name: "Delete rig confirmation",
    });
    await expect(deletion).toContainText("test-rig");
    await expect(deletion).toContainText("builder");
    await expect(
      deletion.getByRole("button", {
        name: "Delete rig permanently",
        exact: true,
      }),
    ).toBeDisabled();
    await deletion
      .getByRole("textbox", { name: "Confirm deletion name", exact: true })
      .fill("wrong");
    await expect(
      deletion.getByRole("button", {
        name: "Delete rig permanently",
        exact: true,
      }),
    ).toBeDisabled();
    await deletion
      .getByRole("button", { name: "Cancel deletion", exact: true })
      .click();
    await expect(deletion).toHaveCount(0);
    await page
      .getByRole("button", { name: "Delete fixture", exact: true })
      .click();
    await deletion
      .getByRole("textbox", { name: "Confirm deletion name", exact: true })
      .fill("fixture");
    await deletion
      .getByRole("button", { name: "Delete rig permanently", exact: true })
      .click();
    await expect(deletion).toHaveCount(0, { timeout: 20000 });
    const core = require("../../electron/features.cjs");
    const actions = (
      await core.edit(c, {
        op: "read",
        root: fixture.root,
        path: "actions.jsonl",
      })
    ).content
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(actions.filter((a: string[]) => a[0] === "down")).toEqual([
      ["down", "test-rig", "--delete", "--snapshot", "--json"],
    ]);
    expect(
      actions.filter((a: string[]) => a[0] === "up" && !a.includes("--plan")),
    ).toHaveLength(1);
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
