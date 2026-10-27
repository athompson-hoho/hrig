import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";

test("desktop mobile controls generate invitations, approve, revoke and stop TLS access", async () => {
  test.setTimeout(90000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-mobile-ui-"));
  await fs.writeFile(
    path.join(directory, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [
        {
          id: "local",
          name: "Test workstation",
          kind: "local",
          root: directory,
        },
      ],
      activeConnection: "local",
      roots: {},
      activeRig: "",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  function post(data: any, credential?: string) {
    return new Promise<any>((resolve, reject) => {
      const request = https.request(
        {
          hostname: "127.0.0.1",
          port: 5182,
          path: "/api",
          method: "POST",
          rejectUnauthorized: false,
          headers: {
            "Content-Type": "application/json",
            ...(credential
              ? { Authorization: `Bearer ${credential}` }
              : { "X-Hrig-Pairing": "1" }),
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode, ...JSON.parse(text) }),
          );
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify(data));
    });
  }
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Mobile devices", exact: true })
      .click();
    await page.getByRole("button", { name: "Start mobile access" }).click();
    await expect(
      page.getByRole("button", { name: "Stop mobile access" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pair a phone", exact: true })
      .click();
    const invitation = JSON.parse(
      Buffer.from(
        (await page.getByLabel("Pairing invitation").inputValue()).slice(6),
        "base64url",
      ).toString("utf8"),
    );
    await expect(
      page.getByRole("img", { name: "Single-use hRig pairing invitation" }),
    ).toBeVisible();
    const pending = (
      await post({
        op: "pair.request",
        code: invitation.code,
        name: "Test Android",
      })
    ).result;
    await expect(page.getByText(pending.phrase, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Approve Test Android", exact: true })
      .click();
    const approved = (await post({ op: "pair.poll", ...pending })).result;
    expect(approved.status).toBe("approved");
    expect(
      (await post({ op: "connections" }, approved.credential)).status,
    ).toBe(200);
    await page.screenshot({
      path: "test-results/desktop-mobile-devices.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revoke Test Android", exact: true })
      .click();
    expect(
      (await post({ op: "connections" }, approved.credential)).status,
    ).toBe(401);
    await page.getByRole("button", { name: "Stop mobile access" }).click();
    await expect(
      page.getByRole("button", { name: "Start mobile access" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
