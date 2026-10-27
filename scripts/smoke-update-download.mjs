import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
if (process.platform !== "win32")
  throw Error("This read-only installer download check requires Windows.");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-update-download-"));
const env = { ...process.env, HRIG_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
await fs.writeFile(
  path.join(dir, "missing-test-config.yml"),
  JSON.stringify({
    provider: "generic",
    url: "https://github.com/athompson-hoho/hrig/releases/latest/download",
    channel: "stable-win32-x64",
    updaterCacheDirName: "hrig-download-qa",
  }),
);
const app = await electron.launch({ args: ["."], env });
try {
  const result = await app.evaluate(async ({ app }, dir) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const { NsisUpdater } = require(
      app.getAppPath() + "/node_modules/electron-updater",
    );
    const adapter = {
      version: "0.0.1",
      name: "HRig update download QA",
      isPackaged: true,
      appUpdateConfigPath: dir + "/missing-test-config.yml",
      userDataPath: dir,
      baseCachePath: dir,
      whenReady: () => Promise.resolve(),
      relaunch: () => {
        throw Error("Must not relaunch");
      },
      quit: () => {
        throw Error("Must not quit to install");
      },
      onQuit: () => {},
    };
    const updater = new NsisUpdater(null, adapter);
    updater.httpExecutor = new (require(
      app.getAppPath() +
        "/node_modules/electron-updater/out/electronHttpExecutor",
    ).ElectronHttpExecutor)();
    updater.setFeedURL({
      provider: "generic",
      url: "https://github.com/athompson-hoho/hrig/releases/latest/download",
      channel: "stable-win32-x64",
    });
    updater.logger = null;
    updater.disableDifferentialDownload = true;
    const { createUpdateService } = require(
      app.getAppPath() + "/electron/update-service.cjs",
    );
    const service = createUpdateService({
      version: "0.0.1",
      platform: "win32",
      packaged: true,
      portable: true,
      policy: { signed: false },
      loadUpdater: () => updater,
      prepareRestart: () => {
        throw Error("Must not install");
      },
      openRelease: async () => {},
    });
    const checked = await service.operation({ op: "check" });
    if (checked.phase !== "available") throw Error("No newer release found");
    const downloaded = await service.operation({ op: "download" });
    if (downloaded.phase !== "downloaded")
      throw Error("Download was not verified");
    return {
      passed: true,
      downloadedVersion: downloaded.latestVersion,
      phase: downloaded.phase,
      canInstall: downloaded.canInstall,
      requiresUnsignedConsent: downloaded.requiresUnsignedConsent,
      installed: false,
    };
  }, dir);
  await fs.mkdir("release", { recursive: true });
  await fs.writeFile(
    "release/update-download-qa.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
