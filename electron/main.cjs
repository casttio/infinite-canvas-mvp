const { app, BrowserWindow, Menu, ipcMain, dialog, clipboard } = require("electron");
const fs = require("node:fs/promises");
const path = require("path");
const { pathToFileURL } = require("node:url");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("in-process-gpu");
  app.disableHardwareAcceleration();
}

const getAutosavePath = () => path.join(app.getPath("userData"), "autosave.icanvas.json");
const ATTACHMENTS_DIR_NAME = ".attachments";
const DEFAULT_WORKSPACE_DIR_NAME = "Infinite Canvas";
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".html", ".htm", ".json", ".txt", ".md", ".xml", ".one", ".onetoc2"]);
const DOCUMENT_SUFFIXES = [".icanvas.html", ".icanvas.json", ".onetoc2", ".html", ".htm", ".json", ".txt", ".md", ".xml", ".one"];

const ensureDefaultWorkspaceDir = async () => {
  const workspacePath = path.join(app.getPath("documents"), DEFAULT_WORKSPACE_DIR_NAME);
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
};

const getDefaultDocumentPath = async (defaultFileName) =>
  path.join(await ensureDefaultWorkspaceDir(), defaultFileName);

const getDialogStartPath = async (filePath) => {
  if (typeof filePath === "string" && filePath.length > 0) {
    return path.dirname(filePath);
  }

  return ensureDefaultWorkspaceDir();
};

const isSupportedDocumentPath = (filePath) =>
  SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());

const getDocumentSuffix = (fileName) => {
  const lowerName = fileName.toLowerCase();
  const matchedSuffix = DOCUMENT_SUFFIXES.find((suffix) => lowerName.endsWith(suffix));
  if (matchedSuffix) {
    return fileName.slice(fileName.length - matchedSuffix.length);
  }

  return path.extname(fileName);
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
      defaultPath: await ensureDefaultWorkspaceDir(),
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

  ipcMain.handle("workspace:list", async () => {
    const rootPath = await ensureDefaultWorkspaceDir();

    return {
      rootPath,
      entries: await listWorkspaceEntries(rootPath),
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
