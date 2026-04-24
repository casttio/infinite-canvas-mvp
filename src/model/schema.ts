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
    marks: z.array(z.enum(["bold", "italic"])).optional(),
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

const assetSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  mimeType: z.string(),
  name: z.string(),
  data: z.string().startsWith("data:"),
}).catchall(z.unknown());

export const documentFileSchema = z.object({
  format: z.literal("icanvas"),
  version: z.literal(2),
  meta: z.object({
    id: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).catchall(z.unknown()),
  nodes: z.array(z.discriminatedUnion("type", [textNodeSchema, imageNodeSchema])),
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
}).catchall(z.unknown());

export const parseDocumentSchema = (input: unknown): DocumentFile =>
  documentFileSchema.parse(input) as DocumentFile;
