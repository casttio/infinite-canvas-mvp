import type {
  CanvasNode,
  DocumentAppearance,
  DocumentFile,
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextParagraph,
  RichTextTable,
  RichTextTableCell,
  RichTextTableRow,
  TextNode,
} from "./types";
import { createDefaultDocumentAppearance } from "./defaults";

const getPageStep = (appearance: DocumentAppearance) =>
  appearance.pages.height + appearance.pages.gap;

const emptyParagraph = (): RichTextParagraph => ({
  type: "paragraph",
  content: [{ type: "break" }],
});

const normalizeInline = (inline: RichTextInline): RichTextInline => {
  if (inline.type === "text") {
    const fontFamily = typeof inline.fontFamily === "string" && inline.fontFamily.trim().length > 0
      ? inline.fontFamily.trim()
      : undefined;
    const fontSize = typeof inline.fontSize === "string" && inline.fontSize.trim().length > 0
      ? inline.fontSize.trim()
      : undefined;
    const color = typeof inline.color === "string" && inline.color.trim().length > 0
      ? inline.color.trim()
      : undefined;
    const highlightColor = typeof inline.highlightColor === "string" && inline.highlightColor.trim().length > 0
      ? inline.highlightColor.trim()
      : undefined;

    return {
      ...inline,
      marks: Array.isArray(inline.marks) ? inline.marks : [],
      ...(fontFamily ? { fontFamily } : {}),
      ...(fontSize ? { fontSize } : {}),
      ...(color ? { color } : {}),
      ...(highlightColor ? { highlightColor } : {}),
    };
  }

  return inline;
};

const normalizeParagraph = (paragraph: RichTextParagraph): RichTextParagraph => ({
  ...paragraph,
  content: paragraph.content.length > 0 ? paragraph.content.map(normalizeInline) : [{ type: "break" }],
});

const normalizeTableCell = (cell: RichTextTableCell, tableDepth: number): RichTextTableCell => ({
  ...cell,
  content: normalizeBlocks(cell.content, tableDepth + 1),
});

const normalizeTable = (table: RichTextTable, tableDepth: number): RichTextTable => {
  const normalizedRows = table.rows.map<RichTextTableRow>((row) => ({
    ...row,
    cells: row.cells.map((cell) => normalizeTableCell(cell, tableDepth)),
  }));
  const rowColumnCount = Math.max(...normalizedRows.map((row) => row.cells.length), 0);
  const columnCount = Math.max(rowColumnCount, 1);

  const rows = normalizedRows.map<RichTextTableRow>((row) => ({
    ...row,
    cells: row.cells.length >= columnCount
      ? row.cells
      : [
          ...row.cells,
          ...Array.from({ length: columnCount - row.cells.length }, (): RichTextTableCell => ({
            type: "tableCell",
            content: [emptyParagraph()],
          })),
        ],
  }));

  const hasExplicitColWidths = Array.isArray(table.colWidths) && table.colWidths.length > 0;
  const colWidths = hasExplicitColWidths
    ? table.colWidths!.slice(0, columnCount)
    : tableDepth === 0
      ? []
      : undefined;

  if (colWidths) {
    while (colWidths.length < columnCount) {
      const fallback = colWidths.length > 0 ? colWidths[colWidths.length - 1] : 160;
      colWidths.push(fallback);
    }
  }

  const width = colWidths?.reduce((sum, value) => sum + value, 0) ?? 0;

  return {
    ...table,
    rows,
    ...(colWidths ? { colWidths } : {}),
    ...(width > 0 ? { w: width } : {}),
  };
};

export const normalizeBlock = (block: RichTextBlock, tableDepth = 0): RichTextBlock => {
  if (block.type === "table") {
    return normalizeTable(block, tableDepth);
  }

  return normalizeParagraph(block);
};

export const normalizeBlocks = (blocks: RichTextBlock[], tableDepth = 0): RichTextBlock[] =>
  blocks.length > 0
    ? blocks.map((block) => normalizeBlock(block, tableDepth))
    : [emptyParagraph()];

