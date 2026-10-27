// Drive the installed Android app against the isolated native-pairing fixture.
// node tests/mobile/native-full.cjs emulator-5556
const { _android, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const serial = process.argv[2];
async function admin(op, extra = {}) {
  const response = await fetch("http://127.0.0.1:5183", {
    method: "POST",
    body: JSON.stringify({ op, ...extra }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const scenario = (values) => admin("scenario", { values });
const hardware = (...args) =>
  execFileSync(
    process.env.ORCA_CLI_COMMAND || "orca",
    ["emulator", ...args, "--device", serial, "--json"],
    { windowsHide: true, timeout: 30000 },
  );
(async () => {
  if (!serial) throw new Error("Pass an explicit emulator serial.");
  const device = (await _android.devices()).find(
    (item) => item.serial() === serial,
  );
  if (!device) throw new Error("Android emulator not available.");
  await fs.mkdir(".hrig-test/full-mobile", { recursive: true });
  try {
    await scenario({
      rich: true,
      queueFailure: false,
      inventoryFailure: false,
      screenFailure: false,
      messageFailure: false,
      empty: false,
      sessionRevision: 1,
      removeSeat: false,
    });
    await admin("start");
    const initialMessages = (await admin("receipts")).filter(item => item.op === "message").length;
    const page = await (
      await device.webView({ pkg: "dev.hrig.companion" })
    ).page();
    const section = (name) =>
      page
        .getByRole("navigation")
        .getByRole("button", { name: new RegExp(name) })
        .click();
    const openSeat = (index) =>
      page
        .getByRole("button", {
          name:
            index === 0
              ? /^builder codex/
              : new RegExp("^agent-" + index + " "),
        })
        .click();
    const back = () =>
      page.getByRole("button", { name: /All sessions/ }).click();
    if (
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
    if (!(await page.getByLabel("Desktop invitation").isVisible()))
      await page
        .getByRole("button", { name: "Enter pairing details", exact: true })
        .click();
    const invitation = await admin("invite");
    await page.getByLabel("Desktop invitation").fill(invitation.payload);
    await page
      .getByRole("button", { name: "Review invitation", exact: true })
      .click();
    const name = await page.getByLabel("Phone name").boundingBox(),
      approve = await page
        .getByRole("button", { name: "Request desktop approval", exact: true })
        .boundingBox(),
      other = await page
        .getByRole("button", { name: "Choose another computer", exact: true })
        .boundingBox();
    if (
      approve.y - name.y - name.height < 12 ||
      other.y - approve.y - approve.height < 12
    )
      throw new Error("Native pairing controls are touching.");
    await page
      .getByRole("button", { name: "Request desktop approval", exact: true })
      .scrollIntoViewIfNeeded();
    await device.screenshot({
      path: ".hrig-test/full-mobile/after-review.png",
    });
    await page
      .getByRole("button", { name: "Request desktop approval", exact: true })
      .click();
    await expect
      .poll(async () => (await admin("status")).pending.length)
      .toBe(1);
    const pending = (await admin("status")).pending[0];
    await expect(page.getByText(pending.phrase, { exact: true })).toBeVisible();
    await admin("approve", { id: pending.id });
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel("Machine")).toHaveValue("fixture");
    await expect(page.locator(".seat")).toHaveCount(12);
    await expect(
      page.getByRole("heading", { name: "Recovered sessions", exact: true }),
    ).toBeVisible();
    console.log(
      "PASS: spaced approval controls, pinned pairing, active desktop connection and all 12 seats (including recovered group).",
    );
    for (let index = 0; index < 12; index++) {
      await openSeat(index);
      await expect(
        page.getByText(`model-${index}-with-a-descriptive-name`, {
          exact: true,
        }),
      ).toBeVisible();
      if (index === 3)
        await expect(
          page.getByText(/No live terminal is available/),
        ).toBeVisible();
      else {
        await expect(page.getByLabel("Session screen")).toContainText(
          "Line 199",
          { timeout: 15000 },
        );
        const noOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        );
        if (!noOverflow)
          throw new Error(
            "Native session causes horizontal overflow: " + index,
          );
      }
      if (index === 5)
        await expect(
          page.getByText("Agent needs a user decision before proceeding.", {
            exact: true,
          }),
        ).toBeVisible();
      await back();
    }
    console.log(
      "PASS: every seat, attention information, stopped-seat handling, model metadata and long terminal output.",
    );
    await scenario({ queueFailure: true });
    await section("Tasks");
    await page
      .getByRole("button", { name: "Refresh tasks", exact: true })
      .click();
    await expect(
      page.getByText(
        "Fixture task query failed; inventory remains available.",
        { exact: true },
      ),
    ).toBeVisible();
    await section("Sessions");
    await expect(page.locator(".seat")).toHaveCount(12);
    await scenario({ queueFailure: false });
    await section("Tasks");
    await page
      .getByRole("button", { name: "Refresh tasks", exact: true })
      .click();
    await expect(page.locator(".task-card")).toHaveCount(14);
    await scenario({ inventoryFailure: true });
    await section("Sessions");
    await page
      .getByRole("button", { name: "Refresh sessions", exact: true })
      .click();
    await expect(
      page.getByText("Fixture inventory request failed.", { exact: true }),
    ).toBeVisible();
    await section("Tasks");
    await expect(page.locator(".task-card")).toHaveCount(14);
    await scenario({ inventoryFailure: false });
    await section("Sessions");
    await page
      .getByRole("button", { name: "Refresh sessions", exact: true })
      .click();
    await expect(
      page.getByText("Fixture inventory request failed.", { exact: true }),
    ).toHaveCount(0);
    console.log(
      "PASS: task and inventory failures are independent and recoverable.",
    );
    await section("Tasks");
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
    if (
      !(await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= visualViewport.width + 1 &&
          innerWidth <= visualViewport.width + 1,
      ))
    )
      throw new Error("Expanded task fields stretched the native viewport.");
    console.log(
      "PASS: filtered task list and full details, including Unicode, owner, dates and unelided fields.",
    );
    await section("Sessions");
    await openSeat(0);
    const input = page.getByLabel("Message builder");
    await input.click();
    hardware("type", "Keyboard spacing test");
    await expect(input).toHaveValue("Keyboard spacing test");
    hardware("button", "back");
    await input.fill("Mobile full test café ✓ 📱\nPreserve this draft.");
    await scenario({ screenFailure: true, messageFailure: true });
    await page
      .getByRole("button", { name: "Refresh screen", exact: true })
      .click();
    await expect(
      page.getByText("Fixture pane temporarily unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".badge")).toHaveText("Connected");
    await page.getByRole("button", { name: /Send message/ }).click();
    await expect(page.getByText(/Your draft is preserved/)).toBeVisible();
    await back();
    await openSeat(0);
    await expect(input).toHaveValue(
      "Mobile full test café ✓ 📱\nPreserve this draft.",
    );
    await scenario({ screenFailure: false, messageFailure: false });
    await page.getByRole("button", { name: /Send message/ }).click();
    await expect(page.getByRole("status")).toContainText(
      "Message sent to builder",
    );
    const receipts = await admin("receipts");
    if (receipts.filter((item) => item.op === "message").length !== initialMessages + 1)
      throw new Error("Message was retried or not recorded exactly once.");
    console.log(
      "PASS: real keyboard input, local screen errors, preserved drafts and one deliberate message receipt.",
    );
    await scenario({ sessionRevision: 2 });
    await expect(page.getByLabel("Session screen")).toContainText(
      "Session revision 2",
      { timeout: 20000 },
    );
    await scenario({ removeSeat: true });
    await expect(
      page.getByText(/This seat is no longer in the current inventory/),
    ).toBeVisible({ timeout: 20000 });
    await back();
    await expect(page.locator(".seat")).toHaveCount(11);
    await scenario({ removeSeat: false });
    await page
      .getByRole("button", { name: "Refresh sessions", exact: true })
      .click();
    await expect(page.locator(".seat")).toHaveCount(12);
    await page.getByLabel("Machine").selectOption("offline");
    await expect(page.locator(".seat")).toHaveCount(0);
    await expect(
      page.getByText("Fixture SSH host is unreachable.", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Machine").selectOption("fixture");
    await expect(page.locator(".seat")).toHaveCount(12);
    console.log(
      "PASS: replaced sessions, removed seats, unreachable connection and connection recovery.",
    );
    hardware("rotate", "landscape_left");
    await expect
      .poll(() => page.evaluate(() => innerWidth > innerHeight))
      .toBe(true);
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw new Error("Landscape overflow.");
    await section("Tasks");
    await page.locator(".task-card").first().click();
    await expect(page.locator(".task-body").last()).toContainText(
      "Second paragraph",
    );
    await device.screenshot({
      path: ".hrig-test/full-mobile/landscape-task.png",
    });
    hardware("rotate", "portrait");
    await expect
      .poll(() => page.evaluate(() => innerHeight > innerWidth))
      .toBe(true);
    await section("Sessions");
    await device.screenshot({
      path: ".hrig-test/full-mobile/after-sessions.png",
    });
    await scenario({ empty: true });
    await page
      .getByRole("button", { name: "Refresh sessions", exact: true })
      .click();
    await expect(
      page.getByText("No rigs or seats were reported for this connection.", {
        exact: true,
      }),
    ).toBeVisible();
    await section("Tasks");
    await page
      .getByRole("button", { name: "Refresh tasks", exact: true })
      .click();
    await expect(
      page.getByText("No tasks were reported in the latest host window.", {
        exact: true,
      }),
    ).toBeVisible();
    console.log("PASS: landscape/portrait navigation and honest empty states.");
    await scenario({ empty: false });
  } finally {
    await device.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
