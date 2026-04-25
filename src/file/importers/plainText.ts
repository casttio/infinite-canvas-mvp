import { createDefaultDocumentAppearance, createDefaultPageBounds, createDocumentId, createNodeId } from "../../model/defaults";
import type { DocumentFile, RichTextDoc } from "../../model/types";

const nowIso = () => new Date().toISOString();

const plainTextToRichTextDoc = (text: string): RichTextDoc => {
  const normalizedText = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalizedText.split("\n");

  return {
    type: "doc",
    content: (lines.length > 0 ? lines : [""]).map((line) => ({
      type: "paragraph" as const,
      content: line.length > 0 ? [{ type: "text" as const, text: line }] : [{ type: "break" as const }],
    })),
  };
};

export const importPlainTextDocument = (rawText: string, fileName = "import.txt"): DocumentFile => {
  const timestamp = nowIso();

  return {
    format: "icanvas",
    version: 2,
    meta: {
        id: createDocumentId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        kind: "plain-text",
        fileName,
      },
    },
    nodes: [
      {
        id: createNodeId("text"),
        type: "text",
        pageIndex: 0,
        x: 48,
        y: 48,
        w: 560,
        h: 320,
        z: 1,
        content: plainTextToRichTextDoc(rawText),
        style: {
          fontSize: 16,
        },
      },
    ],
    assets: {},
    pageBounds: createDefaultPageBounds(),
    viewState: {
      cameraX: 0,
      cameraY: 0,
      zoom: 1,
    },
    appearance: createDefaultDocumentAppearance(),
  };
};
