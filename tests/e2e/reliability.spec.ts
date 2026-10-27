import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
async function fixture(kind = "local") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-reliability-"));
  await fs.writeFile(path.join(dir, "demo.ts"), "export const value = 1;\n");
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        { id: "qa", name: "QA host", kind, root: dir, distro: "Ubuntu" },
      ],
      activeConnection: "qa",
      roots: {},
      layouts: {},
      savedLayouts: [],
      activeRig: "",
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  return { dir, env };
}
async function command(page: any, name: string) {
  await page.locator(".command-trigger").click();
  await page
    .getByRole("textbox", { name: "Search commands and sessions" })
    .fill(name);
  await page
    .locator(".command-list button")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Command center" }),
  ).toHaveCount(0);
}
test("doctor failure finishes, recovered edits survive a killed renderer, and Save All preserves disk conflicts", async () => {
  const { dir, env } = await fixture();
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("connection:doctor");
      ipcMain.handle("connection:doctor", () => {
        throw new Error("QA doctor failure");
      });
    });
    await command(page, "Connection doctor");
    await expect(page.getByText(/QA doctor failure/)).toBeVisible();
    await expect(
      page.getByText("Checking connection and dependencies", { exact: false }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await page.getByRole("button", { name: "demo.ts", exact: true }).click();
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// RECOVER_ME");
    await expect
      .poll(
        async () => await fs.readFile(path.join(dir, "drafts.json"), "utf8"),
      )
      .toContain("RECOVER_ME");
    await expect
      .poll(
        async () => await fs.readFile(path.join(dir, "workspace.json"), "utf8"),
      )
      .toContain("demo.ts");
    await app
      .evaluate(() => {
        process.exit(0);
      })
      .catch(() => {});
    await fs.writeFile(
      path.join(dir, "demo.ts"),
      "export const value = 2; // external\n",
    );
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Restore recovery copy" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Restore recovery copy" }).click();
    await expect(
      page.locator(".monaco-editor .view-lines").first(),
    ).toContainText("RECOVER_ME");
    await command(page, "Save All");
    await expect
      .poll(() => fs.readFile(path.join(dir, "demo.ts"), "utf8"))
      .toContain("external");
    await expect
      .poll(() => fs.readFile(path.join(dir, "drafts.json"), "utf8"))
      .toContain("RECOVER_ME");
    await page
      .getByRole("button", { name: "Reload from disk", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard edits and reload", exact: true })
      .click();
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// SAVE_ALL");
    await command(page, "Save All");
    await expect
      .poll(() => fs.readFile(path.join(dir, "demo.ts"), "utf8"))
      .toContain("SAVE_ALL");
    await command(page, "Saved drafts and recovery");
    await expect(
      page.getByText("No saved drafts.", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
test("local and provider boards support deliberate actions and persist project state", async () => {
  const { dir, env } = await fixture();
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await command(page, "Task boards and integrations");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Issue title").fill("Build the board");
    await page.getByLabel("Issue description").fill("Fixture task");
    await page
      .getByRole("button", { name: "Confirm create", exact: true })
      .click();
    await page.getByRole("button", { name: /Build the board/ }).click();
    await page.getByLabel("Work item status").selectOption("Doing");
    await page.getByRole("button", { name: "Review status change" }).click();
    await page.getByRole("button", { name: "Confirm status update" }).click();
    await expect(
      page
        .locator(".work-column")
        .filter({ has: page.getByRole("heading", { name: "Doing 1" }) }),
    ).toContainText("Build the board");
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: /Build the board/ }),
    ).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      const calls: any[] = [];
      (globalThis as any).qaProviderCalls = calls;
      ipcMain.removeHandler("integrations:operation");
      ipcMain.handle("integrations:operation", (_e, a) => {
        calls.push(a);
        if (a.op === "list")
          return {
            items: [
              {
                id: "1",
                title: "GitHub fixture",
                body: "Description",
                url: "https://github.com/qa/demo/issues/1",
                status: "open",
              },
            ],
            statuses: [{ id: "closed", name: "closed" }],
            partial: true,
          };
        return {};
      });
    });
    await page.getByLabel("Task source").selectOption("github");
    await page.getByLabel("GitHub repository").fill("qa/demo");
    await page.getByRole("button", { name: "Load / refresh board" }).click();
    await expect(
      page.getByRole("button", { name: "GitHub fixture" }),
    ).toBeVisible();
    await expect(page.getByText(/Partial results:/)).toBeVisible();
    await page.getByRole("button", { name: "GitHub fixture" }).click();
    await page.getByLabel("Work item status").selectOption("closed");
    await page.getByRole("button", { name: "Review status change" }).click();
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).qaProviderCalls.filter(
            (a: any) => a.op === "update",
          ).length,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "Confirm status update" }).click();
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).qaProviderCalls.filter(
            (a: any) => a.op === "update" && a.confirmed,
          ).length,
      ),
    ).toBe(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: "release/previews/task-boards.png" });
  } finally {
    await app.close();
  }
});
test("stale inventory stays labeled and message drafts survive restart without retrying an uncertain send", async () => {
  const { dir, env } = await fixture("wsl");
  let app = await electron.launch({ args: ["."], env });
  const install = async () =>
    app.evaluate(({ ipcMain }) => {
      (globalThis as any).qaSends = 0;
      (globalThis as any).qaOffline = false;
      ipcMain.removeHandler("rig:inventory");
      ipcMain.handle("rig:inventory", () => {
        if ((globalThis as any).qaOffline) throw new Error("QA offline");
        return {
          rigs: [
            { id: "rig", name: "fixture", status: "running", nodeCount: 1 },
          ],
          seats: [
            {
              id: "seat",
              rigId: "rig",
              rigName: "fixture",
              name: "builder",
              runtime: "test",
              session: "qa",
              status: "idle",
            },
          ],
          sampledAt: "2026-10-27T12:00:00Z",
        };
      });
      ipcMain.removeHandler("rig:send");
      ipcMain.handle("rig:send", () => {
        (globalThis as any).qaSends++;
        throw new Error("QA uncertain delivery");
      });
    });
  try {
    await install();
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await expect(page.locator(".seat-row")).toContainText("builder");
    await command(page, "Send a message");
    await page.getByLabel("Message draft").fill("Keep this draft");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText(/Delivery is uncertain/)).toBeVisible();
    await app.close();
    app = await electron.launch({ args: ["."], env });
    await install();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await expect(page.getByLabel("Message draft")).toHaveValue(
      "Keep this draft",
    );
    expect(await app.evaluate(() => (globalThis as any).qaSends)).toBe(0);
    await app.evaluate(() => {
      (globalThis as any).qaOffline = true;
    });
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await expect(page.getByText(/Stale inventory/)).toBeVisible();
    await expect(page.locator(".seat-row")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
test("review drafts persist and stale revisions or changed recipients cannot receive old notes", async () => {
  const { env } = await fixture("wsl");
  let app = await electron.launch({ args: ["."], env });
  const install = async () =>
    app.evaluate(({ ipcMain }) => {
      (globalThis as any).qaRevision = "revision-one";
      (globalThis as any).qaSends = 0;
      ipcMain.removeHandler("rig:inventory");
      ipcMain.handle("rig:inventory", () => ({
        rigs: [],
        seats: ["builder", "reviewer"].map((name) => ({
          id: name,
          rigId: "rig",
          rigName: "fixture",
          name,
          runtime: "qa",
          session: "qa",
          status: "idle",
        })),
        sampledAt: "now",
      }));
      ipcMain.removeHandler("files:git");
      ipcMain.handle("files:git", () => ({
        isRepository: true,
        root: "fixture",
        entries: [{ path: "demo.ts", status: "M" }],
      }));
      ipcMain.removeHandler("editor:operation");
      ipcMain.handle("editor:operation", () => ({
        content: "fixture",
        revision: (globalThis as any).qaRevision,
      }));
      ipcMain.removeHandler("rig:send");
      ipcMain.handle("rig:send", () => {
        (globalThis as any).qaSends++;
        return "accepted";
      });
    });
  try {
    await install();
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await command(page, "Review workspace");
    await page.getByLabel("Review note file").fill("demo.ts");
    await page.getByLabel("Review note", {exact:true}).fill("Preserve this review");
    await page.getByRole("button", { name: "Add review note" }).click();
    await expect(page.locator(".review-note")).toContainText(
      "Preserve this review",
    );
    await app.close();
    app = await electron.launch({ args: ["."], env });
    await install();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Refresh rigs", exact: true })
      .click();
    await expect(page.locator(".review-note")).toContainText(
      "Preserve this review",
    );
    await page.getByLabel("Review recipient").selectOption("reviewer");
    await page
      .getByRole("button", { name: "Send notes to selected seat" })
      .click();
    await expect(page.locator(".tool-panel .error-box")).toContainText(
      "another recipient",
    );
    await page.getByLabel("Review recipient").selectOption("builder");
    await app.evaluate(() => {
      (globalThis as any).qaRevision = "revision-two";
    });
    await page
      .getByRole("button", { name: "Send notes to selected seat" })
      .click();
    await expect(page.locator(".tool-panel .error-box")).toContainText(
      "Stale review note",
    );
    expect(await app.evaluate(() => (globalThis as any).qaSends)).toBe(0);
    await expect(page.locator(".review-note")).toContainText(
      "Preserve this review",
    );
  } finally {
    await app.close();
  }
});
test("GitHub Projects and Linear boards use provider fields and explicit mutation confirmations", async () => {
  const { env } = await fixture();
  const app = await electron.launch({ args: ["."], env });
  try {
    await app.evaluate(({ ipcMain }) => {
      (globalThis as any).qaRequests = [];
      ipcMain.removeHandler("integrations:operation");
      ipcMain.handle("integrations:operation", (_e, a) => {
        (globalThis as any).qaRequests.push(a);
        if (a.op === "credentials")
          return { linear: true, secureStorage: true };
        if (a.op === "catalog")
          return {
            teams: {
              nodes: [
                {
                  id: "team1",
                  name: "Product",
                  states: { nodes: [{ id: "done1", name: "Done" }] },
                },
              ],
            },
            projects: { nodes: [{ id: "project1", name: "Desktop" }] },
          };
        if (a.op === "board")
          return {
            items: [
              {
                id: "pv1",
                title: "Project card",
                body: "Board fixture",
                url: "https://github.com/qa/demo/issues/2",
                status: "In progress",
              },
            ],
          };
        if (a.op === "list")
          return {
            items: [
              {
                id: "linear1",
                team: "team1",
                title: "APP-1 Linear card",
                body: "Linear fixture",
                url: "https://linear.app/qa/issue/APP-1",
                status: "Todo",
              },
            ],
            partial: false,
          };
        return {};
      });
    });
    const page = await app.firstWindow();
    await command(page, "Task boards and integrations");
    await page.getByLabel("Task source").selectOption("projects");
    await page.getByLabel("GitHub project owner").fill("qa");
    await page.getByLabel("GitHub project number").fill("2");
    await page.getByRole("button", { name: "Load / refresh board" }).click();
    await expect(
      page.getByRole("button", { name: "Project card" }),
    ).toBeVisible();
    await expect(page.getByText(/status columns are read-only/)).toBeVisible();
    await page.getByLabel("Task source").selectOption("linear");
    await page.getByRole("button", { name: "Load / refresh board" }).click();
    await expect(
      page.getByRole("button", { name: /APP-1 Linear card/ }),
    ).toBeVisible();
    await page.getByLabel("Linear team").selectOption("team1");
    await page.getByLabel("Linear project").selectOption("project1");
    await page.getByRole("button", { name: "Load / refresh board" }).click();
    await page.getByRole("button", { name: /APP-1 Linear card/ }).click();
    await page.getByLabel("Work item status").selectOption("done1");
    await page.getByRole("button", { name: "Review status change" }).click();
    expect(
      await app.evaluate(
        () =>
          (globalThis as any).qaRequests.filter((a: any) => a.op === "update")
            .length,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "Confirm status update" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const updates = await app.evaluate(() =>
      (globalThis as any).qaRequests.filter((a: any) => a.op === "update"),
    );
    expect(updates).toMatchObject([
      {
        provider: "linear",
        op: "update",
        id: "linear1",
        status: "done1",
        confirmed: true,
      },
    ]);
  } finally {
    await app.close();
  }
});
