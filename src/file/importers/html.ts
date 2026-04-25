import { createAssetId, createDefaultDocumentAppearance, createDefaultPageBounds, createDocumentId, createImageNode } from "../../model/defaults";
import type { DocumentFile } from "../../model/types";

const nowIso = () => new Date().toISOString();

const createPreviewHtml = (rawHtml: string) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(rawHtml, "text/html");
  const title = parsed.title.trim();
  const headInnerHtml = parsed.head.innerHTML;
  const bodyInnerHtml = parsed.body.innerHTML;

  return {
    title,
    html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${headInnerHtml}
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: white;
      }
    </style>
  </head>
  <body>
    ${bodyInnerHtml}
  </body>
</html>`,
  };
};

export const importHtmlDocument = (rawHtml: string, fileName = "import.html"): DocumentFile => {
  const timestamp = nowIso();
  const preview = createPreviewHtml(rawHtml);
  const assetId = createAssetId();
  const previewWidth = 960;
  const previewHeight = 720;
  const previewNode = {
    ...createImageNode(48, 48, assetId, previewWidth, previewHeight),
    style: {
      kind: "html-preview",
    },
  };

  return {
    format: "icanvas",
    version: 2,
    meta: {
      id: createDocumentId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(preview.title ? { title: preview.title } : {}),
      source: {
        kind: "html",
        fileName,
      },
    },
    nodes: [previewNode],
    assets: {
      [assetId]: {
        id: assetId,
        type: "html",
        mimeType: "text/html",
        name: preview.title || fileName,
        data: preview.html,
      },
    },
    pageBounds: createDefaultPageBounds(),
    viewState: {
      cameraX: 0,
      cameraY: 0,
      zoom: 1,
    },
    appearance: createDefaultDocumentAppearance(),
  };
};
