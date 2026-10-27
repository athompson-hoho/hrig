const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const core = require("./core.cjs");
const terminals = new Map();
let mainWindow;
let persist = Promise.resolve();
let latestState = "";
if (process.env.HRIG_DATA_DIR)
  app.setPath("userData", process.env.HRIG_DATA_DIR);
const trusted = (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents)
    throw new Error("Untrusted application window.");
};
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return fn(event, ...args);
  });
}

function isPopoutUrl(url) {
  try {
    const expected = new URL(
      process.env.HRIG_DEV_URL
        ? `${process.env.HRIG_DEV_URL}/popout.html`
        : require("node:url").pathToFileURL(
            path.join(__dirname, "../dist/popout.html"),
          ).href,
    );
    const requested = new URL(url);
    return (
      requested.protocol === expected.protocol &&
      requested.host === expected.host &&
      requested.pathname === expected.pathname &&
      [...requested.searchParams.keys()].every((key) => key === "id") &&
      !requested.hash
    );
  } catch {
    return false;
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1510,
    height: 980,
    minWidth: 1020,
    minHeight: 680,
    frame: false,
    backgroundColor: "#101115",
    icon: path.join(__dirname, "../assets/icon.png"),
    title: "HRig",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["Keep editing", "Discard and close"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved changes",
      message: "Some files have unsaved edits.",
      detail:
        "Keep editing to save your changes, or discard them and close HRig.",
    });
    if (choice === 1) event.preventDefault();
  });
  // Only the bundled docking popout document can open a child window. No preload is exposed there.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = isPopoutUrl(url);
    return allowed
      ? {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: "#101115",
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        }
      : { action: "deny" };
  });
  mainWindow.webContents.on("did-create-window", (child) => {
    child.webContents.on("will-navigate", (event, url) => {
      if (!isPopoutUrl(url)) event.preventDefault();
    });
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
  if (process.env.HRIG_DEV_URL) mainWindow.loadURL(process.env.HRIG_DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}
handle("state:load", async () => {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(app.getPath("userData"), "workspace.json"),
        "utf8",
      ),
    );
  } catch {
    return null;
  }
});
handle("state:save", (_event, state) => {
  const data = JSON.stringify(state, null, 2);
  if (data.length > 8 * 1024 * 1024)
    throw new Error("Workspace state is too large.");
  latestState = data;
  const write = () => {
    if (data !== latestState) return;
    const file = path.join(app.getPath("userData"), "workspace.json");
    // Small metadata snapshots are atomic on the main thread. This also prevents
    // an in-flight asynchronous rename racing the final shutdown snapshot.
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
    fsSync.writeFileSync(file + ".tmp", data);
    fsSync.renameSync(file + ".tmp", file);
  };
  persist = persist.catch(() => {}).then(write);
  return persist;
});
// The renderer cannot wait for asynchronous IPC during beforeunload. Flush its
// final metadata synchronously, and make older queued writes skip that snapshot.
ipcMain.on("state:flush", (event, state) => {
  try {
    trusted(event);
    const data = JSON.stringify(state, null, 2);
    if (data.length > 8 * 1024 * 1024)
      throw new Error("Workspace state is too large.");
    latestState = data;
    const file = path.join(app.getPath("userData"), "workspace.json");
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
    fsSync.writeFileSync(file + ".closing.tmp", data);
    fsSync.renameSync(file + ".closing.tmp", file);
    event.returnValue = { saved: true };
  } catch (error) {
    event.returnValue = { saved: false, error: error.message };
  }
});
handle("connections:detect", () => core.detectConnections());
handle("rig:inventory", (_event, connection) => core.inventory(connection));
handle("rig:send", async (_event, connection, seat, message) => {
  core.validateConnection(connection);
  if (connection.kind === "local")
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
  return core.remote(
    connection,
    `${core.quote(connection.rigBinary || "rig")} send ${core.quote(seat)} ${core.quote(message)}`,
  );
});
handle("rig:queue", async (_event, connection, rigName) => {
  return core.queue(connection, rigName);
});
handle("files:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
handle("files:operation", (_event, connection, request) =>
  core.fileOperation(connection, request),
);
handle("files:git", async (_event, connection, root) =>
  core.parseGitStatus(
    (await core.fileOperation(connection, { op: "git", root, path: "" })).raw,
  ),
);
handle("terminal:create", async (event, options) => {
  const { id, connection, session, root } = options;
  if (typeof id !== "string" || id.length > 1000)
    throw new Error("Invalid panel ID.");
  core.validateConnection(connection);
  const existing = terminals.get(id);
  if (existing) return { id, buffer: existing.buffer, reused: true };
  let file, args;
  if (connection.kind === "local") {
    file = "powershell.exe";
    args = ["-NoLogo", "-NoProfile"];
  } else {
    const directory =
      !root || root === "~"
        ? '"$HOME"'
        : root.startsWith("~/")
          ? '"$HOME"/' + core.quote(root.slice(2))
          : core.quote(root);
    const cd = session ? "" : `cd -- ${directory} && `;
    const command = session ? core.sessionCommand(session) : "exec bash -l";
    ({ file, args } = core.transport(connection, cd + command, true));
  }
  let pty;
  try {
    pty = require("node-pty");
  } catch {
    throw new Error(
      "The Windows terminal module could not load. Reinstall dependencies for this computer.",
    );
  }
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  // A child shell is independent of the Orca agent that built HRig.
  for (const key of Object.keys(env))
    if (
      key.startsWith("ORCA_") ||
      key === "ELECTRON_RUN_AS_NODE" ||
      key === "HRIG_DEV_URL"
    )
      delete env[key];
  const terminal = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols || 100,
    rows: options.rows || 30,
    cwd: connection.kind === "local" ? root || process.cwd() : process.cwd(),
    env,
    useConpty: true,
  });
  const item = { terminal, buffer: "", sender: event.sender };
  terminals.set(id, item);
  terminal.onData((data) => {
    if (terminals.get(id) !== item) return;
    item.buffer = (item.buffer + data).slice(-300000);
    if (!item.sender.isDestroyed())
      item.sender.send("terminal:data", { id, data });
  });
  terminal.onExit(({ exitCode }) => {
    if (terminals.get(id) !== item) return;
    if (!item.sender.isDestroyed())
      item.sender.send("terminal:data", { id, exitCode });
    terminals.delete(id);
  });
  return { id, buffer: "" };
});
handle("terminal:close", (_event, id) => {
  const item = terminals.get(id);
  if (item) {
    item.terminal.kill();
    terminals.delete(id);
  }
});
ipcMain.on("terminal:write", (event, id, data) => {
  trusted(event);
  if (typeof data === "string" && data.length < 1000000)
    terminals.get(id)?.terminal.write(data);
});
ipcMain.on("terminal:resize", (event, id, cols, rows) => {
  trusted(event);
  if (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    rows > 0 &&
    cols < 1000 &&
    rows < 1000
  )
    try {
      terminals.get(id)?.terminal.resize(cols, rows);
    } catch {}
});
ipcMain.on("window:action", (event, action) => {
  trusted(event);
  if (action === "minimize") mainWindow.minimize();
  if (action === "maximize")
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === "close") mainWindow.close();
});
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow);
} else app.quit();
app.on("window-all-closed", () => {
  for (const item of terminals.values())
    try {
      item.terminal.kill();
    } catch {}
  app.quit();
});
