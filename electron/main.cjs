const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, shell } = require("electron");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("path");
const { pathToFileURL } = require("node:url");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("disable-features", "MiddleClickAutoscroll");
  app.disableHardwareAcceleration();
}

const getAutosavePath = () => path.join(app.getPath("userData"), "autosave.icanvas.json");
const ATTACHMENTS_DIR_NAME = ".attachments";
const DEFAULT_WORKSPACE_DIR_NAME = "Infinite Canvas";
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".html", ".htm", ".json", ".txt", ".md", ".xml", ".one", ".onetoc2"]);
const DOCUMENT_SUFFIXES = [".icanvas.html", ".icanvas.json", ".onetoc2", ".html", ".htm", ".json", ".txt", ".md", ".xml", ".one"];
const RUNTIME_PORT = 19876;
let mainWindow = null;
let runtimeServer = null;
let runtimeState = {
  filePath: null,
  viewState: null,
  activePageIndex: 0,
  selectedNodeIds: [],
};
const runtimePending = new Map();

const ensureDefaultWorkspaceDir = async () => {
  const workspacePath = path.join(app.getPath("documents"), DEFAULT_WORKSPACE_DIR_NAME);
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
};

const ensureDocumentsDir = async () => {
  const rootPath = await ensureDefaultWorkspaceDir();
  const docsPath = path.join(rootPath, "Documents");
  await fs.mkdir(docsPath, { recursive: true });
  return docsPath;
};

const getDefaultDocumentPath = async (defaultFileName) =>
  path.join(await ensureDocumentsDir(), defaultFileName);

const getDialogStartPath = async (filePath) => {
  if (typeof filePath === "string" && filePath.length > 0) {
    return path.dirname(filePath);
  }

  return ensureDocumentsDir();
};

const isSupportedDocumentPath = (filePath) =>
  SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const isPathInside = (parentPath, candidatePath) => {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const validateEntryName = (name, label) => {
  const normalized = typeof name === "string" ? name.trim() : "";
  if (!normalized) {
    throw new Error(`${label}不能为空。`);
  }

  if (normalized === "." || normalized === ".." || /[\\/]/.test(normalized)) {
    throw new Error(`${label}不能包含路径分隔符。`);
  }

  return normalized;
};

const getWorkspacePath = async (candidatePath, options = {}) => {
  const rootPath = path.resolve(await ensureDefaultWorkspaceDir());
  const resolvedPath = candidatePath ? path.resolve(candidatePath) : rootPath;

  if (!isPathInside(rootPath, resolvedPath)) {
    throw new Error("只能操作工作目录内的项目。");
  }

  if (!options.allowRoot && resolvedPath === rootPath) {
    throw new Error("不能对工作区根目录执行此操作。");
  }

  return { rootPath, resolvedPath };
};

const getDocumentSuffix = (fileName) => {
  const lowerName = fileName.toLowerCase();
  const matchedSuffix = DOCUMENT_SUFFIXES.find((suffix) => lowerName.endsWith(suffix));
  if (matchedSuffix) {
    return fileName.slice(fileName.length - matchedSuffix.length);
  }

  return path.extname(fileName);
};

const getDocumentBaseName = (fileName) => {
  const suffix = getDocumentSuffix(fileName);
  return suffix ? fileName.slice(0, Math.max(0, fileName.length - suffix.length)) : fileName;
};

const readDocumentPayload = async (filePath) => {
  const bytes = await fs.readFile(filePath);

  return {
    filePath,
    fileName: path.basename(filePath),
    rawText: bytes.toString("utf8"),
    bytes: Array.from(bytes),
  };
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (chunks.length === 0) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      reject(error);
    }
  });
  request.on("error", reject);
});

const requestRuntimeRendererAction = (channel, payload) => new Promise((resolve, reject) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    reject(new Error("Infinite Canvas window is not available."));
    return;
  }

  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const timeout = setTimeout(() => {
    runtimePending.delete(requestId);
    reject(new Error("Runtime request timed out."));
  }, 15000);

  runtimePending.set(requestId, {
    resolve,
    reject,
    timeout,
  });
  mainWindow.webContents.send(channel, { requestId, ...payload });
});

