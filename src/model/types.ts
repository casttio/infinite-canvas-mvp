export type UnknownFields = Record<string, unknown>;

export interface DocumentMeta extends UnknownFields {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ViewState extends UnknownFields {
  cameraX: number;
  cameraY: number;
  zoom: number;
}

export interface DocumentGridAppearance extends UnknownFields {
  enabled: boolean;
  color: string;
  size: number;
}

export interface DocumentPagesAppearance extends UnknownFields {
  count: number;
  height: number;
  gap: number;
  titles?: string[];
}

export interface DocumentAppearance extends UnknownFields {
  pageBackground: string;
  grid: DocumentGridAppearance;
  pages: DocumentPagesAppearance;
}

export interface PageBounds extends UnknownFields {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RichTextTextLeaf extends UnknownFields {
  type: "text";
  text: string;
  marks?: Array<"bold" | "italic" | "underline" | "strike">;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  highlightColor?: string;
}

export interface RichTextBreakLeaf extends UnknownFields {
  type: "break";
}

export interface RichTextImageLeaf extends UnknownFields {
  type: "image";
  assetId: string;
  w?: number;
  h?: number;
}

export type RichTextInline = RichTextTextLeaf | RichTextBreakLeaf | RichTextImageLeaf;

export interface RichTextParagraph extends UnknownFields {
  type: "paragraph";
  content: RichTextInline[];
}

export interface RichTextTableCell extends UnknownFields {
  type: "tableCell";
  content: RichTextBlock[];
}

export interface RichTextTableRow extends UnknownFields {
  type: "tableRow";
  cells: RichTextTableCell[];
}

export interface RichTextTable extends UnknownFields {
  type: "table";
  w?: number;
  colWidths?: number[];
  rows: RichTextTableRow[];
}

export type RichTextBlock = RichTextParagraph | RichTextTable;

export interface RichTextDoc extends UnknownFields {
  type: "doc";
  content: RichTextBlock[];
}

export interface BaseNode extends UnknownFields {
  id: string;
  type: "text" | "image" | "shape";
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  style: Record<string, unknown>;
}

export interface TextNode extends BaseNode {
  type: "text";
  content: RichTextDoc;
}

export interface ImageNode extends BaseNode {
  type: "image";
  assetId: string;
}

export interface ShapeNode extends BaseNode {
  type: "shape";
  shapeType: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius?: number;
  label?: RichTextDoc;
}

export type ConnectorAnchor = "top" | "bottom" | "left" | "right" | "center";
export type ConnectorMarker = "none" | "arrow" | "circle";
export type ConnectorLineStyle = "solid" | "dashed" | "dotted";

export interface ConnectorNode extends UnknownFields {
  id: string;
  type: "connector";
  pageIndex: number;
  z: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startNodeId?: string;
  startAnchor?: ConnectorAnchor;
  endNodeId?: string;
  endAnchor?: ConnectorAnchor;
  stroke: string;
  strokeWidth: number;
  lineStyle: ConnectorLineStyle;
  endMarker: ConnectorMarker;
  startMarker: ConnectorMarker;
  label?: string;
  style: Record<string, unknown>;
}

export type BoxCanvasNode = TextNode | ImageNode | ShapeNode;
export type CanvasNode = BoxCanvasNode | ConnectorNode;

export interface Asset extends UnknownFields {
  id: string;
  type: "image" | "html" | "pdf" | "file";
  storage?: "embedded" | "managed";
  mimeType: string;
  name: string;
  data?: string;
  relativePath?: string;
  sizeBytes?: number;
}

export type AssetMap = Record<string, Asset>;

export interface DocumentFile extends UnknownFields {
  format: "icanvas";
  version: 2;
  meta: DocumentMeta;
  nodes: CanvasNode[];
  assets: AssetMap;
  pageBounds: PageBounds;
  viewState: ViewState;
  appearance: DocumentAppearance;
}
