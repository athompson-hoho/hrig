import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-package-smoke-"));
const env = { ...process.env, HRIG_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let latest;
try {
  latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
} catch {}
const app = await electron.launch({
  executablePath: path.resolve(
    process.argv[2] || latest?.executable || "release/win-unpacked/HRig.exe",
  ),
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New panel", exact: true }).waitFor();
  await page.keyboard.press("Control+Shift+T");
  await page.locator(".xterm-helper-textarea").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".terminal-host")?.textContent?.includes("PS "),
  );
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("Write-Output HRIG_PACKAGED_OK");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector(".terminal-host")
          ?.textContent?.match(/HRIG_PACKAGED_OK/g) || []
      ).length >= 2,
  );
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page
    .locator(".monaco-editor .view-lines")
    .filter({ hasText: "# HRig" })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Workspace tools" })
    .getByRole("button", { name: "Connection doctor", exact: false })
    .click();
  await page.getByText("Windows workspace", { exact: true }).waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/packaged.png" });
  console.log(
    "Packaged Windows app: renderer, preload, native PTY, bundled editor, and connection doctor passed.",
  );
} finally {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
