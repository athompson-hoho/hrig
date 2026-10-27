const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdateService } = require("../electron/update-service.cjs");
test("unsigned Windows and portable updates require explicit consent, verified download and a safe restart", async () => {
  for (const portable of [false, true]) {
    const updater = new EventEmitter();
    let installs = 0,
      guards = 0;
    updater.checkForUpdates = async () => ({
      updateInfo: { version: "0.12.0" },
    });
    updater.downloadUpdate = async () => ["verified"];
    updater.quitAndInstall = () => installs++;
    const service = createUpdateService({
      version: "0.11.0",
      platform: "win32",
      packaged: true,
      portable,
      policy: { signed: false },
      loadUpdater: () => updater,
      prepareRestart: async () => {
        guards++;
        return { ready: true };
      },
      openRelease: async () => {},
    });
    assert.equal(service.status().canInstall, true);
    assert.equal(service.status().requiresUnsignedConsent, true);
    await service.operation({ op: "check" });
    assert.equal(installs, 0);
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    await service.operation({ op: "download" });
    await assert.rejects(
      service.operation({ op: "install", confirmed: true }),
      /unsigned/,
    );
    assert.equal(guards, 0);
    assert.equal(installs, 0);
    await service.operation({
      op: "install",
      confirmed: true,
      allowUnsigned: true,
    });
    assert.equal(guards, 1);
    assert.equal(installs, 1);
  }
});
test("checksum failures prevent unsigned installation and never run the restart guard", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ updateInfo: { version: "0.12.0" } });
  updater.downloadUpdate = async () => {
    throw Error("SHA512 checksum mismatch");
  };
  const service = createUpdateService({
    version: "0.11.0",
    platform: "win32",
    packaged: true,
    loadUpdater: () => updater,
    prepareRestart: () => {
      throw Error("Must not run");
    },
    openRelease: async () => {},
  });
  await service.operation({ op: "check" });
  await assert.rejects(service.operation({ op: "download" }), /checksum/);
  await assert.rejects(
    service.operation({ op: "install", confirmed: true, allowUnsigned: true }),
    /Download/,
  );
});

test("startup and periodic checks never download and skip active updates; development builds stay offline", async () => {
  const { scheduleUpdateChecks } = require("../electron/update-adapter.cjs");
  let timeout,
    interval,
    quit,
    phase = "idle";
  const calls = [];
  const delays = [];
  let cleared = 0;
  const timers = {
    setTimeout(fn, ms) {
      timeout = fn;
      delays.push(ms);
      return 1;
    },
    setInterval(fn, ms) {
      interval = fn;
      delays.push(ms);
      return 2;
    },
    clearTimeout() {
      cleared++;
    },
    clearInterval() {
      cleared++;
    },
  };
  const app = {
    isPackaged: true,
    whenReady: () => Promise.resolve(),
    once(_event, fn) {
      quit = fn;
    },
  };
  const service = {
    status: () => ({ phase }),
    operation: async (a) => {
      calls.push(a.op);
    },
  };
  scheduleUpdateChecks(app, service, timers);
  await Promise.resolve();
  assert.deepEqual(delays, [10000, 21600000]);
  timeout();
  await Promise.resolve();
  assert.deepEqual(calls, ["check"]);
  phase = "downloaded";
  interval();
  assert.equal(calls.length, 1);
  phase = "available";
  interval();
  await Promise.resolve();
  assert.deepEqual(calls, ["check", "check"]);
  quit();
  assert.equal(cleared, 2);
  scheduleUpdateChecks({ ...app, isPackaged: false }, service, {
    setTimeout() {
      throw Error("Must stay offline");
    },
  });
});
