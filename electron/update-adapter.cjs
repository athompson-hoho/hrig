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
    loadUpdater: () => {
      const updater = require("electron-updater").autoUpdater;
      if (
        process.env.PORTABLE_EXECUTABLE_DIR &&
        !updater.hrigPortableInstaller
      ) {
        const install = updater.quitAndInstall.bind(updater);
        updater.quitAndInstall = (...args) => {
          delete process.env.PORTABLE_EXECUTABLE_DIR;
          delete process.env.PORTABLE_EXECUTABLE_FILE;
          delete process.env.PORTABLE_EXECUTABLE_APP_FILENAME;
          return install(...args);
        };
        updater.hrigPortableInstaller = true;
      }
      return updater;
    },
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
  const schedule = scheduleUpdateChecks(app, service);
  ipcMain.handle("updates:frequency", (event, hours) => {
    trusted(event);
    schedule.setHours(hours);
    return { hours };
  });
  return service;
}
const CHECK_HOURS = [0, 6, 12, 24, 168];
function scheduleUpdateChecks(
  app,
  service,
  timers = { setTimeout, setInterval, clearTimeout, clearInterval },
) {
  const controller = { setHours() {} };
  if (!app.isPackaged) return controller;
  let hours = 6,
    ready = false,
    startup,
    periodic;
  const check = () => {
    if (
      ["checking", "downloading", "downloaded", "installing"].includes(
        service.status().phase,
      )
    )
      return;
    void service.operation({ op: "check" }).catch(() => {});
  };
  const arm = () => {
    if (periodic !== undefined) timers.clearInterval(periodic);
    periodic = hours > 0 ? timers.setInterval(check, hours * 60 * 60 * 1000) : undefined;
    periodic?.unref?.();
  };
  // 0 = never check automatically (manual Check for updates still works).
  controller.setHours = (value) => {
    if (!CHECK_HOURS.includes(value)) throw new Error("Unsupported update-check frequency.");
    hours = value;
    if (hours === 0 && startup !== undefined) {
      timers.clearTimeout(startup);
      startup = undefined;
    }
    if (ready) arm();
  };
  app.whenReady().then(() => {
    ready = true;
    if (hours > 0) {
      startup = timers.setTimeout(check, 10000);
      startup.unref?.();
    }
    arm();
    app.once("before-quit", () => {
      if (startup !== undefined) timers.clearTimeout(startup);
      if (periodic !== undefined) timers.clearInterval(periodic);
    });
  });
  return controller;
}
module.exports = { registerUpdates, scheduleUpdateChecks, CHECK_HOURS };
