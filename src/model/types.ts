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

export interface PageBounds extends UnknownFields {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RichTextTextLeaf extends UnknownFields {
  type: "text";
  text: string;
  marks?: Array<"bold" | "italic">;
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
  type: "text" | "image";
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

export type CanvasNode = TextNode | ImageNode;

export interface Asset extends UnknownFields {
  id: string;
  type: "image";
  mimeType: string;
  name: string;
  data: string;
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
}
