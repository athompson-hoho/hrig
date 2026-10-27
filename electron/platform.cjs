const path = require("node:path");
function localShell(platform, choice = "system", env = process.env) {
  if (!["system", "powershell", "cmd", "bash", "zsh"].includes(choice))
    throw new Error("Unsupported local shell");
  if (platform === "win32") {
    if (["bash", "zsh"].includes(choice))
      throw new Error("Choose WSL for a Unix shell on Windows.");
    return choice === "cmd"
      ? { file: "cmd.exe", args: ["/Q"] }
      : { file: "powershell.exe", args: ["-NoLogo", "-NoProfile"] };
  }
  const file =
    choice === "bash"
      ? "/bin/bash"
      : choice === "zsh"
        ? "/bin/zsh"
        : env.SHELL || "/bin/bash";
  if (!path.posix.isAbsolute(file) || /[\r\n\0]/.test(file))
    throw new Error("The login shell must be an absolute executable path.");
  return { file, args: ["-l"] };
}
module.exports = { localShell };
