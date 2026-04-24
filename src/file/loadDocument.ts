import { parseDocument } from "./parse";
import type { DocumentFile } from "../model/types";

export const loadDocumentFromFile = async (file: File): Promise<DocumentFile> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await file.text();
  return parseDocument({
    fileName: file.name,
    rawText: text,
    bytes,
  });
};
