const { contextBridge, ipcRenderer } = require("electron");
const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("hrig", {
  doctor: invoke("connection:doctor"),
  edit: invoke("editor:operation"),
  rigAction: invoke("rig:action"),
  ports: invoke("ports:list"),
  openPreview: invoke("preview:open"),
  closePreview: invoke("preview:close"),
  notifyAttention: invoke("attention:notify"),
  onResume: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("connection:resume", listener);
    return () => ipcRenderer.removeListener("connection:resume", listener);
  },
  loadState: invoke("state:load"),
  saveState: invoke("state:save"),
  flushState: (state) => ipcRenderer.sendSync("state:flush", state),
  detectConnections: invoke("connections:detect"),
  inventory: invoke("rig:inventory"),
  sendMessage: invoke("rig:send"),
  queue: invoke("rig:queue"),
  file: invoke("files:operation"),
  projects: invoke("rig:projects"),
  pickFolder: invoke("files:pick"),
  git: invoke("files:git"),
  createTerminal: invoke("terminal:create"),
  closeTerminal: invoke("terminal:close"),
  writeTerminal: (id, data) => ipcRenderer.send("terminal:write", id, data),
  resizeTerminal: (id, cols, rows) =>
    ipcRenderer.send("terminal:resize", id, cols, rows),
  onTerminal: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  window: (action) => ipcRenderer.send("window:action", action),
});
