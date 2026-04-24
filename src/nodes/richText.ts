import type {
  AssetMap,
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextParagraph,
  RichTextTable,
  RichTextTableCell,
} from "../model/types";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll("\"", "&quot;");

const createEmptyParagraph = (): RichTextParagraph => ({
  type: "paragraph",
  content: [{ type: "text", text: "" }],
});

const ensureParagraphContent = (content: RichTextInline[]): RichTextInline[] =>
  content.length > 0 ? content : [{ type: "text", text: "" }];

const ensureBlocks = (blocks: RichTextBlock[]): RichTextBlock[] =>
  blocks.length > 0 ? blocks : [createEmptyParagraph()];

const wrapMarks = (text: string, marks: Array<"bold" | "italic"> = []) => {
  return marks.reduce((result, mark) => {
    if (mark === "bold") {
      return `<strong>${result}</strong>`;
    }

    if (mark === "italic") {
      return `<em>${result}</em>`;
    }

    return result;
  }, text);
};

const inlineToHtml = (inline: RichTextInline, assets: AssetMap = {}) => {
  if (inline.type === "break") {
    return "<br />";
  }

  if (inline.type === "image") {
    const asset = assets[inline.assetId];
    const sizeAttributes = [
      inline.w ? `data-w="${inline.w}"` : "",
      inline.h ? `data-h="${inline.h}"` : "",
      inline.w ? `style="width: ${inline.w}px;"` : "",
    ].filter(Boolean).join(" ");

    if (!asset) {
      return `<span class="text-inline-image-missing" data-asset-id="${escapeAttribute(inline.assetId)}" ${sizeAttributes}>图片资源缺失</span>`;
    }

    return `<span class="text-inline-image-frame" contenteditable="false" data-asset-id="${escapeAttribute(inline.assetId)}" ${sizeAttributes}><img src="${escapeAttribute(asset.data)}" alt="${escapeAttribute(asset.name)}" draggable="false" /><span class="text-inline-image-resize" data-image-resize-handle="true"></span></span>`;
  }

  return wrapMarks(escapeHtml(inline.text), inline.marks);
};

const paragraphToHtml = (paragraph: RichTextParagraph, assets: AssetMap = {}): string =>
  `<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p>${ensureParagraphContent(paragraph.content).map((inline) => inlineToHtml(inline, assets)).join("") || "<br />"}</p></div>`;

const tableCellToHtml = (
  cell: RichTextTableCell,
  assets: AssetMap = {},
  tableDepth = 0,
): string =>
  `<td><div class="text-block-table-cell-content">${blocksToHtml(ensureBlocks(cell.content), assets, tableDepth)}</div></td>`;

const tableToHtml = (table: RichTextTable, assets: AssetMap = {}, tableDepth = 0): string => {
  const columnWidths = Array.isArray(table.colWidths) ? table.colWidths.filter((width) => Number.isFinite(width) && width > 0) : [];
  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const wrapperWidth = table.w ?? (totalColumnWidth > 0 ? totalColumnWidth : undefined);
  const widthAttributes = [
    wrapperWidth ? `data-w="${wrapperWidth}"` : "",
    wrapperWidth ? `style="width: ${wrapperWidth}px;"` : "",
    columnWidths.length > 0 ? `data-col-widths="${columnWidths.join(",")}"` : "",
    `data-table-depth="${tableDepth}"`,
  ].filter(Boolean).join(" ");
  const colGroup = columnWidths.length > 0
    ? `<colgroup>${columnWidths.map((width) => `<col style="width: ${width}px;" />`).join("")}</colgroup>`
    : "";

  return `<div class="text-block text-block-table-wrap" data-block-kind="table" ${widthAttributes}><table class="text-block-table">${colGroup}<tbody>${table.rows.map((row) => `<tr>${row.cells.map((cell) => tableCellToHtml(cell, assets, tableDepth + 1)).join("")}</tr>`).join("")}</tbody></table><span class="text-block-table-resize" contenteditable="false" data-table-resize-handle="true"></span></div>`;
};

