import { z } from "zod";
import type {
  DocumentFile,
  RichTextBlock,
  RichTextTable,
  RichTextTableCell,
  RichTextTableRow,
} from "./types";

const unknownRecord = z.record(z.string(), z.unknown());

const richTextInlineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    marks: z.array(z.enum(["bold", "italic", "underline", "strike"])).optional(),
    fontFamily: z.string().min(1).optional(),
    fontSize: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    highlightColor: z.string().min(1).optional(),
  }).catchall(z.unknown()),
  z.object({
    type: z.literal("break"),
  }).catchall(z.unknown()),
  z.object({
    type: z.literal("image"),
    assetId: z.string(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
  }).catchall(z.unknown()),
]);

const richTextParagraphSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(richTextInlineSchema),
}).catchall(z.unknown());

const richTextBlockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.union([richTextParagraphSchema, richTextTableSchema]) as unknown as z.ZodType<RichTextBlock>,
);

const richTextTableCellSchema: z.ZodType<RichTextTableCell> = z.lazy(() =>
  z.object({
    type: z.literal("tableCell"),
    content: z.array(richTextBlockSchema),
  }).catchall(z.unknown()),
);

const richTextTableRowSchema: z.ZodType<RichTextTableRow> = z.lazy(() =>
  z.object({
    type: z.literal("tableRow"),
    cells: z.array(richTextTableCellSchema).min(1),
  }).catchall(z.unknown()),
);

const richTextTableSchema: z.ZodType<RichTextTable> = z.lazy(() =>
  z.object({
    type: z.literal("table"),
    w: z.number().positive().optional(),
    colWidths: z.array(z.number().positive()).optional(),
    rows: z.array(richTextTableRowSchema).min(1),
  }).catchall(z.unknown()),
);

const richTextDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(richTextBlockSchema),
}).catchall(z.unknown());

const baseNodeSchema = z.object({
  id: z.string(),
  pageIndex: z.number().int().nonnegative().optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  z: z.number(),
  style: unknownRecord,
});

const textNodeSchema = baseNodeSchema.extend({
  type: z.literal("text"),
  content: richTextDocSchema,
}).catchall(z.unknown());

const imageNodeSchema = baseNodeSchema.extend({
  type: z.literal("image"),
  assetId: z.string(),
}).catchall(z.unknown());

const shapeNodeSchema = baseNodeSchema.extend({
  type: z.literal("shape"),
  shapeType: z.enum(["rect", "ellipse"]),
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().nonnegative(),
  borderRadius: z.number().nonnegative().optional(),
  label: richTextDocSchema.optional(),
}).catchall(z.unknown());

const timelineNodeFieldsSchema = z.object({
  date: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  kind: z.enum(["paper", "product", "release", "policy", "benchmark", "event"]).optional(),
  org: z.string().optional(),
  authors: z.string().optional(),
  link: z.string().optional(),
  doi: z.string().optional(),
  arxiv: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  addedAt: z.string().optional(),
  source: z.enum(["manual", "arxiv", "rss"]).optional(),
}).catchall(z.unknown());

const timelineNodeSchema = baseNodeSchema.extend({
  type: z.literal("timeline"),
  entries: z.array(timelineNodeFieldsSchema),
}).catchall(z.unknown());

const connectorNodeSchema = z.object({
  id: z.string(),
  type: z.literal("connector"),
  pageIndex: z.number().int().nonnegative().optional(),
  z: z.number(),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  startNodeId: z.string().optional(),
  startAnchor: z.enum(["top", "bottom", "left", "right", "center"]).optional(),
  endNodeId: z.string().optional(),
  endAnchor: z.enum(["top", "bottom", "left", "right", "center"]).optional(),
  stroke: z.string(),
  strokeWidth: z.number().nonnegative(),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
  endMarker: z.enum(["none", "arrow", "circle"]),
  startMarker: z.enum(["none", "arrow", "circle"]),
  label: z.string().optional(),
  style: unknownRecord,
}).catchall(z.unknown());

const assetSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "html", "pdf", "file"]),
  storage: z.enum(["embedded", "managed"]).optional(),
  mimeType: z.string(),
  name: z.string(),
  data: z.string().min(1).optional(),
  relativePath: z.string().min(1).optional(),
  sizeBytes: z.number().nonnegative().optional(),
}).catchall(z.unknown());

export const documentFileSchema = z.object({
  format: z.literal("icanvas"),
  version: z.literal(2),
  meta: z.object({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).catchall(z.unknown()),
  nodes: z.array(z.discriminatedUnion("type", [textNodeSchema, imageNodeSchema, shapeNodeSchema, connectorNodeSchema, timelineNodeSchema])),
  assets: z.record(z.string(), assetSchema),
  pageBounds: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  }).catchall(z.unknown()),
  viewState: z.object({
    cameraX: z.number(),
    cameraY: z.number(),
    zoom: z.number().positive(),
  }).catchall(z.unknown()),
  appearance: z.object({
    pageBackground: z.string().min(1),
    grid: z.object({
      enabled: z.boolean(),
      color: z.string().min(1),
      size: z.number().positive(),
    }).catchall(z.unknown()),
    pages: z.object({
      count: z.number().int().positive(),
      height: z.number().positive(),
      gap: z.number().nonnegative(),
      titles: z.array(z.string()).optional(),
    }).catchall(z.unknown()),
  }).catchall(z.unknown()),
}).catchall(z.unknown());

export const parseDocumentSchema = (input: unknown): DocumentFile =>
  documentFileSchema.parse(input) as DocumentFile;
