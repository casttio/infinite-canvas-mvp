import { parseDocument } from "./parse";
import type { DocumentFile } from "../model/types";

interface RawDocumentInput {
  fileName?: string;
  rawText: string;
  bytes?: Uint8Array;
}

export const loadDocumentFromRaw = ({ fileName, rawText, bytes }: RawDocumentInput): DocumentFile =>
  parseDocument({
    fileName,
    rawText,
    bytes,
  });

export const loadDocumentFromFile = async (file: File): Promise<DocumentFile> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await file.text();
  return loadDocumentFromRaw({
    fileName: file.name,
    rawText: text,
    bytes,
  });
};
