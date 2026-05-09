import type {
  AssetMap,
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextMark,
  RichTextParagraph,
  RichTextTable,
  RichTextTableCell,
} from "../model/types";
import { normalizeRichTextDoc } from "../model/normalize";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightText = (escapedText: string, query: string): string => {
  if (!query) return escapedText;
  const pattern = escapeRegex(query);
  return escapedText.replace(
    new RegExp(`(${pattern})`, "gi"),
    '<mark class="search-highlight">$1</mark>',
  );
};

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll("\"", "&quot;");

const createEmptyParagraph = (): RichTextParagraph => ({
  type: "paragraph",
  content: [{ type: "text", text: "" }],
});

const EMPTY_PARAGRAPH_BLOCK_HTML = `<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p><br /></p></div>`;
const HEADING_FONT_SIZES: Record<string, string> = {
  h1: "32px",
  h2: "28px",
  h3: "24px",
  h4: "20px",
  h5: "18px",
  h6: "16px",
};
const LIST_BULLETS = ["•", "◦", "▪"];

export const wrapTableCellContentHtml = (innerHtml = EMPTY_PARAGRAPH_BLOCK_HTML) =>
  `<div class="text-block-table-cell-content">${innerHtml}</div>`;

export const createEmptyTableCellHtml = () => `<td>${wrapTableCellContentHtml()}</td>`;

const ensureParagraphContent = (content: RichTextInline[]): RichTextInline[] =>
  content.length > 0 ? content : [{ type: "text", text: "" }];

const ensureBlocks = (blocks: RichTextBlock[]): RichTextBlock[] =>
  blocks.length > 0 ? blocks : [createEmptyParagraph()];

const wrapMarks = (text: string, marks: RichTextMark[] = []) => {
  return marks.reduce((result, mark) => {
    if (mark === "bold") {
      return `<strong>${result}</strong>`;
    }

    if (mark === "italic") {
      return `<em>${result}</em>`;
    }

    if (mark === "underline") {
      return `<u>${result}</u>`;
    }

    if (mark === "strike") {
      return `<s>${result}</s>`;
    }

    return result;
  }, text);
};

const normalizeInlineStyleValue = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const normalizeHighlightColor = (value: string | null | undefined) => {
  const normalized = normalizeInlineStyleValue(value)?.toLowerCase();
  if (!normalized || normalized === "transparent" || normalized === "rgba(0, 0, 0, 0)" || normalized === "rgba(0,0,0,0)") {
    return undefined;
  }

  return normalized;
};

const wrapInlineStyle = (content: string, inline: Extract<RichTextInline, { type: "text" }>) => {
  const styleEntries = [
    inline.fontFamily ? `font-family: ${escapeAttribute(inline.fontFamily)};` : "",
    inline.fontSize ? `font-size: ${escapeAttribute(inline.fontSize)};` : "",
    inline.color ? `color: ${escapeAttribute(inline.color)};` : "",
    inline.highlightColor ? `background-color: ${escapeAttribute(inline.highlightColor)};` : "",
  ].filter(Boolean);

  if (styleEntries.length === 0) {
    return content;
  }

  const attributes = [
    inline.fontFamily ? `data-font-family="${escapeAttribute(inline.fontFamily)}"` : "",
    inline.fontSize ? `data-font-size="${escapeAttribute(inline.fontSize)}"` : "",
    inline.color ? `data-text-color="${escapeAttribute(inline.color)}"` : "",
    inline.highlightColor ? `data-highlight-color="${escapeAttribute(inline.highlightColor)}"` : "",
    `style="${styleEntries.join(" ")}"`,
  ].filter(Boolean).join(" ");

  return `<span ${attributes}>${content}</span>`;
};

