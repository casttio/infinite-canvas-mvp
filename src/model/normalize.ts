import type {
  CanvasNode,
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

const emptyParagraph = (): RichTextParagraph => ({
  type: "paragraph",
  content: [{ type: "break" }],
});

const normalizeInline = (inline: RichTextInline): RichTextInline => {
  if (inline.type === "text") {
    const fontFamily = typeof inline.fontFamily === "string" && inline.fontFamily.trim().length > 0
      ? inline.fontFamily.trim()
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

export const normalizeBlock = (block: RichTextBlock): RichTextBlock => {
  if (block.type === "table") {
    return normalizeTable(block, 0);
  }

  return normalizeParagraph(block);
};

export const normalizeBlocks = (blocks: RichTextBlock[], tableDepth = 0): RichTextBlock[] =>
  blocks.length > 0
    ? blocks.map((block) => (block.type === "table" ? normalizeTable(block, tableDepth) : normalizeParagraph(block)))
    : [emptyParagraph()];

export const normalizeRichTextDoc = (doc: RichTextDoc): RichTextDoc => ({
  ...doc,
  content: normalizeBlocks(doc.content),
});

const normalizeNode = (node: CanvasNode): CanvasNode => {
  if (node.type !== "text") {
    return node;
  }

  return {
    ...node,
    content: normalizeRichTextDoc((node as TextNode).content),
  };
};

export const normalizeDocument = (document: DocumentFile): DocumentFile => ({
  ...document,
  nodes: document.nodes.map(normalizeNode),
});
