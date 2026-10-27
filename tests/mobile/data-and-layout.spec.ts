import { test, expect } from "@playwright/test";
import path from "node:path";
const { createGateway } = require("../../electron/mobile-gateway.cjs");
const { mobileScenario } = require("./scenarios.cjs");
const token = "mobile-data-layout-fixture-".repeat(2);
let scenario: ReturnType<typeof mobileScenario>, server: any, address: string;
test.beforeEach(async () => {
  scenario = mobileScenario();
  scenario.state.rich = true;
  server = createGateway({
    token,
    connections: scenario.connections,
    activeConnection: scenario.activeConnection,
    backend: scenario.backend,
    runRig: scenario.runRig,
    readTask: scenario.readTask,
    assets: path.resolve("dist-mobile"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(() => {
  server.closeAllConnections();
  server.close();
});
async function connect(page: any) {
  await page.goto(address);
  await page
    .getByRole("button", { name: "Legacy shared-key connection" })
    .click();
  await page.getByLabel("Pairing key").fill(token);
  await page.getByRole("button", { name: "Connect to hRig" }).click();
  await expect(page.getByLabel("Machine")).toHaveValue("fixture");
}
test("desktop selection, every seat and full tasks remain usable when one service fails", async ({
  page,
}) => {
  scenario.state.queueFailure = true;
  await connect(page);
  await expect(page.locator(".seat")).toHaveCount(12);
  await expect(
    page.getByRole("heading", { name: "Recovered sessions", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".badge")).toHaveText("Connected");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Tasks/ })
    .click();
  await expect(
    page.getByText("Fixture task query failed; inventory remains available.", {
      exact: true,
    }),
  ).toBeVisible();
  scenario.state.queueFailure = false;
  await page
    .getByRole("button", { name: "Refresh tasks", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(14);
  await page.getByLabel("Search tasks").fill("Task 13");
  await expect(page.locator(".task-card")).toHaveCount(1);
  await page.locator(".task-card").click();
  await expect(
    page.getByText(
      "Full intent: test Unicode café ✓ 📱 and preserve all information.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".task-body").last()).toContainText(
    "Second paragraph",
  );
  await page.getByText("All task fields", { exact: true }).click();
  await expect(page.getByLabel("All task fields")).toContainText(
    '"fieldsElided": false',
  );
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          (visualViewport?.width || innerWidth) + 1,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "All tasks", exact: false }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Sessions/ })
    .click();
  await page.getByLabel("Machine").selectOption("offline");
  await expect(page.locator(".seat")).toHaveCount(0);
  await expect(
    page.getByText("Fixture SSH host is unreachable.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Machine").selectOption("fixture");
  await expect(page.locator(".seat")).toHaveCount(12);
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("inventory failure does not hide tasks", async ({ page }) => {
  scenario.state.inventoryFailure = true;
  await connect(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Tasks/ })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(14);
  await expect(
    page.getByText("Fixture inventory request failed.", { exact: true }),
  ).toBeVisible();
});
test("screen errors stay local, drafts survive failed sends and navigation, stopped seats do not capture", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: /^builder codex/ }).click();
  await expect(page.getByLabel("Session screen")).toContainText(
    "Session revision 1",
  );
  await expect(
    page.getByText("model-0-with-a-descriptive-name", { exact: true }),
  ).toBeVisible();
  scenario.state.screenFailure = true;
  await page
    .getByRole("button", { name: "Refresh screen", exact: true })
    .click();
  await expect(
    page.getByText("Fixture pane temporarily unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".badge")).toHaveText("Connected");
  await expect(page.getByLabel("Session screen")).toContainText(
    "Session revision 1",
  );
  const draft = "Phone test café ✓ 📱\nKeep this draft on failure.";
  await page.getByLabel("Message builder").fill(draft);
  scenario.state.messageFailure = true;
  await page
    .getByRole("button", { name: "Send message", exact: false })
    .click();
  await expect(page.getByLabel("Message builder")).toHaveValue(draft);
  await expect(page.getByText(/Your draft is preserved/)).toBeVisible();
  await page
    .getByRole("button", { name: "All sessions", exact: false })
    .click();
  await page.getByRole("button", { name: /^builder codex/ }).click();
  await expect(page.getByLabel("Message builder")).toHaveValue(draft);
  scenario.state.messageFailure = false;
  await page
    .getByRole("button", { name: "Send message", exact: false })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Message sent to builder",
  );
  expect(scenario.receipts.filter((r: any) => r.op === "message")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "All sessions", exact: false })
    .click();
  await page.getByRole("button", { name: /^agent-3 claude/ }).click();
  await expect(page.getByText(/No live terminal is available/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh screen", exact: true }),
  ).toHaveCount(0);
});
test("pairing controls have touch spacing on narrow phones and landscape", async ({
  page,
}) => {
  await page.goto(address);
  await page
    .getByRole("button", { name: "Enter pairing details", exact: true })
    .click();
  const invite = {
    v: 1,
    hostId: "fixture-host",
    name: "A computer with a long descriptive name",
    urls: ["https://127.0.0.1:5182"],
    fingerprint: "a".repeat(64),
    code: "b".repeat(43),
    expiresAt: Date.now() + 120000,
  };
  await page.getByLabel("Desktop invitation").fill(JSON.stringify(invite));
  await page
    .getByRole("button", { name: "Review invitation", exact: true })
    .click();
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const input = await page.getByLabel("Phone name").boundingBox(),
      approve = await page
        .getByRole("button", { name: "Request desktop approval", exact: true })
        .boundingBox(),
      other = await page
        .getByRole("button", { name: "Choose another computer", exact: true })
        .boundingBox();
    expect(approve!.y - input!.y - input!.height).toBeGreaterThanOrEqual(12);
    expect(other!.y - approve!.y - approve!.height).toBeGreaterThanOrEqual(12);
    expect(approve!.height).toBeGreaterThanOrEqual(48);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/mobile-review-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
