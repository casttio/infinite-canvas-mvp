import { serializeDocument } from "./serialize";
import { saveToFileHandle } from "./fileHandle";
import type { DocumentFile } from "../model/types";

interface SaveDocumentOptions {
  fileName?: string;
  filePath?: string | null;
  fileHandle?: FileSystemFileHandle | null;
  forcePrompt?: boolean;
}

export const saveDocumentToDisk = async (
  document: DocumentFile,
  options: SaveDocumentOptions = {},
): Promise<string | FileSystemFileHandle | null> => {
  const content = serializeDocument(document);
  const fileName = options.fileName ?? `${document.meta.id}.icanvas.html`;

  if (window.electronApp?.saveDocumentToPath) {
    return window.electronApp.saveDocumentToPath({
      content,
      defaultFileName: fileName,
      filePath: options.filePath,
      forcePrompt: options.forcePrompt,
    });
  }

  return saveToFileHandle(content, options.forcePrompt ? null : options.fileHandle, fileName);
};
