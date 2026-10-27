// Run with the isolated native-pairing fixture and an installed debug APK:
// node tests/mobile/native-pairing-smoke.cjs emulator-5556
const { _android, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
async function admin(op, fields = {}) {
  const response = await fetch("http://127.0.0.1:5183", {
    method: "POST",
    body: JSON.stringify({ op, ...fields }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
(async () => {
  const serial = process.argv[2];
  if (!serial) throw new Error("Pass an explicit Android emulator serial.");
  const device = (await _android.devices()).find(
    (value) => value.serial() === serial,
  );
  if (!device)
    throw new Error("Emulator is not connected/authorized: " + serial);
  try {
    await admin("start");
    const page = await (
      await device.webView({ pkg: "dev.hrig.companion" })
    ).page();
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
    const invite = await admin("invite");
    await page.getByLabel("Desktop invitation").fill(invite.payload);
    await page
      .getByRole("button", { name: "Review invitation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Request desktop approval", exact: true })
      .click();
    let status;
    for (let attempt = 0; attempt < 40; attempt++) {
      status = await admin("status");
      if (status.pending.length) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!status.pending.length) throw new Error("No pending desktop approval.");
    await expect(
      page.getByText(status.pending[0].phrase, { exact: true }),
    ).toBeVisible();
    await fs.mkdir(".hrig-test/native-evidence", { recursive: true });
    await device.screenshot({
      path: ".hrig-test/native-evidence/pairing-approval.png",
    });
    await admin("approve", { id: status.pending[0].id });
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /Sessions/ })
      .click();
    await expect(
      page.getByRole("button", { name: /builder codex/ }),
    ).toBeVisible();
    console.log("Pinned native TLS, desktop approval and inventory passed.");
    const savedProfile = await page.evaluate(
      async () =>
        JSON.parse((await window.Capacitor.Plugins.HrigLink.load()).value)[0],
    );
    const credential = savedProfile.credential;
    const encrypted = (
      await device.shell(
        "run-as dev.hrig.companion cat shared_prefs/hrig-vault.xml",
      )
    ).toString();
    if (encrypted.includes(credential))
      throw new Error("Plaintext credential found in Android preferences.");
    if (
      await page.evaluate(
        (secret) => JSON.stringify(localStorage).includes(secret),
        credential,
      )
    )
      throw new Error("Credential found in web storage.");
    const payload = JSON.parse(
      Buffer.from(invite.payload.slice(6), "base64url").toString("utf8"),
    );
    const rejected = await page.evaluate(async (url) => {
      try {
        await window.Capacitor.Plugins.HrigLink.request({
          url: url + "/api",
          fingerprint: "0".repeat(64),
          pairing: true,
          data: { op: "pair.request", code: "bad", name: "Imposter" },
        });
        return false;
      } catch {
        return true;
      }
    }, payload.urls[0]);
    if (!rejected) throw new Error("Wrong host certificate was accepted.");
    console.log(
      "Encrypted device storage and wrong-certificate rejection passed.",
    );
    await page.getByRole("button", { name: "Tasks", exact: false }).click();
    await expect(
      page.getByRole("heading", { name: "Verify native pinned TLS pairing" }),
    ).toBeVisible();
    await device.screenshot({
      path: ".hrig-test/native-evidence/paired-tasks.png",
    });
    await admin("revoke", { id: savedProfile.deviceId });
    // Force a fresh authorized read without ever retrying a message mutation.
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page
      .getByRole("button", { name: /^Connect to / })
      .first()
      .click();
    await expect(page.getByRole("alert")).toContainText("revoked", {
      timeout: 15000,
    });
    console.log("Revoked device cannot reconnect.");
    const logs = (await device.shell("logcat -d -t 2000")).toString();
    if (logs.includes(credential))
      throw new Error("Device credential leaked into native logs.");
    console.log("Device credential is absent from recent native logs.");
    await page
      .getByRole("button", { name: "Enter pairing details", exact: true })
      .click();
    const cancelled = await admin("invite");
    await page.getByLabel("Desktop invitation").fill(cancelled.payload);
    await page
      .getByRole("button", { name: "Review invitation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Request desktop approval", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel on this phone", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel on this phone", exact: true })
      .click();
    await expect
      .poll(async () => (await admin("status")).pending.length)
      .toBe(0);
    console.log("Phone cancellation removes the desktop pending request.");
  } finally {
    await device.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
