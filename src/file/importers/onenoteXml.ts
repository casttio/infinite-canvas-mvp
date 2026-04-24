import { createAssetId, createDocumentId, createNodeId, derivePageBoundsFromNodes } from "../../model/defaults";
import type {
  CanvasNode,
  DocumentFile,
  RichTextBlock,
  RichTextInline,
  RichTextParagraph,
  RichTextTable,
  RichTextTableCell,
  RichTextTableRow,
  TextNode,
} from "../../model/types";

const PX_PER_INCH = 96;
const DEFAULT_TEXT_NODE_WIDTH = 520;
const DEFAULT_TEXT_NODE_MIN_HEIGHT = 120;
const NODE_VERTICAL_GAP = 28;
const PAGE_PADDING = 48;

const nowIso = () => new Date().toISOString();

const asPixels = (value: string | null | undefined) => {
  const numeric = Number.parseFloat(value ?? "");
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * PX_PER_INCH) : undefined;
};

const ensureParagraph = (content: RichTextInline[]): RichTextParagraph => ({
  type: "paragraph",
  content: content.length > 0 ? content : [{ type: "break" }],
});

const directChildren = (root: Element, tagName?: string) =>
  Array.from(root.children).filter((child): child is Element => (
    child instanceof Element && (!tagName || child.tagName === tagName)
  ));

const firstDirectChild = (root: Element, tagName: string) =>
  directChildren(root, tagName)[0];

const readStyleMap = (root: Element) => {
  const styleMap = new Map<string, Array<"bold" | "italic">>();

  root.querySelectorAll("ReadonlyObjects > ParagraphStyles > *[ID]").forEach((styleNode) => {
    const id = styleNode.getAttribute("ID");
    if (!id) {
      return;
    }

    const marks: Array<"bold" | "italic"> = [];
    if (styleNode.querySelector("Bold")?.textContent === "True") {
      marks.push("bold");
    }
    if (styleNode.querySelector("Italic")?.textContent === "True") {
      marks.push("italic");
    }

    styleMap.set(id, marks);
  });

  return styleMap;
};

const textRunToInline = (
  textRun: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
): Extract<RichTextInline, { type: "text" }> | null => {
  const text = textRun.querySelector("Text")?.textContent ?? "";
  const styleRef = textRun.querySelector("[ID]")?.getAttribute("ID");
  const marks = styleRef ? styleMap.get(styleRef) ?? [] : [];

  if (text.length === 0) {
    return null;
  }

  return {
    type: "text" as const,
    text,
    ...(marks.length > 0 ? { marks } : {}),
  };
};

const richTextToParagraph = (richTextNode: Element, styleMap: Map<string, Array<"bold" | "italic">>) => {
  const textRuns = firstDirectChild(richTextNode, "TextRuns");
  const inlines = (textRuns ? directChildren(textRuns, "TextRun") : [])
    .map((textRun) => textRunToInline(textRun, styleMap))
    .filter((inline): inline is Extract<RichTextInline, { type: "text" }> => inline !== null);

  return ensureParagraph(inlines);
};

const imageElementToInline = (imageNode: Element): RichTextInline => {
  const imageName = imageNode.querySelector("ImageFilename")?.textContent
    ?? imageNode.querySelector("PictureContainer Filename")?.textContent
    ?? "OneNote 图片";
  const width = asPixels(imageNode.querySelector("PictureWidth")?.textContent);
  const height = asPixels(imageNode.querySelector("PictureHeight")?.textContent);

  return {
    type: "image",
    assetId: `missing_${createAssetId()}`,
    ...(width ? { w: width } : {}),
    ...(height ? { h: height } : {}),
    alt: imageName,
  };
};

const parseTableCell = (
  cellNode: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
): RichTextTableCell => {
  const content = parseElementBlocks(cellNode, styleMap);

  return {
    type: "tableCell",
    content: content.length > 0 ? content : [ensureParagraph([])],
  };
};

const parseTableNode = (
  tableNode: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
): RichTextTable => {
  const elementChildNodes = firstDirectChild(tableNode, "ElementChildNodes");
  const rows = (elementChildNodes ? directChildren(elementChildNodes, "jcidTableRowNode") : []).map<RichTextTableRow>((rowNode) => ({
    type: "tableRow",
    cells: (firstDirectChild(rowNode, "ElementChildNodes")
      ? directChildren(firstDirectChild(rowNode, "ElementChildNodes")!, "jcidTableCellNode")
      : []
    ).map((cellNode) =>
      parseTableCell(cellNode, styleMap),
    ),
  }));

  const colWidths = (tableNode.querySelector("TableColumnWidths")?.textContent ?? "")
    .split(",")
    .map((value) => asPixels(value))
    .filter((value): value is number => typeof value === "number");
  const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);

  return {
    type: "table",
    ...(totalWidth > 0 ? { w: totalWidth } : {}),
    ...(colWidths.length > 0 ? { colWidths } : {}),
    rows: rows.length > 0 ? rows : [{ type: "tableRow", cells: [parseTableCell(tableNode, styleMap)] }],
  };
};

