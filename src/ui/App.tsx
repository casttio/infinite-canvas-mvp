import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import packageInfo from "../../package.json";
import { openFileWithPicker, setActiveFileHandle } from "../file/fileHandle";
import { loadDocumentFromFile, loadDocumentFromRaw } from "../file/loadDocument";
import { saveDocumentToDisk } from "../file/saveDocument";
import { parseDocumentSchema } from "../model/schema";
import { serializeDocumentJson } from "../file/serialize";
import { dragNode } from "../editor/drag";
import { resizeNode } from "../editor/resize";
import type { ResizeHandle } from "../editor/resize";
import {
  clampZoom,
  stepZoom,
  toWorldPoint,
  zoomAtPoint,
} from "../editor/viewport";
import {
  createAssetId,
  createDefaultRichTextDoc,
  createEmptyDocument,
  createConnectorNode,
  createImageNode,
  createNodeId,
  createShapeNode,
  createTextNode,
  createTimelineNode,
  fitPageBoundsToNodes,
  touchDocument,
} from "../model/defaults";
import { addImageNodeToDocument, addNodeToDocument, updateNodeInDocument } from "../model/documentOps";
import type { BoxCanvasNode, CanvasNode, ConnectorAnchor, ConnectorNode, DocumentFile, PageBounds, RichTextBlock, RichTextDoc, RichTextInline, ShapeNode as ShapeNodeModel, TextNode as TextNodeModel, TimelineNodeFields, TimelineNode as TimelineNodeType, ViewState } from "../model/types";
import { ConnectorLayer } from "../nodes/ConnectorLayer";
import { distanceToSegment, isBoxCanvasNode, nearestAnchor, resolveAnchorPoint, resolveConnectorEndpoint } from "../nodes/connectorGeometry";
import { ImageNode } from "../nodes/ImageNode";
import { ShapeNode } from "../nodes/ShapeNode";
import { TimelineNode } from "../nodes/TimelineNode";
import { TextNode } from "../nodes/TextNode";
import type { TextEditorCommand } from "../nodes/TextNode";
import { generateTimelineHtml, getTimelineSize } from "../timeline/generateTimeline";
import { parseTableToTimelineRows } from "../timeline/parseTable";
import { parseMarkdownToRichTextDoc } from "../markdown/parseMarkdown";
import { clearEmptyParagraphs } from "../model/textCleanup";
import { FileSidebar, getDisplayFileName } from "./FileSidebar";
import { resolveManagedAttachmentOpenPath } from "./attachmentPaths";
import { Toolbar } from "./Toolbar";

const APP_VERSION = packageInfo.version;
import { searchInNodes, type SearchResult } from "../model/search";
import { ReferencePopover, type ReferenceLink, type ReferenceNodeRef } from "../ui/ReferencePopover";
import type { SearchScope } from "../ui/Toolbar";

const isPdfAttachment = (mimeType?: string, fileName?: string) =>
  mimeType?.toLowerCase() === "application/pdf" || fileName?.toLowerCase().endsWith(".pdf") === true;

type InteractionState =
  | { type: "none" }
  | { type: "pan"; startX: number; startY: number; initialX: number; initialY: number }
  | { type: "marquee"; startX: number; startY: number; currentX: number; currentY: number }
  | {
      type: "drag-node";
      nodeId: string;
      nodeIds: string[];
      startPositions: Record<string, { x: number; y: number }>;
      startPointerX: number;
      startPointerY: number;
    }
  | {
      type: "resize-node";
      nodeId: string;
      nodeType: BoxCanvasNode["type"];
      startPointerX: number;
      startPointerY: number;
      startX: number;
      startW: number;
      startH: number;
      handle: ResizeHandle;
      allowOverlap: boolean;
    }
  | { type: "draw-connector"; startX: number; startY: number; currentX: number; currentY: number; startNodeId?: string; startAnchor?: ConnectorAnchor }
  | { type: "drag-connector"; connectorId: string; startPointerX: number; startPointerY: number; startX1: number; startY1: number; startX2: number; startY2: number }
  | { type: "drag-connector-endpoint"; connectorId: string; endpoint: "start" | "end"; startPointerX: number; startPointerY: number; startX: number; startY: number };

type SidebarContextMenuState =
  | null
  | {
      kind: "file";
      x: number;
      y: number;
      filePath: string;
      fileName: string;
      parentDirectoryPath: string | null;
    }
  | {
      kind: "directory";
      x: number;
      y: number;
      directoryPath: string;
      directoryName: string;
      parentDirectoryPath: string | null;
    }
  | {
      kind: "workspace";
      x: number;
      y: number;
      directoryPath: string | null;
    }
  | {
      kind: "page";
      x: number;
      y: number;
      pageIndex: number;
    };

type PageClipboardState = {
  mode: "copy" | "cut";
  title: string;
  nodes: CanvasNode[];
};

type CanvasContextMenuState = null | {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  nodeId?: string;
};

type TrashEntry = {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
};

type MarkdownDialogState = null | {
  worldX: number;
  worldY: number;
  text: string;
};

const fileNameFromMeta = (document: DocumentFile) => `${document.meta.id}.icanvas.html`;
const CAMERA_OVERSCROLL_LEFT_TOP = 240;
const CAMERA_OVERSCROLL_RIGHT_BOTTOM = 180;
const ZOOM_SETTLE_DELAY_MS = 140;
const TEXT_DRAFT_HISTORY_INTERVAL_MS = 1200;
const AUTOSAVE_STORAGE_KEY = "icanvas.autosave.document";
const AUTOSAVE_DELAY_MS = 800;
const PAGE_STATE_STORAGE_KEY = "icanvas.page-state";
const FILE_SIDEBAR_COLLAPSED_STORAGE_KEY = "icanvas.file-sidebar.collapsed";
const PAGE_SIDEBAR_COLLAPSED_STORAGE_KEY = "icanvas.page-sidebar.collapsed";
const FILE_TREE_ORDER_STORAGE_KEY = "icanvas.file-tree.order";

const getInsertOffset = (count: number) => {
  const step = 28;
  const cycle = 6;
  const offset = (count % cycle) * step;

  return {
    x: offset,
    y: offset,
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampOrAnchorStart = (value: number, min: number, max: number) => {
  if (min > max) {
    return max;
  }

  return clamp(value, min, max);
};

const clampViewStateToPage = (
  viewState: ViewState,
  pageBounds: PageBounds,
  rect: DOMRect,
): ViewState => {
  const minCameraX = rect.width - (pageBounds.x + pageBounds.w + CAMERA_OVERSCROLL_RIGHT_BOTTOM) * viewState.zoom;
  const maxCameraX = (CAMERA_OVERSCROLL_LEFT_TOP - pageBounds.x) * viewState.zoom;
  const minCameraY = rect.height - (pageBounds.y + pageBounds.h + CAMERA_OVERSCROLL_RIGHT_BOTTOM) * viewState.zoom;
  const maxCameraY = (CAMERA_OVERSCROLL_LEFT_TOP - pageBounds.y) * viewState.zoom;

  return {
    ...viewState,
    cameraX: clampOrAnchorStart(viewState.cameraX, minCameraX, maxCameraX),
    cameraY: clampOrAnchorStart(viewState.cameraY, minCameraY, maxCameraY),
  };
};

const getCameraBounds = (
  viewState: ViewState,
  pageBounds: PageBounds,
  viewport: { width: number; height: number },
) => {
  const minCameraX = viewport.width - (pageBounds.x + pageBounds.w + CAMERA_OVERSCROLL_RIGHT_BOTTOM) * viewState.zoom;
  const maxCameraX = (CAMERA_OVERSCROLL_LEFT_TOP - pageBounds.x) * viewState.zoom;
  const minCameraY = viewport.height - (pageBounds.y + pageBounds.h + CAMERA_OVERSCROLL_RIGHT_BOTTOM) * viewState.zoom;
  const maxCameraY = (CAMERA_OVERSCROLL_LEFT_TOP - pageBounds.y) * viewState.zoom;

  return {
    minCameraX,
    maxCameraX,
    minCameraY,
    maxCameraY,
  };
};

const getScrollbarMetrics = (
  camera: number,
  minCamera: number,
  maxCamera: number,
  trackSize: number,
) => {
  const scrollRange = Math.max(0, maxCamera - minCamera);
  const safeTrackSize = Math.max(0, trackSize);
  if (scrollRange <= 0 || safeTrackSize <= 0) {
    return {
      thumbSize: safeTrackSize,
      thumbOffset: 0,
      scrollRange,
    };
  }

  const thumbSize = Math.max(36, Math.min(safeTrackSize, safeTrackSize * (safeTrackSize / (safeTrackSize + scrollRange))));
  const thumbTravel = Math.max(0, safeTrackSize - thumbSize);
  const ratio = clamp((maxCamera - camera) / scrollRange, 0, 1);

  return {
    thumbSize,
    thumbOffset: thumbTravel * ratio,
    scrollRange,
  };
};

const getPageInsertionPoint = (documentFile: DocumentFile, pageIndex = 0) => {
  const padding = 40;

  return {
    x: documentFile.pageBounds.x + padding,
    y: documentFile.pageBounds.y + padding,
  };
};

const canDiscardUnsavedChanges = (isDirty: boolean) =>
  !isDirty || window.confirm("当前文档有未保存修改，确定要丢弃吗？");

const isCanvasNodeTarget = (target: EventTarget) =>
  target instanceof Element && !!target.closest(".canvas-node");

const getCanvasNodeIdFromTarget = (target: EventTarget | null) =>
  target instanceof Element ? target.closest(".canvas-node")?.getAttribute("data-node-id") ?? null : null;

const normalizeRect = (rect: { startX: number; startY: number; currentX: number; currentY: number }) => ({
  x: Math.min(rect.startX, rect.currentX),
  y: Math.min(rect.startY, rect.currentY),
  w: Math.abs(rect.currentX - rect.startX),
  h: Math.abs(rect.currentY - rect.startY),
});

const rectsIntersect = (
  first: { x: number; y: number; w: number; h: number },
  second: { x: number; y: number; w: number; h: number },
) =>
  first.x < second.x + second.w &&
  first.x + first.w > second.x &&
  first.y < second.y + second.h &&
  first.y + first.h > second.y;

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["input", "textarea", "select"].includes(target.tagName.toLowerCase()));

const isFormFieldTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && ["input", "textarea", "select"].includes(target.tagName.toLowerCase());

const serializeDocument = (document: DocumentFile) => JSON.stringify(document);

const inferRequiredPageCount = (document: DocumentFile) => {
  return Math.max(1, document.nodes.reduce((maxPageCount, node) => Math.max(maxPageCount, node.pageIndex + 1), 1));
};

const cloneCanvasNode = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const clonePageNodesForInsert = (nodes: CanvasNode[], pageIndex: number) => {
  const idMap = new Map(nodes.map((node) => [node.id, createNodeId(node.type)]));

  return nodes.map((node) => {
    const next = {
      ...cloneCanvasNode(node),
      id: idMap.get(node.id) ?? createNodeId(node.type),
      pageIndex,
    } as CanvasNode;

    if (next.type === "connector") {
      return {
        ...next,
        ...(next.startNodeId && idMap.has(next.startNodeId) ? { startNodeId: idMap.get(next.startNodeId) } : {}),
        ...(next.endNodeId && idMap.has(next.endNodeId) ? { endNodeId: idMap.get(next.endNodeId) } : {}),
      } as CanvasNode;
    }

    if (next.type === "timeline") {
      return {
        ...next,
        entries: next.entries.map((entry) => {
          if (!entry.nodeRef || !idMap.has(entry.nodeRef.nodeId)) {
            return entry;
          }

          return {
            ...entry,
            nodeRef: {
              ...entry.nodeRef,
              pageIndex,
              nodeId: idMap.get(entry.nodeRef.nodeId)!,
            },
          };
        }),
      } as CanvasNode;
    }

    return next;
  });
};

const removePageFromDocument = (document: DocumentFile, pageIndex: number): DocumentFile => ({
  ...document,
  nodes: document.nodes
    .filter((node) => node.pageIndex !== pageIndex)
    .map((node) => (node.pageIndex > pageIndex ? { ...node, pageIndex: node.pageIndex - 1 } : node)),
  appearance: {
    ...document.appearance,
    pages: {
      ...document.appearance.pages,
      count: Math.max(1, document.appearance.pages.count - 1),
      titles: (document.appearance.pages.titles ?? []).filter((_, index) => index !== pageIndex),
    },
  },
});

const insertPageIntoDocument = (
  document: DocumentFile,
  insertIndex: number,
  title: string,
  sourceNodes: CanvasNode[],
): DocumentFile => {
  const currentPageCount = Math.max(document.appearance.pages.count, inferRequiredPageCount(document));
  const pageIndex = Math.max(0, Math.min(insertIndex, currentPageCount));
  const titles = Array.from(
    { length: currentPageCount },
    (_, index) => document.appearance.pages.titles?.[index] ?? "",
  );

  titles.splice(pageIndex, 0, title);

  return {
    ...document,
    nodes: [
      ...document.nodes.map((node) => (node.pageIndex >= pageIndex ? { ...node, pageIndex: node.pageIndex + 1 } : node)),
      ...clonePageNodesForInsert(sourceNodes, pageIndex),
    ],
    appearance: {
      ...document.appearance,
      pages: {
        ...document.appearance.pages,
        count: Math.max(document.appearance.pages.count + 1, titles.length),
        titles,
      },
    },
  };
};

const plainTextFromRichTextDoc = (doc: RichTextDoc) =>
  doc.content.map((block) => {
    if (block.type === "paragraph") {
      return block.content.map((inline) => {
        if (inline.type === "text") {
          return inline.text;
        }
        if (inline.type === "break") {
          return "\n";
        }
        return "";
      }).join("");
    }

    return "";
  }).join("\n").trim();

const richTextBlockHasContent = (block: RichTextBlock): boolean => {
  if (block.type === "table") {
    return true;
  }

  return block.content.some((inline) => {
    if (inline.type === "image") {
      return true;
    }
    if (inline.type === "text") {
      return inline.text.trim().length > 0 || Boolean(inline.href || inline.nodeLink);
    }
    return false;
  });
};

const richTextDocHasContent = (doc: RichTextDoc) => doc.content.some(richTextBlockHasContent);

const formatPageDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: value, time: "" };
  }

  return {
    date: new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(parsed),
    time: new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed),
  };
};

const getWorkspaceRelativePath = (filePath: string, rootPath: string | null) => {
  if (!rootPath || !filePath.startsWith(rootPath)) {
    return filePath;
  }

  return filePath.slice(rootPath.length).replace(/^[\\/]+/, "");
};

const getParentDirectoryPath = (entryPath: string, rootPath: string | null) => {
  const separatorIndex = Math.max(entryPath.lastIndexOf("/"), entryPath.lastIndexOf("\\"));
  if (separatorIndex <= 0) {
    return rootPath;
  }

  return entryPath.slice(0, separatorIndex);
};

const isPathInsideOrEqual = (parentPath: string, candidatePath: string) => {
  const normalizedParent = parentPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedCandidate = candidatePath.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
};

const readStoredFileTreeOrder = (): Record<string, string[]> => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(FILE_TREE_ORDER_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, unknown[]] => typeof entry[0] === "string" && Array.isArray(entry[1]))
        .map(([key, value]) => [key, value.filter((item): item is string => typeof item === "string")]),
    );
  } catch {
    return {};
  }
};

const orderWorkspaceEntries = (
  entries: WorkspaceEntry[],
  orderByDirectory: Record<string, string[]>,
  parentDirectoryPath: string | null,
): WorkspaceEntry[] => {
  const order = orderByDirectory[parentDirectoryPath ?? ""] ?? [];
  const orderIndex = new Map(order.map((path, index) => [path, index]));

  return entries
    .map((entry) => entry.type === "directory"
      ? { ...entry, children: orderWorkspaceEntries(entry.children, orderByDirectory, entry.path) }
      : entry)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.type !== right.entry.type) {
        return left.entry.type === "directory" ? -1 : 1;
      }

      if (left.entry.type === "file" && right.entry.type === "file") {
        const leftIndex = orderIndex.get(left.entry.path);
        const rightIndex = orderIndex.get(right.entry.path);
        if (leftIndex !== undefined || rightIndex !== undefined) {
          return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
        }
      }

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
};

/** Collect all visible file paths from workspace entries (DFS) */
const collectVisibleFilePaths = (entries: WorkspaceEntry[]): string[] => {
  const result: string[] = [];
  const walk = (items: WorkspaceEntry[]) => {
    for (const item of items) {
      if (item.type === "file") result.push(item.path);
      else if (item.type === "directory") walk(item.children);
    }
  };
  walk(entries);
  return result;
};

const readStoredPageState = () => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PAGE_STATE_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, number>;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
    );
  } catch {
    return {} as Record<string, number>;
  }
};

const getPageStatePathKey = (filePath: string) => `path:${filePath}`;
const getPageStateDocumentKey = (documentId: string) => `doc:${documentId}`;

const getStoredPageIndex = (documentId: string, maxPageCount: number, filePath?: string | null) => {
  const pageState = readStoredPageState();
  const pageIndex = [
    filePath ? pageState[getPageStatePathKey(filePath)] : undefined,
    pageState[getPageStateDocumentKey(documentId)],
    pageState[documentId],
  ].find((value) => typeof value === "number");

  if (typeof pageIndex !== "number") {
    return 0;
  }

  return Math.max(0, Math.min(Math.round(pageIndex), Math.max(0, maxPageCount - 1)));
};

const setStoredPageIndex = (documentId: string, pageIndex: number, filePath?: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  const nextState = {
    ...readStoredPageState(),
    [getPageStateDocumentKey(documentId)]: pageIndex,
    [documentId]: pageIndex,
    ...(filePath ? { [getPageStatePathKey(filePath)]: pageIndex } : {}),
  };
  window.localStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify(nextState));
};

const readStoredFileSidebarCollapsed = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(FILE_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
};

const readStoredPageSidebarCollapsed = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(PAGE_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("文件读取失败。"));
    };
    reader.onerror = () => reject(new Error("文件读取失败。"));
    reader.readAsDataURL(file);
  });

const readImageDimensions = (src: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.width, h: image.height });
    image.onerror = () => reject(new Error("图片资源无法解析。"));
    image.src = src;
  });

const plainTextToRichTextDoc = (text: string): RichTextDoc => {
  const normalizedText = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalizedText.split("\n");
  const content = (lines.length > 0 ? lines : [""]).map((line) => ({
    type: "paragraph" as const,
    content: line.length > 0 ? [{ type: "text" as const, text: line }] : [{ type: "break" as const }],
  }));

  return {
    type: "doc",
    content,
  };
};

const looksLikeHtmlSource = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    return false;
  }

  return /<(html|head|body|div|section|article|main|header|footer|aside|nav|table|p|h[1-6]|ul|ol|li|span|img|style|script)\b/i.test(trimmed);
};

const createHtmlPreviewAsset = (rawHtml: string) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(rawHtml, "text/html");
  const title = parsed.title.trim();
  const headInnerHtml = parsed.head.innerHTML;
  const bodyInnerHtml = parsed.body.innerHTML;

  return {
    title,
    html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${headInnerHtml}
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: white;
      }
    </style>
  </head>
  <body>
    ${bodyInnerHtml}
  </body>
