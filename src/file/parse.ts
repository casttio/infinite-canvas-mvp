import type { DocumentFile } from "../model/types";
import { parseCanvasDocument } from "./importers/canvas";
import { importHtmlDocument } from "./importers/html";
import { importOneNoteXmlDocument } from "./importers/onenoteXml";
import { importPlainTextDocument } from "./importers/plainText";

const ONE_NOTE_MAGIC = [0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3];

const startsWithOneNoteMagic = (buffer: Uint8Array) =>
  ONE_NOTE_MAGIC.every((value, index) => buffer[index] === value);

const likelyHtml = (rawText: string) => {
  const normalized = rawText.trimStart().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
};

const likelyXml = (rawText: string) => {
  const normalized = rawText.trimStart();
  return normalized.startsWith("<?xml") || normalized.startsWith("<NotebookSection") || normalized.startsWith("<NotebookToc2");
};

const looksLikeCanvasSource = (rawText: string) => {
  const normalized = rawText.trimStart();
  return normalized.startsWith("{")
    || normalized.startsWith("[")
    || rawText.includes('id="icanvas-document"')
    || rawText.includes("id='icanvas-document'");
};

interface ParseInput {
  fileName?: string;
  rawText: string;
  bytes?: Uint8Array;
}

export const parseDocument = ({ fileName, rawText, bytes }: ParseInput): DocumentFile => {
  const lowerName = fileName?.toLowerCase();

  if ((lowerName?.endsWith(".one") || lowerName?.endsWith(".onetoc2")) && bytes && startsWithOneNoteMagic(bytes)) {
    throw new Error("暂不支持直接打开 .one 二进制文件。请先用 onenote2xml 导出为 XML，再导入这里。");
  }

  if (looksLikeCanvasSource(rawText)) {
    return parseCanvasDocument(rawText);
  }

  if (likelyXml(rawText)) {
    return importOneNoteXmlDocument(rawText, fileName);
  }

  if (likelyHtml(rawText)) {
    return importHtmlDocument(rawText, fileName);
  }

  return importPlainTextDocument(rawText, fileName);
};