const wrapLink = (content: string, inline: Extract<RichTextInline, { type: "text" }>) => {
  if (!inline.href && !inline.nodeLink) {
    return content;
  }

  const attributes = [
    `class="rich-text-link"`,
    inline.href ? `href="${escapeAttribute(inline.href)}"` : `href="#"`,
    inline.href ? `data-href="${escapeAttribute(inline.href)}"` : "",
    inline.nodeLink ? `data-node-link-page="${inline.nodeLink.pageIndex}"` : "",
    inline.nodeLink ? `data-node-link-id="${escapeAttribute(inline.nodeLink.nodeId)}"` : "",
    inline.nodeLink?.label ? `data-node-link-label="${escapeAttribute(inline.nodeLink.label)}"` : "",
    inline.nodeLink?.documentPath ? `data-node-link-doc="${escapeAttribute(inline.nodeLink.documentPath)}"` : "",
    inline.href ? `target="_blank"` : "",
    inline.href ? `rel="noreferrer"` : "",
  ].filter(Boolean).join(" ");

  return `<a ${attributes}>${content}</a>`;
};

const inlineToHtml = (inline: RichTextInline, assets: AssetMap = {}, highlightQuery?: string) => {
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

    if (!asset || asset.type !== "image" || !asset.data) {
      return `<span class="text-inline-image-missing" data-asset-id="${escapeAttribute(inline.assetId)}" ${sizeAttributes}>图片资源缺失</span>`;
    }

    return `<span class="text-inline-image-frame" contenteditable="false" data-asset-id="${escapeAttribute(inline.assetId)}" ${sizeAttributes}><img src="${escapeAttribute(asset.data)}" alt="${escapeAttribute(asset.name)}" draggable="false" /><span class="text-inline-image-resize" data-image-resize-handle="true"></span></span>`;
  }

  const text = escapeHtml(inline.text);
  const highlighted = highlightQuery ? highlightText(text, highlightQuery) : text;
  const markedText = wrapMarks(highlighted, inline.marks?.filter((mark) => mark !== "link"));
  return wrapInlineStyle(wrapLink(markedText, inline), inline);
};

const paragraphToHtml = (paragraph: RichTextParagraph, assets: AssetMap = {}, highlightQuery?: string): string => {
  const tag = paragraph.blockTag ?? "p";
  const blockTagAttr = paragraph.blockTag ? ` data-block-tag="${paragraph.blockTag}"` : "";
  return `<div class="text-block text-block-paragraph" data-block-kind="paragraph"${blockTagAttr}><${tag}>${ensureParagraphContent(paragraph.content).map((inline) => inlineToHtml(inline, assets, highlightQuery)).join("") || "<br />"}</${tag}></div>`;
};

const tableCellToHtml = (
  cell: RichTextTableCell,
  assets: AssetMap = {},
  tableDepth = 0,
  highlightQuery?: string,
): string =>
  `<td>${wrapTableCellContentHtml(blocksToHtml(ensureBlocks(cell.content), assets, tableDepth, highlightQuery))}</td>`;

const tableToHtml = (table: RichTextTable, assets: AssetMap = {}, tableDepth = 0, highlightQuery?: string): string => {
  const columnWidths = Array.isArray(table.colWidths) ? table.colWidths.filter((width) => Number.isFinite(width) && width > 0) : [];
  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const wrapperWidth = totalColumnWidth > 0 ? totalColumnWidth : table.w;
  const widthAttributes = [
    wrapperWidth ? `data-w="${wrapperWidth}"` : "",
    wrapperWidth ? `style="width: ${wrapperWidth}px;"` : "",
    columnWidths.length > 0 ? `data-col-widths="${columnWidths.join(",")}"` : "",
    `data-table-depth="${tableDepth}"`,
  ].filter(Boolean).join(" ");
  const colGroup = columnWidths.length > 0
    ? `<colgroup>${columnWidths.map((width) => `<col style="width: ${width}px;" />`).join("")}</colgroup>`
    : "";

  return `<div class="text-block text-block-table-wrap" data-block-kind="table" ${widthAttributes}><table class="text-block-table">${colGroup}<tbody>${table.rows.map((row) => `<tr>${row.cells.map((cell) => tableCellToHtml(cell, assets, tableDepth + 1, highlightQuery)).join("")}</tr>`).join("")}</tbody></table></div>`;
};