</html>`,
  };
};

type TextMark = NonNullable<Extract<RichTextInline, { type: "text" }>["marks"]>[number];

const mapRichTextBlocks = (
  blocks: RichTextBlock[],
  mapText: (inline: Extract<RichTextInline, { type: "text" }>) => Extract<RichTextInline, { type: "text" }>,
): RichTextBlock[] =>
  blocks.map((block) => {
    if (block.type === "paragraph") {
      return {
        ...block,
        content: block.content.map((inline) => (inline.type === "text" ? mapText(inline) : inline)),
      };
    }

    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          content: mapRichTextBlocks(cell.content, mapText),
        })),
      })),
    };
  });

const mapRichTextDocText = (
  doc: RichTextDoc,
  mapText: (inline: Extract<RichTextInline, { type: "text" }>) => Extract<RichTextInline, { type: "text" }>,
): RichTextDoc => ({
  ...doc,
  content: mapRichTextBlocks(doc.content, mapText),
});

const collectTextLeaves = (blocks: RichTextBlock[]): Array<Extract<RichTextInline, { type: "text" }>> =>
  blocks.flatMap((block) => {
    if (block.type === "paragraph") {
      return block.content.filter((inline): inline is Extract<RichTextInline, { type: "text" }> => inline.type === "text");
    }

    return block.rows.flatMap((row) => row.cells.flatMap((cell) => collectTextLeaves(cell.content)));
  });

const setRichTextFontFamily = (doc: RichTextDoc, fontFamily: string) =>
  mapRichTextDocText(doc, (inline) => ({ ...inline, fontFamily }));

const setRichTextFontSize = (doc: RichTextDoc, fontSize: string) =>
  mapRichTextDocText(doc, (inline) => ({ ...inline, fontSize }));

const setRichTextColor = (doc: RichTextDoc, color: string) =>
  mapRichTextDocText(doc, (inline) => ({ ...inline, color }));

const setRichTextHighlightColor = (doc: RichTextDoc, color: string) =>
  mapRichTextDocText(doc, (inline) => {
    if (color === "transparent") {
      const { highlightColor: _highlightColor, ...rest } = inline;
      return rest;
    }

    return { ...inline, highlightColor: color };
  });

const toggleRichTextMark = (doc: RichTextDoc, mark: TextMark) => {
  const textLeaves = collectTextLeaves(doc.content);
  const shouldRemove = textLeaves.length > 0 && textLeaves.every((inline) => inline.marks?.includes(mark));

  return mapRichTextDocText(doc, (inline) => {
    const marks = inline.marks ?? [];
    return {
      ...inline,
      marks: shouldRemove
        ? marks.filter((current) => current !== mark)
        : Array.from(new Set([...marks, mark])),
    };
  });
};

export const App = () => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const autosaveTimeoutRef = useRef<number | null>(null);
  const pageSwipeGestureRef = useRef<{
    pageIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    isHorizontal: boolean;
    moved: boolean;
  } | null>(null);
  const suppressNextCanvasClickRef = useRef(false);
  const dragDidMoveRef = useRef(false);
  const resizeDidMoveRef = useRef(false);
  const transientHistoryBaseRef = useRef<DocumentFile | null>(null);
  const textDraftHistoryRef = useRef<{ nodeId: string; updatedAt: number } | null>(null);
  const editorCommandNonceRef = useRef(0);
  const zoomSettleTimeoutRef = useRef<number | null>(null);
  const initialDocumentRef = useRef<DocumentFile | null>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  if (!initialDocumentRef.current) {
    initialDocumentRef.current = createEmptyDocument();
  }
  const [documentFile, setDocumentFile] = useState<DocumentFile>(initialDocumentRef.current);
  const documentFileRef = useRef<DocumentFile>(initialDocumentRef.current);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [selectionFormat, setSelectionFormat] = useState<{ fontFamily: string | null; fontSize: string | null } | null>(null);
  const [interaction, setInteraction] = useState<InteractionState>({ type: "none" });
  const [connectorMode, setConnectorMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [editorCommand, setEditorCommand] = useState<TextEditorCommand | null>(null);
  const [pendingNodeLinkRef, setPendingNodeLinkRef] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [editorContentRevision, setEditorContentRevision] = useState(0);
  const [zoomTransitionActive, setZoomTransitionActive] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "pending" | "saved">("idle");
  const [autosaveRestoreAvailable, setAutosaveRestoreAvailable] = useState(false);
  const [windowAlwaysOnTop, setWindowAlwaysOnTop] = useState(false);
  const [currentSavePath, setCurrentSavePath] = useState<string | null>(null);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [workspaceDocumentSummaries, setWorkspaceDocumentSummaries] = useState<WorkspaceDocumentSummary[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fileTreeOrder, setFileTreeOrder] = useState(readStoredFileTreeOrder);
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(readStoredFileSidebarCollapsed);
  const [pageSidebarCollapsed, setPageSidebarCollapsed] = useState(readStoredPageSidebarCollapsed);
  const [openingWorkspaceFilePath, setOpeningWorkspaceFilePath] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenuState>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState>(null);
  const [pageClipboard, setPageClipboard] = useState<PageClipboardState | null>(null);
  const [markdownDialog, setMarkdownDialog] = useState<MarkdownDialogState>(null);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[] | null>(null);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [nodeLinkPopover, setNodeLinkPopover] = useState<{ x: number; y: number; refs: ReferenceNodeRef[]; title: string; fullText?: string; previewContent?: import("../ui/ReferencePopover").PreviewContent; filePath?: string; links?: ReferenceLink[]; onAddRef?: () => void; onRemoveRef?: () => void } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("current-document");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [highlightQuery, setHighlightQuery] = useState("");
  const searchDebounceRef = useRef<number | null>(null);
  const openWorkspaceFileRef = useRef<(filePath: string, targetPageIndex?: number) => Promise<void>>(async () => {});
  const [nodeLinkPicker, setNodeLinkPicker] = useState<{ editingNodeId: string; x: number; y: number } | null>(null);
  const [externalDocPickerTab, setExternalDocPickerTab] = useState<"current" | "external">("current");
  const [linkPickerSearch, setLinkPickerSearch] = useState("");
  const [externalDocNodes, setExternalDocNodes] = useState<{ filePath: string; fileName: string; nodes: { id: string; pageIndex: number; type: string }[] }[] | null>(null);
  const [externalDocsLoading, setExternalDocsLoading] = useState(false);
  const [expandedExternalDocs, setExpandedExternalDocs] = useState<Set<string>>(new Set());
  const [expandedExternalDocPages, setExpandedExternalDocPages] = useState<Record<string, Set<number>>>({});
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null);
  const [renamingFileName, setRenamingFileName] = useState("");
  const [renamingDirectoryPath, setRenamingDirectoryPath] = useState<string | null>(null);
  const [renamingDirectoryName, setRenamingDirectoryName] = useState("");
  const [renamingPageIndex, setRenamingPageIndex] = useState<number | null>(null);
  const [renamingPageTitle, setRenamingPageTitle] = useState("");
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [lastSelectedFilePath, setLastSelectedFilePath] = useState<string | null>(null);
  const [managedAssetUrls, setManagedAssetUrls] = useState<Record<string, string>>({});
  const historyPastRef = useRef<DocumentFile[]>([]);
  const historyFutureRef = useRef<DocumentFile[]>([]);
  const persistedSnapshotRef = useRef(serializeDocument(initialDocumentRef.current));
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [swipedPageIndex, setSwipedPageIndex] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [canvasViewportSize, setCanvasViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    documentFileRef.current = documentFile;
  }, [documentFile]);

  useEffect(() => {
    window.electronApp?.isWindowAlwaysOnTop?.()
      .then(setWindowAlwaysOnTop)
      .catch(() => {});
  }, []);

  const selectedTextNode = (
    selectedNodeIds.length === 1
      ? documentFile.nodes.find((node): node is TextNodeModel => node.id === selectedNodeIds[0] && node.type === "text")
      : undefined
  );
  const selectedConnector = (
    selectedNodeIds.length === 1
      ? documentFile.nodes.find((node): node is ConnectorNode => node.id === selectedNodeIds[0] && node.type === "connector")
      : undefined
  );
  const hasSelectedTextNodes = selectedNodeIds.some((nodeId) =>
    documentFile.nodes.some((node) => node.id === nodeId && node.type === "text"),
  );
  const selectedTextNodeHasTable = selectedTextNode?.content.content.some((block) => block.type === "table") ?? false;
  const pageCount = Math.max(documentFile.appearance.pages.count, inferRequiredPageCount(documentFile));
  const visiblePageNodes = documentFile.nodes
    .filter((node) => node.pageIndex === activePageIndex)
    .sort((left, right) => left.z - right.z);
  const visiblePageBoxNodes = visiblePageNodes.filter((n): n is BoxCanvasNode => n.type !== "connector" && n.type !== "timeline");
  const visibleTimelineNodes = visiblePageNodes.filter((n): n is TimelineNodeType => n.type === "timeline");
  const visiblePageConnectors = visiblePageNodes.filter((node): node is ConnectorNode => node.type === "connector");
  const currentPageTitle = documentFile.appearance.pages.titles?.[activePageIndex] ?? "";
  const currentPageDateTime = formatPageDateTime(documentFile.meta.createdAt);
  const currentFileName = currentSavePath?.split(/[\\/]/).pop() ?? fileHandleRef.current?.name ?? fileNameFromMeta(documentFile);
  const currentDisplayFileName = getDisplayFileName(currentFileName);
  const pageSummaries = useMemo(() => Array.from({ length: pageCount }, (_, index) => {
    const explicitTitle = documentFile.appearance.pages.titles?.[index]?.trim();
    if (explicitTitle) {
      return explicitTitle;
    }

    const firstTextNode = documentFile.nodes
      .filter((node): node is TextNodeModel => node.type === "text" && node.pageIndex === index)
      .sort((left, right) => (left.y - right.y) || (left.x - right.x) || (left.z - right.z))[0];
    const firstLine = firstTextNode
      ? plainTextFromRichTextDoc(firstTextNode.content).split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
      : undefined;

    return firstLine ?? `空白页 ${index + 1}`;
  }), [documentFile.appearance.pages.titles, documentFile.nodes, pageCount]);
  const orderedWorkspaceEntries = useMemo(
    () => orderWorkspaceEntries(workspaceEntries, fileTreeOrder, workspaceRootPath),
    [fileTreeOrder, workspaceEntries, workspaceRootPath],
  );

  useEffect(() => {
    refreshWorkspaceEntries().catch(() => {});
  }, []);

  useEffect(() => {
    if (currentSavePath) {
      expandDirectoriesForFile(currentSavePath);
    }
  }, [currentSavePath, workspaceRootPath]);

  useEffect(() => {
    if (!sidebarContextMenu && !canvasContextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".context-menu")) {
        return;
      }
      setSidebarContextMenu(null);
      setCanvasContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarContextMenu(null);
        setCanvasContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarContextMenu, canvasContextMenu]);

  useEffect(() => {
    setStoredPageIndex(documentFile.meta.id, activePageIndex, currentSavePath);
  }, [activePageIndex, currentSavePath, documentFile.meta.id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(FILE_SIDEBAR_COLLAPSED_STORAGE_KEY, fileSidebarCollapsed ? "true" : "false");
  }, [fileSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PAGE_SIDEBAR_COLLAPSED_STORAGE_KEY, pageSidebarCollapsed ? "true" : "false");
  }, [pageSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(FILE_TREE_ORDER_STORAGE_KEY, JSON.stringify(fileTreeOrder));
  }, [fileTreeOrder]);

  const syncEditorStateToDocument = (nextDocument: DocumentFile) => {
    const nextNodeIds = new Set(nextDocument.nodes.map((node) => node.id));
    setSelectedNodeIds((current) => current.filter((id) => nextNodeIds.has(id)));
    setEditingNodeId((current) => (current && nextNodeIds.has(current) ? current : null));
  };

  const updateDirtyFromDocument = (nextDocument: DocumentFile) => {
    setIsDirty(serializeDocument(nextDocument) !== persistedSnapshotRef.current);
  };

  const clampDocumentToViewport = (nextDocument: DocumentFile) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect
      ? {
          ...nextDocument,
          viewState: clampViewStateToPage(nextDocument.viewState, nextDocument.pageBounds, rect),
        }
      : nextDocument;
  };

  const pushHistory = (snapshot: DocumentFile) => {
    historyPastRef.current = [...historyPastRef.current, snapshot].slice(-100);
    historyFutureRef.current = [];
  };

  const resetHistory = () => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
  };

  const clearCurrentFileBinding = () => {
    fileHandleRef.current = null;
    setActiveFileHandle(null);
    setCurrentSavePath(null);
  };

  const expandDirectoriesForFile = (filePath: string) => {
    if (!workspaceRootPath || !filePath.startsWith(workspaceRootPath)) {
      return;
    }

    const relativePath = filePath.slice(workspaceRootPath.length).replace(/^[\\/]+/, "");
    const segments = relativePath.split(/[\\/]/).filter(Boolean);
    if (segments.length <= 1) {
      return;
    }

    const separator = workspaceRootPath.includes("\\") ? "\\" : "/";
    const nextDirectories: string[] = [];
    let currentPath = workspaceRootPath;

    for (const segment of segments.slice(0, -1)) {
      currentPath = `${currentPath}${separator}${segment}`;
      nextDirectories.push(currentPath);
    }

    setExpandedDirectories((current) => Array.from(new Set([...current, ...nextDirectories])));
  };

  const refreshWorkspaceEntries = async () => {
    if (!window.electronApp?.listWorkspaceEntries) {
      return;
    }

    setWorkspaceLoading(true);
    try {
      const [entriesResult, summariesResult] = await Promise.all([
        window.electronApp.listWorkspaceEntries(),
        window.electronApp.listWorkspaceDocumentSummaries?.(),
      ]);
      setWorkspaceRootPath(entriesResult.rootPath);
      setWorkspaceEntries(entriesResult.entries);
      setWorkspaceDocumentSummaries(summariesResult?.documents ?? []);
      setWorkspaceError(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "读取工作目录失败。");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const clearAutosave = () => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.electronApp?.clearAutosaveDocument) {
      void window.electronApp.clearAutosaveDocument();
      return;
    }

    window.localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  };

  const syncPageSelection = (nextDocument: DocumentFile) => {
    const nextPageCount = Math.max(nextDocument.appearance.pages.count, inferRequiredPageCount(nextDocument));
    setActivePageIndex((current) => Math.min(current, nextPageCount - 1));
  };

  const applyDocumentState = (
    updater: DocumentFile | ((current: DocumentFile) => DocumentFile),
    options?: {
      markDirty?: boolean;
      recordHistory?: boolean;
      historyBase?: DocumentFile | null;
      clearFuture?: boolean;
    },
  ) => {
    const currentDocument = documentFileRef.current;
    const resolved = typeof updater === "function"
      ? (updater as (current: DocumentFile) => DocumentFile)(currentDocument)
      : updater;
    const nextDocument = clampDocumentToViewport(resolved);

    if (serializeDocument(currentDocument) === serializeDocument(nextDocument)) {
      return;
    }

    if (options?.recordHistory) {
      pushHistory(options.historyBase ?? currentDocument);
    } else if (options?.clearFuture) {
      historyFutureRef.current = [];
    }

    documentFileRef.current = nextDocument;
    setDocumentFile(nextDocument);
    syncEditorStateToDocument(nextDocument);
    syncPageSelection(nextDocument);
    if (options?.markDirty === false) {
      setIsDirty(false);
    } else {
      updateDirtyFromDocument(nextDocument);
    }
  };

  const loadIntoEditor = (
    loaded: DocumentFile,
    options?: {
      savePath?: string | null;
      fileHandle?: FileSystemFileHandle | null;
    },
  ) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const nextDocument = rect
      ? {
          ...loaded,
          viewState: clampViewStateToPage(loaded.viewState, loaded.pageBounds, rect),
        }
      : loaded;

    persistedSnapshotRef.current = serializeDocument(nextDocument);
    resetHistory();
    documentFileRef.current = nextDocument;
    setDocumentFile(nextDocument);
    const nextSavePath = options?.savePath ?? null;
    const pageStatePath = nextSavePath ?? options?.fileHandle?.name ?? null;
    const maxPageCount = Math.max(nextDocument.appearance.pages.count, inferRequiredPageCount(nextDocument));
    setActivePageIndex(getStoredPageIndex(nextDocument.meta.id, maxPageCount, pageStatePath));
    setCurrentSavePath(nextSavePath);
    fileHandleRef.current = options?.fileHandle ?? null;
    setActiveFileHandle(fileHandleRef.current);
    setManagedAssetUrls({});
    setSelectedNodeIds([]);
    setEditingNodeId(null);
    setErrorMessage(null);
    setIsDirty(false);
    setAutosaveRestoreAvailable(false);
    setAutosaveStatus("idle");
  };

  const applyAutosaveDocument = (raw: string) => {
    // Autosave data may contain both document JSON and the original save path
    // (wrapped since fix for subdirectory save-path loss). Handle both old and new formats.
    let docData: unknown;
    let savedPath: string | undefined;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "doc" in parsed && !Array.isArray(parsed)) {
        // New format: { path: string | null, doc: DocumentFile }
        savedPath = typeof parsed.path === "string" ? parsed.path : undefined;
        docData = parsed.doc;
      } else {
        // Old format: just the document JSON
        docData = parsed;
      }
    } catch {
      docData = null;
    }

    const restored = parseDocumentSchema(docData);
    loadIntoEditor(restored, savedPath ? { savePath: savedPath } : undefined);
    setAutosaveRestoreAvailable(false);
    setAutosaveStatus("saved");
  };

  const patchDocument = (updater: (current: DocumentFile) => DocumentFile, markDirty = true) => {
    applyDocumentState(updater, {
      markDirty,
      recordHistory: markDirty,
      clearFuture: markDirty,
    });
  };

  const settleDocumentLayout = (document: DocumentFile) => {
    const nodeBounds = fitPageBoundsToNodes(document.nodes);
    const nextPageBounds = {
      ...nodeBounds,
      h: Math.max(nodeBounds.h, document.appearance.pages.height),
    };
    const rect = canvasRef.current?.getBoundingClientRect();
    const nextPageCount = Math.max(document.appearance.pages.count, inferRequiredPageCount(document));

    return {
      ...document,
      appearance: {
        ...document.appearance,
        pages: {
          ...document.appearance.pages,
          count: nextPageCount,
        },
      },
      pageBounds: nextPageBounds,
      viewState: rect ? clampViewStateToPage(document.viewState, nextPageBounds, rect) : document.viewState,
    };
  };

  const updateNode = (
    nodeId: string,
    updater: (node: CanvasNode) => CanvasNode,
    markDirty = true,
    options?: { avoidVerticalOverlap?: boolean },
  ) => {
    patchDocument((current) => updateNodeInDocument(current, nodeId, updater, options), markDirty);
  };

  const getNodeById = (nodeId: string | null | undefined, nodes: CanvasNode[] = documentFile.nodes) => {
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;
    return node && isBoxCanvasNode(node) ? node : undefined;
  };

  const getNodeAtViewportPoint = (clientX: number, clientY: number, nodes: CanvasNode[] = documentFile.nodes) => {
    const element = document.elementFromPoint(clientX, clientY);
    return getNodeById(getCanvasNodeIdFromTarget(element), nodes);
  };

  const findConnectorAtPoint = (point: { x: number; y: number }) => {
    return [...visiblePageConnectors]
      .sort((left, right) => right.z - left.z)
      .find((connector) => {
        const start = resolveConnectorEndpoint(connector, "start", documentFile.nodes);
        const end = resolveConnectorEndpoint(connector, "end", documentFile.nodes);
        return distanceToSegment(point, start, end) <= 8 / documentFile.viewState.zoom;
      });
  };

  const getTemporaryConnector = () => {
    if (interaction.type !== "draw-connector") {
      return null;
    }

    return {
      x1: interaction.startX,
      y1: interaction.startY,
      x2: interaction.currentX,
      y2: interaction.currentY,
    };
  };

  const updateTextNodeDraft = (
    nodeId: string,
    content: RichTextDoc,
    options?: { history?: "checkpoint" | "coalesce" },
  ) => {
    const now = Date.now();
    const previousDraft = textDraftHistoryRef.current;
    const shouldRecordHistory = options?.history === "checkpoint"
      || !previousDraft
      || previousDraft.nodeId !== nodeId
      || now - previousDraft.updatedAt > TEXT_DRAFT_HISTORY_INTERVAL_MS;

    applyDocumentState(
      (current) => updateNodeInDocument(current, nodeId, (node) =>
        node.type === "text"
          ? { ...node, content }
          : node),
      {
        markDirty: true,
        recordHistory: shouldRecordHistory,
        clearFuture: true,
      },
    );
    textDraftHistoryRef.current = { nodeId, updatedAt: now };
  };

  const updateSelectedTextNodes = (updater: (content: RichTextDoc) => RichTextDoc) => {
    const selectedSet = new Set(selectedNodeIds);
    const hasTarget = documentFile.nodes.some((node) => selectedSet.has(node.id) && node.type === "text");
    if (!hasTarget) {
      return false;
    }

    patchDocument((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        selectedSet.has(node.id) && node.type === "text"
          ? { ...node, content: updater(node.content) }
          : node,
      ),
    }));
    return true;
  };

  const deleteSelectedNodes = () => {
    if (selectedNodeIds.length === 0) {
      return false;
    }

    const selectedSet = new Set(selectedNodeIds);
    patchDocument((current) => settleDocumentLayout({
      ...current,
      nodes: current.nodes.filter((node) => !selectedSet.has(node.id)),
    }));
    setSelectedNodeIds([]);
    setEditingNodeId(null);
    return true;
  };

  const beginEditingTextNode = (nodeId: string) => {
    selectNode(nodeId);

    if (editingNodeId && editingNodeId !== nodeId) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }

      window.requestAnimationFrame(() => {
        setEditingNodeId(nodeId);
      });
      return;
    }

    setEditingNodeId(nodeId);
  };

  const runQuickEditCommand = (command: TextEditorCommand) => {
    if (!selectedTextNode || editingNodeId) {
      return false;
    }

    setEditingNodeId(selectedTextNode.id);
    setEditorCommand(command);
    return true;
  };

  const scheduleZoomSettle = () => {
    if (zoomSettleTimeoutRef.current !== null) {
      window.clearTimeout(zoomSettleTimeoutRef.current);
    }

    setZoomTransitionActive(true);
    zoomSettleTimeoutRef.current = window.setTimeout(() => {
      const rect = canvasRef.current?.getBoundingClientRect();

      if (rect) {
        setDocumentFile((current) => ({
          ...current,
          viewState: clampViewStateToPage(current.viewState, current.pageBounds, rect),
        }));
      }

      setZoomTransitionActive(false);
      zoomSettleTimeoutRef.current = null;
    }, ZOOM_SETTLE_DELAY_MS);
  };

  const selectNode = (nodeId: string) => {
    if (suppressNextCanvasClickRef.current) {
      suppressNextCanvasClickRef.current = false;
      return;
    }

    setSelectedNodeIds([nodeId]);
    canvasRef.current?.focus();
  };

  const handleNewDocument = () => {
    if (!canDiscardUnsavedChanges(isDirty)) {
      return;
    }

    const nextDocument = createEmptyDocument();
    loadIntoEditor(nextDocument);
    clearAutosave();

    if (window.electronApp?.saveDocumentToPath) {
      void saveDocumentVersion(nextDocument, {
        autosave: true,
        filePath: null,
        fileHandle: null,
      });
    }
  };

  const handleSave = async () => {
    await saveCurrentDocument();
  };

  const saveDocumentVersion = async (
    nextDocument: DocumentFile,
    options: {
      forcePrompt?: boolean;
      autosave?: boolean;
      filePath?: string | null;
      fileHandle?: FileSystemFileHandle | null;
    } = {},
  ) => {
    const saveResult = await saveDocumentToDisk(nextDocument, {
      fileName: fileNameFromMeta(nextDocument),
      filePath: "filePath" in options ? options.filePath : currentSavePath,
      fileHandle: "fileHandle" in options ? options.fileHandle : fileHandleRef.current,
      forcePrompt: options.forcePrompt,
    });
    if (!saveResult) {
      return null;
    }
    const savedPath = typeof saveResult === "string" ? saveResult : null;
    const savedHandle = saveResult instanceof FileSystemFileHandle ? saveResult : null;
    persistedSnapshotRef.current = serializeDocument(nextDocument);
    setDocumentFile(nextDocument);
    if (savedPath) {
      setCurrentSavePath(savedPath);
      expandDirectoriesForFile(savedPath);
    }
    if (savedHandle) {
      fileHandleRef.current = savedHandle;
      setActiveFileHandle(savedHandle);
    }
    setActivePageIndex(Math.min(activePageIndex, nextDocument.appearance.pages.count - 1));
    setIsDirty(false);
    setAutosaveStatus(options.autosave ? "saved" : "idle");
    if (!options.autosave) {
      clearAutosave();
    }
    refreshWorkspaceEntries().catch(() => {});
    return savedPath;
  };

  const saveCurrentDocument = async (forcePrompt = false) => {
    const nextDocument = touchDocument(documentFile);
    return saveDocumentVersion(nextDocument, { forcePrompt });
  };

  const handleSaveAs = async () => {
    await saveCurrentDocument(true);
  };

  const handleUndo = () => {
    const previous = historyPastRef.current.at(-1);
    if (!previous) {
      return;
    }

    textDraftHistoryRef.current = null;
    const currentDocument = documentFileRef.current;
    historyPastRef.current = historyPastRef.current.slice(0, -1);
    historyFutureRef.current = [currentDocument, ...historyFutureRef.current].slice(0, 100);
    applyDocumentState(previous, { clearFuture: false });
    setEditorContentRevision((current) => current + 1);
  };

  const handleRedo = () => {
    const next = historyFutureRef.current[0];
    if (!next) {
      return;
    }

    textDraftHistoryRef.current = null;
    const currentDocument = documentFileRef.current;
    historyFutureRef.current = historyFutureRef.current.slice(1);
    historyPastRef.current = [...historyPastRef.current, currentDocument].slice(-100);
    applyDocumentState(next, { clearFuture: false });
    setEditorContentRevision((current) => current + 1);
  };

  const handleOpenClick = async () => {
    if (!canDiscardUnsavedChanges(isDirty)) {
      return;
    }

    if (window.electronApp) {
      try {
        const result = await window.electronApp.openDocumentFromPath();
        if (!result) {
          return;
        }

        const loaded = loadDocumentFromRaw({
          fileName: result.fileName,
          rawText: result.rawText,
          bytes: new Uint8Array(result.bytes),
        });

        loadIntoEditor(loaded, {
          savePath: result.filePath,
        });
        expandDirectoriesForFile(result.filePath);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
      }
      return;
    }

    try {
      const result = await openFileWithPicker();
      if (!result) {
        return;
      }

      const loaded = await loadDocumentFromFile(result.file);
      loadIntoEditor(loaded, {
        fileHandle: result.handle,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
    }
  };
  const handleImageClick = () => imageInputRef.current?.click();
  const handleAttachmentClick = async () => {
    if (window.electronApp?.pickAndImportAttachment) {
      const documentPath = currentSavePath ?? await saveCurrentDocument(true);
      if (!documentPath) {
        return;
      }

      try {
        const imported = await window.electronApp.pickAndImportAttachment({ documentPath });
        if (!imported) {
          return;
        }

        const assetId = createAssetId();
        const icon = isPdfAttachment(imported.mimeType, imported.name) ? "PDF" : "FILE";

        patchDocument((current) => ({
          ...current,
          assets: {
            ...current.assets,
            [assetId]: {
              id: assetId,
              type: isPdfAttachment(imported.mimeType, imported.name) ? "pdf" : "file",
              storage: "managed",
              mimeType: imported.mimeType,
              name: imported.name,
              relativePath: imported.relativePath,
              sizeBytes: imported.sizeBytes,
            },
          },
        }));
        setManagedAssetUrls((current) => ({
          ...current,
          [assetId]: imported.filePath,
        }));

        // Insert attachment inline into text node
        if (editingNodeId || selectedTextNode) {
          const command: TextEditorCommand = {
            type: "insert-attachment",
            nonce: editorCommandNonceRef.current++,
            placement: editingNodeId ? "caret" : "end",
            assetId,
            name: imported.name,
            data: imported.mimeType,
          };

          if (editingNodeId) {
            setEditorCommand(command);
          } else {
            runQuickEditCommand(command);
          }
        } else {
          // No text node available: create a TextNode with the attachment
          const nodeId = createNodeId("text");
          patchDocument((current) => {
            const insertionPoint = getPageInsertionPoint(current, activePageIndex);
            const offset = getInsertOffset(current.nodes.filter((node) => node.pageIndex === activePageIndex).length);
            return addNodeToDocument(current, {
              id: nodeId,
              type: "text",
              pageIndex: activePageIndex,
              x: insertionPoint.x + offset.x,
              y: insertionPoint.y + offset.y,
              w: 360,
              h: 60,
              z: 1,
              style: {},
              content: {
                type: "doc",
                content: [{
                  type: "paragraph",
                  content: [{ type: "image", assetId }],
                }],
              },
            });
          });
          setSelectedNodeIds([nodeId]);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "附件导入失败。");
      }
      return;
    }

    attachmentInputRef.current?.click();
  };

  const handleOpenAttachment = async (assetId: string) => {
    const asset = documentFile.assets[assetId];
    if (!asset) return;

    // Managed attachment: resolve file path and open with system default app
    if (asset.storage === "managed" && asset.relativePath && currentSavePath) {
      if (window.electronApp?.resolveAttachmentUrl) {
        try {
          const filePath = await window.electronApp.resolveAttachmentUrl({
            documentPath: currentSavePath,
            relativePath: asset.relativePath,
          });
          const openPath = resolveManagedAttachmentOpenPath(filePath, managedAssetUrls[assetId]);
          if (openPath && window.electronApp?.openPath) {
            await window.electronApp.openPath(openPath);
            return;
          }
        } catch { /* fall through */ }
      }
      const cachedFilePath = resolveManagedAttachmentOpenPath(null, managedAssetUrls[assetId]);
      if (cachedFilePath) {
        if (window.electronApp?.openPath) {
          await window.electronApp.openPath(cachedFilePath);
        } else if (window.electronApp?.openExternal) {
          window.electronApp.openExternal(cachedFilePath);
        }
        return;
      }
    }

    // Embedded attachment: trigger download via Blob
    if (asset.storage === "embedded" && asset.data) {
      try {
        const response = await fetch(asset.data);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = asset.name || "attachment";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // Fallback: open data URL directly (works for PDFs, images, text)
        window.open(asset.data, "_blank");
      }
    }
  };

  const handleInsertTimelineExample = () => {
    if (editingNodeId) {
      setEditorCommand({
        type: "insert-timeline-example",
        placement: "caret",
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    runQuickEditCommand({
      type: "insert-timeline-example",
      placement: "end",
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleInsertTable = () => {
    if (editingNodeId) {
      setEditorCommand({
        type: "insert-table",
        placement: "caret",
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    runQuickEditCommand({
      type: "insert-table",
      placement: "end",
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleClearEmptyLines = () => {
    if (editingNodeId) {
      setEditorCommand({
        type: "clear-empty-lines",
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    updateSelectedTextNodes((content) => clearEmptyParagraphs(content));
  };

  const handleInsertTableColumn = () => {
    if (!editingNodeId) {
      return;
    }

    setEditorCommand({
      type: "insert-table-column",
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleInsertTableColumnLeft = () => {
    if (!editingNodeId) {
      return;
    }

    setEditorCommand({
      type: "insert-table-column-left",
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleDeleteTableColumn = () => {
    if (!editingNodeId) {
      return;
    }

    setEditorCommand({
      type: "delete-table-column",
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleSetFontFamily = (fontFamily: string) => {
    if (editingNodeId) {
      setEditorCommand({
        type: "set-font-family",
        fontFamily,
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    updateSelectedTextNodes((content) => setRichTextFontFamily(content, fontFamily));
  };

  const handleSetTextColor = (color: string) => {
    if (editingNodeId) {
      setEditorCommand({
        type: "set-text-color",
        color,
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    updateSelectedTextNodes((content) => setRichTextColor(content, color));
  };

  const handleSetFontSize = (fontSize: string) => {
    console.log("[cell-sel] App handleSetFontSize:", fontSize, "editingNodeId:", editingNodeId);
    if (editingNodeId) {
      setEditorCommand({
        type: "set-font-size",
        fontSize,
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    updateSelectedTextNodes((content) => setRichTextFontSize(content, fontSize));
  };

  const handleSetHighlightColor = (color: string) => {
    if (editingNodeId) {
      setEditorCommand({
        type: "set-highlight-color",
        color,
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    updateSelectedTextNodes((content) => setRichTextHighlightColor(content, color));
  };

  const handleApplyBlockStyle = (
    blockStyle: string,
    preset?: {
      tag: string;
      fontSize?: string;
      color?: string;
      fontFamily?: string;
      bold?: boolean;
      italic?: boolean;
      lineHeight?: string;
    },
  ) => {
    console.log("[cell-sel] App handleApplyBlockStyle:", blockStyle, "editingNodeId:", editingNodeId);
    if (!editingNodeId) {
      return;
    }

    setEditorCommand({
      type: "apply-block-style",
      blockStyle,
      blockStylePreset: preset,
      nonce: editorCommandNonceRef.current++,
    });
  };

  const handleToggleInlineStyle = (type: "toggle-bold" | "toggle-italic" | "toggle-underline" | "toggle-strike") => {
    if (editingNodeId) {
      setEditorCommand({
        type,
        nonce: editorCommandNonceRef.current++,
      });
      return;
    }

    const markByCommand = {
      "toggle-bold": "bold",
      "toggle-italic": "italic",
      "toggle-underline": "underline",
      "toggle-strike": "strike",
    } as const satisfies Record<"toggle-bold" | "toggle-italic" | "toggle-underline" | "toggle-strike", TextMark>;

    updateSelectedTextNodes((content) => toggleRichTextMark(content, markByCommand[type]));
  };

  const handleSetPageBackground = (color: string) => {
    patchDocument((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        pageBackground: color,
      },
    }));
  };

  const handleSetGridEnabled = (enabled: boolean) => {
    patchDocument((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        grid: {
          ...current.appearance.grid,
          enabled,
        },
      },
    }));
  };

  const handleSetGridColor = (color: string) => {
    patchDocument((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        grid: {
          ...current.appearance.grid,
          color,
        },
      },
    }));
  };

  const handleSetGridSize = (size: number) => {
    patchDocument((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        grid: {
          ...current.appearance.grid,
          size,
        },
      },
    }));
  };

  const handleZoomChange = (zoom: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    scheduleZoomSettle();
    setDocumentFile((current) => {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const zoomedViewState = zoomAtPoint(current.viewState, centerX, centerY, rect, clampZoom(zoom));

      return {
        ...current,
        viewState: zoomedViewState,
      };
    });
  };

  const handleAddTextAt = (x: number, y: number) => {
    const node = {
      ...createTextNode(x, y),
      pageIndex: activePageIndex,
      content: createDefaultRichTextDoc(""),
    };

    patchDocument((current) => addNodeToDocument(current, node));
    setSelectedNodeIds([node.id]);
    setEditingNodeId(node.id);
  };

  const handleDropTextAt = (x: number, y: number, text: string) => {
    if (text.trim().length === 0) {
      return;
    }

    const node = {
      ...createTextNode(x, y),
      pageIndex: activePageIndex,
      content: plainTextToRichTextDoc(text),
    };

    patchDocument((current) => addNodeToDocument(current, node));
    setSelectedNodeIds([node.id]);
    setEditingNodeId(null);
  };

  const handleInsertHtmlPreviewAt = (x: number, y: number, rawHtml: string, options?: { name?: string }) => {
    if (!looksLikeHtmlSource(rawHtml)) {
      return false;
    }

    const assetId = createAssetId();
    const preview = createHtmlPreviewAsset(rawHtml);
    const node = {
      ...createImageNode(x, y, assetId, 960, 720),
      pageIndex: activePageIndex,
      style: {
        kind: "html-preview",
      },
    };

    patchDocument((current) => addImageNodeToDocument(
      current,
      node,
      {
        id: assetId,
        type: "html",
        mimeType: "text/html",
        name: preview.title || options?.name || "HTML Block",
        data: preview.html,
      },
    ));
    setSelectedNodeIds([node.id]);
    setEditingNodeId(null);
    return true;
  };

  const handlePasteMarkdownAt = async (x: number, y: number) => {
    let markdown = "";

    try {
      markdown = await navigator.clipboard.readText();
    } catch {
      markdown = "";
    }

    if (!markdown.trim()) {
      setMarkdownDialog({ worldX: x, worldY: y, text: "" });
      return;
    }

    addMarkdownNodeAt(x, y, markdown);
  };

  const addMarkdownNodeAt = (x: number, y: number, markdown: string) => {
    if (!markdown.trim()) {
      return;
    }

    const node = {
      ...createTextNode(x, y),
      pageIndex: activePageIndex,
      w: 720,
      h: 360,
      content: parseMarkdownToRichTextDoc(markdown),
    };

    patchDocument((current) => addNodeToDocument(current, node));
    setSelectedNodeIds([node.id]);
    setEditingNodeId(null);
  };

  const handleOpenTrash = useCallback(async () => {
    if (!window.electronApp?.listTrashEntries) {
      setErrorMessage("回收站功能需要在桌面版中使用。");
      return;
    }
    try {
      const entries = await window.electronApp.listTrashEntries();
      setTrashEntries(entries);
      setTrashDialogOpen(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取回收站失败。");
    }
  }, []);

  const handleRestoreTrashEntry = useCallback(async (filePath: string) => {
    if (!window.electronApp?.restoreTrashEntry) return;
    try {
      const result = await window.electronApp.restoreTrashEntry({ filePath });
      setErrorMessage(null);
      // Refresh trash list
      const entries = await window.electronApp.listTrashEntries();
      setTrashEntries(entries);
      // Refresh workspace
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "还原失败。");
    }
  }, []);

  const handleEmptyTrash = useCallback(async () => {
    if (!window.electronApp?.emptyTrash || !window.confirm("确定清空回收站吗？此操作不可撤销。")) return;
    try {
      await window.electronApp.emptyTrash();
      setTrashEntries([]);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "清空回收站失败。");
    }
  }, []);

  const handleRequestInsertNodeLink = useCallback((editingNodeId: string, x: number, y: number) => {
    setNodeLinkPicker({ editingNodeId, x, y });
  }, []);

  /** For timeline entries: open picker, then update the entry's nodeRef */
  const [timelineNodeForRef, setTimelineNodeForRef] = useState<{ nodeId: string; entryIndex: number; x: number; y: number } | null>(null);

  const handleRequestInsertTimelineRef = useCallback((timelineNodeId: string, entryIndex: number, x: number, y: number) => {
    setTimelineNodeForRef({ nodeId: timelineNodeId, entryIndex, x, y });
    setNodeLinkPicker({ editingNodeId: timelineNodeId, x, y });
  }, []);

  /** Open a full-featured reference popover for a timeline entry (rich preview + links + add-ref) */
  /** Unified handler to open a reference popover for any node reference
   *  (used by both text inline references and timeline entry references). */
  const handleOpenNodePopover = useCallback(async (
    targetPageIndex: number,
    targetNodeId: string,
    x: number,
    y: number,
    documentPath?: string,
    extra?: {
      links?: ReferenceLink[];
      onAddRef?: () => void;
      onRemoveRef?: () => void;
    },
  ) => {
    const assets = documentFile.assets;

    // Cross-document reference
    if (documentPath && documentPath !== currentSavePath) {
      if (window.electronApp?.readExternalNodePreview) {
        try {
          const preview = await window.electronApp.readExternalNodePreview({ filePath: documentPath, nodeId: targetNodeId });
          if (preview) {
            const fileName = documentPath.split(/[\\/]/).pop() ?? "";
            const previewContent = (preview.content && preview.content.length > 0)
              ? { kind: "richText" as const, blocks: preview.content, assets: preview.assets ?? {} }
              : undefined;
            setNodeLinkPopover({
              x, y,
              title: `${preview.title} · ${fileName}`,
              previewContent,
              links: extra?.links,
              refs: [{
                pageIndex: preview.pageIndex,
                nodeId: preview.nodeId,
                label: preview.title,
                preview: preview.preview,
                filePath: documentPath,
              }],
              filePath: documentPath,
              onAddRef: extra?.onAddRef,
              onRemoveRef: extra?.onRemoveRef,
            });
            return;
          }
        } catch {
          // fall through to basic info
        }
      }
      // Fallback: show basic info
      const fileName = documentPath.split(/[\\/]/).pop() ?? "";
      setNodeLinkPopover({
        x, y,
        title: `节点 ${targetNodeId} · ${fileName}`,
        refs: [{ pageIndex: targetPageIndex, nodeId: targetNodeId, label: targetNodeId, preview: "来自其他文档", filePath: documentPath }],
        filePath: documentPath,
        onAddRef: extra?.onAddRef,
        onRemoveRef: extra?.onRemoveRef,
      });
      return;
    }

    // Same-document reference
    const targetNode = documentFile.nodes.find((n) => n.id === targetNodeId);
    if (!targetNode) return;

    let title = targetNode.id;
    let preview = "";
    let previewContent: import("../ui/ReferencePopover").PreviewContent | undefined;

    if (targetNode.type === "text" && "content" in targetNode) {
      const blocks = targetNode.content.content;
      const firstPara = blocks.find((b) => b.type === "paragraph");
      if (firstPara) {
        const text = firstPara.content.map((i) => i.type === "text" ? i.text : "").join("").slice(0, 60);
        if (text) title = text;
      }
      previewContent = { kind: "richText", blocks, assets };
    } else if (targetNode.type === "shape" && "label" in targetNode && targetNode.label) {
      const labelBlocks = targetNode.label.content;
      const firstPara = labelBlocks.find((b) => b.type === "paragraph");
      if (firstPara) {
        title = firstPara.content.map((i) => i.type === "text" ? i.text : "").join("").slice(0, 60) || title;
      }
      previewContent = { kind: "richText", blocks: labelBlocks, assets };
    } else if (targetNode.type === "timeline") {
      title = targetNode.entries[0]?.category ?? "时间线";
      preview = `${targetNode.entries.length} 个条目`;
      previewContent = { kind: "text", text: preview };
    } else {
      preview = targetNode.type;
      previewContent = { kind: "text", text: targetNode.type };
    }

    setNodeLinkPopover({
      x, y,
      title,
      previewContent,
      links: extra?.links,
      refs: [{ pageIndex: targetPageIndex, nodeId: targetNodeId, label: title, preview, filePath: documentPath }],
      onAddRef: extra?.onAddRef,
      onRemoveRef: extra?.onRemoveRef,
    });
  }, [documentFile.nodes, documentFile.assets, currentSavePath]);

  /** Open reference popover for a timeline entry */
  const handleOpenTimelineRefPopover = useCallback((entry: TimelineNodeFields, entryIndex: number, timelineNodeId: string, x: number, y: number) => {
    if (!entry.nodeRef) return;

    const links: ReferenceLink[] = [];
    if (entry.doi) links.push({ label: "打开 DOI", url: entry.doi, type: "doi" });
    if (entry.arxiv) links.push({ label: "打开 arXiv", url: entry.arxiv, type: "arxiv" });
    if (entry.link) links.push({ label: "打开链接", url: entry.link, type: "url" });

    handleOpenNodePopover(
      entry.nodeRef.pageIndex,
      entry.nodeRef.nodeId,
      x, y,
      entry.nodeRef.documentPath,
      {
        links,
        onAddRef: () => {
          setNodeLinkPopover(null);
          setTimeout(() => handleRequestInsertTimelineRef(timelineNodeId, entryIndex, x, y), 50);
        },
        onRemoveRef: () => {
          patchDocument((current) => ({
            ...current,
            nodes: current.nodes.map((n) => {
              if (n.id === timelineNodeId && n.type === "timeline") {
                return {
                  ...n,
                  entries: n.entries.map((e, i) =>
                    i === entryIndex ? { ...e, nodeRef: undefined } : e
                  ),
                };
              }
              return n;
            }),
          }));
          setNodeLinkPopover(null);
        },
      },
    );
  }, [handleOpenNodePopover, patchDocument]);

  const handlePickNodeForLink = useCallback((pageIndex: number, nodeId: string, docPath?: string, paragraphIndex?: number) => {
    if (!nodeLinkPicker) return;
    // Find node title for label
    let label = nodeId;
    if (!docPath || docPath === currentSavePath) {
      const targetNode = documentFile.nodes.find((n) => n.id === nodeId);
      if (targetNode && targetNode.type === "text" && "content" in targetNode) {
        const firstPara = targetNode.content.content.find((b) => b.type === "paragraph");
        if (firstPara) {
          const text = firstPara.content.map((i) => i.type === "text" ? i.text : "").join("").trim().slice(0, 40);
          if (text) label = text;
        }
      } else if (targetNode && targetNode.type === "timeline") {
        label = targetNode.entries[0]?.category ?? nodeId;
      }
    }
    // Check if this is a timeline ref pick
    if (timelineNodeForRef) {
      patchDocument((current) => ({
        ...current,
        nodes: current.nodes.map((n) => {
          if (n.id === timelineNodeForRef.nodeId && n.type === "timeline") {
            return {
              ...n,
              entries: n.entries.map((e, i) =>
                i === timelineNodeForRef.entryIndex
                  ? { ...e, nodeRef: { pageIndex, nodeId, label, documentPath: docPath } }
                  : e
              ),
            };
          }
          return n;
        }),
      }));
      setTimelineNodeForRef(null);
      setNodeLinkPicker(null);
      return;
    }
    setEditorCommand({
      type: "insert-node-link",
      nonce: editorCommandNonceRef.current++,
      nodeLinkPage: pageIndex,
      nodeLinkId: nodeId,
      nodeLinkLabel: label,
      nodeLinkDoc: docPath,
      ...(paragraphIndex !== undefined ? { nodeLinkParagraphIndex: paragraphIndex } : {}),
    });
    setNodeLinkPicker(null);
  }, [nodeLinkPicker, documentFile.nodes, currentSavePath, timelineNodeForRef]);

  const handleCancelNodeLinkPicker = useCallback(() => {
    setNodeLinkPicker(null);
    setTimelineNodeForRef(null);
    setExternalDocPickerTab("current");
    setExternalDocNodes(null);
    setExpandedExternalDocs(new Set());
    setExpandedExternalDocPages({});
  }, []);

  const handleNodeLinkClick = useCallback(async (pageIndex: number, nodeId: string, x: number, y: number, documentPath?: string) => {
    handleOpenNodePopover(pageIndex, nodeId, x, y, documentPath);
  }, [handleOpenNodePopover]);

  // ── Search ──

  const runSearch = useCallback((query: string, scope: SearchScope) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchActiveIndex(0);
      return;
    }

    // Local search (current-page / current-document)
    if (scope === "current-page" || scope === "current-document") {
      const results = searchInNodes(
        documentFile.nodes,
        trimmed,
        scope,
        scope === "current-page" ? activePageIndex : undefined,
      );
      setSearchResults(results);
      setSearchActiveIndex(results.length > 0 ? Math.min(searchActiveIndex, results.length - 1) : 0);
      return;
    }

    // Workspace search via IPC
    if (scope === "workspace" && window.electronApp?.searchWorkspace) {
      window.electronApp.searchWorkspace({ query: trimmed, currentPath: currentSavePath ?? undefined })
        .then((results) => {
          setSearchResults(results ?? []);
          setSearchActiveIndex(0);
        })
        .catch(() => {
          setSearchResults([]);
        });
    }
  }, [documentFile.nodes, activePageIndex, searchActiveIndex, currentSavePath]);

  // Debounced search effect
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      runSearch(searchQuery, searchScope);
    }, 200);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, searchScope, runSearch]);

  // Center a node in the viewport (box nodes only — connectors can't be centered)
  const centerNodeInViewport = useCallback((nodeId: string, position: "center" | "top-left" = "center") => {
    const node = documentFile.nodes.find((n) => n.id === nodeId) as import("../model/types").BoxCanvasNode | undefined;
    if (!node || !("x" in node && "w" in node)) return;
    const zoom = documentFile.viewState.zoom;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    let targetX: number;
    let targetY: number;
    if (position === "top-left") {
      // Position node at roughly 1/3 from top-left of viewport
      targetX = -node.x * zoom + rect.width / 3;
      targetY = -node.y * zoom + rect.height / 3;
    } else {
      // Center node in the visible viewport area
      targetX = -(node.x + node.w / 2) * zoom + rect.width / 2;
      targetY = -(node.y + node.h / 2) * zoom + rect.height / 2;
    }

    patchDocument((current) => ({
      ...current,
      viewState: {
        ...current.viewState,
        cameraX: targetX,
        cameraY: targetY,
      },
    }));
  }, [documentFile.nodes, documentFile.viewState]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchActiveIndex(0);
    setHighlightQuery("");
  }, []);

  const handleSearchScopeChange = useCallback((scope: SearchScope) => {
    setSearchScope(scope);
    setSearchResults([]);
    setSearchActiveIndex(0);
    setHighlightQuery("");
  }, []);

  const handleSearchResultClick = useCallback((result: SearchResult) => {
    // Keep the current search context visible after navigation.
    setHighlightQuery(searchQuery);

    if (result.scope === "workspace" && result.filePath && result.filePath !== currentSavePath) {
      // Open external file then select node — use ref to avoid ordering issue
      const filePath = result.filePath;
      const targetNodeId = result.nodeId;
      const targetPage = result.pageIndex;
      // We call handleOpenWorkspaceFile via a ref to avoid TDZ issues with const ordering
      openWorkspaceFileRef.current(filePath, targetPage).then(() => {
        selectNode(targetNodeId);
        centerNodeInViewport(targetNodeId, "top-left");
      }).catch(() => {});
      return;
    }

    // Current document / page navigation
    const targetPage = result.pageIndex;
    if (targetPage !== activePageIndex) {
      handleSelectPage(targetPage + 1);
    }
    selectNode(result.nodeId);
    centerNodeInViewport(result.nodeId, "top-left");
  }, [currentSavePath, activePageIndex, searchQuery]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchActiveIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = searchResults[searchActiveIndex];
      if (active) {
        handleSearchResultClick(active);
      }
    }
  }, [searchResults, searchActiveIndex, handleSearchResultClick]);

  const handleSearchClose = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchActiveIndex(0);
    setHighlightQuery("");
  }, []);

  const handleCloseTrash = useCallback(() => {
    setTrashDialogOpen(false);
    setTrashEntries(null);
  }, []);

  const handleSubmitMarkdownDialog = () => {
    if (!markdownDialog) {
      return;
    }

    addMarkdownNodeAt(markdownDialog.worldX, markdownDialog.worldY, markdownDialog.text);
    setMarkdownDialog(null);
  };

  const handleOpenFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const loaded = await loadDocumentFromFile(file);
      loadIntoEditor(loaded, {
        savePath: ((file as File & { path?: string }).path) ?? null,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
    }
  };

  const handleOpenWorkspaceFile = async (filePath: string, targetPageIndex?: number) => {
    if (!window.electronApp?.openDocumentAtPath) {
      return;
    }

    if (openingWorkspaceFilePath) {
      return;
    }

    if (!canDiscardUnsavedChanges(isDirty)) {
      return;
    }

    setOpeningWorkspaceFilePath(filePath);
    try {
      const result = await window.electronApp.openDocumentAtPath({ filePath });
      if (!result) {
        return;
      }

      const loaded = loadDocumentFromRaw({
        fileName: result.fileName,
        rawText: result.rawText,
        bytes: new Uint8Array(result.bytes),
      });

      loadIntoEditor(loaded, {
        savePath: result.filePath,
      });
      expandDirectoriesForFile(result.filePath);
      setSelectedFilePaths([]);
      if (typeof targetPageIndex === "number") {
        const maxPageCount = Math.max(loaded.appearance.pages.count, inferRequiredPageCount(loaded));
        setActivePageIndex(Math.max(0, Math.min(targetPageIndex, maxPageCount - 1)));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
    } finally {
      setOpeningWorkspaceFilePath(null);
    }
  };

  // Keep ref in sync for search handler (avoids TDZ / ordering issues with const callbacks)
  openWorkspaceFileRef.current = handleOpenWorkspaceFile;

  const handleToggleDirectory = (directoryPath: string) => {
    setExpandedDirectories((current) =>
      current.includes(directoryPath)
        ? current.filter((item) => item !== directoryPath)
        : [...current, directoryPath],
    );
  };

  const handleBeginRenameWorkspaceFile = (filePath: string, currentName: string) => {
    setRenamingDirectoryPath(null);
    setRenamingDirectoryName("");
    setRenamingFilePath(filePath);
    setRenamingFileName(currentName);
  };

  const handleCommitWorkspaceFileRename = async () => {
    if (!renamingFilePath) {
      return;
    }

    if (!window.electronApp?.renameDocumentAtPath) {
      window.alert("重命名需要在桌面版中使用。");
      setRenamingFilePath(null);
      setRenamingFileName("");
      return;
    }

    const nextName = renamingFileName.trim();
    if (!nextName) {
      setRenamingFilePath(null);
      setRenamingFileName("");
      return;
    }

    try {
      const nextPath = await window.electronApp.renameDocumentAtPath({
        filePath: renamingFilePath,
        baseName: nextName,
      });

      if (currentSavePath === renamingFilePath) {
        setCurrentSavePath(nextPath);
      }

      const directoryPath = getParentDirectoryPath(renamingFilePath, workspaceRootPath) ?? "";
      setFileTreeOrder((current) => ({
        ...current,
        [directoryPath]: (current[directoryPath] ?? []).map((path) => (path === renamingFilePath ? nextPath : path)),
      }));
      setRenamingFilePath(null);
      setRenamingFileName("");
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名失败。");
    }
  };

  const handleCancelWorkspaceFileRename = () => {
    setRenamingFilePath(null);
    setRenamingFileName("");
  };

  const handleBeginRenameWorkspaceDirectory = (directoryPath: string, currentName: string) => {
    setRenamingFilePath(null);
    setRenamingFileName("");
    setRenamingDirectoryPath(directoryPath);
    setRenamingDirectoryName(currentName);
  };

  const handleCommitWorkspaceDirectoryRename = async () => {
    if (!renamingDirectoryPath) {
      return;
    }

    if (!window.electronApp?.renameWorkspaceDirectory) {
      setErrorMessage("重命名文件夹需要重启桌面版以加载最新文件操作能力。");
      setRenamingDirectoryPath(null);
      setRenamingDirectoryName("");
      return;
    }

    const directoryPath = renamingDirectoryPath;
    const name = renamingDirectoryName.trim();
    if (!name) {
      setRenamingDirectoryPath(null);
      setRenamingDirectoryName("");
      return;
    }

    try {
      const nextPath = await window.electronApp.renameWorkspaceDirectory({
        directoryPath,
        name,
      });
      setExpandedDirectories((current) => current.map((item) =>
        isPathInsideOrEqual(directoryPath, item)
          ? item.replace(directoryPath, nextPath)
          : item));
      setFileTreeOrder((current) => Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          isPathInsideOrEqual(directoryPath, key) ? key.replace(directoryPath, nextPath) : key,
          value.map((path) => (isPathInsideOrEqual(directoryPath, path) ? path.replace(directoryPath, nextPath) : path)),
        ]),
      ));
      if (currentSavePath && isPathInsideOrEqual(directoryPath, currentSavePath)) {
        setCurrentSavePath(currentSavePath.replace(directoryPath, nextPath));
      }
      setRenamingDirectoryPath(null);
      setRenamingDirectoryName("");
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名文件夹失败。");
    }
  };

  const handleCancelWorkspaceDirectoryRename = () => {
    setRenamingDirectoryPath(null);
    setRenamingDirectoryName("");
  };

  const rememberFileOrderPlacement = (
    filePath: string,
    targetFilePath: string,
    placement: "before" | "after",
  ) => {
    const targetDirectoryPath = getParentDirectoryPath(targetFilePath, workspaceRootPath);
    const sourceDirectoryPath = getParentDirectoryPath(filePath, workspaceRootPath);
    const directoryKey = targetDirectoryPath ?? "";
    const sourceKey = sourceDirectoryPath ?? "";

    setFileTreeOrder((current) => {
      const currentOrder = current[directoryKey] ?? [];
      const orderWithTarget = currentOrder.includes(targetFilePath) ? currentOrder : [...currentOrder, targetFilePath];
      const targetIndex = orderWithTarget.filter((path) => path !== filePath).indexOf(targetFilePath);
      const nextOrder = orderWithTarget.filter((path) => path !== filePath && path !== targetFilePath);
      nextOrder.splice(Math.max(0, targetIndex), 0, targetFilePath);
      const insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
      nextOrder.splice(Math.max(0, insertIndex), 0, filePath);

      return {
        ...current,
        ...(sourceKey !== directoryKey ? { [sourceKey]: (current[sourceKey] ?? []).filter((path) => path !== filePath) } : {}),
        [directoryKey]: nextOrder,
      };
    });
  };

  const handleMoveWorkspaceFileToDirectory = async (filePath: string, targetDirectoryPath: string) => {
    if (!window.electronApp?.moveDocumentToDirectory) {
      window.alert("移动文件需要在桌面版中使用。");
      return null;
    }

    try {
      const nextPath = await window.electronApp.moveDocumentToDirectory({
        filePath,
        targetDirectoryPath,
      });

      if (currentSavePath === filePath) {
        setCurrentSavePath(nextPath);
      }

      setExpandedDirectories((current) => Array.from(new Set([...current, targetDirectoryPath])));
      const sourceDirectoryPath = getParentDirectoryPath(filePath, workspaceRootPath);
      if (sourceDirectoryPath !== targetDirectoryPath || nextPath !== filePath) {
        setFileTreeOrder((current) => ({
          ...current,
          [sourceDirectoryPath ?? ""]: (current[sourceDirectoryPath ?? ""] ?? []).filter((path) => path !== filePath),
          [targetDirectoryPath]: [
            ...(current[targetDirectoryPath] ?? []).filter((path) => path !== filePath && path !== nextPath),
            nextPath,
          ],
        }));
      }
      refreshWorkspaceEntries().catch(() => {});
      return nextPath;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "移动文件失败。");
      return null;
    }
  };

  const handleReorderWorkspaceFile = async (
    filePath: string,
    targetFilePath: string,
    placement: "before" | "after",
  ) => {
    if (filePath === targetFilePath) {
      return;
    }

    const sourceDirectoryPath = getParentDirectoryPath(filePath, workspaceRootPath);
    const targetDirectoryPath = getParentDirectoryPath(targetFilePath, workspaceRootPath);

    if (sourceDirectoryPath !== targetDirectoryPath && targetDirectoryPath) {
      const movedPath = await handleMoveWorkspaceFileToDirectory(filePath, targetDirectoryPath);
      if (!movedPath) {
        return;
      }
      rememberFileOrderPlacement(movedPath, targetFilePath, placement);
      refreshWorkspaceEntries().catch(() => {});
      return;
    }

    rememberFileOrderPlacement(filePath, targetFilePath, placement);
  };

  const handleCreateWorkspaceDirectory = async (parentDirectoryPath: string | null) => {
    if (!window.electronApp?.createWorkspaceDirectory) {
      setErrorMessage("新建文件夹需要重启桌面版以加载最新文件操作能力。");
      return;
    }

    try {
      const nextPath = await window.electronApp.createWorkspaceDirectory({
        parentDirectoryPath,
        name: "新建文件夹",
      });
      setExpandedDirectories((current) => Array.from(new Set([
        ...current,
        ...(parentDirectoryPath ? [parentDirectoryPath] : []),
        nextPath,
      ])));
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新建文件夹失败。");
    }
  };

  const handleRenameWorkspaceDirectory = async (directoryPath: string, currentName: string) => {
    if (!window.electronApp?.renameWorkspaceDirectory) {
      setErrorMessage("重命名文件夹需要在桌面版中使用。");
      return;
    }
    handleBeginRenameWorkspaceDirectory(directoryPath, currentName);
  };

  const handleDeleteWorkspaceFile = async (filePath: string) => {
    if (!window.electronApp?.deleteDocumentAtPath) {
      window.alert("删除文件需要在桌面版中使用。");
      return;
    }

    if (!window.confirm("确定删除这个文件吗？")) {
      return;
    }

    try {
      await window.electronApp.deleteDocumentAtPath({ filePath });
      const directoryPath = getParentDirectoryPath(filePath, workspaceRootPath) ?? "";
      setFileTreeOrder((current) => ({
        ...current,
        [directoryPath]: (current[directoryPath] ?? []).filter((path) => path !== filePath),
      }));
      if (currentSavePath === filePath) {
        const nextDocument = createEmptyDocument();
        loadIntoEditor(nextDocument);
        clearAutosave();
      }
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除文件失败。");
    }
  };

  const handleDeleteWorkspaceDirectory = async (directoryPath: string) => {
    if (!window.electronApp?.deleteWorkspaceDirectory) {
      window.alert("删除文件夹需要在桌面版中使用。");
      return;
    }

    if (!window.confirm("确定删除这个文件夹及其中所有内容吗？")) {
      return;
    }

    try {
      await window.electronApp.deleteWorkspaceDirectory({ directoryPath });
      setExpandedDirectories((current) => current.filter((item) => !isPathInsideOrEqual(directoryPath, item)));
      setFileTreeOrder((current) => Object.fromEntries(
        Object.entries(current)
          .filter(([key]) => !isPathInsideOrEqual(directoryPath, key))
          .map(([key, value]) => [key, value.filter((path) => !isPathInsideOrEqual(directoryPath, path))]),
      ));
      if (currentSavePath && isPathInsideOrEqual(directoryPath, currentSavePath)) {
        setCurrentSavePath(null);
        fileHandleRef.current = null;
        setActiveFileHandle(null);
        setIsDirty(true);
      }
      refreshWorkspaceEntries().catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除文件夹失败。");
    }
  };

  const handleBeginRenamePage = (pageIndex: number) => {
    setRenamingPageIndex(pageIndex);
    setRenamingPageTitle(documentFile.appearance.pages.titles?.[pageIndex] ?? "");
  };

  const handleCommitPageRename = () => {
    if (renamingPageIndex === null) {
      return;
    }

    handlePageTitleChange(renamingPageIndex, renamingPageTitle.trim());
    setRenamingPageIndex(null);
    setRenamingPageTitle("");
  };

  const handleCancelPageRename = () => {
    setRenamingPageIndex(null);
    setRenamingPageTitle("");
  };

  const handleFileSelect = useCallback((filePath: string, ctrlKey: boolean, shiftKey: boolean) => {
    if (ctrlKey) {
      setSelectedFilePaths(prev =>
        prev.includes(filePath) ? prev.filter(p => p !== filePath) : [...prev, filePath]
      );
    } else if (shiftKey && lastSelectedFilePath) {
      // Range select: collect all visible file paths
      const allPaths = collectVisibleFilePaths(workspaceEntries);
      const startIdx = allPaths.indexOf(lastSelectedFilePath);
      const endIdx = allPaths.indexOf(filePath);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        setSelectedFilePaths(allPaths.slice(from, to + 1));
      }
    } else {
      setSelectedFilePaths([filePath]);
    }
    setLastSelectedFilePath(filePath);
  }, [lastSelectedFilePath, workspaceEntries]);

  const handleFileContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    filePath: string,
    currentName: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarContextMenu({
      kind: "file",
      x: event.clientX,
      y: event.clientY,
      filePath,
      fileName: currentName,
      parentDirectoryPath: getParentDirectoryPath(filePath, workspaceRootPath),
    });
  };

  const handleDirectoryContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    directoryPath: string,
    currentName: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarContextMenu({
      kind: "directory",
      x: event.clientX,
      y: event.clientY,
      directoryPath,
      directoryName: currentName,
      parentDirectoryPath: getParentDirectoryPath(directoryPath, workspaceRootPath),
    });
  };

  const handleWorkspaceBlankContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarContextMenu({
      kind: "workspace",
      x: event.clientX,
      y: event.clientY,
      directoryPath: workspaceRootPath,
    });
  };

  const handlePageContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    pageIndex: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarContextMenu({
      kind: "page",
      x: event.clientX,
      y: event.clientY,
      pageIndex,
    });
  };

  const handleSelectPage = (pageNumber: number) => {
    setSwipedPageIndex(null);
    setSwipeOffset(0);
    setSelectedNodeIds([]);
    setEditingNodeId(null);
    setActivePageIndex(pageNumber - 1);
  };

  const handleAddPage = () => {
    setSwipedPageIndex(null);
    setSwipeOffset(0);
    patchDocument((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        pages: {
          ...current.appearance.pages,
          count: current.appearance.pages.count + 1,
          titles: [...(current.appearance.pages.titles ?? []), ""],
        },
      },
    }));
    setActivePageIndex(pageCount);
  };

  const getPageSnapshot = (pageIndex: number): PageClipboardState => ({
    mode: "copy",
    title: documentFile.appearance.pages.titles?.[pageIndex] ?? "",
    nodes: cloneCanvasNode(documentFile.nodes.filter((node) => node.pageIndex === pageIndex)),
  });

  const handleCopyPage = (pageIndex: number) => {
    setPageClipboard(getPageSnapshot(pageIndex));
  };

  const handleCutPage = (pageIndex: number) => {
    if (pageCount <= 1) {
      return;
    }

    setPageClipboard({
      ...getPageSnapshot(pageIndex),
      mode: "cut",
    });
    setSwipedPageIndex(null);
    setSwipeOffset(0);
    patchDocument((current) => settleDocumentLayout(removePageFromDocument(current, pageIndex)));
    setActivePageIndex((current) => {
      if (current > pageIndex) {
        return current - 1;
      }
      return Math.max(0, Math.min(current, pageCount - 2));
    });
  };

  const handlePastePageAfter = (pageIndex: number) => {
    if (!pageClipboard) {
      return;
    }

    const insertIndex = Math.max(0, Math.min(pageIndex + 1, pageCount));
    setSwipedPageIndex(null);
    setSwipeOffset(0);
    patchDocument((current) => settleDocumentLayout(insertPageIntoDocument(
      current,
      insertIndex,
      pageClipboard.title,
      pageClipboard.nodes,
    )));
    setActivePageIndex(insertIndex);
    if (pageClipboard.mode === "cut") {
      setPageClipboard(null);
    }
  };

  const handleDeletePage = (pageIndex: number) => {
    if (pageCount <= 1) {
      return;
    }

    // Backup current document to trash before removing page
    if (window.electronApp?.saveDocumentToTrash) {
      const pageTitle = documentFile.appearance.pages.titles?.[pageIndex] ?? `第${pageIndex + 1}页`;
      const baseName = `${pageTitle}-page-${pageIndex + 1}.icanvas.json`;
      window.electronApp.saveDocumentToTrash({
        content: serializeDocument(documentFile),
        baseName,
      }).catch(() => {});
    }

    setSwipedPageIndex(null);
    setSwipeOffset(0);
    patchDocument((current) => settleDocumentLayout(removePageFromDocument(current, pageIndex)));
    setActivePageIndex((current) => Math.max(0, Math.min(current, pageCount - 2)));
  };

  const handlePageTitleChange = (pageIndex: number, title: string) => {
    patchDocument((current) => {
      const titles = Array.from(
        { length: Math.max(current.appearance.pages.count, pageCount) },
        (_, index) => current.appearance.pages.titles?.[index] ?? "",
      );
      titles[pageIndex] = title;

      return {
        ...current,
        appearance: {
          ...current.appearance,
          pages: {
            ...current.appearance.pages,
            titles,
          },
        },
      };
    });
  };

  const handleRestoreAutosave = () => {
    if (typeof window === "undefined") {
      return;
    }
    const readAutosave = window.electronApp?.getAutosaveDocument
      ? window.electronApp.getAutosaveDocument()
      : Promise.resolve(window.localStorage.getItem(AUTOSAVE_STORAGE_KEY));

    readAutosave.then((raw) => {
      if (!raw) {
        setAutosaveRestoreAvailable(false);
        return;
      }
      applyAutosaveDocument(raw);
    }).catch(() => {
      clearAutosave();
      setAutosaveRestoreAvailable(false);
    });
  };

  const handleDiscardAutosave = () => {
    clearAutosave();
    setAutosaveRestoreAvailable(false);
  };

  const handleAddText = () => {
    if (!canvasRef.current) {
      return;
    }

    const node = {
      ...createTextNode(0, 0),
      content: createDefaultRichTextDoc(""),
    };
    patchDocument((current) => {
      const insertionPoint = getPageInsertionPoint(current, activePageIndex);
      const offset = getInsertOffset(current.nodes.filter((node) => node.pageIndex === activePageIndex).length);

      return addNodeToDocument(current, {
        ...node,
        pageIndex: activePageIndex,
        x: insertionPoint.x + offset.x,
        y: insertionPoint.y + offset.y,
      });
    });
    setSelectedNodeIds([node.id]);
    setEditingNodeId(node.id);
  };

  const handleAddShape = (shapeType: ShapeNodeModel["shapeType"]) => {
    const node = createShapeNode(0, 0, shapeType);
    patchDocument((current) => {
      const insertionPoint = getPageInsertionPoint(current, activePageIndex);
      const offset = getInsertOffset(current.nodes.filter((item) => item.pageIndex === activePageIndex).length);

      return addNodeToDocument(current, {
        ...node,
        pageIndex: activePageIndex,
        x: insertionPoint.x + offset.x,
        y: insertionPoint.y + offset.y,
      });
    });
    setSelectedNodeIds([node.id]);
    setEditingNodeId(null);
  };

  const updateSelectedConnector = (updater: (connector: ConnectorNode) => ConnectorNode) => {
    if (!selectedConnector) {
      return;
    }

    updateNode(selectedConnector.id, (node) => node.type === "connector" ? updater(node) : node);
  };

  const handleGenerateTimeline = () => {
    if (!selectedTextNode) {
      setErrorMessage("请先选中包含表格的文本块。");
      return;
    }

    const rows = parseTableToTimelineRows(selectedTextNode);
    if (rows.length === 0) {
      setErrorMessage("未能从表格解析出时间线数据。请确认列包含：方向、年份、标题，DOI 可选。");
      return;
    }

    const title = currentPageTitle.trim() || currentDisplayFileName || "时间线";

    // Create a live TimelineNode instead of a static HTML snapshot
    const entries: TimelineNodeFields[] = rows.map((r) => ({
      category: r.category,
      date: r.date,
      title: r.title,
      summary: r.summary,
      kind: r.kind,
      org: r.org,
      authors: r.authors,
      link: r.link,
      doi: r.doi,
      arxiv: r.arxiv,
      tags: r.tags,
      importance: r.importance,
      imageRefs: r.imageRefs,
      addedAt: r.addedAt ?? new Date().toISOString(),
      source: r.source,
    }));

    // Group entries by category, create one timeline node per category
    const catMap = new Map<string, TimelineNodeFields[]>();
    for (const e of entries) {
      const list = catMap.get(e.category) ?? [];
      list.push(e);
      catMap.set(e.category, list);
    }

    const nodeIds: string[] = [];
    let offsetX = selectedTextNode.x + selectedTextNode.w + 48;
    const startY = selectedTextNode.y;

    patchDocument((current) => {
      let doc = current;
      const categories = Array.from(catMap.keys());
      categories.forEach((cat, i) => {
        const catEntries = catMap.get(cat)!;
        const node = createTimelineNode(
          offsetX + i * (320 + 16),
          startY,
          catEntries,
        );
        doc = addNodeToDocument(doc, {
          ...node,
          pageIndex: selectedTextNode.pageIndex,
          w: 320,
          h: Math.max(200, Math.min(800, catEntries.length * 36 + 60)),
        });
        nodeIds.push(node.id);
      });
      return doc;
    });
    setSelectedNodeIds(nodeIds);
    setEditingNodeId(null);
  };

  const handleImportImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    if (editingNodeId || selectedTextNode) {
      try {
        const assetId = createAssetId();
        const data = await readFileAsDataUrl(file);
        const dimensions = await readImageDimensions(data);
        const maxInitialWidth = 360;
        const scale = Math.min(1, maxInitialWidth / dimensions.w);
        const width = Math.max(80, Math.round(dimensions.w * scale));
        const height = Math.max(40, Math.round(dimensions.h * scale));

        patchDocument((current) => ({
          ...current,
          assets: {
            ...current.assets,
            [assetId]: {
              id: assetId,
              type: "image",
              mimeType: file.type || "image/png",
              name: file.name || "inline-image",
              data,
            },
          },
        }));

        const command: TextEditorCommand = {
          type: "insert-image",
          nonce: editorCommandNonceRef.current++,
          placement: editingNodeId ? "caret" : "end",
          assetId,
          name: file.name || "inline-image",
          data,
          w: width,
          h: height,
        };

        if (editingNodeId) {
          setEditorCommand(command);
        } else {
          runQuickEditCommand(command);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "图片读取失败。");
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setErrorMessage("图片读取失败。");
        return;
      }

      const assetId = createAssetId();
      const image = new Image();
      image.onload = () => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        const maxWidth = 480;
        const minSide = 120;
        const fitScale = Math.min(1, maxWidth / image.width);
        const minScale = Math.max(minSide / (image.width * fitScale), minSide / (image.height * fitScale), 1);
        const width = image.width * fitScale * minScale;
        const height = image.height * fitScale * minScale;
        const node = createImageNode(0, 0, assetId, width, height);

        patchDocument((current) => {
          const insertionPoint = getPageInsertionPoint(current, activePageIndex);
          const offset = getInsertOffset(current.nodes.filter((node) => node.pageIndex === activePageIndex).length);
          return addImageNodeToDocument(
            current,
            {
              ...node,
              pageIndex: activePageIndex,
              x: insertionPoint.x + offset.x,
              y: insertionPoint.y + offset.y,
            },
            {
              id: assetId,
              type: "image",
              mimeType: file.type || "image/png",
              name: file.name,
              data: reader.result as string,
            },
          );
        });
        setSelectedNodeIds([node.id]);
      };
      image.onerror = () => setErrorMessage("图片资源无法解析。");
      image.src = reader.result;
    };
    reader.onerror = () => setErrorMessage("图片读取失败。");
    reader.readAsDataURL(file);
  };

  const handleImportAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const assetId = createAssetId();
      const data = await readFileAsDataUrl(file);
      const isPdf = isPdfAttachment(file.type, file.name);
      const icon = isPdf ? "PDF" : "FILE";

      patchDocument((current) => ({
        ...current,
        assets: {
          ...current.assets,
          [assetId]: {
            id: assetId,
            type: isPdf ? "pdf" : "file",
            storage: "embedded",
            mimeType: file.type || "application/octet-stream",
            name: file.name,
            data,
            sizeBytes: file.size,
          },
        },
      }));

      if (editingNodeId || selectedTextNode) {
        const command: TextEditorCommand = {
          type: "insert-attachment",
          nonce: editorCommandNonceRef.current++,
          placement: editingNodeId ? "caret" : "end",
          assetId,
          name: file.name,
          data: file.type || "application/octet-stream",
        };

        if (editingNodeId) {
          setEditorCommand(command);
        } else {
          runQuickEditCommand(command);
        }
      } else {
        // No text node available: create a TextNode with the attachment
        const nodeId = createNodeId("text");
        patchDocument((current) => {
          const insertionPoint = getPageInsertionPoint(current, activePageIndex);
          const offset = getInsertOffset(current.nodes.filter((node) => node.pageIndex === activePageIndex).length);
          return addNodeToDocument(current, {
            id: nodeId,
            type: "text",
            pageIndex: activePageIndex,
            x: insertionPoint.x + offset.x,
            y: insertionPoint.y + offset.y,
            w: 360,
            h: 60,
            z: 1,
            style: {},
            content: {
              type: "doc",
              content: [{
                type: "paragraph",
                content: [{ type: "image", assetId }],
              }],
            },
          });
        });
        setSelectedNodeIds([nodeId]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "附件读取失败。");
    }
  };

  const handlePasteImageIntoText = async (file: File) => {
    const assetId = createAssetId();
    const data = await readFileAsDataUrl(file);
    const dimensions = await readImageDimensions(data);
    const maxInitialWidth = 360;
    const scale = Math.min(1, maxInitialWidth / dimensions.w);
    const width = Math.max(80, Math.round(dimensions.w * scale));
    const height = Math.max(40, Math.round(dimensions.h * scale));

    patchDocument((current) => ({
      ...current,
      assets: {
        ...current.assets,
        [assetId]: {
          id: assetId,
          type: "image",
          mimeType: file.type || "image/png",
          name: file.name || "pasted-image",
          data,
        },
      },
    }));

    return {
      assetId,
      name: file.name || "pasted-image",
      data,
      w: width,
      h: height,
    };
  };

  useEffect(() => {
    if (window.electronApp) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    if (editingNodeId === null) {
      setEditorCommand(null);
      setSelectionFormat(null);
    }
  }, [editingNodeId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const readAutosave = window.electronApp?.getAutosaveDocument
      ? window.electronApp.getAutosaveDocument()
      : Promise.resolve(window.localStorage.getItem(AUTOSAVE_STORAGE_KEY));

    readAutosave.then((raw) => {
      if (!raw) {
        return;
      }
      applyAutosaveDocument(raw);
    }).catch(() => {
      clearAutosave();
    });
  }, []);

  useEffect(() => () => {
    if (zoomSettleTimeoutRef.current !== null) {
      window.clearTimeout(zoomSettleTimeoutRef.current);
    }
    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!isDirty) {
      if (autosaveTimeoutRef.current !== null) {
        window.clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      return;
    }

    setAutosaveStatus("pending");
    if (autosaveTimeoutRef.current !== null) {
      window.clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = window.setTimeout(() => {
      const content = serializeDocumentJson(documentFile);
      // Wrap JSON with save path so autosave restore can recover the original file location
      const autosavePayload = JSON.stringify({ path: currentSavePath, doc: JSON.parse(content) });
      const saveAutosave = window.electronApp?.saveDocumentToPath
        ? saveDocumentVersion(touchDocument(documentFile), { autosave: true })
            .then(() => window.electronApp?.saveAutosaveDocument?.(autosavePayload) ?? Promise.resolve())
            .then(() => setAutosaveStatus("saved"))
        : (() => {
            return (window.electronApp?.saveAutosaveDocument
              ? window.electronApp.saveAutosaveDocument(autosavePayload)
              : Promise.resolve(window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, autosavePayload)))
              .then(() => setAutosaveStatus("saved"));
          })();

      saveAutosave.catch(() => setAutosaveStatus("idle"));
      autosaveTimeoutRef.current = null;
    }, AUTOSAVE_DELAY_MS);
  }, [currentSavePath, documentFile, isDirty]);

  useEffect(() => {
    const managedAssets = Object.values(documentFile.assets).filter((asset) =>
      asset.storage === "managed" && typeof asset.relativePath === "string" && asset.relativePath.length > 0,
    );

    if (managedAssets.length === 0 || !currentSavePath || !window.electronApp?.resolveAttachmentUrl) {
      setManagedAssetUrls({});
      return;
    }

    let canceled = false;

    Promise.all(managedAssets.map(async (asset) => {
      const resolvedUrl = await window.electronApp!.resolveAttachmentUrl({
        documentPath: currentSavePath,
        relativePath: asset.relativePath!,
      });
      return [asset.id, resolvedUrl ?? ""] as const;
    })).then((entries) => {
      if (canceled) {
        return;
      }

      setManagedAssetUrls(Object.fromEntries(entries));
    }).catch(() => {
      if (!canceled) {
        setManagedAssetUrls({});
      }
    });

    return () => {
      canceled = true;
    };
  }, [currentSavePath, documentFile.assets]);

  useEffect(() => {
    let blockMiddlePasteUntil = 0;

    const blockMiddleClickDefault = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 1) {
        return;
      }

      blockMiddlePasteUntil = performance.now() + 800;
      event.preventDefault();
    };

    const blockMiddleClickPaste = (event: InputEvent) => {
      if (!event.inputType.startsWith("insertFromPaste")) {
        return;
      }

      if (performance.now() <= blockMiddlePasteUntil) {
        event.preventDefault();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const lowerKey = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.defaultPrevented) {
        if (lowerKey === "z" && !event.shiftKey && !isFormFieldTarget(event.target)) {
          event.preventDefault();
          handleUndo();
          return;
        }

        if ((lowerKey === "z" && event.shiftKey) || lowerKey === "y") {
          if (!isFormFieldTarget(event.target)) {
            event.preventDefault();
            handleRedo();
            return;
          }
        }
      }

      if (
        !editingNodeId &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedNodeIds.length > 0 &&
        !event.defaultPrevented &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        deleteSelectedNodes();
        return;
      }

      if (
        editingNodeId ||
        !selectedTextNode ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      event.preventDefault();
      runQuickEditCommand({
        type: "append-text",
        placement: "end",
        text: event.key,
        nonce: editorCommandNonceRef.current++,
      });
    };

    const handlePaste = async (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      const pastedHtml = event.clipboardData?.getData("text/html") ?? "";
      const pastedText = event.clipboardData?.getData("text/plain") ?? "";

      if (
        editingNodeId ||
        !selectedTextNode
      ) {
        return;
      }

      // Check for meaningful text content first.
      // OneNote and similar apps put both HTML and an image snapshot into the
      // clipboard; the user almost always intends to paste the rich text, not
      // the rendered image.
      if (pastedText.trim().length > 0 || pastedHtml.length > 0) {
        event.preventDefault();
        runQuickEditCommand({
          type: "append-text",
          placement: "end",
          text: pastedText,
          nonce: editorCommandNonceRef.current++,
        });
        return;
      }

      // No text content – check for standalone image file in clipboard items.
      const imageFile = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();

      if (!imageFile) {
        return;
      }

      event.preventDefault();

      try {
        const inserted = await handlePasteImageIntoText(imageFile);
        runQuickEditCommand({
          type: "insert-image",
          placement: "end",
          nonce: editorCommandNonceRef.current++,
          assetId: inserted.assetId,
          name: inserted.name,
          data: inserted.data,
          w: inserted.w,
          h: inserted.h,
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "图片读取失败。");
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("pointerdown", blockMiddleClickDefault, true);
    document.addEventListener("pointerup", blockMiddleClickDefault, true);
    document.addEventListener("mousedown", blockMiddleClickDefault, true);
    document.addEventListener("mouseup", blockMiddleClickDefault, true);
    document.addEventListener("auxclick", blockMiddleClickDefault, true);
    document.addEventListener("beforeinput", blockMiddleClickPaste, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("paste", handlePaste, true);
      document.removeEventListener("pointerdown", blockMiddleClickDefault, true);
      document.removeEventListener("pointerup", blockMiddleClickDefault, true);
      document.removeEventListener("mousedown", blockMiddleClickDefault, true);
      document.removeEventListener("mouseup", blockMiddleClickDefault, true);
      document.removeEventListener("auxclick", blockMiddleClickDefault, true);
      document.removeEventListener("beforeinput", blockMiddleClickPaste, true);
    };
  }, [documentFile, editingNodeId, selectedTextNode, selectedNodeIds]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      if (interaction.type === "pan") {
        setDocumentFile((current) => {
          const nextViewState = clampViewStateToPage(
            {
              ...current.viewState,
              cameraX: interaction.initialX + (event.clientX - interaction.startX),
              cameraY: interaction.initialY + (event.clientY - interaction.startY),
            },
            current.pageBounds,
            rect,
          );

          return {
            ...current,
            viewState: nextViewState,
          };
        });
        return;
      }

      if (interaction.type === "marquee") {
        const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
        setInteraction({
          ...interaction,
          currentX: point.x,
          currentY: point.y,
        });
        return;
      }

      if (interaction.type === "draw-connector") {
        const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
        setInteraction({
          ...interaction,
          currentX: point.x,
          currentY: point.y,
        });
        return;
      }

      if (interaction.type === "drag-node") {
        const delta = {
          x: (event.clientX - interaction.startPointerX) / documentFile.viewState.zoom,
          y: (event.clientY - interaction.startPointerY) / documentFile.viewState.zoom,
        };
        dragDidMoveRef.current = dragDidMoveRef.current || delta.x !== 0 || delta.y !== 0;

        setDocumentFile((current) => {
          const nextNodes = current.nodes.map((node) => {
            const startPosition = interaction.startPositions[node.id];

            if (!startPosition) {
              return node;
            }

            return {
              ...node,
              ...dragNode(startPosition, delta),
            };
          });

          return {
            ...current,
            nodes: nextNodes,
            pageBounds: fitPageBoundsToNodes(nextNodes),
          };
        });
        return;
      }

      if (interaction.type === "drag-connector") {
        const delta = {
          x: (event.clientX - interaction.startPointerX) / documentFile.viewState.zoom,
          y: (event.clientY - interaction.startPointerY) / documentFile.viewState.zoom,
        };
        dragDidMoveRef.current = dragDidMoveRef.current || delta.x !== 0 || delta.y !== 0;
        setDocumentFile((current) => {
          const nextNodes = current.nodes.map((node) => {
            if (node.id !== interaction.connectorId || node.type !== "connector") {
              return node;
            }

            return {
              ...node,
              startNodeId: undefined,
              startAnchor: undefined,
              endNodeId: undefined,
              endAnchor: undefined,
              x1: interaction.startX1 + delta.x,
              y1: interaction.startY1 + delta.y,
              x2: interaction.startX2 + delta.x,
              y2: interaction.startY2 + delta.y,
            };
          });

          return {
            ...current,
            nodes: nextNodes,
            pageBounds: fitPageBoundsToNodes(nextNodes),
          };
        });
        return;
      }

      if (interaction.type === "drag-connector-endpoint") {
        const delta = {
          x: (event.clientX - interaction.startPointerX) / documentFile.viewState.zoom,
          y: (event.clientY - interaction.startPointerY) / documentFile.viewState.zoom,
        };
        dragDidMoveRef.current = dragDidMoveRef.current || delta.x !== 0 || delta.y !== 0;
        setDocumentFile((current) => {
          const nextNodes = current.nodes.map((node) => {
            if (node.id !== interaction.connectorId || node.type !== "connector") {
              return node;
            }

            return interaction.endpoint === "start"
              ? {
                  ...node,
                  startNodeId: undefined,
                  startAnchor: undefined,
                  x1: interaction.startX + delta.x,
                  y1: interaction.startY + delta.y,
                }
              : {
                  ...node,
                  endNodeId: undefined,
                  endAnchor: undefined,
                  x2: interaction.startX + delta.x,
                  y2: interaction.startY + delta.y,
                };
          });

          return {
            ...current,
            nodes: nextNodes,
            pageBounds: fitPageBoundsToNodes(nextNodes),
          };
        });
        return;
      }

      if (interaction.type === "resize-node") {
        const delta = {
          x: (event.clientX - interaction.startPointerX) / documentFile.viewState.zoom,
          y: (event.clientY - interaction.startPointerY) / documentFile.viewState.zoom,
        };
        resizeDidMoveRef.current = resizeDidMoveRef.current || delta.x !== 0 || delta.y !== 0;
        setDocumentFile((current) => {
          const nextNodes = current.nodes.map((node) => {
            if (node.id !== interaction.nodeId) {
              return node;
            }

            return {
              ...node,
              ...resizeNode(
                { x: interaction.startX, w: interaction.startW, h: interaction.startH },
                delta,
                interaction.nodeType === "text" ? "width-only" : "free",
                interaction.handle,
                current.pageBounds.x,
              ),
            };
          });

          return {
            ...current,
            nodes: nextNodes,
            pageBounds: fitPageBoundsToNodes(nextNodes),
          };
        });
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (interaction.type === "drag-node") {
        const didMove = dragDidMoveRef.current;
        dragDidMoveRef.current = false;

        if (didMove) {
          suppressNextCanvasClickRef.current = true;
          applyDocumentState((current) => settleDocumentLayout(current), {
            recordHistory: true,
            historyBase: transientHistoryBaseRef.current,
          });
        }
      }

      if (interaction.type === "marquee") {
        const selectionRect = normalizeRect(interaction);
        const movedEnough = selectionRect.w > 4 / documentFile.viewState.zoom || selectionRect.h > 4 / documentFile.viewState.zoom;

        if (movedEnough) {
          const selectedIds = documentFile.nodes
            .filter((node) => node.pageIndex === activePageIndex && (isBoxCanvasNode(node) || node.type === "timeline") && rectsIntersect(selectionRect, node as { x: number; y: number; w: number; h: number }))
            .map((node) => node.id);

          setSelectedNodeIds(selectedIds);
          suppressNextCanvasClickRef.current = true;
        } else {
          handleAddTextAt(interaction.startX, interaction.startY);
          suppressNextCanvasClickRef.current = true;
        }
      }

      if (interaction.type === "draw-connector") {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const pointer = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
          const endNode = getNodeAtViewportPoint(event.clientX, event.clientY);
          const endAnchor = endNode ? nearestAnchor(endNode, pointer) : undefined;
          const endPoint = endNode ? resolveAnchorPoint(endNode, endAnchor) : pointer;
          const movedEnough = Math.hypot(endPoint.x - interaction.startX, endPoint.y - interaction.startY) > 4 / documentFile.viewState.zoom;

          if (movedEnough) {
            const connector = createConnectorNode(interaction.startX, interaction.startY, endPoint.x, endPoint.y, {
              pageIndex: activePageIndex,
              ...(interaction.startNodeId ? { startNodeId: interaction.startNodeId } : {}),
              ...(interaction.startAnchor ? { startAnchor: interaction.startAnchor } : {}),
              ...(endNode ? { endNodeId: endNode.id } : {}),
              ...(endAnchor ? { endAnchor } : {}),
            });
            patchDocument((current) => addNodeToDocument(current, connector));
            setSelectedNodeIds([connector.id]);
            setConnectorMode(false);
            suppressNextCanvasClickRef.current = true;
          }
        }
      }

      if (interaction.type === "drag-connector" || interaction.type === "drag-connector-endpoint") {
        const didMove = dragDidMoveRef.current;
        dragDidMoveRef.current = false;

        if (didMove) {
          if (interaction.type === "drag-connector-endpoint") {
            const endNode = getNodeAtViewportPoint(event.clientX, event.clientY);
            const rect = canvasRef.current?.getBoundingClientRect();
            if (endNode && rect) {
              const pointer = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
              const anchor = nearestAnchor(endNode, pointer);
              const endpoint = resolveAnchorPoint(endNode, anchor);
              patchDocument((current) => updateNodeInDocument(current, interaction.connectorId, (node) => {
                if (node.type !== "connector") {
                  return node;
                }

                return interaction.endpoint === "start"
                  ? { ...node, x1: endpoint.x, y1: endpoint.y, startNodeId: endNode.id, startAnchor: anchor }
                  : { ...node, x2: endpoint.x, y2: endpoint.y, endNodeId: endNode.id, endAnchor: anchor };
              }));
            }
          }

          suppressNextCanvasClickRef.current = true;
          applyDocumentState((current) => settleDocumentLayout(current), {
            recordHistory: true,
            historyBase: transientHistoryBaseRef.current,
          });
        }
      }

      if (interaction.type === "resize-node") {
        const didMove = resizeDidMoveRef.current;
        resizeDidMoveRef.current = false;

        if (didMove) {
          suppressNextCanvasClickRef.current = true;
          applyDocumentState((current) => settleDocumentLayout(current), {
            recordHistory: true,
            historyBase: transientHistoryBaseRef.current,
          });
        }
      }

      setInteraction({ type: "none" });
      transientHistoryBaseRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activePageIndex, documentFile, interaction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    // Native wheel listener with { passive: false } so preventDefault works for zoom/pan
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    const syncCanvasViewportSize = () => {
      setCanvasViewportSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    };

    syncCanvasViewportSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncCanvasViewportSize);
      return () => {
        canvas.removeEventListener("wheel", handleWheel);
        window.removeEventListener("resize", syncCanvasViewportSize);
      };
    }

    const observer = new ResizeObserver(syncCanvasViewportSize);
    observer.observe(canvas);
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, []);

  const startNodeDrag = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation"> & { button?: number },
    node: CanvasNode,
  ) => {
    if (connectorMode && isBoxCanvasNode(node) && event.button !== 1) {
      startConnectorDraw(event, node);
      return;
    }

    if (event.button === 1) {
      event.stopPropagation();
      event.preventDefault();
      setInteraction({
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        initialX: documentFile.viewState.cameraX,
        initialY: documentFile.viewState.cameraY,
      });
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    dragDidMoveRef.current = false;
    transientHistoryBaseRef.current = documentFile;
    suppressNextCanvasClickRef.current = true;
    const nodeIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
    setSelectedNodeIds(nodeIds);
    setInteraction({
      type: "drag-node",
      nodeId: node.id,
      nodeIds,
      startPositions: Object.fromEntries(
        documentFile.nodes
          .filter((item) => nodeIds.includes(item.id) && (isBoxCanvasNode(item) || item.type === "timeline"))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ) as Record<string, { x: number; y: number }>,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    });
  };

  const startConnectorDraw = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation"> & { button?: number },
    node?: BoxCanvasNode,
  ) => {
    if (event.button && event.button !== 0) {
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const pointer = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
    const anchor = node ? nearestAnchor(node, pointer) : undefined;
    const start = node ? resolveAnchorPoint(node, anchor) : pointer;
    transientHistoryBaseRef.current = documentFile;
    setSelectedNodeIds([]);
    setInteraction({
      type: "draw-connector",
      startX: start.x,
      startY: start.y,
      currentX: pointer.x,
      currentY: pointer.y,
      ...(node ? { startNodeId: node.id, startAnchor: anchor } : {}),
    });
  };

  const startConnectorDrag = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation">,
    connector: ConnectorNode,
  ) => {
    const start = resolveConnectorEndpoint(connector, "start", documentFile.nodes);
    const end = resolveConnectorEndpoint(connector, "end", documentFile.nodes);

    event.stopPropagation();
    event.preventDefault();
    transientHistoryBaseRef.current = documentFile;
    suppressNextCanvasClickRef.current = true;
    setSelectedNodeIds([connector.id]);
    setInteraction({
      type: "drag-connector",
      connectorId: connector.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX1: start.x,
      startY1: start.y,
      startX2: end.x,
      startY2: end.y,
    });
  };

  const startConnectorEndpointDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    connector: ConnectorNode,
    endpoint: "start" | "end",
  ) => {
    const point = resolveConnectorEndpoint(connector, endpoint, documentFile.nodes);

    event.stopPropagation();
    event.preventDefault();
    transientHistoryBaseRef.current = documentFile;
    setSelectedNodeIds([connector.id]);
    setInteraction({
      type: "drag-connector-endpoint",
      connectorId: connector.id,
      endpoint,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: point.x,
      startY: point.y,
    });
  };

  const startResize = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">,
    node: CanvasNode,
    handle: ResizeHandle = "bottom-right",
  ) => {
    if (!isBoxCanvasNode(node)) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    resizeDidMoveRef.current = false;
    transientHistoryBaseRef.current = documentFile;
    setInteraction({
      type: "resize-node",
      nodeId: node.id,
      nodeType: node.type,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: node.x,
      startW: node.w,
      startH: node.h,
      handle,
      allowOverlap: event.altKey,
    });
  };

  const startCanvasPan = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation">,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setInteraction({
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      initialX: documentFile.viewState.cameraX,
      initialY: documentFile.viewState.cameraY,
    });
  };

  const viewportForScrollbars = {
    width: canvasViewportSize.width || canvasRef.current?.clientWidth || 0,
    height: canvasViewportSize.height || canvasRef.current?.clientHeight || 0,
  };
  const cameraBounds = getCameraBounds(documentFile.viewState, documentFile.pageBounds, viewportForScrollbars);
  const scrollbarInset = 0;
  const scrollbarThickness = 12;
  const horizontalTrackSize = Math.max(0, viewportForScrollbars.width - scrollbarInset * 2 - scrollbarThickness);
  const verticalTrackSize = Math.max(0, viewportForScrollbars.height - scrollbarInset * 2 - scrollbarThickness);
  const horizontalScrollbar = getScrollbarMetrics(
    documentFile.viewState.cameraX,
    cameraBounds.minCameraX,
    cameraBounds.maxCameraX,
    horizontalTrackSize,
  );
  const verticalScrollbar = getScrollbarMetrics(
    documentFile.viewState.cameraY,
    cameraBounds.minCameraY,
    cameraBounds.maxCameraY,
    verticalTrackSize,
  );
  const showHorizontalScrollbar = horizontalScrollbar.scrollRange > 1 && horizontalTrackSize > 0;
  const showVerticalScrollbar = verticalScrollbar.scrollRange > 1 && verticalTrackSize > 0;

  const setCameraFromScrollbar = (axis: "x" | "y", pointerCoordinate: number, thumbSize: number, trackSize: number) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }

    const trackStart = axis === "x"
      ? canvasRect.left + scrollbarInset
      : canvasRect.top + scrollbarInset;
    const thumbTravel = Math.max(0, trackSize - thumbSize);
    const ratio = thumbTravel > 0
      ? clamp((pointerCoordinate - trackStart - thumbSize / 2) / thumbTravel, 0, 1)
      : 0;

    setDocumentFile((current) => {
      const bounds = getCameraBounds(current.viewState, current.pageBounds, {
        width: canvasRef.current?.clientWidth ?? viewportForScrollbars.width,
        height: canvasRef.current?.clientHeight ?? viewportForScrollbars.height,
      });

      if (axis === "x") {
        return {
          ...current,
          viewState: {
            ...current.viewState,
            cameraX: bounds.maxCameraX - ratio * Math.max(0, bounds.maxCameraX - bounds.minCameraX),
          },
        };
      }

      return {
        ...current,
        viewState: {
          ...current.viewState,
          cameraY: bounds.maxCameraY - ratio * Math.max(0, bounds.maxCameraY - bounds.minCameraY),
        },
      };
    });
  };

  const startScrollbarDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    axis: "x" | "y",
    thumbSize: number,
    trackSize: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerCoordinate = axis === "x" ? event.clientX : event.clientY;
    setCameraFromScrollbar(axis, pointerCoordinate, thumbSize, trackSize);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setCameraFromScrollbar(axis, axis === "x" ? moveEvent.clientX : moveEvent.clientY, thumbSize, trackSize);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div className="app-shell">
      <div className="app-titlebar">
        <div className="app-titlebar-drag-region">
          <span>Infinite Canvas</span>
          <span className="app-version">v{APP_VERSION}</span>
        </div>
        <div className="window-controls">
          <button
            type="button"
            className="window-control-button"
            aria-label="最小化"
            onClick={() => {
              void window.electronApp?.minimizeWindow?.();
            }}
          >
            -
          </button>
          <button
            type="button"
            className="window-control-button"
            aria-label={windowAlwaysOnTop ? "取消置顶" : "窗口置顶"}
            aria-pressed={windowAlwaysOnTop}
            onClick={() => {
              window.electronApp?.toggleWindowAlwaysOnTop?.()
                .then(setWindowAlwaysOnTop)
                .catch(() => {});
            }}
          >
            {windowAlwaysOnTop ? "●" : "○"}
          </button>
          <button
            type="button"
            className="window-control-button"
            aria-label="最大化或还原"
            onClick={() => {
              void window.electronApp?.toggleMaximizeWindow?.();
            }}
          >
            □
          </button>
          <button
            type="button"
            className="window-control-button close"
            aria-label="关闭"
            onClick={() => {
              void window.electronApp?.closeWindow?.();
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div className="topbar-shell">
        <Toolbar
          zoom={documentFile.viewState.zoom}
          dirty={isDirty}
          canUndo={historyPastRef.current.length > 0}
          canRedo={historyFutureRef.current.length > 0}
          canInsertTable={editingNodeId !== null || !!selectedTextNode}
          canInsertTableColumn={editingNodeId !== null}
          canClearEmptyLines={editingNodeId !== null || hasSelectedTextNodes}
          canFormatText={editingNodeId !== null || hasSelectedTextNodes}
          canGenerateTimeline={selectedTextNodeHasTable}
          onNewDocument={handleNewDocument}
          onOpenDocument={handleOpenClick}
          onSaveDocument={handleSave}
          onOpenTrash={handleOpenTrash}
          onSaveAsDocument={handleSaveAs}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onAddText={handleAddText}
          onAddShape={handleAddShape}
          onAddImage={handleImageClick}
          onAddAttachment={handleAttachmentClick}
          connectorMode={connectorMode}
          onToggleConnectorMode={() => {
            setConnectorMode((current) => !current);
            setInteraction({ type: "none" });
          }}
          selectedConnectorStyle={selectedConnector ? {
            stroke: selectedConnector.stroke,
            strokeWidth: selectedConnector.strokeWidth,
            lineStyle: selectedConnector.lineStyle,
            endMarker: selectedConnector.endMarker,
          } : null}
          onSetConnectorStroke={(stroke) => updateSelectedConnector((connector) => ({ ...connector, stroke }))}
          onSetConnectorStrokeWidth={(strokeWidth) => updateSelectedConnector((connector) => ({ ...connector, strokeWidth }))}
          onSetConnectorLineStyle={(lineStyle) => updateSelectedConnector((connector) => ({ ...connector, lineStyle }))}
          onSetConnectorEndMarker={(endMarker) => updateSelectedConnector((connector) => ({ ...connector, endMarker }))}
          onInsertTable={handleInsertTable}
          onGenerateTimeline={handleGenerateTimeline}
          onInsertTimelineExample={handleInsertTimelineExample}
          onClearEmptyLines={handleClearEmptyLines}
          onInsertTableColumn={handleInsertTableColumn}
          onInsertTableColumnLeft={handleInsertTableColumnLeft}
          onDeleteTableColumn={handleDeleteTableColumn}
          onSetFontFamily={handleSetFontFamily}
          onSetFontSize={handleSetFontSize}
          onSetTextColor={handleSetTextColor}
          onSetHighlightColor={handleSetHighlightColor}
          onApplyBlockStyle={handleApplyBlockStyle}
          onToggleBold={() => handleToggleInlineStyle("toggle-bold")}
          onToggleItalic={() => handleToggleInlineStyle("toggle-italic")}
          onToggleUnderline={() => handleToggleInlineStyle("toggle-underline")}
          onToggleStrike={() => handleToggleInlineStyle("toggle-strike")}
          pageBackground={documentFile.appearance.pageBackground}
          gridEnabled={documentFile.appearance.grid.enabled}
          gridColor={documentFile.appearance.grid.color}
          gridSize={documentFile.appearance.grid.size}
          onSetPageBackground={handleSetPageBackground}
          onSetGridEnabled={handleSetGridEnabled}
          onSetGridColor={handleSetGridColor}
          onSetGridSize={handleSetGridSize}
          onZoomChange={handleZoomChange}
          searchQuery={searchQuery}
          searchScope={searchScope}
          searchResults={searchResults}
          searchActiveIndex={searchActiveIndex}
          onSearchChange={handleSearchChange}
          onSearchScopeChange={handleSearchScopeChange}
          onSearchResultClick={handleSearchResultClick}
          onSearchKeyDown={handleSearchKeyDown}
          onSearchClose={handleSearchClose}
          selectionFontFamily={selectionFormat?.fontFamily ?? null}
          selectionFontSize={selectionFormat?.fontSize ?? null}
        />
      </div>

      <input
        ref={openInputRef}
        type="file"
        accept=".icanvas.html,.icanvas.json,.html,.htm,.xml,.txt,.md,.one,.onetoc2,application/json,text/html,application/xml,text/plain"
        hidden
        onChange={handleOpenFile}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleImportImage}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        accept=".pdf,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.md"
        hidden
        onChange={handleImportAttachment}
      />

      {autosaveRestoreAvailable ? (
        <div className="autosave-banner">
          <span>发现自动保存草稿，是否恢复？</span>
          <div className="autosave-banner-actions">
            <button type="button" onClick={handleRestoreAutosave}>恢复</button>
            <button type="button" onClick={handleDiscardAutosave}>丢弃</button>
          </div>
        </div>
      ) : null}

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      {trashDialogOpen && trashEntries !== null ? (
        <div className="modal-backdrop" onPointerDown={handleCloseTrash}>
          <div className="trash-dialog" onPointerDown={(event) => event.stopPropagation()} style={{ width: 560, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div className="trash-dialog-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e9ecef' }}>
              <strong style={{ fontSize: 16 }}>回收站</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="toolbar-button" onClick={handleEmptyTrash} style={{ fontSize: 12, padding: '2px 10px' }} disabled={trashEntries.length === 0}>清空回收站</button>
                <button type="button" onClick={handleCloseTrash} aria-label="关闭" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9993' }}>×</button>
              </div>
            </div>
            <div className="trash-dialog-body" style={{ overflowY: 'auto', padding: 8 }}>
              {trashEntries.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#9E9993', fontSize: 14 }}>回收站是空的</div>
              ) : (
                trashEntries.map((entry) => {
                  const originalName = entry.name.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_/, "");
                  const deletedAt = new Date(entry.mtimeMs).toLocaleString("zh-CN");
                  return (
                    <div key={entry.path} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #F0EEE9' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#24211F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{originalName}</div>
                        <div style={{ fontSize: 12, color: '#9E9993' }}>删除于 {deletedAt}</div>
                      </div>
                      <button
                        type="button"
                        className="toolbar-button"
                        onClick={() => handleRestoreTrashEntry(entry.path)}
                        style={{ fontSize: 12, padding: '2px 10px', flexShrink: 0 }}
                      >还原</button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
      {nodeLinkPopover ? (
        <ReferencePopover
          title={nodeLinkPopover.title}
          x={nodeLinkPopover.x}
          y={nodeLinkPopover.y}
          fullText={nodeLinkPopover.fullText}
          previewContent={nodeLinkPopover.previewContent}
          nodeRefs={nodeLinkPopover.refs}
          links={nodeLinkPopover.links}
          onAddRef={nodeLinkPopover.onAddRef}
          onRemoveRef={nodeLinkPopover.onRemoveRef}
          onNavigateTo={(pageIndex, nodeId, filePath) => {
            if (filePath && filePath !== currentSavePath) {
              setNodeLinkPopover(null);
              void handleOpenWorkspaceFile(filePath, pageIndex);
              return;
            }
            handleSelectPage(pageIndex + 1);
            selectNode(nodeId);
            setNodeLinkPopover(null);
          }}
          onClose={() => setNodeLinkPopover(null)}
        />
      ) : null}
      {nodeLinkPicker ? (
        <div className="modal-backdrop" onPointerDown={handleCancelNodeLinkPicker}>
          <div className="node-link-picker" onPointerDown={(event) => event.stopPropagation()} style={{ width: 440, maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e9ecef' }}>
              <strong style={{ fontSize: 15 }}>选择要引用的节点</strong>
              <button type="button" onClick={handleCancelNodeLinkPicker} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#9E9993' }}>×</button>
            </div>
            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e9ecef' }}>
              <button type="button" onClick={() => setExternalDocPickerTab("current")}
                style={{ flex: 1, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: externalDocPickerTab === "current" ? 700 : 400, color: externalDocPickerTab === "current" ? '#24211F' : '#9E9993', borderBottom: externalDocPickerTab === "current" ? '2px solid #D57D61' : '2px solid transparent' }}>
                当前文档
              </button>
              <button type="button" onClick={async () => {
                setExternalDocPickerTab("external");
                if (!externalDocNodes && window.electronApp?.listExternalDocumentNodes) {
                  setExternalDocsLoading(true);
                  try {
                    const otherDocs = workspaceDocumentSummaries.filter(d => d.filePath !== currentSavePath);
                    const results = await Promise.all(
                      otherDocs.map(d => window.electronApp!.listExternalDocumentNodes!({ filePath: d.filePath }).catch(() => null))
                    );
                    setExternalDocNodes(results.filter(Boolean) as unknown as typeof externalDocNodes);
                  } catch {} finally {
                    setExternalDocsLoading(false);
                  }
                }
              }}
                style={{ flex: 1, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: externalDocPickerTab === "external" ? 700 : 400, color: externalDocPickerTab === "external" ? '#24211F' : '#9E9993', borderBottom: externalDocPickerTab === "external" ? '2px solid #D57D61' : '2px solid transparent' }}>
                其他文档
              </button>
            </div>
            {/* Search input */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #e9ecef' }}>
              <input
                type="text"
                value={linkPickerSearch}
                onChange={(e) => setLinkPickerSearch(e.currentTarget.value)}
                placeholder="搜索节点或文本块..."
                autoFocus
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ overflowY: 'auto', padding: 8 }}>
              {externalDocPickerTab === "current" && (() => {
                const searchLower = linkPickerSearch.trim().toLowerCase();
                const filteredNodes = searchLower
                  ? documentFile.nodes.filter((n) => {
                      let text = n.id;
                      if (n.type === "text" && "content" in n) {
                        const firstPara = n.content.content.find((b) => b.type === "paragraph");
                        if (firstPara) text = firstPara.content.map((i) => i.type === "text" ? i.text : "").join("");
                      } else if (n.type === "timeline") {
                        text = n.entries[0]?.category ?? n.id;
                      }
                      return text.toLowerCase().includes(searchLower);
                    })
                  : documentFile.nodes;
                const items: Array<{ key: string; pageIndex: number; nodeId: string; displayName: string; sub: string; docPath?: string; paragraphIndex?: number }> = [];
                for (const n of filteredNodes) {
                  let displayName = n.id;
                  let sub: string = n.type;
                  if (n.type === "text" && "content" in n) {
                    const paras = n.content.content.filter((b) => b.type === "paragraph");
                    const firstPara = paras[0];
                    if (firstPara) {
                      const t = firstPara.content.map((i) => i.type === "text" ? i.text : "").join("").trim().slice(0, 50);
                      if (t) displayName = t;
                    }
                    sub = `${n.type} · ${paras.length} 段`;
                    if (searchLower) {
                      // Show matching paragraphs as separate items
                      paras.forEach((p, pi) => {
                        const ptext = p.content.map((i) => i.type === "text" ? i.text : "").join("").trim();
                        if (ptext && (!searchLower || ptext.toLowerCase().includes(searchLower))) {
                          items.push({
                            key: `${n.id}-p${pi}`,
                            pageIndex: n.pageIndex,
                            nodeId: n.id,
                            displayName: ptext.slice(0, 60),
                            sub: `段落 ${pi + 1}`,
                            paragraphIndex: pi,
                          });
                        }
                      });
                      continue; // Skip node-level entry when showing paragraph matches
                    }
                  } else if (n.type === "timeline") {
                    displayName = n.entries[0]?.category ?? "时间线";
                    sub = `${n.entries.length} 个条目`;
                  }
                  items.push({
                    key: n.id,
                    pageIndex: n.pageIndex,
                    nodeId: n.id,
                    displayName,
                    sub,
                  });
                }
                if (items.length === 0) {
                  return <div style={{ padding: 16, textAlign: 'center', color: '#9E9993', fontSize: 13 }}>无匹配结果</div>;
                }
                return items.map((item) => (
                  <button key={item.key} type="button"
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #F0EEE9', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#24211F' }}
                    onClick={() => handlePickNodeForLink(item.pageIndex, item.nodeId, item.docPath, item.paragraphIndex)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#FFFFFF')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.displayName}</div>
                    <div style={{ fontSize: 12, color: '#9E9993' }}>{item.sub}</div>
                  </button>
                ));
              })()}
              {externalDocPickerTab === "external" && (
                externalDocsLoading ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#9E9993', fontSize: 14 }}>加载中...</div>
                ) : externalDocNodes && externalDocNodes.length > 0 ? (
                  (() => {
                    const searchLower = linkPickerSearch.trim().toLowerCase();
                    const docPageMap = new Map<string, { fileName: string; filePath: string; pages: Map<number, { pageTitle: string; nodes: { id: string; type: string }[] }> }>();
                    for (const doc of externalDocNodes) {
                      const summary = workspaceDocumentSummaries.find(s => s.filePath === doc.filePath);
                      const pages = new Map<number, { pageTitle: string; nodes: { id: string; type: string }[] }>();
                      for (const n of doc.nodes) {
                        let pageTitle = `第 ${n.pageIndex + 1} 页`;
                        if (summary) {
                          const pageInfo = summary.pages.find(p => p.index === n.pageIndex);
                          if (pageInfo?.title) pageTitle = pageInfo.title;
                        }
                        if (!pages.has(n.pageIndex)) pages.set(n.pageIndex, { pageTitle, nodes: [] });
                        pages.get(n.pageIndex)!.nodes.push({ id: n.id, type: n.type });
                      }
                      if (searchLower) {
                        const docNameMatch = doc.fileName.toLowerCase().includes(searchLower);
                        const matchedPages = new Map<number, { pageTitle: string; nodes: { id: string; type: string }[] }>();
                        for (const [pi, pg] of pages) {
                          const titleMatch = pg.pageTitle.toLowerCase().includes(searchLower);
                          const matchedNodes = pg.nodes.filter(n => n.id.toLowerCase().includes(searchLower) || n.type.toLowerCase().includes(searchLower));
                          if (titleMatch || matchedNodes.length > 0) {
                            matchedPages.set(pi, { ...pg, nodes: titleMatch ? pg.nodes : matchedNodes });
                          }
                        }
                        if (docNameMatch) docPageMap.set(doc.filePath, { fileName: doc.fileName, filePath: doc.filePath, pages });
                        else if (matchedPages.size > 0) docPageMap.set(doc.filePath, { fileName: doc.fileName, filePath: doc.filePath, pages: matchedPages });
                      } else {
                        docPageMap.set(doc.filePath, { fileName: doc.fileName, filePath: doc.filePath, pages });
                      }
                    }
                    if (docPageMap.size === 0) {
                      return <div style={{ padding: 16, textAlign: 'center', color: '#9E9993', fontSize: 13 }}>无匹配结果</div>;
                    }
                    const result: React.ReactNode[] = [];
                    let docIdx = 0;
                    for (const [filePath, docInfo] of docPageMap) {
                      const isDocExpanded = expandedExternalDocs.has(filePath);
                      result.push(
                        <button key={`doc-${docIdx}`} type="button" style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderBottom: '1px solid #F0EEE9', background: '#FFFFFF', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#24211F' }}
                          onClick={() => { setExpandedExternalDocs(prev => { const n = new Set(prev); if (n.has(filePath)) n.delete(filePath); else n.add(filePath); return n; }); }}>
                          <span style={{ fontSize: 11, color: '#9E9993', width: 12 }}>{isDocExpanded ? '▾' : '▸'}</span>
                          <span>{docInfo.fileName}</span>
                        </button>
                      );
                      if (isDocExpanded) {
                        const pageEntries = Array.from(docInfo.pages.entries()).sort(([a], [b]) => a - b);
                        for (const [pageIdx, pageInfo] of pageEntries) {
                          const expandedPages = expandedExternalDocPages[filePath] ?? new Set();
                          const isPageExpanded = expandedPages.has(pageIdx);
                          result.push(
                            <button key={`page-${docIdx}-${pageIdx}`} type="button" style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '4px 8px 4px 28px', border: 'none', borderBottom: '1px solid #F0EEE9', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#6B6661' }}
                              onClick={() => { setExpandedExternalDocPages(prev => { const np = new Set(prev[filePath] ?? []); if (np.has(pageIdx)) np.delete(pageIdx); else np.add(pageIdx); return { ...prev, [filePath]: np }; }); }}>
                              <span style={{ fontSize: 10, color: '#9E9993', width: 12 }}>{isPageExpanded ? '▾' : '▸'}</span>
                              <span>{pageInfo.pageTitle}</span>
                              <span style={{ fontSize: 10, color: '#9E9993' }}>({pageInfo.nodes.length})</span>
                            </button>
                          );
                          if (isPageExpanded) {
                            for (const nodeInfo of pageInfo.nodes) {
                              let displayName = `${nodeInfo.type}: ${nodeInfo.id.slice(0, 30)}`;
                              result.push(
                                <button key={`node-${docIdx}-${pageIdx}-${nodeInfo.id}`} type="button" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px 4px 44px', border: 'none', borderBottom: '1px solid #FFFFFF', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#D57D61' }}
                                  onClick={() => handlePickNodeForLink(pageIdx, nodeInfo.id, filePath)}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                                  {displayName}
                                </button>
                              );
                            }
                          }
                        }
                      }
                      docIdx++;
                    }
                    return result;
                  })()
                ) : (
                  <div style={{ padding: 32, textAlign: 'center', color: '#9E9993', fontSize: 14 }}>没有其他文档</div>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
      {markdownDialog ? (
        <div className="modal-backdrop" onPointerDown={() => setMarkdownDialog(null)}>
          <div className="markdown-dialog" onPointerDown={(event) => event.stopPropagation()}>
            <div className="markdown-dialog-header">
              <strong>粘贴 Markdown</strong>
              <button type="button" onClick={() => setMarkdownDialog(null)} aria-label="关闭">×</button>
            </div>
            <textarea
              autoFocus
              value={markdownDialog.text}
              onChange={(event) => setMarkdownDialog((current) => current ? { ...current, text: event.currentTarget.value } : current)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  handleSubmitMarkdownDialog();
                }
                if (event.key === "Escape") {
                  setMarkdownDialog(null);
                }
              }}
              placeholder={"# 标题\n\n| 方向 | 年份 | 标题 | DOI |\n|---|---:|---|---|\n| AI分子表示 | 2025 | Token-Mol | 10.1038/s41467-025-59628-y |"}
            />
            <div className="markdown-dialog-actions">
              <button type="button" onClick={() => setMarkdownDialog(null)}>取消</button>
              <button type="button" className="primary" onClick={handleSubmitMarkdownDialog} disabled={!markdownDialog.text.trim()}>插入</button>
            </div>
          </div>
        </div>
      ) : null}

      {canvasContextMenu ? (
        <div
          className="context-menu sidebar-context-menu"
          style={{
            left: canvasContextMenu.x,
            top: canvasContextMenu.y,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {canvasContextMenu.nodeId && (
            <button
              type="button"
              className="sidebar-context-menu-item"
              onClick={() => {
                const { x, y, nodeId } = canvasContextMenu;
                setCanvasContextMenu(null);
                if (nodeId) {
                  // If the node is a timeline, add ref to the first entry without one
                  const targetNode = documentFile.nodes.find(n => n.id === nodeId);
                  if (targetNode?.type === "timeline") {
                    const entryIndex = targetNode.entries.findIndex(e => !e.nodeRef);
                    if (entryIndex >= 0) {
                      handleRequestInsertTimelineRef(nodeId, entryIndex, x, y);
                    }
                  } else {
                    handleRequestInsertNodeLink(nodeId, x, y);
                  }
                }
              }}
            >
              添加引用
            </button>
          )}
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => {
              const { worldX, worldY } = canvasContextMenu;
              setCanvasContextMenu(null);
              navigator.clipboard.readText()
                .then((clipboardText) => {
                  if (!looksLikeHtmlSource(clipboardText)) {
                    setErrorMessage("剪贴板里没有可插入的 HTML 源码。");
                    return;
                  }
                  handleInsertHtmlPreviewAt(worldX, worldY, clipboardText, { name: "HTML Block" });
                })
                .catch((error) => {
                  setErrorMessage(error instanceof Error ? error.message : "插入 HTML 块失败。");
                });
            }}
          >
            插入 HTML 块
          </button>
          <button
            type="button"
            className="sidebar-context-menu-item"
            onClick={() => {
              const { worldX, worldY } = canvasContextMenu;
              setCanvasContextMenu(null);
              handlePasteMarkdownAt(worldX, worldY).catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : "粘贴 Markdown 失败。");
              });
            }}
          >
            粘贴 Markdown
          </button>
        </div>
      ) : null}

      {sidebarContextMenu ? (
        <div
          className="context-menu sidebar-context-menu"
          style={{
            left: sidebarContextMenu.x,
            top: sidebarContextMenu.y,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {sidebarContextMenu.kind === "file" ? (
            <>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleOpenWorkspaceFile(sidebarContextMenu.filePath);
                }}
              >
                打开
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleBeginRenameWorkspaceFile(sidebarContextMenu.filePath, sidebarContextMenu.fileName);
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  const parentDirectoryPath = sidebarContextMenu.parentDirectoryPath;
                  setSidebarContextMenu(null);
                  handleCreateWorkspaceDirectory(parentDirectoryPath);
                }}
              >
                在此处新建文件夹
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item danger"
                onClick={() => {
                  const filePath = sidebarContextMenu.filePath;
                  setSidebarContextMenu(null);
                  handleDeleteWorkspaceFile(filePath).catch(() => {});
                }}
              >
                删除文件
              </button>
            </>
          ) : sidebarContextMenu.kind === "directory" ? (
            <>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  const directoryPath = sidebarContextMenu.directoryPath;
                  setSidebarContextMenu(null);
                  handleToggleDirectory(directoryPath);
                }}
              >
                展开/折叠
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  const directoryPath = sidebarContextMenu.directoryPath;
                  setSidebarContextMenu(null);
                  handleCreateWorkspaceDirectory(directoryPath);
                }}
              >
                新建子文件夹
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  const { directoryPath, directoryName } = sidebarContextMenu;
                  setSidebarContextMenu(null);
                  handleRenameWorkspaceDirectory(directoryPath, directoryName).catch(() => {});
                }}
              >
                重命名文件夹
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item danger"
                onClick={() => {
                  const directoryPath = sidebarContextMenu.directoryPath;
                  setSidebarContextMenu(null);
                  handleDeleteWorkspaceDirectory(directoryPath).catch(() => {});
                }}
              >
                删除文件夹
              </button>
            </>
          ) : sidebarContextMenu.kind === "workspace" ? (
            <>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  const directoryPath = sidebarContextMenu.directoryPath;
                  setSidebarContextMenu(null);
                  handleCreateWorkspaceDirectory(directoryPath);
                }}
              >
                新建文件夹
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  refreshWorkspaceEntries().catch(() => {});
                }}
              >
                刷新
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleSelectPage(sidebarContextMenu.pageIndex + 1);
                }}
              >
                切换到此页
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleAddPage();
                }}
              >
                新增页
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleBeginRenamePage(sidebarContextMenu.pageIndex);
                }}
              >
                重命名
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleCopyPage(sidebarContextMenu.pageIndex);
                }}
              >
                复制页
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                disabled={pageCount <= 1}
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleCutPage(sidebarContextMenu.pageIndex);
                }}
              >
                剪切页
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item"
                disabled={!pageClipboard}
                onClick={() => {
                  setSidebarContextMenu(null);
                  handlePastePageAfter(sidebarContextMenu.pageIndex);
                }}
              >
                粘贴到此页后
              </button>
              <button
                type="button"
                className="sidebar-context-menu-item danger"
                disabled={pageCount <= 1}
                onClick={() => {
                  setSidebarContextMenu(null);
                  handleDeletePage(sidebarContextMenu.pageIndex);
                }}
              >
                删除页
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="content-shell">
        <aside className="left-rail">
          <button
            type="button"
            className={!fileSidebarCollapsed ? "sidebar-menu-button left-rail-button active" : "sidebar-menu-button left-rail-button"}
            aria-label={fileSidebarCollapsed ? "展开文件侧栏" : "收起文件侧栏"}
            aria-pressed={!fileSidebarCollapsed}
            onClick={() => setFileSidebarCollapsed((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>
          <button
            type="button"
            className={!pageSidebarCollapsed ? "rail-page-button left-rail-button active" : "rail-page-button left-rail-button"}
            aria-label={pageSidebarCollapsed ? "展开页面栏" : "收起页面栏"}
            aria-pressed={!pageSidebarCollapsed}
            onClick={() => setPageSidebarCollapsed((current) => !current)}
          >
            <span className="rail-page-sheet" />
            <span className="rail-page-line top" />
            <span className="rail-page-line middle" />
            <span className="rail-page-line bottom" />
          </button>
        </aside>

        <div className="workspace-shell">
          <aside className={fileSidebarCollapsed ? "file-sidebar collapsed" : "file-sidebar"}>
            {!fileSidebarCollapsed ? (
              <FileSidebar
                entries={orderedWorkspaceEntries}
                rootPath={workspaceRootPath}
                currentFilePath={currentSavePath}
                openingFilePath={openingWorkspaceFilePath}
                expandedDirectories={expandedDirectories}
                loading={workspaceLoading}
                errorMessage={workspaceError}
                onToggleDirectory={handleToggleDirectory}
                onOpenFile={handleOpenWorkspaceFile}
                onMoveFileToDirectory={handleMoveWorkspaceFileToDirectory}
                onReorderFile={handleReorderWorkspaceFile}
                onFileContextMenu={handleFileContextMenu}
                onDirectoryContextMenu={handleDirectoryContextMenu}
                onBlankContextMenu={handleWorkspaceBlankContextMenu}
                renamingFilePath={renamingFilePath}
                renamingFileName={renamingFileName}
                onRenamingFileNameChange={setRenamingFileName}
                onCommitFileRename={handleCommitWorkspaceFileRename}
                onCancelFileRename={handleCancelWorkspaceFileRename}
                renamingDirectoryPath={renamingDirectoryPath}
                renamingDirectoryName={renamingDirectoryName}
                onRenamingDirectoryNameChange={setRenamingDirectoryName}
                onCommitDirectoryRename={handleCommitWorkspaceDirectoryRename}
                onCancelDirectoryRename={handleCancelWorkspaceDirectoryRename}
                onRefresh={() => {
                  refreshWorkspaceEntries().catch(() => {});
                }}
                selectedFilePaths={selectedFilePaths}
                onSelectFile={handleFileSelect}
              />
            ) : null}
          </aside>

        <aside className={pageSidebarCollapsed ? "page-sidebar-column collapsed" : "page-sidebar-column"}>
          <section className="sidebar-panel page-sidebar">
            <div className="sidebar-panel-header">
              <div>
                <span className="page-sidebar-title" title={currentFileName}>{currentDisplayFileName}</span>
                <small>
                  {autosaveStatus === "pending" ? "自动保存中" : autosaveStatus === "saved" ? "已自动保存" : "文档结构"}
                </small>
              </div>
              <button type="button" className="sidebar-panel-action icon" onClick={handleAddPage} aria-label="新增页">+</button>
            </div>
            <div className="page-sidebar-list">
            {Array.from({ length: pageCount }, (_, index) => {
              const pageNumber = index + 1;
              const isSwiped = swipedPageIndex === index;
              const translateX = isSwiped ? Math.min(0, swipeOffset || -88) : 0;
              return (
                <div
                  key={pageNumber}
                  className={isSwiped ? "page-chip-row swiped" : "page-chip-row"}
                  onPointerDown={(event) => {
                    pageSwipeGestureRef.current = {
                      pageIndex: index,
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      offsetX: isSwiped ? -88 : 0,
                      isHorizontal: false,
                      moved: false,
                    };
                  }}
                  onPointerMove={(event) => {
                    const gesture = pageSwipeGestureRef.current;
                    if (!gesture || gesture.pageIndex !== index || gesture.pointerId !== event.pointerId) {
                      return;
                    }

                    const deltaX = event.clientX - gesture.startX;
                    const deltaY = event.clientY - gesture.startY;

                    if (!gesture.isHorizontal) {
                      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) {
                        return;
                      }
                      gesture.isHorizontal = true;
                    }

                    gesture.moved = true;
                    const nextOffset = clamp(gesture.offsetX + deltaX, -88, 0);
                    gesture.offsetX = nextOffset;
                    setSwipedPageIndex(index);
                    setSwipeOffset(nextOffset);
                    gesture.startX = event.clientX;
                    gesture.startY = event.clientY;
                    event.preventDefault();
                  }}
                  onPointerUp={(event) => {
                    const gesture = pageSwipeGestureRef.current;
                    if (!gesture || gesture.pageIndex !== index || gesture.pointerId !== event.pointerId) {
                      return;
                    }

                    if (gesture.isHorizontal) {
                      const shouldOpen = swipeOffset <= -44;
                      setSwipedPageIndex(shouldOpen ? index : null);
                      setSwipeOffset(shouldOpen ? -88 : 0);
                      event.preventDefault();
                    }

                    window.setTimeout(() => {
                      pageSwipeGestureRef.current = null;
                    }, 0);
                  }}
                  onPointerCancel={() => {
                    pageSwipeGestureRef.current = null;
                    setSwipeOffset(0);
                    setSwipedPageIndex(null);
                  }}
                >
                  <button
                    type="button"
                    className="page-chip-delete"
                    onClick={() => handleDeletePage(index)}
                    disabled={pageCount <= 1}
                    aria-label={`删除${pageSummaries[index]}`}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    className={pageNumber - 1 === activePageIndex ? "page-chip active" : "page-chip"}
                    style={{ transform: `translateX(${translateX}px)` }}
                    onContextMenu={(event) => handlePageContextMenu(event, index)}
                    onClick={() => {
                      if (pageSwipeGestureRef.current?.moved) {
                        pageSwipeGestureRef.current = null;
                        return;
                      }

                      if (swipedPageIndex !== null && swipedPageIndex !== index) {
                        setSwipedPageIndex(null);
                        setSwipeOffset(0);
                        return;
                      }

                      if (isSwiped) {
                        setSwipedPageIndex(null);
                        setSwipeOffset(0);
                        return;
                      }

                      handleSelectPage(pageNumber);
                    }}
                  >
                    {renamingPageIndex === index ? (
                      <input
                        className="page-chip-inline-input"
                        autoFocus
                        value={renamingPageTitle}
                        onChange={(event) => setRenamingPageTitle(event.currentTarget.value)}
                        onBlur={handleCommitPageRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            handleCommitPageRename();
                          }
                          if (event.key === "Escape") {
                            handleCancelPageRename();
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <span className="page-chip-label">{pageSummaries[index]}</span>
                    )}
                  </button>
                </div>
              );
            })}
            </div>
          </section>
        </aside>

        <div
          ref={canvasRef}
          className="canvas-shell"
        tabIndex={0}
        onDragOver={(event) => {
          if (isCanvasNodeTarget(event.target)) {
            return;
          }

          if (!Array.from(event.dataTransfer?.types ?? []).includes("text/plain")) {
            return;
          }

          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (isCanvasNodeTarget(event.target)) {
            return;
          }

          const plainText = event.dataTransfer?.getData("text/plain") ?? "";
          if (plainText.length === 0) {
            return;
          }

          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          event.preventDefault();
          const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
          handleDropTextAt(point.x, point.y, plainText);
        }}
        onContextMenu={(event) => {
          if (isEditableTarget(event.target)) {
            return;
          }

          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          event.preventDefault();
          const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
          const nodeId = getCanvasNodeIdFromTarget(event.target);
          setSidebarContextMenu(null);
          setCanvasContextMenu({
            x: event.clientX,
            y: event.clientY,
            worldX: point.x,
            worldY: point.y,
            ...(nodeId ? { nodeId } : {}),
          });
        }}
        onClick={() => {
          setCanvasContextMenu(null);
          if (swipedPageIndex !== null) {
            setSwipedPageIndex(null);
            setSwipeOffset(0);
          }
          if (suppressNextCanvasClickRef.current) {
            suppressNextCanvasClickRef.current = false;
            return;
          }

          setSelectedNodeIds([]);
        }}
        onDoubleClick={(event) => {
          if (editingNodeId) {
            return;
          }

          if (isCanvasNodeTarget(event.target)) {
            return;
          }

          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          event.preventDefault();
          const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
          handleAddTextAt(point.x, point.y);
        }}
        onPointerDown={(event) => {
          if (isCanvasNodeTarget(event.target)) {
            return;
          }

          if (event.button === 0) {
            if (editingNodeId) {
              return;
            }
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }

            const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
            if (connectorMode) {
              startConnectorDraw(event.nativeEvent);
              return;
            }

            const connector = findConnectorAtPoint(point);
            if (connector) {
              startConnectorDrag(event.nativeEvent, connector);
              return;
            }

            setSelectedNodeIds([]);
            setInteraction({
              type: "marquee",
              startX: point.x,
              startY: point.y,
              currentX: point.x,
              currentY: point.y,
            });
            return;
          }

          if (event.button !== 1) {
            return;
          }

          startCanvasPan(event);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          if (event.ctrlKey || event.metaKey) {
            const nextZoom = stepZoom(documentFile.viewState.zoom, event.deltaY > 0 ? "out" : "in");
            scheduleZoomSettle();
            setDocumentFile((current) => {
              const zoomedViewState = zoomAtPoint(current.viewState, event.clientX, event.clientY, rect, nextZoom);

              return {
                ...current,
                viewState: zoomedViewState,
              };
            });
            return;
          }

          setDocumentFile((current) => ({
            ...current,
            viewState: clampViewStateToPage(
              {
                ...current.viewState,
                cameraX: current.viewState.cameraX - event.deltaX,
                cameraY: current.viewState.cameraY - event.deltaY,
              },
              current.pageBounds,
              rect,
            ),
          }));
        }}
        >
          <div
            className={`canvas-grid ${zoomTransitionActive ? "zoom-transition" : ""}`}
            style={{
              "--canvas-zoom": documentFile.viewState.zoom,
              "--inverse-zoom": 1 / documentFile.viewState.zoom,
              transform: `translate(${documentFile.viewState.cameraX}px, ${documentFile.viewState.cameraY}px) scale(${documentFile.viewState.zoom})`,
            } as CSSProperties}
        >
          <div
            className="page-surface"
            style={{
              transform: `translate(${documentFile.pageBounds.x}px, ${documentFile.pageBounds.y}px)`,
              width: documentFile.pageBounds.w,
              height: documentFile.pageBounds.h,
              backgroundColor: documentFile.appearance.pageBackground,
              "--page-grid-color": documentFile.appearance.grid.color,
              "--page-grid-size": `${documentFile.appearance.grid.size}px`,
            } as CSSProperties}
          >
            {Array.from({ length: documentFile.appearance.pages.count }, (_, i) => {
              const top = i * documentFile.appearance.pages.height;
              return (
                <div key={i}
                  className={[
                    "page-sheet",
                    documentFile.appearance.grid.enabled ? "has-grid" : "",
                    "active",
                  ].filter(Boolean).join(" ")}
                  style={{
                    top: `${top}px`,
                    height: `${documentFile.appearance.pages.height}px`,
                    backgroundColor: documentFile.appearance.pageBackground,
                  }}
                />
              );
            })}
            <div
              className="onenote-page-title"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="onenote-page-title-outline">
                <input
                  className="onenote-page-title-input"
                  type="text"
                  value={currentPageTitle}
                  onChange={(event) => handlePageTitleChange(activePageIndex, event.currentTarget.value)}
                  placeholder="页面标题"
                />
              </div>
              <div className="onenote-page-title-datetime" aria-label="页面创建时间">
                <div>{currentPageDateTime.date}</div>
                {currentPageDateTime.time ? <div>{currentPageDateTime.time}</div> : null}
              </div>
            </div>
          </div>
          <ConnectorLayer
            connectors={visiblePageConnectors}
            nodes={documentFile.nodes}
            pageBounds={documentFile.pageBounds}
            selectedNodeIds={selectedNodeIds}
            temporaryConnector={getTemporaryConnector()}
            onEndpointPointerDown={startConnectorEndpointDrag}
          />
          {visibleTimelineNodes.map((node) => {
              return (
                <TimelineNode
                  key={node.id}
                  node={node}
                  selected={selectedNodeIds.includes(node.id)}
                  onSelect={() => selectNode(node.id)}
                  onPointerDown={(event) => startNodeDrag(event, node)}
                  onResizePointerDown={(event, handle) => startResize(event, node, handle)}
                  onHeightChange={(h) => {
                    updateNode(node.id, (current) =>
                      current.type === "timeline" ? { ...current, h } : current
                    );
                  }}
                  onEntriesChange={(entries) => {
                    updateNode(node.id, (current) => current.type === "timeline"
                      ? { ...current, entries }
                      : current);
                  }}
                  assets={documentFile.assets}
                  onRequestInsertTimelineRef={(timelineNodeId, entryIndex, x, y) => {
                    handleRequestInsertTimelineRef(timelineNodeId, entryIndex, x, y);
                  }}
                  onOpenTimelineRefPopover={(entry, entryIndex, timelineNodeId, x, y) => {
                    handleOpenTimelineRefPopover(entry, entryIndex, timelineNodeId, x, y);
                  }}
                />
              );
            })}
          {visiblePageBoxNodes.map((node) => {
              if (node.type === "text") {
                return (
                  <TextNode
                    key={node.id}
                    node={node}
                    assets={documentFile.assets}
                    selected={selectedNodeIds.includes(node.id)}
                    editing={editingNodeId === node.id}
                    command={editingNodeId === node.id ? editorCommand : null}
                    contentRevision={editorContentRevision}
                    onSelect={() => selectNode(node.id)}
                    onBeginEdit={() => {
                      beginEditingTextNode(node.id);
                    }}
                    onCommit={(content) => {
                      textDraftHistoryRef.current = null;
                      setEditingNodeId(null);
                      if (!richTextDocHasContent(content)) {
                        patchDocument((current) => settleDocumentLayout({
                          ...current,
                          nodes: current.nodes.filter((currentNode) => currentNode.id !== node.id),
                        }));
                        setSelectedNodeIds((current) => current.filter((nodeId) => nodeId !== node.id));
                        return;
                      }
                      updateNode(node.id, (current) => ({ ...current, content }));
                    }}
                    onDraftChange={(content, options) => {
                      updateTextNodeDraft(node.id, content, options);
                    }}
                    onPasteImage={handlePasteImageIntoText}
                    onAutoResize={(height) => {
                      updateNode(
                        node.id,
                        (current) => {
                          if (current.type !== "text" || Math.abs(current.h - height) < 1) {
                            return current;
                          }

                          return {
                            ...current,
                            h: height,
                          };
                        },
                        false,
                        { avoidVerticalOverlap: height > node.h },
                      );
                    }}
                    onAutoResizeWidth={(width) => {
                      updateNode(
                        node.id,
                        (current) => {
                          if (current.type !== "text" || Math.abs(current.w - width) < 1) {
                            return current;
                          }

                          return {
                            ...current,
                            w: width,
                          };
                        },
                        false,
                        { avoidVerticalOverlap: width > node.w },
                      );
                    }}
                    onDragHandlePointerDown={(event) => startNodeDrag(event, node)}
                    onMiddlePanPointerDown={startCanvasPan}
                    onResizePointerDown={(event, handle) => startResize(event, node, handle)}
                    onNavigateTo={(pageIndex, nodeId) => {
                      handleSelectPage(pageIndex + 1);
                      selectNode(nodeId);
                    }}
                    onNodeLinkClick={handleNodeLinkClick}
                    onOpenAttachment={handleOpenAttachment}
                    onRequestInsertNodeLink={(x, y) => node.id === editingNodeId && handleRequestInsertNodeLink(node.id, x, y)}
                    onRequestSelectAll={() => {
                      const pageNodeIds = documentFile.nodes
                        .filter((n) => n.pageIndex === node.pageIndex)
                        .map((n) => n.id);
                      setSelectedNodeIds(pageNodeIds);
                      setEditingNodeId(null);
                    }}
                    onSelectionFormatChange={(fmt) => {
                      if (node.id === editingNodeId) setSelectionFormat(fmt);
                    }}
                    highlightQuery={highlightQuery}
                  />
                );
              }

              if (node.type === "shape") {
                return (
                  <ShapeNode
                    key={node.id}
                    highlightQuery={highlightQuery}
                    node={node}
                    selected={selectedNodeIds.includes(node.id)}
                    onSelect={() => selectNode(node.id)}
                    onPointerDown={(event) => startNodeDrag(event, node)}
                    onResizePointerDown={(event, handle) => startResize(event, node, handle)}
                    onLabelChange={(label) => {
                      updateNode(node.id, (current) => current.type === "shape"
                        ? { ...current, label: label.trim() ? createDefaultRichTextDoc(label.trim()) : undefined }
                        : current);
                    }}
                  />
                );
              }

              return (
                <ImageNode
                  key={node.id}
                  node={node}
                  asset={(() => {
                    const asset = documentFile.assets[node.assetId];
                    if (!asset || asset.storage !== "managed") {
                      return asset;
                    }

                    return {
                      ...asset,
                      data: managedAssetUrls[asset.id],
                    };
                  })()}
                  selected={selectedNodeIds.includes(node.id)}
                  onSelect={() => selectNode(node.id)}
                  onPointerDown={(event) => startNodeDrag(event, node)}
                  onResizePointerDown={(event, handle) => startResize(event, node, handle)}
                  onOpenAttachment={handleOpenAttachment}
                />
              );
            })}
          {interaction.type === "marquee" ? (
            <div
              className="selection-marquee"
              style={{
                transform: `translate(${normalizeRect(interaction).x}px, ${normalizeRect(interaction).y}px)`,
                width: normalizeRect(interaction).w,
                height: normalizeRect(interaction).h,
              }}
            />
          ) : null}
        </div>
          {showHorizontalScrollbar ? (
            <div
              className="canvas-scrollbar canvas-scrollbar-horizontal"
              onPointerDown={(event) => startScrollbarDrag(event, "x", horizontalScrollbar.thumbSize, horizontalTrackSize)}
              aria-hidden="true"
            >
              <div
                className="canvas-scrollbar-thumb"
                style={{
                  width: horizontalScrollbar.thumbSize,
                  transform: `translateX(${horizontalScrollbar.thumbOffset}px)`,
                }}
              />
            </div>
          ) : null}
          {showVerticalScrollbar ? (
            <div
              className="canvas-scrollbar canvas-scrollbar-vertical"
              onPointerDown={(event) => startScrollbarDrag(event, "y", verticalScrollbar.thumbSize, verticalTrackSize)}
              aria-hidden="true"
            >
              <div
                className="canvas-scrollbar-thumb"
                style={{
                  height: verticalScrollbar.thumbSize,
                  transform: `translateY(${verticalScrollbar.thumbOffset}px)`,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
};
