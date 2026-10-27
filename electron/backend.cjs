// Application services deliberately have no Electron or UI dependency.
// Desktop IPC and future clients share these boundaries; window/PTY lifecycle,
// credentials, notifications and update installation stay in host adapters.
function createBackend({
  core = require("./core.cjs"),
  features = require("./features.cjs"),
  platform = process.platform,
} = {}) {
  return {
    inventory: (c) => core.inventory(c),
    doctor: (c) => features.diagnose(c),
    edit: (c, r) => features.edit(c, r),
    file: (c, r) => core.fileOperation(c, r),
    git: (c, root) => core.gitStatus(c, root),
    queue: (c, rig) => core.queue(c, rig),
    projects: (c) => features.projects(c),
    rigAction: (c, r) => features.rigAction(c, r),
    designRig: (c, r) => features.designRig(c, r),
    sendMessage(c, seat, message) {
      core.validateConnection(c);
      if (c.kind === "local" && platform === "win32")
        throw new Error("Select a WSL or SSH connection.");
      if (
        typeof seat !== "string" ||
        !seat ||
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 50000
      )
        throw new Error(
          "Choose a seat and enter a message under 50,000 characters.",
        );
      return features.runRig(c, ["send", seat, message]);
    },
  };
}
module.exports = { createBackend };
