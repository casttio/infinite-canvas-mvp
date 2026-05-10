import { migrateDocument } from "../../model/migrate";
import { parseDocumentSchema } from "../../model/schema";
import type { DocumentFile } from "../../model/types";

const extractEmbeddedDocumentJson = (rawText: string) => {
  const normalized = rawText.trimStart().toLowerCase();
  if (!normalized.startsWith("<!doctype html") && !normalized.startsWith("<html")) {
    return rawText;
  }

  const parser = new DOMParser();
  const html = parser.parseFromString(rawText, "text/html");
  const embedded = html.querySelector("#icanvas-document");
  const json = embedded?.textContent;

  if (!json) {
    throw new Error("HTML 文件里没有找到画布数据。");
  }

  return json;
};

export const parseCanvasDocument = (rawText: string): DocumentFile => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractEmbeddedDocumentJson(rawText));
  } catch {
    throw new Error("文件不是合法画布文件。");
  }

  const migrated = migrateDocument(parsed);
  return parseDocumentSchema(migrated);
};
