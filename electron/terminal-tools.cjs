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
function registerTerminalTools({ handle, dialog, shell, getWindow, fs, clipboard, getTerminal }) {
  handle("terminal:read-clipboard", async () => {
    const text = clipboard ? clipboard.readText() : "";
    return typeof text === "string" ? text : "";
  });
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
  handle("terminal:save-log", async (_event, request) => {
    const { id, text } = request || {};
    if (typeof id !== "string" || !id || typeof text !== "string" || !text)
      throw new Error("Choose a connected terminal with retained output.");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > 32 * 1024 * 1024)
      throw new Error("Terminal log exceeds the 32 MiB limit.");
    const terminal = typeof getTerminal === "function" ? getTerminal(id) : null;
    if (!terminal) throw new Error("Connect this terminal before saving its log.");
    const lines = text.split(/\r\n|\r|\n/).length;
    const confirmation = await dialog.showMessageBox(getWindow(), {
      type: "question",
      title: "Save terminal log",
      message: "Save this terminal's retained output to a local file?",
      detail: `${bytes} bytes · ${lines} lines\nWarning: terminal text can contain secrets.`,
      buttons: ["Cancel", "Choose file"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { saved: false };
    if (getTerminal(id) !== terminal)
      throw new Error("Terminal changed while confirming. Choose Save terminal log again.");
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "Save terminal log",
      defaultPath: "terminal-log.txt",
      filters: [{ name: "Plain text log", extensions: ["txt", "log"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    if (getTerminal(id) !== terminal)
      throw new Error("Terminal changed while choosing a file. Choose Save terminal log again.");
    await fs.writeFile(result.filePath, text, "utf8");
    return { saved: true, bytes, lines };
  });
  handle("snippets:export", async (_event, text) => {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 32 * 1024 * 1024)
      throw new Error("Snippet export exceeds the 32 MiB limit.");
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "Export terminal snippets",
      defaultPath: "terminal-snippets.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
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
