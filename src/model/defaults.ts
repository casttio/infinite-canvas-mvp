import type {
  CanvasNode,
  DocumentAppearance,
  DocumentFile,
  ImageNode,
  PageBounds,
  RichTextDoc,
  TextNode,
} from "./types";

const nowIso = () => new Date().toISOString();

const randomId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
};

export const createDocumentId = () => randomId("doc");
export const createNodeId = (type: "text" | "image") => randomId(`node_${type}`);
export const createAssetId = () => randomId("asset");

export const createDefaultRichTextDoc = (text = "双击编辑文本"): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text }],
    },
  ],
});

export const createDefaultPageBounds = (): PageBounds => ({
  x: 0,
  y: 0,
  w: 1600,
  h: 1200,
});

export const createDefaultDocumentAppearance = (): DocumentAppearance => ({
  pageBackground: "#ffffff",
  grid: {
    enabled: false,
    color: "rgba(15, 23, 42, 0.08)",
    size: 24,
  },
  pages: {
    count: 1,
    height: 1200,
    gap: 72,
    titles: [],
  },
});

export const derivePageBoundsFromNodes = (
  nodes: Array<Pick<CanvasNode, "x" | "y" | "w" | "h">>,
  margin = 240,
): PageBounds => {
  const fallback = createDefaultPageBounds();

  if (nodes.length === 0) {
    return fallback;
  }

  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    maxX = Math.max(maxX, node.x + node.w + margin);
    maxY = Math.max(maxY, node.y + node.h + margin);
  });

  if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return fallback;
  }

  return {
    ...fallback,
    w: Math.max(fallback.w, maxX - fallback.x),
    h: Math.max(fallback.h, maxY - fallback.y),
  };
};

export const fitPageBoundsToNodes = (
  nodes: Array<Pick<CanvasNode, "x" | "y" | "w" | "h">>,
  margin = 240,
): PageBounds => {
  return derivePageBoundsFromNodes(nodes, margin);
};

export const createEmptyDocument = (): DocumentFile => {
  const timestamp = nowIso();

  return {
    format: "icanvas",
    version: 2,
    meta: {
      id: createDocumentId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    nodes: [],
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

export const createTextNode = (x: number, y: number): TextNode => ({
  id: createNodeId("text"),
  type: "text",
  pageIndex: 0,
  x,
  y,
  w: 320,
  h: 180,
  z: 1,
  content: createDefaultRichTextDoc(),
  style: {
    fontSize: 16,
  },
});

export const createImageNode = (
  x: number,
  y: number,
  assetId: string,
  width: number,
  height: number,
): ImageNode => ({
  id: createNodeId("image"),
  type: "image",
  pageIndex: 0,
  x,
  y,
  w: width,
  h: height,
  z: 1,
  assetId,
  style: {},
});

export const touchDocument = (document: DocumentFile): DocumentFile => ({
  ...document,
  meta: {
    ...document.meta,
    updatedAt: nowIso(),
  },
});
