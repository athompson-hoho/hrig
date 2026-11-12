const { contextBridge, ipcRenderer, webUtils } = require("electron");
const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("hrig", {
  rigControl: invoke("rig:control"),
  updates: invoke('updates:operation'),
  updateFrequency: invoke('updates:frequency'),
  setSpellcheck: invoke('spellcheck:set'),
  onUpdates: callback => { const listener=(_event,state)=>callback(state);ipcRenderer.on('updates:state',listener);return ()=>ipcRenderer.removeListener('updates:state',listener); },
  onPrepareUpdate: callback => { const listener=async(_event,token)=>{try{ipcRenderer.send('updates:restart-ready',{token,...await callback()});}catch(error){ipcRenderer.send('updates:restart-ready',{token,ready:false,error:error.message});}};ipcRenderer.on('updates:prepare-restart',listener);return ()=>ipcRenderer.removeListener('updates:prepare-restart',listener); },
  terminalLog: invoke('terminal:log'),
  onTerminalLog: callback => { const listener = (_event,state) => callback(state); ipcRenderer.on('terminal:log-state',listener); return () => ipcRenderer.removeListener('terminal:log-state',listener); },
  exportTerminal: invoke('terminal:export'),
  openTerminalLink: invoke('terminal:open-link'),
  clipboardHasImage: invoke('terminal:clipboard-image'),
  pasteClipboardImage: invoke('terminal:paste-image'),
  readClipboardText: invoke('terminal:read-clipboard'),
  pathForFile: (file) => {
    try {
      const path = webUtils.getPathForFile(file);
      return typeof path === "string" ? path : "";
    } catch {
      return "";
    }
  },
  platform: process.platform,
  mobile: invoke('mobile:operation'),
  integrate: invoke('integrations:operation'),
  openWorkLink: invoke('integrations:open'),
  drafts: (request) => ipcRenderer.sendSync('drafts:operation', request),
  doctor: invoke("connection:doctor"),
  exportDiagnostics: invoke('diagnostics:export'),
  edit: invoke("editor:operation"),
  rigAction: invoke("rig:action"),
  seatPrompt: invoke("seat:prompt"),
  inventoryCache: invoke("inventory:cache"),
  seatTranscript: invoke("seat:transcript"),
  seatMessage: invoke("seat:message"),
  designRig: invoke("rig:design"),
  assessTeam: invoke("rig:assess"),
  ports: invoke("ports:list"),
  openPreview: invoke("preview:open"),
  closePreview: invoke("preview:close"),
  notifyAttention: invoke("attention:notify"),
  notifySeatAttention: invoke("seat:notify-attention"),
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
  setWindowTitle: invoke("window:title"),
});