const resolveRuntimeRequest = (result) => {
  const requestId = typeof result?.requestId === "string" ? result.requestId : "";
  const pending = runtimePending.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  runtimePending.delete(requestId);
  if (result.ok) {
    pending.resolve(result);
    return;
  }
  pending.reject(new Error(result.error || "Runtime request failed."));
};

const startRuntimeServer = () => {
  if (runtimeServer) {
    return;
  }

  runtimeServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, runtimeState);
        return;
      }

      if (request.method === "POST" && url.pathname === "/open") {
        const body = await readJsonBody(request);
        const filePath = typeof body.filePath === "string" ? body.filePath : "";
        if (!filePath) {
          sendJson(response, 400, { error: "filePath is required." });
          return;
        }
        const result = await requestRuntimeRendererAction("runtime:open-document", { filePath });
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/navigate") {
        const body = await readJsonBody(request);
        const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
        if (!nodeId) {
          sendJson(response, 400, { error: "nodeId is required." });
          return;
        }
        const result = await requestRuntimeRendererAction("runtime:navigate-to-node", { nodeId });
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  runtimeServer.listen(RUNTIME_PORT, "127.0.0.1", () => {
    console.log(`Infinite Canvas runtime server listening on http://127.0.0.1:${RUNTIME_PORT}`);
  });
  runtimeServer.on("error", (error) => {
    console.warn("Infinite Canvas runtime server failed", error);
    runtimeServer = null;
  });
};

const getPageCountFromDocumentData = (documentData) => {
  const explicitCount = Number(documentData?.appearance?.pages?.count);
  const nodePageCount = Array.isArray(documentData?.nodes)
    ? documentData.nodes.reduce((maxPageCount, node) => {
      const pageIndex = Number(node?.pageIndex);
      return Number.isFinite(pageIndex) ? Math.max(maxPageCount, Math.floor(pageIndex) + 1) : maxPageCount;
    }, 1)
    : 1;

  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return Math.max(1, Math.floor(explicitCount), nodePageCount);
  }

  return Math.max(1, nodePageCount);
};

const getPlainTextFromRichText = (content) => {
  if (!Array.isArray(content)) {
    return "";
  }

  const lines = [];

  for (const block of content) {
    if (block?.type === "paragraph" && Array.isArray(block.content)) {
      const text = block.content.map((inline) => {
        if (inline?.type === "text") {
          return typeof inline.text === "string" ? inline.text : "";
        }
        if (inline?.type === "break") {
          return "\n";
        }
        return "";
      }).join("").trim();

      if (text) {
        lines.push(text);
      }
      continue;
    }

    if (block?.type === "table" && Array.isArray(block.rows)) {
      for (const row of block.rows) {
        if (!Array.isArray(row?.cells)) {
          continue;
        }
        for (const cell of row.cells) {
          const text = getPlainTextFromRichText(cell?.content);
          if (text) {
            lines.push(text);
          }
        }
      }
    }
  }

  return lines.join("\n").trim();
};

const getPagesFromDocumentData = (documentData, fileName) => {
  const pageCount = getPageCountFromDocumentData(documentData);
  const explicitTitles = Array.isArray(documentData?.appearance?.pages?.titles)
    ? documentData.appearance.pages.titles
    : [];
  const textNodes = Array.isArray(documentData?.nodes)
    ? documentData.nodes.filter((node) => node?.type === "text")
    : [];

  return Array.from({ length: pageCount }, (_, index) => {
    const explicitTitle = typeof explicitTitles[index] === "string" ? explicitTitles[index].trim() : "";
    if (explicitTitle) {
      return { index, title: explicitTitle };
    }

    const firstTextNode = textNodes
      .filter((node) => Number(node?.pageIndex) === index)
      .sort((left, right) => {
        const byY = Number(left?.y ?? 0) - Number(right?.y ?? 0);
        if (byY !== 0) {
          return byY;
        }
        const byX = Number(left?.x ?? 0) - Number(right?.x ?? 0);
        if (byX !== 0) {
          return byX;
        }
        return Number(left?.z ?? 0) - Number(right?.z ?? 0);
      })[0];
    const firstLine = firstTextNode
      ? getPlainTextFromRichText(firstTextNode.content?.content)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      : "";

    return {
      index,
      title: firstLine || `${getDocumentBaseName(fileName)} · 第 ${index + 1} 页`,
    };
  });
};

