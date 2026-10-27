const { EventEmitter } = require("node:events");
const RELEASES = "https://github.com/athompson-hoho/hrig/releases";
function newer(next, current) {
  const parse = (v) => {
    const m = String(v).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return m ? m.slice(1).map(Number) : null;
  };
  const a = parse(next),
    b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function createUpdateService({
  version,
  platform = process.platform,
  arch = process.arch,
  packaged = false,
  policy = {},
  portable = false,
  request = fetch,
  loadUpdater,
  prepareRestart,
  openRelease,
}) {
  const events = new EventEmitter();
  let updater = null,
    busy = false;
  const supported =
    packaged &&
    ((platform === "win32" &&
      (policy.signed !== true || !!policy.publisherName)) ||
      (platform === "darwin" && policy.signed === true));
  let state = {
    phase: "idle",
    currentVersion: version,
    latestVersion: "",
    releaseUrl: RELEASES,
    notes: "",
    progress: 0,
    canInstall: supported,
    requiresUnsignedConsent: supported && policy.signed !== true,
    error: "",
    mode: supported ? "in-app" : "manual",
    reason: !packaged
      ? "Development build: use a packaged release."
      : portable && platform === "win32"
        ? "Updating this portable copy opens Windows setup. The original portable file remains; use the installed app afterward."
        : platform === "linux"
          ? "Use your Linux package manager or download the current package."
          : !supported
            ? "This build is unsigned. In-app installation stays disabled until signed releases are configured."
            : policy.signed !== true
              ? "Updates are checksum-verified but unsigned. Windows may show a security prompt."
              : "",
  };
  const set = (change) => {
    state = { ...state, ...change };
    events.emit("change", { ...state });
    return { ...state };
  };
  function getUpdater() {
    if (updater) return updater;
    updater = loadUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on("download-progress", (p) =>
      set({
        phase: "downloading",
        progress: Math.max(0, Math.min(100, p.percent || 0)),
      }),
    );
    updater.on("update-downloaded", () =>
      set({ phase: "downloaded", progress: 100 }),
    );
    updater.on("error", (e) =>
      set({ phase: "error", error: String(e.message || e).slice(0, 2000) }),
    );
    return updater;
  }
  return {
    events,
    status: () => ({ ...state }),
    async operation(a = {}) {
      if (a.op === "status") return { ...state };
      if (a.op === "open-release") {
        await openRelease(state.releaseUrl);
        return { ...state };
      }
      if (busy) throw new Error("An update operation is already in progress.");
      if (!["check", "download", "install"].includes(a.op))
        throw new Error("Unsupported update operation.");
      busy = true;
      try {
        if (a.op === "check") {
          if (state.phase === "downloaded") return { ...state };
          set({ phase: "checking", error: "", progress: 0 });
          if (supported) {
            const result = await getUpdater().checkForUpdates();
            const latest = result?.updateInfo?.version || version;
            return set({
              phase: newer(latest, version) ? "available" : "current",
              latestVersion: latest,
              notes:
                typeof result?.updateInfo?.releaseNotes === "string"
                  ? result.updateInfo.releaseNotes
                  : "",
              releaseUrl: RELEASES + "/tag/v" + latest,
            });
          }
          const response = await request(
            "https://api.github.com/repos/athompson-hoho/hrig/releases/latest",
            {
              headers: { Accept: "application/vnd.github+json" },
              signal: AbortSignal.timeout(20000),
            },
          );
          if (!response.ok)
            throw new Error(
              "Update check failed (HTTP " +
                response.status +
                "). Try again later.",
            );
          const release = await response.json();
          if (
            release.draft ||
            release.prerelease ||
            !/^v\d+\.\d+\.\d+$/.test(release.tag_name)
          )
            throw new Error("The server did not return a stable release.");
          const latest = release.tag_name.slice(1);
          return set({
            phase: newer(latest, version) ? "available" : "current",
            latestVersion: latest,
            notes:
              typeof release.body === "string"
                ? release.body.slice(0, 50000)
                : "",
            releaseUrl: RELEASES + "/tag/v" + latest,
          });
        }
        if (!supported) throw new Error(state.reason);
        if (a.op === "download") {
          if (state.phase !== "available")
            throw new Error("Check for a newer release before downloading.");
          set({ phase: "downloading", error: "", progress: 0 });
          await getUpdater().downloadUpdate();
          return set({ phase: "downloaded", progress: 100 });
        }
        if (a.confirmed !== true)
          throw new Error("Confirm restart and installation.");
        if (state.requiresUnsignedConsent && a.allowUnsigned !== true)
          throw new Error(
            "Acknowledge that this update is unsigned before installing.",
          );
        if (state.phase !== "downloaded")
          throw new Error("Download and verify the update before installing.");
        // electron-updater can spawn the installer BEFORE app.quit. A normal
        // beforeunload dialog is therefore too late; obtain the editor guard first.
        const ready = await prepareRestart();
        if (!ready?.ready)
          throw new Error(
            ready?.error || "Save or discard unsaved edits before installing.",
          );
        set({ phase: "installing", error: "" });
        getUpdater().quitAndInstall(false, true);
        return { ...state };
      } catch (e) {
        set({
          phase:
            a.op === "install" && state.phase === "downloaded"
              ? "downloaded"
              : "error",
          error: String(e.message || e).slice(0, 2000),
        });
        throw e;
      } finally {
        busy = false;
      }
    },
  };
}
module.exports = { createUpdateService, newer };
