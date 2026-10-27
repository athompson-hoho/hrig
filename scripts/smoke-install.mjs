import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
// The installer writes OS shortcuts/registry entries. Run only on disposable CI.
if (process.platform !== "win32" || process.env.CI !== "true")
  throw new Error(
    "Installer lifecycle smoke is restricted to disposable Windows CI.",
  );
const latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
const installer = path.resolve(
  "release",
  `HRig-${latest.version}-windows-x64-setup.exe`,
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-install-fixture-"));
const guard = path.join(
  process.env.APPDATA,
  "hrig",
  `preserve-${Date.now()}.txt`,
);
await fs.mkdir(path.dirname(guard), { recursive: true });
await fs.writeFile(guard, "Keep user data on uninstall.");
execFileSync(installer, ["/S", "/D=" + dir], {
  windowsHide: true,
  timeout: 180000,
});
const executable = path.join(dir, "HRig.exe");
await fs.access(executable);
execFileSync(process.execPath, ["scripts/smoke-native.mjs", executable], {
  stdio: "inherit",
  timeout: 180000,
});
const uninstaller = path.join(dir, "Uninstall HRig.exe");
await fs.access(uninstaller);
execFileSync(uninstaller, ["/S"], { windowsHide: true, timeout: 180000 });
let removed = false;
for (let i = 0; i < 60; i++) {
  try {
    await fs.access(executable);
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    removed = true;
    break;
  }
}
if (!removed)
  throw new Error("Installer uninstall did not remove its application.");
if ((await fs.readFile(guard, "utf8")) !== "Keep user data on uninstall.")
  throw new Error("Uninstall removed user data.");
await fs.writeFile(
  "release/installer-qa-win32-x64.json",
  JSON.stringify(
    {
      version: latest.version,
      installed: true,
      launched: true,
      uninstalled: true,
      userDataPreserved: true,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Per-user installer install, native launch, uninstall and user-data preservation passed.",
);