const parseContentChild = (
  child: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
): RichTextBlock[] => {
  if (child.tagName === "jcidRichTextOENode") {
    return [richTextToParagraph(child, styleMap)];
  }

  if (child.tagName === "jcidTableNode") {
    return [parseTableNode(child, styleMap)];
  }

  if (child.tagName === "jcidImageNode") {
    return [ensureParagraph([imageElementToInline(child)])];
  }

  return [];
};

const parseOutlineElement = (
  outlineElementNode: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
) => {
  const contentChildNodes = firstDirectChild(outlineElementNode, "ContentChildNodes");
  return (contentChildNodes ? directChildren(contentChildNodes) : [])
    .flatMap((child) => parseContentChild(child, styleMap));
};

const parseContentChildren = (
  root: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
) => {
  const elementChildNodes = firstDirectChild(root, "ElementChildNodes");
  return (elementChildNodes ? directChildren(elementChildNodes, "jcidOutlineElementNode") : [])
    .flatMap((outlineElement) => parseOutlineElement(outlineElement, styleMap));
};

const parseElementBlocks = (
  root: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
) => {
  const blocks = [
    ...parseContentChildren(root, styleMap),
  ];

  const directContent = firstDirectChild(root, "ContentChildNodes");
  if (directContent) {
    blocks.push(...directChildren(directContent).flatMap((child) => parseContentChild(child, styleMap)));
  }

  return blocks;
};

const estimateTextNodeHeight = (content: RichTextBlock[]) => {
  const height = content.reduce((total, block) => {
    if (block.type === "table") {
      return total + Math.max(88, block.rows.length * 48);
    }

    const textLength = block.content.reduce((sum, inline) => sum + (inline.type === "text" ? inline.text.length : 1), 0);
    return total + Math.max(34, Math.ceil(textLength / 28) * 28);
  }, 0);

  return Math.max(DEFAULT_TEXT_NODE_MIN_HEIGHT, height + 40);
};

const outlineToTextNode = (
  outlineNode: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
  x: number,
  y: number,
  z: number,
): TextNode | null => {
  const content = parseElementBlocks(outlineNode, styleMap);
  if (content.length === 0) {
    return null;
  }

  return {
    id: createNodeId("text"),
    type: "text",
    x,
    y,
    w: DEFAULT_TEXT_NODE_WIDTH,
    h: estimateTextNodeHeight(content),
    z,
    content: {
      type: "doc",
      content,
    },
    style: {
      fontSize: 16,
      source: "onenote-xml",
    },
  };
};

const pageToNodes = (
  pageNode: Element,
  styleMap: Map<string, Array<"bold" | "italic">>,
  pageIndex: number,
): CanvasNode[] => {
  const manifest = firstDirectChild(pageNode, "jcidPageManifestNode");
  const manifestContent = manifest ? firstDirectChild(manifest, "ContentChildNodes") : undefined;
  const pageContentNode = manifestContent ? directChildren(manifestContent, "jcidPageNode")[0] : undefined;
  const elementChildNodes = pageContentNode ? firstDirectChild(pageContentNode, "ElementChildNodes") : undefined;
  const outlineNodes = elementChildNodes ? directChildren(elementChildNodes, "jcidOutlineNode") : [];
  let cursorY = PAGE_PADDING + pageIndex * 920;

  return outlineNodes.reduce<CanvasNode[]>((nodes, outlineNode) => {
    const nextNode = outlineToTextNode(outlineNode, styleMap, PAGE_PADDING, cursorY, nodes.length + 1);
    if (!nextNode) {
      return nodes;
    }

    nodes.push(nextNode);
    cursorY += nextNode.h + NODE_VERTICAL_GAP;
    return nodes;
  }, []);
};

export const importOneNoteXmlDocument = (rawXml: string, fileName = "import.xml"): DocumentFile => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(rawXml, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("OneNote XML 解析失败。");
  }

  const root = xml.documentElement;
  if (root.tagName !== "NotebookSection") {
    throw new Error(`暂不支持 ${root.tagName}，目前只支持 onenote2xml 导出的 NotebookSection XML。`);
  }

  const styleMap = readStyleMap(root);
  const pages = Array.from(root.querySelectorAll(":scope > Page"));
  const nodes = pages.flatMap((pageNode, pageIndex) => pageToNodes(pageNode, styleMap, pageIndex));
  const timestamp = nowIso();
  const title = pages[0]?.querySelector("CachedTitleString")?.textContent?.trim() || fileName;
  const author = pages[0]?.querySelector("Author")?.textContent?.trim();

  return {
    format: "icanvas",
    version: 2,
    meta: {
      id: createDocumentId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      title,
      source: {
        kind: "onenote-xml",
        fileName,
        ...(author ? { author } : {}),
        pages: pages.length,
      },
    },
    nodes,
    assets: {},
    pageBounds: derivePageBoundsFromNodes(nodes),
    viewState: {
      cameraX: 0,
      cameraY: 0,
      zoom: 1,
    },
  };
};