const blockToHtml = (block: RichTextBlock, assets: AssetMap = {}, tableDepth = 0): string => {
  if (block.type === "table") {
    return tableToHtml(block, assets, tableDepth);
  }

  return paragraphToHtml(block, assets);
};

const blocksToHtml = (blocks: RichTextBlock[], assets: AssetMap = {}, tableDepth = 0): string =>
  blocks.map((block) => blockToHtml(block, assets, tableDepth)).join("");

export const createRichTextTableHtml = (rows = 2, columns = 2) =>
  `<div class="text-block text-block-table-wrap" data-block-kind="table"><table class="text-block-table"><tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => "<td><p><br /></p></td>").join("")}</tr>`).join("")}</tbody></table><span class="text-block-table-resize" contenteditable="false" data-table-resize-handle="true"></span></div>`;

export const wrapRichTextTableHtml = (tableInnerHtml: string, options?: { width?: number; colWidths?: number[] }) => {
  const colWidths = Array.isArray(options?.colWidths)
    ? options.colWidths.filter((width) => Number.isFinite(width) && width > 0)
    : [];
  const wrapperWidth = options?.width ?? (colWidths.length > 0 ? colWidths.reduce((sum, width) => sum + width, 0) : undefined);
  const widthAttributes = [
    wrapperWidth ? `data-w="${wrapperWidth}"` : "",
    wrapperWidth ? `style="width: ${wrapperWidth}px;"` : "",
    colWidths.length > 0 ? `data-col-widths="${colWidths.join(",")}"` : "",
  ].filter(Boolean).join(" ");

  return `<div class="text-block text-block-table-wrap" data-block-kind="table" ${widthAttributes}><table class="text-block-table">${tableInnerHtml}</table><span class="text-block-table-resize" contenteditable="false" data-table-resize-handle="true"></span></div>`;
};

export const richTextDocToHtml = (doc: RichTextDoc, assets: AssetMap = {}) =>
  blocksToHtml(ensureBlocks(doc.content), assets);

const readMarks = (element: Node | null, marks: Array<"bold" | "italic"> = []) => {
  let current = element;
  const nextMarks = [...marks];

  while (current && current instanceof HTMLElement) {
    const tagName = current.tagName.toLowerCase();
    if ((tagName === "strong" || tagName === "b") && !nextMarks.includes("bold")) {
      nextMarks.push("bold");
    }
    if ((tagName === "em" || tagName === "i") && !nextMarks.includes("italic")) {
      nextMarks.push("italic");
    }
    current = current.parentElement;
  }

  return nextMarks;
};

const appendInlineNode = (node: Node, content: RichTextInline[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text.length > 0) {
      content.push({
        type: "text",
        text,
        marks: readMarks(node.parentNode),
      });
    }
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.tagName.toLowerCase() === "br") {
    content.push({ type: "break" });
    return;
  }

  if (node.dataset.tableResizeHandle === "true") {
    return;
  }

  if (node.classList.contains("text-inline-image-frame") || node.classList.contains("text-inline-image-missing")) {
    const assetId = node.getAttribute("data-asset-id");
    if (assetId) {
      const width = Number(node.getAttribute("data-w"));
      const height = Number(node.getAttribute("data-h"));
      content.push({
        type: "image",
        assetId,
        ...(Number.isFinite(width) && width > 0 ? { w: width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { h: height } : {}),
      });
    }
    return;
  }

  if (node.tagName.toLowerCase() === "img") {
    const assetId = node.getAttribute("data-asset-id");
    if (assetId) {
      const width = Number(node.getAttribute("width")) || Number((node as HTMLImageElement).width);
      const height = Number(node.getAttribute("height")) || Number((node as HTMLImageElement).height);
      content.push({
        type: "image",
        assetId,
        ...(Number.isFinite(width) && width > 0 ? { w: width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { h: height } : {}),
      });
    }
    return;
  }

  Array.from(node.childNodes).forEach((child) => appendInlineNode(child, content));
};

const paragraphFromNodes = (nodes: Node[]) => {
  const content: RichTextInline[] = [];
  nodes.forEach((node) => appendInlineNode(node, content));

  return {
    type: "paragraph" as const,
    content: ensureParagraphContent(content),
  };
};

const isBlockElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && ["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName.toLowerCase());

const isTableWrapperElement = (node: Node): node is HTMLDivElement =>
  node instanceof HTMLDivElement && node.classList.contains("text-block-table-wrap");

const isResizeHandleElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement &&
  node.dataset.tableResizeHandle === "true";

const getDirectTableRows = (table: HTMLTableElement) => {
  const rows: HTMLTableRowElement[] = [];

  Array.from(table.children).forEach((child) => {
    if (child instanceof HTMLTableRowElement) {
      rows.push(child);
      return;
    }

    if (child instanceof HTMLTableSectionElement) {
      rows.push(...Array.from(child.rows));
    }
  });

  return rows;
};

const readTableColumnWidths = (wrapper: HTMLElement, table: HTMLTableElement) => {
  const explicitWidths = (wrapper.getAttribute("data-col-widths") ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (explicitWidths.length > 0) {
    return explicitWidths;
  }

  return Array.from(table.querySelectorAll(":scope > colgroup > col"))
    .map((col) => Number.parseFloat((col as HTMLElement).style.width))
    .filter((value) => Number.isFinite(value) && value > 0);
};

const tableFromElement = (table: HTMLTableElement, width?: number, colWidths?: number[]): RichTextTable => {
  const rows = getDirectTableRows(table).map((row) => ({
    type: "tableRow" as const,
    cells: Array.from(row.cells).map((cell) => ({
      type: "tableCell" as const,
      content: parseBlocksFromNodes(Array.from(cell.childNodes)),
    })),
  }));

  return {
    type: "table",
    ...(Number.isFinite(width) && width && width > 0 ? { w: width } : {}),
    ...(Array.isArray(colWidths) && colWidths.length > 0 ? { colWidths } : {}),
    rows: rows.length > 0 ? rows : [{
      type: "tableRow",
      cells: [{
        type: "tableCell",
        content: [createEmptyParagraph()],
      }],
    }],
  };
};

const readTableWidth = (element: HTMLElement) => {
  const width = Number(element.getAttribute("data-w"));
  if (Number.isFinite(width) && width > 0) {
    return width;
  }

  const inlineWidth = Number.parseFloat(element.style.width);
  return Number.isFinite(inlineWidth) && inlineWidth > 0 ? inlineWidth : undefined;
};

const parseBlocksFromNodes = (nodes: Node[]): RichTextBlock[] => {
  const blocks: RichTextBlock[] = [];
  let inlineBuffer: Node[] = [];

  const flushInlineBuffer = () => {
    if (inlineBuffer.length === 0) {
      return;
    }

    blocks.push(paragraphFromNodes(inlineBuffer));
    inlineBuffer = [];
  };

  nodes.forEach((node) => {
    if (isResizeHandleElement(node)) {
      return;
    }

    if (isTableWrapperElement(node)) {
      flushInlineBuffer();
      const table = Array.from(node.children).find((child) => child instanceof HTMLTableElement);
      if (table instanceof HTMLTableElement) {
        blocks.push(tableFromElement(table, readTableWidth(node), readTableColumnWidths(node, table)));
      }
      return;
    }

    if (node instanceof HTMLTableElement) {
      flushInlineBuffer();
      blocks.push(tableFromElement(node));
      return;
    }

    if (isBlockElement(node)) {
      flushInlineBuffer();
      blocks.push(...parseBlocksFromNodes(Array.from(node.childNodes)));
      return;
    }

    inlineBuffer.push(node);
  });

  flushInlineBuffer();

  return ensureBlocks(blocks);
};

export const htmlToRichTextDoc = (html: string): RichTextDoc => {
  const root = document.createElement("div");
  root.innerHTML = html;

  return {
    type: "doc",
    content: parseBlocksFromNodes(Array.from(root.childNodes)),
  };
};
