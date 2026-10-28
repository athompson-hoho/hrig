const { URL } = require("node:url");
function externalUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Only HTTP and HTTPS links without embedded credentials can be opened.",
    );
  return url.href;
}
function registerTerminalTools({ handle, dialog, shell, getWindow, fs }) {
  handle("terminal:export", async (_event, text) => {
    if (
      typeof text !== "string" ||
      Buffer.byteLength(text, "utf8") > 32 * 1024 * 1024
    )
      throw new Error("Terminal export exceeds the 32 MiB limit.");
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "hRig",
      defaultPath: "terminal-output.txt",
      filters: [{ name: "Plain text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, text, "utf8");
    return { saved: true };
  });
  handle("terminal:open-link", async (_event, value) => {
    const url = externalUrl(value);
    const result = await dialog.showMessageBox(getWindow(), {
      type: "question",
      title: "hRig",
      message: "Open this link in your browser?",
      detail: url,
      buttons: ["Cancel", "Open link"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) await shell.openExternal(url);
  });
}
module.exports = { externalUrl, registerTerminalTools };