const blockToHtml = (block: RichTextBlock, assets: AssetMap = {}, tableDepth = 0, highlightQuery?: string): string => {
  if (block.type === "table") {
    return tableToHtml(block, assets, tableDepth, highlightQuery);
  }

  return paragraphToHtml(block, assets, highlightQuery);
};

const blocksToHtml = (blocks: RichTextBlock[], assets: AssetMap = {}, tableDepth = 0, highlightQuery?: string): string =>
  blocks.map((block) => blockToHtml(block, assets, tableDepth, highlightQuery)).join("");

export const createRichTextTableHtml = (rows = 2, columns = 2) =>
  `<div class="text-block text-block-table-wrap" data-block-kind="table"><table class="text-block-table"><tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: columns }, () => createEmptyTableCellHtml()).join("")}</tr>`).join("")}</tbody></table></div>`;

export const wrapRichTextTableHtml = (tableInnerHtml: string, options?: { width?: number; colWidths?: number[] }) => {
  const colWidths = Array.isArray(options?.colWidths)
    ? options.colWidths.filter((width) => Number.isFinite(width) && width > 0)
    : [];
  const wrapperWidth = colWidths.length > 0 ? colWidths.reduce((sum, width) => sum + width, 0) : options?.width;
  const widthAttributes = [
    wrapperWidth ? `data-w="${wrapperWidth}"` : "",
    wrapperWidth ? `style="width: ${wrapperWidth}px;"` : "",
    colWidths.length > 0 ? `data-col-widths="${colWidths.join(",")}"` : "",
  ].filter(Boolean).join(" ");

  return `<div class="text-block text-block-table-wrap" data-block-kind="table" ${widthAttributes}><table class="text-block-table">${tableInnerHtml}</table></div>`;
};

export const richTextDocToHtml = (doc: RichTextDoc, assets: AssetMap = {}, highlightQuery?: string) =>
  blocksToHtml(ensureBlocks(doc.content), assets, 0, highlightQuery);

const readMarks = (element: Node | null, marks: RichTextMark[] = []) => {
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
    if (tagName in HEADING_FONT_SIZES && !nextMarks.includes("bold")) {
      nextMarks.push("bold");
    }
    if (tagName === "blockquote" && !nextMarks.includes("italic")) {
      nextMarks.push("italic");
    }
    if ((current.style.fontWeight === "bold" || Number.parseInt(current.style.fontWeight, 10) >= 600) && !nextMarks.includes("bold")) {
      nextMarks.push("bold");
    }
    if ((current.style.fontStyle === "italic" || current.style.fontStyle === "oblique") && !nextMarks.includes("italic")) {
      nextMarks.push("italic");
    }
    if (tagName === "u" && !nextMarks.includes("underline")) {
      nextMarks.push("underline");
    }
    if ((tagName === "s" || tagName === "strike" || tagName === "del") && !nextMarks.includes("strike")) {
      nextMarks.push("strike");
    }
    if (tagName === "a" && !nextMarks.includes("link")) {
      nextMarks.push("link");
    }
    const textDecoration = current.style.textDecorationLine || current.style.textDecoration;
    if (textDecoration.includes("underline") && !nextMarks.includes("underline")) {
      nextMarks.push("underline");
    }
    if (textDecoration.includes("line-through") && !nextMarks.includes("strike")) {
      nextMarks.push("strike");
    }
    current = current.parentElement;
  }

  return nextMarks;
};

const readLink = (element: Node | null) => {
  let current = element;
  let href: string | undefined;
  let nodeLink: Extract<RichTextInline, { type: "text" }>["nodeLink"];

  while (current && current instanceof HTMLElement) {
    if (current.tagName.toLowerCase() === "a") {
      const rawHref = current.dataset.href || current.getAttribute("href") || undefined;
      href = rawHref && rawHref !== "#" ? rawHref : href;

      const rawPage = current.dataset.nodeLinkPage;
      const nodeId = current.dataset.nodeLinkId;
      const pageIndex = rawPage !== undefined ? Number(rawPage) : NaN;
      if (nodeId && Number.isFinite(pageIndex)) {
        nodeLink = {
          pageIndex: Math.max(0, Math.round(pageIndex)),
          nodeId,
          ...(current.dataset.nodeLinkLabel ? { label: current.dataset.nodeLinkLabel } : {}),
        };
      }
    }

    if (
      current.dataset.blockKind
      || current.classList.contains("text-block-table-cell-content")
      || current.tagName.toLowerCase() === "td"
    ) {
      break;
    }

    current = current.parentElement;
  }

  return {
    ...(href ? { href } : {}),
    ...(nodeLink ? { nodeLink } : {}),
  };
};

const readInlineStyle = (element: Node | null) => {
  let current = element;
  let fontFamily: string | undefined;
  let fontSize: string | undefined;
  let color: string | undefined;
  let highlightColor: string | undefined;

  while (current && current instanceof HTMLElement) {
    if (!fontFamily) {
      fontFamily = normalizeInlineStyleValue(
        current.dataset.fontFamily
        ?? current.style.fontFamily
        ?? current.getAttribute("face"),
      );
      if (!fontFamily) {
        const tagName = current.tagName.toLowerCase();
        if (tagName === "code" || tagName === "pre") {
          fontFamily = "monospace";
        }
      }
    }

    if (!fontSize) {
      fontSize = normalizeInlineStyleValue(
        current.dataset.fontSize
        ?? current.style.fontSize,
      );
      if (!fontSize) {
        fontSize = HEADING_FONT_SIZES[current.tagName.toLowerCase()];
      }
    }

    if (!color) {
      color = normalizeInlineStyleValue(
        current.dataset.textColor
        ?? current.style.color
        ?? current.getAttribute("color"),
      );
      if (!color && current.tagName.toLowerCase() === "blockquote") {
        color = "#6B6661";
      }
    }

    if (!highlightColor) {
      highlightColor = normalizeHighlightColor(
        current.dataset.highlightColor
        ?? current.style.backgroundColor,
      );
    }

    if (
      current.dataset.blockKind
      || current.classList.contains("text-block-table-cell-content")
      || current.tagName.toLowerCase() === "td"
    ) {
      break;
    }

    current = current.parentElement;
  }

  return {
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontSize ? { fontSize } : {}),
    ...(color ? { color } : {}),
    ...(highlightColor ? { highlightColor } : {}),
  };
};

const appendInlineNode = (node: Node, content: RichTextInline[]) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text.length > 0) {
      content.push({
        type: "text",
        text,
        marks: readMarks(node.parentNode),
        ...readLink(node.parentNode),
        ...readInlineStyle(node.parentNode),
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

const paragraphFromNodes = (nodes: Node[], blockTag?: string) => {
  const content: RichTextInline[] = [];
  nodes.forEach((node) => appendInlineNode(node, content));

  return {
    type: "paragraph" as const,
    blockTag,
    content: ensureParagraphContent(content),
  };
};

const isBlockElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && ["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "pre"].includes(node.tagName.toLowerCase());

const isListElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && ["ul", "ol"].includes(node.tagName.toLowerCase());

const isTableWrapperElement = (node: Node): node is HTMLDivElement =>
  node instanceof HTMLDivElement && node.classList.contains("text-block-table-wrap");

const isTableCellContentElement = (node: Node): node is HTMLDivElement =>
  node instanceof HTMLDivElement && node.classList.contains("text-block-table-cell-content");

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

export const readTableColumnWidths = (wrapper: HTMLElement, table: HTMLTableElement) => {
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
      content: parseBlocksFromNodes(Array.from(
        cell.querySelector(":scope > .text-block-table-cell-content")?.childNodes ?? cell.childNodes,
      )),
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

const paragraphFromPreElement = (element: HTMLElement): RichTextParagraph => {
  const text = (element.textContent ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = text.split("\n");
  const content: RichTextInline[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      content.push({ type: "break" });
    }

    if (line.length > 0) {
      content.push({
        type: "text",
        text: line,
        fontFamily: "monospace",
      });
    }
  });

  return {
    type: "paragraph",
    content: ensureParagraphContent(content),
  };
};

const parseListElement = (list: HTMLElement, depth = 0): RichTextBlock[] => {
  const isOrdered = list.tagName.toLowerCase() === "ol";
  const startValue = Number.parseInt(list.getAttribute("start") ?? "1", 10);
  const start = Number.isFinite(startValue) ? startValue : 1;
  const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
  const blocks: RichTextBlock[] = [];

  items.forEach((item, index) => {
    const nestedLists = Array.from(item.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && ["ul", "ol"].includes(child.tagName.toLowerCase()),
    );
    const contentNodes = Array.from(item.childNodes).filter((node) => (
      !(node instanceof HTMLElement && ["ul", "ol"].includes(node.tagName.toLowerCase()))
    ));
    const paragraph = paragraphFromNodes(contentNodes);
    const prefix = isOrdered ? `${start + index}. ` : `${LIST_BULLETS[depth % LIST_BULLETS.length]} `;

    paragraph.content = [
      { type: "text", text: prefix },
      ...paragraph.content,
    ];
    blocks.push(paragraph);

    nestedLists.forEach((nestedList) => {
      blocks.push(...parseListElement(nestedList, depth + 1));
    });
  });

  return blocks.length > 0 ? blocks : [createEmptyParagraph()];
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

    if (isTableCellContentElement(node)) {
      flushInlineBuffer();
      blocks.push(...parseBlocksFromNodes(Array.from(node.childNodes)));
      return;
    }

    if (isListElement(node)) {
      flushInlineBuffer();
      blocks.push(...parseListElement(node));
      return;
    }

    if (node instanceof HTMLTableElement) {
      flushInlineBuffer();
      blocks.push(tableFromElement(node));
      return;
    }

    if (isBlockElement(node)) {
      flushInlineBuffer();
      if (node.tagName.toLowerCase() === "pre") {
        blocks.push(paragraphFromPreElement(node));
        return;
      }
      // If this is the text-block wrapper div, look inside for the actual block tag
      if (node instanceof HTMLDivElement && node.classList.contains("text-block-paragraph")) {
        const inner = node.firstElementChild;
        if (inner instanceof HTMLElement) console.log("[parse] wrapper inner tag:", inner.tagName.toLowerCase(), "innerHTML:", inner.innerHTML.substring(0, 100));
        if (inner instanceof HTMLElement) {
          const innerTag = inner.tagName.toLowerCase();
          // Prefer explicit data-block-tag attribute (more robust against browser quirks)
          const explicitTag = node.dataset.blockTag;
          const tag = explicitTag || innerTag;
          if (tag === "p") {
            blocks.push(...parseBlocksFromNodes(Array.from(inner.childNodes)));
          } else {
            blocks.push(paragraphFromNodes(Array.from(inner.childNodes), tag));
          }
        }
        return;
      }
      const tag = node.tagName.toLowerCase();
      if (tag === "p" || tag === "div") {
        blocks.push(...parseBlocksFromNodes(Array.from(node.childNodes)));
      } else {
        blocks.push(paragraphFromNodes(Array.from(node.childNodes), tag));
      }
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

  return normalizeRichTextDoc({
    type: "doc",
    content: parseBlocksFromNodes(Array.from(root.childNodes)),
  });
};