const extractEmbeddedDocumentJson = (rawText) => {
  const match = rawText.match(/<script[^>]*id=(["'])icanvas-document\1[^>]*>([\s\S]*?)<\/script>/i);
  return match?.[2] ?? null;
};

const getDocumentJsonSource = (rawText) => {
  const normalized = rawText.trimStart();
  const lowerNormalized = normalized.toLowerCase();
  if (lowerNormalized.startsWith("<!doctype html") || lowerNormalized.startsWith("<html")) {
    return extractEmbeddedDocumentJson(rawText);
  }
  return normalized.startsWith("{") || normalized.startsWith("[") ? rawText : null;
};

const parseDocumentDataFromRawText = (rawText) => {
  const jsonSource = getDocumentJsonSource(rawText);
  if (!jsonSource) {
    return null;
  }
  const parsed = JSON.parse(jsonSource);
  return parsed && typeof parsed === "object" ? parsed : null;
};

const summarizeDocumentFile = async (rootPath, filePath) => {
  const fileName = path.basename(filePath);
  const relativePath = path.relative(rootPath, filePath);

  try {
    const rawText = await fs.readFile(filePath, "utf8");
    const parsed = parseDocumentDataFromRawText(rawText);

    if (parsed) {
      const pages = getPagesFromDocumentData(parsed, fileName);
      return {
        filePath,
        fileName,
        relativePath,
        pageCount: pages.length,
        pages,
        updatedAt: typeof parsed?.meta?.updatedAt === "string" ? parsed.meta.updatedAt : undefined,
      };
    }
  } catch (error) {
    console.warn("Failed to summarize document", filePath, error);
  }

  return {
    filePath,
    fileName,
    relativePath,
    pageCount: 1,
    pages: [{ index: 0, title: getDocumentBaseName(fileName) }],
  };
};

const listWorkspaceDocumentSummaries = async (rootPath, currentPath = rootPath) => {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.name !== ATTACHMENTS_DIR_NAME)
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    });

  const documents = [];

  for (const entry of visibleEntries) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      documents.push(...await listWorkspaceDocumentSummaries(rootPath, absolutePath));
      continue;
    }

    if (!entry.isFile() || !isSupportedDocumentPath(absolutePath)) {
      continue;
    }

    documents.push(await summarizeDocumentFile(rootPath, absolutePath));
  }

  return documents;
};

const listWorkspaceEntries = async (rootPath, currentPath = rootPath) => {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.name !== ATTACHMENTS_DIR_NAME)
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    });

  const children = [];

  for (const entry of visibleEntries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath);

    if (entry.isDirectory()) {
      children.push({
        type: "directory",
        name: entry.name,
        path: absolutePath,
        relativePath,
        children: await listWorkspaceEntries(rootPath, absolutePath),
      });
      continue;
    }

    if (!entry.isFile() || !isSupportedDocumentPath(absolutePath)) {
      continue;
    }

    children.push({
      type: "file",
      name: entry.name,
      path: absolutePath,
      relativePath,
    });
  }

  return children;
};

const getMimeTypeFromPath = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  const knownMimeTypes = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
  };

  return knownMimeTypes[extension] ?? "application/octet-stream";
};

const ensureUniqueAttachmentPath = async (targetPath) => {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  let nextPath = targetPath;
  let index = 1;

  while (true) {
    try {
      await fs.access(nextPath);
      nextPath = path.join(directory, `${baseName}-${index}${extension}`);
      index += 1;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return nextPath;
      }
      throw error;
    }
  }
};

