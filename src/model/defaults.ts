import type {
  CanvasNode,
  ConnectorLineStyle,
  ConnectorMarker,
  ConnectorNode,
  DocumentAppearance,
  DocumentFile,
  ImageNode,
  PageBounds,
  RichTextDoc,
  ShapeNode,
  TextNode,
  TimelineNode,
} from "./types";

const nowIso = () => new Date().toISOString();

const randomId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
};

export const createDocumentId = () => randomId("doc");
export const createNodeId = (type: "text" | "image" | "shape" | "connector" | "timeline") => randomId(`node_${type}`);
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
  nodes: Array<CanvasNode | { x: number; y: number; w: number; h: number }>,
  margin = 240,
): PageBounds => {
  const fallback = createDefaultPageBounds();

  if (nodes.length === 0) {
    return fallback;
  }

  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    if ("type" in node && node.type === "connector") {
      maxX = Math.max(maxX, node.x1 + margin, node.x2 + margin);
      maxY = Math.max(maxY, node.y1 + margin, node.y2 + margin);
      return;
    }

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
  nodes: CanvasNode[],
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

export const createTimelineNode = (x: number, y: number, entries?: TimelineNode["entries"]): TimelineNode => ({
  id: createNodeId("timeline"),
  type: "timeline",
  pageIndex: 0,
  x,
  y,
  w: 320,
  h: 400,
  z: 1,
  entries: entries ?? [],
  style: {},
});

export const createShapeNode = (
  x: number,
  y: number,
  shapeType: ShapeNode["shapeType"] = "rect",
): ShapeNode => ({
  id: createNodeId("shape"),
  type: "shape",
  pageIndex: 0,
  x,
  y,
  w: 240,
  h: 160,
  z: 1,
  shapeType,
  fill: shapeType === "ellipse" ? "#fef3c7" : "#dbeafe",
  stroke: "#1d4ed8",
  strokeWidth: 2,
  borderRadius: shapeType === "rect" ? 12 : undefined,
  style: {},
});

export const createConnectorNode = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: Partial<Pick<
    ConnectorNode,
    "startNodeId" | "startAnchor" | "endNodeId" | "endAnchor" | "pageIndex" | "stroke" | "strokeWidth" | "lineStyle" | "startMarker" | "endMarker" | "label"
  >> = {},
): ConnectorNode => ({
  id: createNodeId("connector"),
  type: "connector",
  pageIndex: options.pageIndex ?? 0,
  z: 1,
  x1,
  y1,
  x2,
  y2,
  ...(options.startNodeId ? { startNodeId: options.startNodeId } : {}),
  ...(options.startAnchor ? { startAnchor: options.startAnchor } : {}),
  ...(options.endNodeId ? { endNodeId: options.endNodeId } : {}),
  ...(options.endAnchor ? { endAnchor: options.endAnchor } : {}),
  stroke: options.stroke ?? "#2563eb",
  strokeWidth: options.strokeWidth ?? 2,
  lineStyle: (options.lineStyle ?? "solid") as ConnectorLineStyle,
  startMarker: (options.startMarker ?? "none") as ConnectorMarker,
  endMarker: (options.endMarker ?? "arrow") as ConnectorMarker,
  ...(options.label ? { label: options.label } : {}),
  style: {},
});

export const touchDocument = (document: DocumentFile): DocumentFile => ({
  ...document,
  meta: {
    ...document.meta,
    updatedAt: nowIso(),
  },
});
