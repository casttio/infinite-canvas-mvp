const HTML_FILE_PICKER_TYPES = [
  {
    description: "Infinite Canvas",
    accept: {
      "text/html": [".html", ".htm", ".icanvas.html"],
      "application/json": [".json", ".icanvas.json"],
      "text/plain": [".txt", ".md"],
      "application/xml": [".xml", ".one", ".onetoc2"],
    },
  },
];

let activeFileHandle: FileSystemFileHandle | null = null;

const ensureFileSystemAccess = (methodName: "showOpenFilePicker" | "showSaveFilePicker") => {
  const supported = methodName === "showOpenFilePicker"
    ? typeof window.showOpenFilePicker === "function"
    : typeof window.showSaveFilePicker === "function";

  if (!supported) {
    throw new Error("当前浏览器不支持直接读写本地文件，请使用 Chrome 或 Edge。");
  }
};

export const openFileWithPicker = async (): Promise<{
  file: File;
  handle: FileSystemFileHandle;
} | null> => {
  ensureFileSystemAccess("showOpenFilePicker");
  const showOpenFilePicker = window.showOpenFilePicker!;

  try {
    const [handle] = await showOpenFilePicker({
      multiple: false,
      types: HTML_FILE_PICKER_TYPES,
    });
    const file = await handle.getFile();
    activeFileHandle = handle;
    return { file, handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }

    throw error;
  }
};

export const saveToFileHandle = async (
  content: string,
  handle?: FileSystemFileHandle | null,
  suggestedName = "document.icanvas.html",
) => {
  const target = handle ?? activeFileHandle;

  try {
    if (target) {
      const writable = await target.createWritable();
      await writable.write(content);
      await writable.close();
      activeFileHandle = target;
      return target;
    }

    ensureFileSystemAccess("showSaveFilePicker");
    const showSaveFilePicker = window.showSaveFilePicker!;
    const newHandle = await showSaveFilePicker({
      suggestedName,
      types: HTML_FILE_PICKER_TYPES,
    });
    const writable = await newHandle.createWritable();
    await writable.write(content);
    await writable.close();
    activeFileHandle = newHandle;
    return newHandle;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }

    throw error;
  }
};

export const getActiveFileHandle = () => activeFileHandle;

export const setActiveFileHandle = (handle: FileSystemFileHandle | null) => {
  activeFileHandle = handle;
};