export const normalizeRichTextDoc = (doc: RichTextDoc): RichTextDoc => ({
  ...doc,
  content: normalizeBlocks(doc.content),
});

const normalizeNode = (node: CanvasNode, appearance: DocumentAppearance, pageBounds: DocumentFile["pageBounds"]): CanvasNode => {
  const step = getPageStep(appearance);
  const explicitPageIndex = typeof node.pageIndex === "number" && Number.isFinite(node.pageIndex)
    ? Math.max(0, Math.round(node.pageIndex))
    : null;
  const inferredPageIndex = Math.max(0, Math.floor((node.y - pageBounds.y) / step));
  const pageIndex = explicitPageIndex ?? inferredPageIndex;
  const localY = explicitPageIndex === null
    ? node.y - pageIndex * step
    : node.y;
  const normalizedBase = {
    ...node,
    pageIndex,
    x: Math.max(pageBounds.x, node.x),
    y: Math.max(pageBounds.y, localY),
  } as CanvasNode;

  if (normalizedBase.type !== "text") {
    return normalizedBase;
  }

  return {
    ...normalizedBase,
    content: normalizeRichTextDoc((normalizedBase as TextNode).content),
  };
};

const normalizeAppearance = (appearance: Partial<DocumentAppearance> | undefined): DocumentAppearance => {
  const defaults = createDefaultDocumentAppearance();
  const pageBackground = typeof appearance?.pageBackground === "string" && appearance.pageBackground.trim().length > 0
    ? appearance.pageBackground.trim()
    : defaults.pageBackground;
  const gridColor = typeof appearance?.grid?.color === "string" && appearance.grid.color.trim().length > 0
    ? appearance.grid.color.trim()
    : defaults.grid.color;
  const gridSize = typeof appearance?.grid?.size === "number" && Number.isFinite(appearance.grid.size)
    ? Math.max(8, Math.min(96, Math.round(appearance.grid.size)))
    : defaults.grid.size;
  const pageCount = typeof appearance?.pages?.count === "number" && Number.isFinite(appearance.pages.count)
    ? Math.max(1, Math.round(appearance.pages.count))
    : defaults.pages.count;
  const pageHeight = typeof appearance?.pages?.height === "number" && Number.isFinite(appearance.pages.height)
    ? Math.max(600, Math.round(appearance.pages.height))
    : defaults.pages.height;
  const pageGap = typeof appearance?.pages?.gap === "number" && Number.isFinite(appearance.pages.gap)
    ? Math.max(24, Math.round(appearance.pages.gap))
    : defaults.pages.gap;
  const pageTitles = Array.isArray(appearance?.pages?.titles)
    ? appearance.pages.titles.map((title) => (typeof title === "string" ? title : ""))
    : defaults.pages.titles ?? [];

  return {
    ...defaults,
    ...(appearance ?? {}),
    pageBackground,
    grid: {
      ...defaults.grid,
      ...(appearance?.grid ?? {}),
      color: gridColor,
      size: gridSize,
      enabled: Boolean(appearance?.grid?.enabled),
    },
    pages: {
      ...defaults.pages,
      ...(appearance?.pages ?? {}),
      count: pageCount,
      height: pageHeight,
      gap: pageGap,
      titles: pageTitles,
    },
  };
};

export const normalizeDocument = (document: DocumentFile): DocumentFile => {
  const appearance = normalizeAppearance(document.appearance);
  const nodes = document.nodes.map((node) => normalizeNode(node, appearance, document.pageBounds));
  const inferredPageCount = nodes.reduce((maxPageCount, node) => Math.max(maxPageCount, node.pageIndex + 1), 1);

  return {
    ...document,
    appearance: {
      ...appearance,
      pages: {
        ...appearance.pages,
        count: Math.max(appearance.pages.count, inferredPageCount),
        titles: Array.from(
          { length: Math.max(appearance.pages.count, inferredPageCount) },
          (_, index) => appearance.pages.titles?.[index] ?? "",
        ),
      },
    },
    nodes,
  };
};
