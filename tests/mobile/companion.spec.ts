import { test, expect } from "@playwright/test";
import path from "node:path";
const { createGateway } = require("../../electron/mobile-gateway.cjs");
let server: any;
let address: string;
const token = "mobile-test-key-".repeat(4);
const messages: string[][] = [];
test.beforeAll(async () => {
  server = createGateway({
    token,
    assets: path.resolve("dist-mobile"),
    connections: async () => [
      { id: "fixture", name: "Development machine", kind: "wsl" },
    ],
    backend: {
      validateConnection: () => {},
      inventory: async () => ({
        rigs: [{ id: "team", name: "Product team", status: "running" }],
        seats: [
          {
            id: "builder",
            rigId: "team",
            rigName: "Product team",
            name: "builder",
            runtime: "codex",
            status: "working",
            session: "fixture",
          },
        ],
      }),
      queue: async () => [
        {
          id: "work",
          title: "Build the mobile client",
          status: "active",
          destination: "builder",
        },
      ],
      sessionCommand: () => {},
      quote: (v: string) => v,
      remote: async () => "Working on the companion gateway…",
    },
    runRig: async (_c: unknown, args: string[]) => {
      messages.push(args);
      return "sent";
    },
    readTask: async () => ({
      id: "work",
      title: "Build the mobile client",
      body: "Full mobile task details.",
      state: "active",
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => {
  server?.closeAllConnections();
  server?.close();
});
test("phone pairing, sessions, screen, messaging, tasks and disconnect", async ({
  page,
}) => {
  await page.goto(address);
  await page
    .getByRole("button", { name: "Legacy shared-key connection" })
    .click();
  await page.getByLabel("Pairing key").fill("wrong");
  await page.getByRole("button", { name: "Connect to hRig" }).click();
  await expect(page.getByRole("alert")).toHaveText("Pairing key rejected.");
  await page.getByLabel("Pairing key").fill(token);
  await page.getByRole("button", { name: "Connect to hRig" }).click();
  await page.getByRole("button", { name: /builder/ }).click();
  await expect(page.getByLabel("Session screen")).toContainText(
    "Working on the companion gateway",
  );
  await page.getByLabel("Message builder").fill("Please report status.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Message sent to builder",
  );
  expect(messages).toEqual([
    ["send", "builder@Product team", "Please report status."],
  ]);
  await page.getByRole("button", { name: "Tasks", exact: false }).click();
  await page.getByRole("button", { name: /Build the mobile client/ }).click();
  await expect(
    page.getByRole("heading", { name: "Build the mobile client" }),
  ).toBeVisible();
  await expect(
    page.getByText("Full mobile task details.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    token,
  );
  await page.screenshot({
    path: "test-results/mobile-tasks.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Legacy shared-key connection" })
    .click();
  await expect(page.getByLabel("Pairing key")).toHaveValue("");
});
