const { contextBridge, ipcRenderer } = require("electron");

const runtimeListeners = new Map();

ipcRenderer.on("runtime:open-document", (_event, request) => {
  runtimeListeners.get("open-document")?.(request);
});

ipcRenderer.on("runtime:navigate-to-node", (_event, request) => {
  runtimeListeners.get("navigate-to-node")?.(request);
});

contextBridge.exposeInMainWorld("electronApp", {
  getAutosaveDocument: () => ipcRenderer.invoke("autosave:get"),
  saveAutosaveDocument: (content) => ipcRenderer.invoke("autosave:save", content),
  clearAutosaveDocument: () => ipcRenderer.invoke("autosave:clear"),
  openDocumentFromPath: () => ipcRenderer.invoke("document:open"),
  openDocumentAtPath: (options) => ipcRenderer.invoke("document:open-at-path", options),
  renameDocumentAtPath: (options) => ipcRenderer.invoke("document:rename", options),
  moveDocumentToDirectory: (options) => ipcRenderer.invoke("document:move-to-directory", options),
  deleteDocumentAtPath: (options) => ipcRenderer.invoke("document:delete", options),
  saveDocumentToPath: (options) => ipcRenderer.invoke("document:save", options),
  createWorkspaceDirectory: (options) => ipcRenderer.invoke("workspace:create-directory", options),
  renameWorkspaceDirectory: (options) => ipcRenderer.invoke("workspace:rename-directory", options),
  deleteWorkspaceDirectory: (options) => ipcRenderer.invoke("workspace:delete-directory", options),
  listWorkspaceEntries: () => ipcRenderer.invoke("workspace:list"),
  listWorkspaceDocumentSummaries: () => ipcRenderer.invoke("workspace:document-summaries"),
  listExternalDocumentNodes: (options) => ipcRenderer.invoke("document:list-external-nodes", options),
  readExternalNodePreview: (options) => ipcRenderer.invoke("document:read-node-preview", options),
  searchWorkspace: (options) => ipcRenderer.invoke("document:search-workspace", options),
  listTrashEntries: () => ipcRenderer.invoke("trash:list"),
  restoreTrashEntry: (options) => ipcRenderer.invoke("trash:restore", options),
  emptyTrash: () => ipcRenderer.invoke("trash:delete-all"),
  saveDocumentToTrash: (options) => ipcRenderer.invoke("trash:save-document", options),
  pickAndImportAttachment: (options) => ipcRenderer.invoke("attachment:pick-import", options),
  resolveAttachmentUrl: (options) => ipcRenderer.invoke("attachment:resolve-url", options),
  updateRuntimeState: (state) => ipcRenderer.invoke("runtime:update-state", state),
  runtimeOpenResult: (result) => ipcRenderer.invoke("runtime:open-result", result),
  runtimeNavigateResult: (result) => ipcRenderer.invoke("runtime:navigate-result", result),
  onRuntimeOpenDocument: (callback) => {
    runtimeListeners.set("open-document", callback);
    return () => runtimeListeners.delete("open-document");
  },
  onRuntimeNavigateToNode: (callback) => {
    runtimeListeners.set("navigate-to-node", callback);
    return () => runtimeListeners.delete("navigate-to-node");
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  dumpPageHtml: () => {
    const html = document.documentElement.outerHTML;
    console.log('[Codex Debug] Sending HTML to main process, length:', html.length);
    return ipcRenderer.invoke("dev:save-html", html);
  },
  isWindowAlwaysOnTop: () => ipcRenderer.invoke("window:is-always-on-top"),
  toggleWindowAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-always-on-top"),
});
