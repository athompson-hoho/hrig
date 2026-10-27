const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createUpdateService } = require("./update-service.cjs");
function registerUpdates({ app, ipcMain, shell, getWindow, trusted }) {
  let pending = null,
    policy = {};
  try {
    policy = JSON.parse(
      fs.readFileSync(
        path.join(process.resourcesPath, "release-policy.json"),
        "utf8",
      ),
    );
  } catch {}
  const prepareRestart = () =>
    new Promise((resolve) => {
      const win = getWindow();
      if (!win || win.isDestroyed())
        return resolve({ ready: false, error: "Workspace is unavailable." });
      const token = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending = null;
        resolve({
          ready: false,
          error:
            "Workspace did not confirm a safe restart. Nothing was installed.",
        });
      }, 15000);
      pending = {
        token,
        resolve: (value) => {
          clearTimeout(timer);
          pending = null;
          resolve(value);
        },
      };
      win.webContents.send("updates:prepare-restart", token);
    });
  ipcMain.on("updates:restart-ready", (event, result) => {
    trusted(event);
    if (pending && result?.token === pending.token)
      pending.resolve({ ready: result.ready === true, error: result.error });
  });
  const service = createUpdateService({
    version: app.getVersion(),
    packaged: app.isPackaged,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    policy,
    prepareRestart,
    loadUpdater: () => require("electron-updater").autoUpdater,
    openRelease: (url) => shell.openExternal(url),
  });
  service.events.on("change", (state) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("updates:state", state);
  });
  ipcMain.handle("updates:operation", (event, request) => {
    trusted(event);
    return service.operation(request);
  });
  return service;
}
module.exports = { registerUpdates };
