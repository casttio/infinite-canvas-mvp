import { serializeDocument } from "./serialize";
import type { DocumentFile } from "../model/types";

export const saveDocumentToDisk = (document: DocumentFile, fileName?: string) => {
  const blob = new Blob([serializeDocument(document)], {
    type: "text/html",
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName ?? `${document.meta.id}.icanvas.html`;
  anchor.click();
  URL.revokeObjectURL(url);
};
