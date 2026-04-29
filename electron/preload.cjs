const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronApp", {
  getAutosaveDocument: () => ipcRenderer.invoke("autosave:get"),
  saveAutosaveDocument: (content) => ipcRenderer.invoke("autosave:save", content),
  clearAutosaveDocument: () => ipcRenderer.invoke("autosave:clear"),
  openDocumentFromPath: () => ipcRenderer.invoke("document:open"),
  openDocumentAtPath: (options) => ipcRenderer.invoke("document:open-at-path", options),
  renameDocumentAtPath: (options) => ipcRenderer.invoke("document:rename", options),
  moveDocumentToDirectory: (options) => ipcRenderer.invoke("document:move-to-directory", options),
  saveDocumentToPath: (options) => ipcRenderer.invoke("document:save", options),
  listWorkspaceEntries: () => ipcRenderer.invoke("workspace:list"),
  listWorkspaceDocumentSummaries: () => ipcRenderer.invoke("workspace:document-summaries"),
  pickAndImportAttachment: (options) => ipcRenderer.invoke("attachment:pick-import", options),
  resolveAttachmentUrl: (options) => ipcRenderer.invoke("attachment:resolve-url", options),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowAlwaysOnTop: () => ipcRenderer.invoke("window:is-always-on-top"),
  toggleWindowAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-always-on-top"),
});
