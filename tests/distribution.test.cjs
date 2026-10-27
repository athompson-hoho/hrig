const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createUpdateService,
  newer,
} = require("../electron/update-service.cjs");
const {
  makePolicy,
  feedName,
  downloads,
} = require("../electron/release-model.cjs");
const { createBackend } = require("../electron/backend.cjs");
test("unsigned and incomplete signing policies cannot enable installation; channels isolate every architecture", () => {
  for (const platform of ["win32", "darwin", "linux"])
    for (const arch of ["x64", "arm64"]) {
      assert.equal(makePolicy(platform, arch, {}).signed, false);
      assert.ok(feedName(platform, arch).includes(platform + "-" + arch));
      assert.ok(
        downloads("0.9.0", platform, arch).every((f) => f.includes(arch)),
      );
    }
  assert.throws(
    () => makePolicy("darwin", "arm64", { CSC_LINK: "private-fixture" }),
    (e) =>
      !e.message.includes("private-fixture") &&
      e.message.includes("APPLE_TEAM_ID"),
  );
  assert.throws(
    () => makePolicy("win32", "x64", { WIN_CSC_LINK: "private-fixture" }),
    /incomplete/,
  );
  assert.equal(
    makePolicy("win32", "x64", {
      WIN_CSC_LINK: "cert",
      WIN_CSC_KEY_PASSWORD: "password",
      WIN_PUBLISHER_NAME: "Publisher",
    }).signed,
    true,
  );
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("0.8.1", "0.9.0"), false);
  assert.equal(newer("99.0.0-beta", "0.9.0"), false);
});
test("manual checks use a fixed stable-release endpoint and never execute or download an unsigned update", async () => {
  const calls = [];
  let opened = "";
  const service = createUpdateService({
    version: "0.9.0",
    packaged: true,
    platform: "darwin",
    arch: "arm64",
    policy: { signed: false },
    loadUpdater: () => {
      throw Error("Must not load native updater");
    },
    request: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          tag_name: "v0.10.0",
          html_url: "https://untrusted.example",
          body: "Release notes",
        }),
      };
    },
    openRelease: async (url) => {
      opened = url;
    },
  });
  assert.equal(service.status().canInstall, false);
  const result = await service.operation({ op: "check" });
  assert.equal(result.phase, "available");
  assert.deepEqual(calls, [
    "https://api.github.com/repos/athompson-hoho/hrig/releases/latest",
  ]);
  await assert.rejects(service.operation({ op: "download" }), /unsigned/);
  await service.operation({ op: "open-release" });
  assert.equal(
    opened,
    "https://github.com/athompson-hoho/hrig/releases/tag/v0.10.0",
  );
  await assert.rejects(
    service.operation({ op: "install", confirmed: true }),
    /unsigned/,
  );
});
test("checking/downloading never restarts; install requires confirmation, verified download and a successful workspace guard", async () => {
  const updater = new EventEmitter();
  let installed = 0,
    guards = 0,
    ready = false;
  updater.checkForUpdates = async () => ({
    updateInfo: { version: "0.10.0", releaseNotes: "Fixture" },
  });
  updater.downloadUpdate = async () => {
    updater.emit("download-progress", { percent: 42 });
    updater.emit("update-downloaded");
    return ["verified-fixture"];
  };
  updater.quitAndInstall = () => {
    installed++;
  };
  const service = createUpdateService({
    version: "0.9.0",
    packaged: true,
    platform: "win32",
    arch: "x64",
    policy: { signed: true, publisherName: "Fixture Publisher" },
    loadUpdater: () => updater,
    prepareRestart: async () => {
      guards++;
      return { ready, error: "Unsaved buffers remain" };
    },
    openRelease: async () => {},
  });
  await service.operation({ op: "check" });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(installed, 0);
  await service.operation({ op: "download" });
  assert.equal(service.status().phase, "downloaded");
  assert.equal(installed, 0);
  assert.equal(guards, 0);
  await assert.rejects(service.operation({ op: "install" }), /Confirm/);
  assert.equal(guards, 0);
  await assert.rejects(
    service.operation({ op: "install", confirmed: true }),
    /Unsaved/,
  );
  assert.equal(installed, 0);
  assert.equal(service.status().phase, "downloaded");
  ready = true;
  await service.operation({ op: "install", confirmed: true });
  assert.equal(installed, 1);
  assert.equal(guards, 2);
});
test("update network/signature failures stay visible and do not retry writes or bypass the workspace guard", async () => {
  let requests = 0;
  const service = createUpdateService({
    version: "0.9.0",
    request: async () => {
      requests++;
      throw Error("Fixture offline");
    },
    openRelease: async () => {},
  });
  await assert.rejects(service.operation({ op: "check" }), /offline/);
  assert.equal(requests, 1);
  assert.equal(service.status().phase, "error");
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ updateInfo: { version: "0.10.0" } });
  updater.downloadUpdate = async () => {
    throw Error("Invalid signature");
  };
  const signed = createUpdateService({
    version: "0.9.0",
    packaged: true,
    platform: "darwin",
    policy: { signed: true },
    loadUpdater: () => updater,
    prepareRestart: () => {
      throw Error("Must not restart");
    },
    openRelease: async () => {},
  });
  await signed.operation({ op: "check" });
  await assert.rejects(signed.operation({ op: "download" }), /signature/);
  await assert.rejects(
    signed.operation({ op: "install", confirmed: true }),
    /Download/,
  );
});
test("backend services retain literal payloads and reject invalid sends without Electron", async () => {
  const calls = [];
  const backend = createBackend({
    platform: "linux",
    core: { validateConnection: (c) => assert.ok(c.id) },
    features: {
      runRig: async (c, args) => {
        calls.push(args);
        return "accepted";
      },
    },
  });
  await backend.sendMessage(
    { id: "fixture", kind: "local" },
    "builder@rig",
    "literal $(not executed)",
  );
  assert.deepEqual(calls, [["send", "builder@rig", "literal $(not executed)"]]);
  assert.throws(
    () =>
      backend.sendMessage({ id: "fixture", kind: "local" }, "builder@rig", ""),
    /enter a message/,
  );
  assert.equal(calls.length, 1);
});