const showContextMenu = (window, params) => {
  const template = [];

  if (params.isEditable) {
    template.push(
      { role: "undo", label: "撤销" },
      { role: "redo", label: "重做" },
      { type: "separator" },
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" },
    );
  } else if (params.selectionText?.trim()) {
    template.push(
      { role: "copy", label: "复制" },
      { role: "selectAll", label: "全选" },
    );
  }

  if (params.linkURL) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push({
      label: "复制链接地址",
      click: () => clipboard.writeText(params.linkURL),
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push({ role: "inspect", label: "检查元素" });
  }

  if (template.length === 0) {
    return;
  }

  Menu.buildFromTemplate(template).popup({ window });
};

const createMainWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    frame: false,
    backgroundColor: "#eef2f6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  window.webContents.on("context-menu", (_event, params) => {
    showContextMenu(window, params);
  });

  mainWindow = window;
  // Ctrl+Shift+I / Cmd+Shift+I to open DevTools
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i") {
      mainWindow?.webContents.toggleDevTools();
    }
  });
  mainWindow.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
};

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle("autosave:get", async () => {
    try {
      return await fs.readFile(getAutosavePath(), "utf8");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("autosave:save", async (_event, content) => {
    await fs.mkdir(path.dirname(getAutosavePath()), { recursive: true });
    await fs.writeFile(getAutosavePath(), String(content), "utf8");
  });

  ipcMain.handle("autosave:clear", async () => {
    try {
      await fs.unlink(getAutosavePath());
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:is-always-on-top", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop() ?? false);

  ipcMain.handle("window:toggle-always-on-top", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    const nextAlwaysOnTop = !window.isAlwaysOnTop();
    window.setAlwaysOnTop(nextAlwaysOnTop);
    return nextAlwaysOnTop;
  });

  ipcMain.handle("shell:open-external", async (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("runtime:update-state", async (_event, state = {}) => {
    runtimeState = {
      ...runtimeState,
      filePath: typeof state.filePath === "string" ? state.filePath : null,
      viewState: state.viewState && typeof state.viewState === "object" ? state.viewState : null,
      activePageIndex: Number.isFinite(Number(state.activePageIndex)) ? Number(state.activePageIndex) : 0,
      selectedNodeIds: Array.isArray(state.selectedNodeIds) ? state.selectedNodeIds.filter((id) => typeof id === "string") : [],
    };
  });

  ipcMain.handle("runtime:open-result", async (_event, result = {}) => {
    resolveRuntimeRequest(result);
  });

  ipcMain.handle("runtime:navigate-result", async (_event, result = {}) => {
    resolveRuntimeRequest(result);
  });

  ipcMain.handle("document:save", async (_event, options = {}) => {
    const content = String(options.content ?? "");
    const defaultFileName = String(options.defaultFileName ?? "document.icanvas.html");
    const forcePrompt = Boolean(options.forcePrompt);
    let targetPath = typeof options.filePath === "string" && options.filePath.length > 0
      ? options.filePath
      : null;

    if (!targetPath && !forcePrompt) {
      targetPath = await getDefaultDocumentPath(defaultFileName);
    }

    if (!targetPath || forcePrompt) {
      const result = await dialog.showSaveDialog({
        defaultPath: targetPath ?? await getDefaultDocumentPath(defaultFileName),
        filters: [
          { name: "Infinite Canvas", extensions: ["html"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      targetPath = result.filePath;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
    return targetPath;
  });

  ipcMain.handle("document:open", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: await ensureDocumentsDir(),
      properties: ["openFile"],
      filters: [
        { name: "Supported Documents", extensions: ["html", "htm", "json", "txt", "md", "xml", "one", "onetoc2"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return readDocumentPayload(result.filePaths[0]);
  });

  ipcMain.handle("document:open-at-path", async (_event, options = {}) => {
    const filePath = typeof options.filePath === "string" ? options.filePath : "";
    if (!filePath) {
      return null;
    }

    return readDocumentPayload(filePath);
  });

  ipcMain.handle("document:rename", async (_event, options = {}) => {
    const filePath = typeof options.filePath === "string" ? options.filePath : "";
    const nextBaseName = typeof options.baseName === "string" ? options.baseName.trim() : "";

    if (!filePath || !nextBaseName) {
      throw new Error("文件路径或新文件名无效。");
    }

    if (/[\\/]/.test(nextBaseName)) {
      throw new Error("文件名不能包含路径分隔符。");
    }

    const currentFileName = path.basename(filePath);
    const suffix = getDocumentSuffix(currentFileName);
    const currentBaseName = currentFileName.slice(0, Math.max(0, currentFileName.length - suffix.length));

    if (nextBaseName === currentBaseName) {
      return filePath;
    }

    const targetPath = path.join(path.dirname(filePath), `${nextBaseName}${suffix}`);
    await fs.rename(filePath, targetPath);
    return targetPath;
  });

  ipcMain.handle("document:move-to-directory", async (_event, options = {}) => {
    const filePath = typeof options.filePath === "string" ? options.filePath : "";
    const targetDirectoryPath = typeof options.targetDirectoryPath === "string" ? options.targetDirectoryPath : "";

    if (!filePath || !targetDirectoryPath) {
      throw new Error("文件路径或目标文件夹无效。");
    }

    const rootPath = path.resolve(await ensureDefaultWorkspaceDir());
    const resolvedFilePath = path.resolve(filePath);
    const resolvedTargetDirectoryPath = path.resolve(targetDirectoryPath);

    if (!isPathInside(rootPath, resolvedFilePath) || !isPathInside(rootPath, resolvedTargetDirectoryPath)) {
      throw new Error("只能移动工作目录内的文件。");
    }

    if (!isSupportedDocumentPath(resolvedFilePath)) {
      throw new Error("只能移动支持的文档文件。");
    }

    const [fileStats, targetDirectoryStats] = await Promise.all([
      fs.stat(resolvedFilePath),
      fs.stat(resolvedTargetDirectoryPath),
    ]);

    if (!fileStats.isFile() || !targetDirectoryStats.isDirectory()) {
      throw new Error("文件路径或目标文件夹无效。");
    }

    if (path.dirname(resolvedFilePath) === resolvedTargetDirectoryPath) {
      return resolvedFilePath;
    }

    const targetPath = path.join(resolvedTargetDirectoryPath, path.basename(resolvedFilePath));
    try {
      await fs.access(targetPath);
      throw new Error("目标文件夹已存在同名文件。");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.rename(resolvedFilePath, targetPath);
    return targetPath;
  });

  ipcMain.handle("document:delete", async (_event, options = {}) => {
    const filePath = typeof options.filePath === "string" ? options.filePath : "";
    if (!filePath) {
      throw new Error("文件路径无效。");
    }

    const { resolvedPath } = await getWorkspacePath(filePath);
    if (!isSupportedDocumentPath(resolvedPath)) {
      throw new Error("只能删除支持的文档文件。");
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      throw new Error("只能删除文件。");
    }

    await trashFile(resolvedPath);
  });

  ipcMain.handle("workspace:create-directory", async (_event, options = {}) => {
    const name = validateEntryName(options.name || "新建文件夹", "文件夹名");
    const parentDirectoryPath = typeof options.parentDirectoryPath === "string" && options.parentDirectoryPath.length > 0
      ? options.parentDirectoryPath
      : null;
    const { resolvedPath: parentPath } = await getWorkspacePath(parentDirectoryPath, { allowRoot: true });
    const stats = await fs.stat(parentPath);
    if (!stats.isDirectory()) {
      throw new Error("目标位置不是文件夹。");
    }

    let targetPath = path.join(parentPath, name);
    for (let index = 2; ; index += 1) {
      try {
        await fs.access(targetPath);
        targetPath = path.join(parentPath, `${name} ${index}`);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          break;
        }
        throw error;
      }
    }
    await fs.mkdir(targetPath);
    return targetPath;
  });

  ipcMain.handle("workspace:rename-directory", async (_event, options = {}) => {
    const directoryPath = typeof options.directoryPath === "string" ? options.directoryPath : "";
    const name = validateEntryName(options.name, "文件夹名");
    const { rootPath, resolvedPath } = await getWorkspacePath(directoryPath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("只能重命名文件夹。");
    }

    const targetPath = path.join(path.dirname(resolvedPath), name);
    if (!isPathInside(rootPath, targetPath)) {
      throw new Error("只能操作工作目录内的项目。");
    }

    await fs.rename(resolvedPath, targetPath);
    return targetPath;
  });

  ipcMain.handle("workspace:delete-directory", async (_event, options = {}) => {
    const directoryPath = typeof options.directoryPath === "string" ? options.directoryPath : "";
    const { resolvedPath } = await getWorkspacePath(directoryPath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("只能删除文件夹。");
    }

    await fs.rm(resolvedPath, { recursive: true, force: false });
  });

  ipcMain.handle("workspace:list", async () => {
    const rootPath = await ensureDocumentsDir();

    return {
      rootPath,
      entries: await listWorkspaceEntries(rootPath),
    };
  });

  ipcMain.handle("workspace:document-summaries", async () => {
    const rootPath = await ensureDocumentsDir();

    return {
      rootPath,
      documents: await listWorkspaceDocumentSummaries(rootPath),
    };
  });

  ipcMain.handle("attachment:pick-import", async (_event, options = {}) => {
    const documentPath = typeof options.documentPath === "string" && options.documentPath.length > 0
      ? options.documentPath
      : null;

    if (!documentPath) {
      throw new Error("导入附件前需要先保存文档到本地路径。");
    }

    const result = await dialog.showOpenDialog({
      defaultPath: await getDialogStartPath(documentPath),
      properties: ["openFile"],
      filters: [
        { name: "Supported Attachments", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "txt", "md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const sourcePath = result.filePaths[0];
    const attachmentsDir = path.join(path.dirname(documentPath), ATTACHMENTS_DIR_NAME);
    await fs.mkdir(attachmentsDir, { recursive: true });
    const targetPath = await ensureUniqueAttachmentPath(path.join(attachmentsDir, path.basename(sourcePath)));
    await fs.copyFile(sourcePath, targetPath);
    const stats = await fs.stat(targetPath);

    return {
      name: path.basename(targetPath),
      mimeType: getMimeTypeFromPath(targetPath),
      relativePath: path.relative(path.dirname(documentPath), targetPath),
      sizeBytes: stats.size,
      fileUrl: pathToFileURL(targetPath).href,
    };
  });

  ipcMain.handle("dev:save-html", async (_event, htmlContent) => {
    const tmpDir = app.getPath("temp");
    const filePath = path.join(tmpDir, "codex-page-html.html");
    await fs.writeFile(filePath, htmlContent, "utf8");
    // Also write to home dir for easier access
    const homePath = path.join(app.getPath("home"), "codex-page-html.html");
    await fs.writeFile(homePath, htmlContent, "utf8");
    return filePath + "\n" + homePath;
  });

  ipcMain.handle("attachment:resolve-url", async (_event, options = {}) => {
    const documentPath = typeof options.documentPath === "string" && options.documentPath.length > 0
      ? options.documentPath
      : null;
    const relativePath = typeof options.relativePath === "string" && options.relativePath.length > 0
      ? options.relativePath
      : null;

    if (!documentPath || !relativePath) {
      return null;
    }

    const targetPath = path.resolve(path.dirname(documentPath), relativePath);
    try {
      await fs.access(targetPath);
      return pathToFileURL(targetPath).href;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  });

  createMainWindow();
  startRuntimeServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (runtimeServer) {
    runtimeServer.close();
    runtimeServer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ─── Trash helpers ────────────────────────────────────────────────
const getTrashDir = async () => {
  const rootPath = await ensureDefaultWorkspaceDir();
  const trashPath = path.join(rootPath, "Trash");
  await fs.mkdir(trashPath, { recursive: true });
  return trashPath;
};

const trashFile = async (srcPath) => {
  const trashDir = await getTrashDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = path.basename(srcPath);
  const destName = `${timestamp}_${baseName}`;
  const destPath = path.join(trashDir, destName);
  await fs.cp(srcPath, destPath, { recursive: false });
  await fs.rm(srcPath, { force: true });
  return destPath;
};

ipcMain.handle("trash:list", async () => {
  const trashDir = await getTrashDir();
  const entries = await fs.readdir(trashDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(trashDir, entry.name);
    const stats = await fs.stat(filePath);
    files.push({
      name: entry.name,
      path: filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });
  }
  // Sort by mtime descending (newest first)
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
});

ipcMain.handle("trash:restore", async (_event, options = {}) => {
  const filePath = typeof options.filePath === "string" && options.filePath.length > 0 ? options.filePath : "";
  if (!filePath) throw new Error("文件路径无效。");

  const trashDir = await getTrashDir();
  if (!isPathInside(trashDir, filePath)) throw new Error("只能还原回收站中的文件。");

  const baseName = path.basename(filePath);
  // Strip timestamp prefix: "2026-05-06T12-34-56_originalname.icanvas.html"
  const originalName = baseName.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/, "");
  const docsDir = await ensureDocumentsDir();
  const targetPath = path.join(docsDir, originalName);

  await fs.cp(filePath, targetPath, { recursive: false });
  await fs.rm(filePath, { force: true });
  return { restoredPath: targetPath, originalName };
});

ipcMain.handle("trash:delete-all", async () => {
  const trashDir = await getTrashDir();
  await fs.rm(trashDir, { recursive: true, force: true });
  await fs.mkdir(trashDir, { recursive: true });
});

ipcMain.handle("trash:save-document", async (_event, options = {}) => {
  const content = typeof options.content === "string" ? options.content : "";
  const baseName = typeof options.baseName === "string" ? options.baseName : "untitled.icanvas.json";
  if (!content) throw new Error("内容无效。");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const trashDir = await getTrashDir();
  const destName = `${timestamp}_${baseName}`;
  const destPath = path.join(trashDir, destName);
  await fs.writeFile(destPath, content, "utf8");
  return destPath;
});

ipcMain.handle("document:list-external-nodes", async (_event, options = {}) => {
  const filePath = typeof options.filePath === "string" ? options.filePath : "";
  if (!filePath) {
    return [];
  }
  try {
    const payload = await readDocumentPayload(filePath);
    const parsed = parseDocumentDataFromRawText(payload.rawText);
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const summaries = nodes.flatMap((node) => {
      if (!node || typeof node !== "object") {
        return [];
      }
      const id = typeof node.id === "string" ? node.id : "";
      const type = typeof node.type === "string" ? node.type : "";
      const pageIndex = Number.isInteger(node.pageIndex) ? node.pageIndex : 0;
      return id && type ? [{ id, pageIndex, type }] : [];
    });
    return { filePath, fileName: path.basename(filePath), nodes: summaries };
  } catch {
    return null;
  }
});

ipcMain.handle("document:read-node-preview", async (_event, options = {}) => {
  const filePath = typeof options.filePath === "string" ? options.filePath : "";
  const nodeId = typeof options.nodeId === "string" ? options.nodeId : "";
  if (!filePath || !nodeId) {
    return null;
  }
  try {
    const payload = await readDocumentPayload(filePath);
    const parsed = parseDocumentDataFromRawText(payload.rawText);
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const node = nodes.find((candidate) => candidate && typeof candidate === "object" && candidate.id === nodeId);
    if (!node) return null;

    const type = typeof node.type === "string" ? node.type : "unknown";

    let title = nodeId;
    let preview = "";

    let content = undefined;
    let usedAssetIds = new Set();
    if (type === "text") {
      const blocks = Array.isArray(node.content?.content) ? node.content.content : [];
      content = blocks;
      const text = blocks
        .flatMap((block) => Array.isArray(block?.content) ? block.content : [])
        .filter((inline) => inline?.type === "text" && typeof inline.text === "string")
        .map((inline) => inline.text)
        .join("")
        .trim();
      if (text) {
        title = text.slice(0, 60);
        preview = text.slice(0, 200);
      }
    } else if (type === "shape" && node.label && Array.isArray(node.label.content)) {
      content = node.label.content;
      const text = content
        .flatMap((b) => Array.isArray(b?.content) ? b.content : [])
        .filter((inline) => inline?.type === "text" && typeof inline.text === "string")
        .map((inline) => inline.text)
        .join("")
        .trim();
      if (text) {
        title = text.slice(0, 60);
        preview = text.slice(0, 200);
      }
    } else if (type === "timeline") {
      const entries = Array.isArray(node.entries) ? node.entries : [];
      const category = entries.find((entry) => typeof entry?.category === "string")?.category;
      if (category) title = category;
    }

    // Collect used asset IDs from content blocks
    if (content && Array.isArray(content)) {
      content.forEach((block) => {
        if (Array.isArray(block?.content)) {
          block.content.forEach((inline) => {
            if (inline?.type === "image" && typeof inline.assetId === "string") {
              usedAssetIds.add(inline.assetId);
            }
          });
        }
      });
    }

    // Filter assets to only those needed
    let assets = undefined;
    if (usedAssetIds.size > 0 && parsed?.assets && typeof parsed.assets === "object") {
      assets = {};
      usedAssetIds.forEach((aid) => {
        if (parsed.assets[aid]) {
          assets[aid] = parsed.assets[aid];
        }
      });
    }

    return {
      pageIndex: Number.isInteger(node.pageIndex) ? node.pageIndex : 0,
      nodeId,
      type,
      title,
      preview,
      content,
      assets,
    };
  } catch {
    return null;
  }
});

ipcMain.handle("document:search-workspace", async (_event, options = {}) => {
  const query = typeof options.query === "string" ? options.query.trim() : "";
  const currentPath = typeof options.currentPath === "string" ? options.currentPath : "";
  if (!query) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const rootPath = await ensureDefaultWorkspaceDir();

  const collectTexts = (blocks) => {
    const texts = [];
    if (!Array.isArray(blocks)) return texts;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "paragraph" && Array.isArray(block.content)) {
        const text = block.content
          .map((inline) => inline?.type === "text" && typeof inline.text === "string" ? inline.text : "")
          .join("");
        if (text.trim()) texts.push(text);
      } else if (block.type === "table" && Array.isArray(block.rows)) {
        for (const row of block.rows) {
          if (!row || !Array.isArray(row.cells)) continue;
          for (const cell of row.cells) {
            if (cell && Array.isArray(cell.content)) {
              texts.push(...collectTexts(cell.content));
            }
          }
        }
      }
    }
    return texts;
  };

  const getAllDocs = async (dirPath, results) => {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await getAllDocs(fullPath, results);
      } else if (entry.isFile() && isSupportedDocumentPath(fullPath)) {
        try {
          const rawText = await fs.readFile(fullPath, "utf8");
          const parsed = parseDocumentDataFromRawText(rawText);
          if (!parsed) continue;
          results.push({
            filePath: fullPath,
            fileName: path.basename(fullPath),
            nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
          });
        } catch {
          // skip unreadable docs
        }
      }
    }
  };

  try {
    const docs = [];
    await getAllDocs(rootPath, docs);

    const output = [];
    const MAX_RESULTS = 100;

    for (const doc of docs) {
      for (const node of doc.nodes) {
        if (!node || typeof node !== "object") continue;
        const nodeId = typeof node.id === "string" ? node.id : "";
        const nodeType = typeof node.type === "string" ? node.type : "";
        const pageIndex = Number.isInteger(node.pageIndex) ? node.pageIndex : 0;
        if (!nodeId) continue;

        let texts = [];
        let title = nodeId;

        if (nodeType === "text" && node.content && Array.isArray(node.content.content)) {
          texts = collectTexts(node.content.content);
          if (texts.length > 0) title = texts[0].slice(0, 60);
        } else if (nodeType === "shape" && node.label && Array.isArray(node.label.content)) {
          texts = collectTexts(node.label.content);
          if (texts.length > 0) title = texts[0].slice(0, 60);
        } else if (nodeType === "timeline" && Array.isArray(node.entries)) {
          for (const entry of node.entries) {
            if (!entry || typeof entry !== "object") continue;
            if (typeof entry.title === "string") texts.push(entry.title);
            if (typeof entry.summary === "string") texts.push(entry.summary);
            if (typeof entry.category === "string") texts.push(entry.category);
            if (Array.isArray(entry.tags)) texts.push(...entry.tags.filter((t) => typeof t === "string"));
            if (typeof entry.authors === "string") texts.push(entry.authors);
          }
          title = node.entries.find((e) => typeof e?.category === "string")?.category || title;
        } else if (nodeType === "image") {
          texts = [nodeId];
        }

        // Search in texts
        for (const text of texts) {
          const lower = text.toLowerCase();
          let pos = 0;
          while (pos < lower.length) {
            const idx = lower.indexOf(lowerQuery, pos);
            if (idx === -1) break;
            const snippetStart = Math.max(0, idx - 30);
            const snippetEnd = Math.min(text.length, idx + query.length + 30);
            const snippet = (snippetStart > 0 ? "…" : "") +
              text.slice(snippetStart, snippetEnd) +
              (snippetEnd < text.length ? "…" : "");

            output.push({
              id: `${doc.filePath}-${nodeId}-${output.length}`,
              scope: "workspace",
              filePath: doc.filePath,
              fileName: doc.fileName,
              pageIndex,
              nodeId,
              nodeType,
              title,
              snippet,
              matchStart: idx,
              matchEnd: idx + query.length,
            });

            pos = idx + 1;
            if (output.length >= MAX_RESULTS) {
              return output;
            }
          }
        }
      }
    }

    return output;
  } catch {
    return [];
  }
});
