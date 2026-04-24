import { createDefaultPageBounds, createDocumentId, createNodeId } from "../../model/defaults";
import type { DocumentFile, RichTextDoc } from "../../model/types";

const nowIso = () => new Date().toISOString();

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const htmlToRichTextDoc = (rawHtml: string): RichTextDoc => {
  const parser = new DOMParser();
  const html = parser.parseFromString(rawHtml, "text/html");
  const blocks = Array.from(html.body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre"));

  const paragraphs = (blocks.length > 0 ? blocks : [html.body]).map((element) => {
    const text = normalizeWhitespace(element.textContent ?? "");
    return {
      type: "paragraph" as const,
      content: text.length > 0 ? [{ type: "text" as const, text }] : [{ type: "break" as const }],
    };
  });

  return {
    type: "doc",
    content: paragraphs,
  };
};

export const importHtmlDocument = (rawHtml: string, fileName = "import.html"): DocumentFile => {
  const timestamp = nowIso();

  return {
    format: "icanvas",
    version: 2,
    meta: {
      id: createDocumentId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        kind: "html",
        fileName,
      },
    },
    nodes: [
      {
        id: createNodeId("text"),
        type: "text",
        x: 48,
        y: 48,
        w: 640,
        h: 360,
        z: 1,
        content: htmlToRichTextDoc(rawHtml),
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
  };
};
