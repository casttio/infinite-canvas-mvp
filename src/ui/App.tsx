import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
  createEmptyDocument,
  createImageNode,
  createTextNode,
  fitPageBoundsToNodes,
  touchDocument,
} from "../model/defaults";
import { addImageNodeToDocument, addNodeToDocument, updateNodeInDocument } from "../model/documentOps";
import type { CanvasNode, DocumentFile, PageBounds, RichTextBlock, RichTextDoc, RichTextInline, TextNode as TextNodeModel, ViewState } from "../model/types";
import { ImageNode } from "../nodes/ImageNode";
import { TextNode } from "../nodes/TextNode";
import type { TextEditorCommand } from "../nodes/TextNode";
import { FileSidebar, WorkspaceGraphPanel } from "./FileSidebar";
import { Toolbar } from "./Toolbar";

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
      nodeType: CanvasNode["type"];
      startPointerX: number;
      startPointerY: number;
      startX: number;
      startW: number;
      startH: number;
      handle: ResizeHandle;
      allowOverlap: boolean;
    };

type SidebarContextMenuState =
  | null
  | {
      kind: "file";
      x: number;
      y: number;
      filePath: string;
      fileName: string;
    }
  | {
      kind: "page";
      x: number;
      y: number;
      pageIndex: number;
    };

type LeftSidebarMode = "files" | "graph";

const fileNameFromMeta = (document: DocumentFile) => `${document.meta.id}.icanvas.html`;
const CAMERA_OVERSCROLL_LEFT_TOP = 240;
const CAMERA_OVERSCROLL_RIGHT_BOTTOM = 180;
const ZOOM_SETTLE_DELAY_MS = 140;
const AUTOSAVE_STORAGE_KEY = "icanvas.autosave.document";
const AUTOSAVE_DELAY_MS = 800;
const PAGE_STATE_STORAGE_KEY = "icanvas.page-state";
const FILE_SIDEBAR_COLLAPSED_STORAGE_KEY = "icanvas.file-sidebar.collapsed";
const GRAPH_SIDEBAR_WIDTH_STORAGE_KEY = "icanvas.graph-sidebar.width";
const GRAPH_SIDEBAR_DEFAULT_WIDTH = 360;
const GRAPH_SIDEBAR_MIN_WIDTH = 280;
const GRAPH_SIDEBAR_MAX_WIDTH = 760;

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

const formatUpdatedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
};

const getWorkspaceRelativePath = (filePath: string, rootPath: string | null) => {
  if (!rootPath || !filePath.startsWith(rootPath)) {
    return filePath;
  }

  return filePath.slice(rootPath.length).replace(/^[\\/]+/, "");
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

const readStoredGraphSidebarWidth = () => {
  if (typeof window === "undefined") {
    return GRAPH_SIDEBAR_DEFAULT_WIDTH;
  }

  const storedWidth = Number(window.localStorage.getItem(GRAPH_SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(storedWidth)
    ? clamp(storedWidth, GRAPH_SIDEBAR_MIN_WIDTH, GRAPH_SIDEBAR_MAX_WIDTH)
    : GRAPH_SIDEBAR_DEFAULT_WIDTH;
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
  const [interaction, setInteraction] = useState<InteractionState>({ type: "none" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [editorCommand, setEditorCommand] = useState<TextEditorCommand | null>(null);
  const [zoomTransitionActive, setZoomTransitionActive] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "pending" | "saved">("idle");
  const [autosaveRestoreAvailable, setAutosaveRestoreAvailable] = useState(false);
  const [currentSavePath, setCurrentSavePath] = useState<string | null>(null);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [workspaceDocumentSummaries, setWorkspaceDocumentSummaries] = useState<WorkspaceDocumentSummary[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fileSidebarCollapsed, setFileSidebarCollapsed] = useState(readStoredFileSidebarCollapsed);
  const [leftSidebarMode, setLeftSidebarMode] = useState<LeftSidebarMode>("files");
  const [graphSidebarWidth, setGraphSidebarWidth] = useState(readStoredGraphSidebarWidth);
  const [graphSidebarResizing, setGraphSidebarResizing] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenuState>(null);
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null);
  const [renamingFileName, setRenamingFileName] = useState("");
  const [renamingPageIndex, setRenamingPageIndex] = useState<number | null>(null);
  const [renamingPageTitle, setRenamingPageTitle] = useState("");
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

  const selectedTextNode = (
    selectedNodeIds.length === 1
      ? documentFile.nodes.find((node): node is TextNodeModel => node.id === selectedNodeIds[0] && node.type === "text")
      : undefined
  );
  const hasSelectedTextNodes = selectedNodeIds.some((nodeId) =>
    documentFile.nodes.some((node) => node.id === nodeId && node.type === "text"),
  );
  const pageCount = Math.max(documentFile.appearance.pages.count, inferRequiredPageCount(documentFile));
  const visiblePageNodes = documentFile.nodes
    .filter((node) => node.pageIndex === activePageIndex)
    .sort((left, right) => left.z - right.z);
  const currentPageTitle = documentFile.appearance.pages.titles?.[activePageIndex] ?? "";
  const currentFileName = currentSavePath?.split(/[\\/]/).pop() ?? fileHandleRef.current?.name ?? fileNameFromMeta(documentFile);
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
  const currentWorkspaceDocumentSummary = useMemo<WorkspaceDocumentSummary | null>(() => {
    if (!currentSavePath) {
      return null;
    }

    return {
      filePath: currentSavePath,
      fileName: currentSavePath.split(/[\\/]/).pop() ?? fileNameFromMeta(documentFile),
      relativePath: getWorkspaceRelativePath(currentSavePath, workspaceRootPath),
      pageCount,
      pages: pageSummaries.map((title, index) => ({ index, title })),
      updatedAt: documentFile.meta.updatedAt,
    };
  }, [currentSavePath, documentFile.meta.updatedAt, pageCount, pageSummaries, workspaceRootPath]);
  const sidebarDocumentSummaries = useMemo(() => {
    if (!currentWorkspaceDocumentSummary) {
      return workspaceDocumentSummaries;
    }

    const withoutCurrent = workspaceDocumentSummaries.filter((item) => item.filePath !== currentWorkspaceDocumentSummary.filePath);
    return [...withoutCurrent, currentWorkspaceDocumentSummary]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  }, [currentWorkspaceDocumentSummary, workspaceDocumentSummaries]);

  useEffect(() => {
    refreshWorkspaceEntries().catch(() => {});
  }, []);

  useEffect(() => {
    if (currentSavePath) {
      expandDirectoriesForFile(currentSavePath);
    }
  }, [currentSavePath, workspaceRootPath]);

  useEffect(() => {
    if (!sidebarContextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".sidebar-context-menu")) {
        return;
      }
      setSidebarContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarContextMenu]);

  useEffect(() => {
    if (!showFileMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".topbar-file-menu-anchor")) {
        return;
      }
      setShowFileMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFileMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFileMenu]);

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

    window.localStorage.setItem(GRAPH_SIDEBAR_WIDTH_STORAGE_KEY, String(graphSidebarWidth));
  }, [graphSidebarWidth]);

  const syncEditorStateToDocument = (nextDocument: DocumentFile) => {
    const nextNodeIds = new Set(nextDocument.nodes.map((node) => node.id));
    setSelectedNodeIds((current) => current.filter((id) => nextNodeIds.has(id)));
    setEditingNodeId((current) => (current && nextNodeIds.has(current) ? current : null));
  };

  const updateDirtyFromDocument = (nextDocument: DocumentFile) => {
    setIsDirty(serializeDocument(nextDocument) !== persistedSnapshotRef.current);
  };

  const handleGraphSidebarResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = graphSidebarWidth;
    setGraphSidebarResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setGraphSidebarWidth(clamp(nextWidth, GRAPH_SIDEBAR_MIN_WIDTH, GRAPH_SIDEBAR_MAX_WIDTH));
    };
    const handlePointerUp = () => {
      setGraphSidebarResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
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
    const restored = parseDocumentSchema(JSON.parse(raw));
    loadIntoEditor(restored);
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

    historyPastRef.current = historyPastRef.current.slice(0, -1);
    historyFutureRef.current = [documentFile, ...historyFutureRef.current].slice(0, 100);
    applyDocumentState(previous, { clearFuture: false });
  };

  const handleRedo = () => {
    const next = historyFutureRef.current[0];
    if (!next) {
      return;
    }

    historyFutureRef.current = historyFutureRef.current.slice(1);
    historyPastRef.current = [...historyPastRef.current, documentFile].slice(-100);
    applyDocumentState(next, { clearFuture: false });
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
        const isPdf = imported.mimeType === "application/pdf" || imported.name.toLowerCase().endsWith(".pdf");
        const width = isPdf ? 720 : 360;
        const height = isPdf ? 920 : 160;
        const node = {
          ...createImageNode(0, 0, assetId, width, height),
          style: {
            kind: isPdf ? "pdf-preview" : "attachment-preview",
          },
        };

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
              type: isPdf ? "pdf" : "file",
              storage: "managed",
              mimeType: imported.mimeType,
              name: imported.name,
              relativePath: imported.relativePath,
              sizeBytes: imported.sizeBytes,
            },
          );
        });
        setManagedAssetUrls((current) => ({
          ...current,
          [assetId]: imported.fileUrl,
        }));
        setSelectedNodeIds([node.id]);
        setEditingNodeId(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "附件导入失败。");
      }
      return;
    }

    attachmentInputRef.current?.click();
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

    if (!canDiscardUnsavedChanges(isDirty)) {
      return;
    }

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
      if (typeof targetPageIndex === "number") {
        const maxPageCount = Math.max(loaded.appearance.pages.count, inferRequiredPageCount(loaded));
        setActivePageIndex(Math.max(0, Math.min(targetPageIndex, maxPageCount - 1)));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
    }
  };

  const handleToggleDirectory = (directoryPath: string) => {
    setExpandedDirectories((current) =>
      current.includes(directoryPath)
        ? current.filter((item) => item !== directoryPath)
        : [...current, directoryPath],
    );
  };

  const handleBeginRenameWorkspaceFile = (filePath: string, currentName: string) => {
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

  const handleDeletePage = (pageIndex: number) => {
    if (pageCount <= 1) {
      return;
    }

    setSwipedPageIndex(null);
    setSwipeOffset(0);
    patchDocument((current) => settleDocumentLayout({
      ...current,
      nodes: current.nodes
        .filter((node) => node.pageIndex !== pageIndex)
        .map((node) => (node.pageIndex > pageIndex ? { ...node, pageIndex: node.pageIndex - 1 } : node)),
      appearance: {
        ...current.appearance,
        pages: {
          ...current.appearance.pages,
          count: Math.max(1, current.appearance.pages.count - 1),
          titles: (current.appearance.pages.titles ?? []).filter((_, index) => index !== pageIndex),
        },
      },
    }));
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

    const node = createTextNode(0, 0);
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
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const width = isPdf ? 720 : 360;
      const height = isPdf ? 920 : 160;
      const node = {
        ...createImageNode(0, 0, assetId, width, height),
        style: {
          kind: isPdf ? "pdf-preview" : "attachment-preview",
        },
      };

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
            type: isPdf ? "pdf" : "file",
            storage: "embedded",
            mimeType: file.type || "application/octet-stream",
            name: file.name,
            data,
            sizeBytes: file.size,
          },
        );
      });

      setSelectedNodeIds([node.id]);
      setEditingNodeId(null);
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
      const saveAutosave = window.electronApp?.saveDocumentToPath
        ? saveDocumentVersion(touchDocument(documentFile), { autosave: true })
            .then(() => window.electronApp?.saveAutosaveDocument?.(content) ?? Promise.resolve())
            .then(() => setAutosaveStatus("saved"))
        : (() => {
            return (window.electronApp?.saveAutosaveDocument
              ? window.electronApp.saveAutosaveDocument(content)
              : Promise.resolve(window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, content)))
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
      if (
        editingNodeId ||
        !selectedTextNode ||
        event.defaultPrevented ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const pastedText = event.clipboardData?.getData("text/plain") ?? "";
      const imageFile = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();

      if (!imageFile && pastedText.length === 0) {
        return;
      }

      event.preventDefault();

      if (imageFile) {
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
        return;
      }

      runQuickEditCommand({
        type: "append-text",
        placement: "end",
        text: pastedText,
        nonce: editorCommandNonceRef.current++,
      });
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("paste", handlePaste, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("paste", handlePaste, true);
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

    const handlePointerUp = () => {
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
            .filter((node) => node.pageIndex === activePageIndex && rectsIntersect(selectionRect, node))
            .map((node) => node.id);

          setSelectedNodeIds(selectedIds);
          suppressNextCanvasClickRef.current = true;
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

    const syncCanvasViewportSize = () => {
      setCanvasViewportSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    };

    syncCanvasViewportSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncCanvasViewportSize);
      return () => window.removeEventListener("resize", syncCanvasViewportSize);
    }

    const observer = new ResizeObserver(syncCanvasViewportSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const startNodeDrag = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation"> & { button?: number },
    node: CanvasNode,
  ) => {
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
          .filter((item) => nodeIds.includes(item.id))
          .map((item) => [item.id, { x: item.x, y: item.y }]),
      ),
      startPointerX: event.clientX,
      startPointerY: event.clientY,
    });
  };

  const startResize = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">,
    node: CanvasNode,
    handle: ResizeHandle = "bottom-right",
  ) => {
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
  const scrollbarInset = 12;
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
      <div className="topbar-shell">
        <div className="topbar-actions-row">
          <button type="button" className="toolbar-button toolbar-icon-button" disabled={historyPastRef.current.length === 0} onClick={handleUndo} aria-label="撤销">↶</button>
          <button type="button" className="toolbar-button toolbar-icon-button" disabled={historyFutureRef.current.length === 0} onClick={handleRedo} aria-label="重做">↷</button>
          <div className="toolbar-popover-anchor topbar-file-menu-anchor">
            <button
              type="button"
              className={showFileMenu ? "toolbar-button toolbar-file-button active" : "toolbar-button toolbar-file-button"}
              onClick={() => setShowFileMenu((current) => !current)}
            >
              文件
            </button>
            {showFileMenu ? (
              <div className="toolbar-file-menu">
                <button type="button" className="toolbar-file-menu-item" onClick={handleNewDocument}>新建</button>
                <button type="button" className="toolbar-file-menu-item" onClick={handleOpenClick}>打开</button>
                <button type="button" className="toolbar-file-menu-item primary" onClick={handleSave}>保存</button>
                <button type="button" className="toolbar-file-menu-item" onClick={handleSaveAs}>另存为</button>
              </div>
            ) : null}
          </div>
        </div>
        <Toolbar
          zoom={documentFile.viewState.zoom}
          dirty={isDirty}
          canInsertTable={editingNodeId !== null || !!selectedTextNode}
          canInsertTableColumn={editingNodeId !== null}
          canFormatText={editingNodeId !== null || hasSelectedTextNodes}
          onAddText={handleAddText}
          onAddImage={handleImageClick}
          onAddAttachment={handleAttachmentClick}
          onInsertTable={handleInsertTable}
          onInsertTableColumn={handleInsertTableColumn}
          onInsertTableColumnLeft={handleInsertTableColumnLeft}
          onDeleteTableColumn={handleDeleteTableColumn}
          onSetFontFamily={handleSetFontFamily}
          onSetFontSize={handleSetFontSize}
          onSetTextColor={handleSetTextColor}
          onSetHighlightColor={handleSetHighlightColor}
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

      {sidebarContextMenu ? (
        <div
          className="sidebar-context-menu"
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
            className={leftSidebarMode === "files" && !fileSidebarCollapsed ? "sidebar-menu-button left-rail-button active" : "sidebar-menu-button left-rail-button"}
            aria-label={fileSidebarCollapsed ? "展开文件侧栏" : "收起文件侧栏"}
            aria-pressed={!fileSidebarCollapsed}
            onClick={() => {
              setLeftSidebarMode("files");
              setFileSidebarCollapsed((current) => (leftSidebarMode !== "files" ? false : !current));
            }}
          >
            <span />
            <span />
            <span />
          </button>
          <button
            type="button"
            className={leftSidebarMode === "graph" && !fileSidebarCollapsed ? "rail-graph-button left-rail-button active" : "rail-graph-button left-rail-button"}
            aria-label={leftSidebarMode === "graph" && !fileSidebarCollapsed ? "收起网络图" : "显示网络图"}
            aria-pressed={leftSidebarMode === "graph" && !fileSidebarCollapsed}
            onClick={() => {
              setLeftSidebarMode("graph");
              setFileSidebarCollapsed((current) => (leftSidebarMode !== "graph" ? false : !current));
            }}
          >
            <span className="rail-graph-dot top" />
            <span className="rail-graph-dot middle" />
            <span className="rail-graph-dot bottom" />
            <span className="rail-graph-link top" />
            <span className="rail-graph-link bottom" />
          </button>
        </aside>

        <div className="workspace-shell">
        <aside
          className={[
            "file-sidebar",
            fileSidebarCollapsed ? "collapsed" : "",
            leftSidebarMode === "graph" ? "graph-resizable" : "",
            graphSidebarResizing ? "resizing" : "",
          ].filter(Boolean).join(" ")}
          style={
            !fileSidebarCollapsed && leftSidebarMode === "graph"
              ? ({
                  "--graph-sidebar-width": `${graphSidebarWidth}px`,
                } as CSSProperties)
              : undefined
          }
        >
          {!fileSidebarCollapsed && leftSidebarMode === "files" ? (
            <FileSidebar
              entries={workspaceEntries}
              rootPath={workspaceRootPath}
              currentFilePath={currentSavePath}
              expandedDirectories={expandedDirectories}
              loading={workspaceLoading}
              errorMessage={workspaceError}
              onToggleDirectory={handleToggleDirectory}
              onOpenFile={handleOpenWorkspaceFile}
              onFileContextMenu={handleFileContextMenu}
              renamingFilePath={renamingFilePath}
              renamingFileName={renamingFileName}
              onRenamingFileNameChange={setRenamingFileName}
              onCommitFileRename={handleCommitWorkspaceFileRename}
              onCancelFileRename={handleCancelWorkspaceFileRename}
              onRefresh={() => {
                refreshWorkspaceEntries().catch(() => {});
              }}
            />
          ) : null}
          {!fileSidebarCollapsed && leftSidebarMode === "graph" ? (
            <>
              <WorkspaceGraphPanel
                documentSummaries={sidebarDocumentSummaries}
                rootPath={workspaceRootPath}
                currentFilePath={currentSavePath}
                currentPageIndex={activePageIndex}
                onOpenFile={handleOpenWorkspaceFile}
                onOpenPage={(filePath, pageIndex, isCurrentFile) => {
                  if (isCurrentFile || currentSavePath === filePath) {
                    handleSelectPage(pageIndex + 1);
                    return;
                  }

                  void handleOpenWorkspaceFile(filePath, pageIndex);
                }}
              />
              <button
                type="button"
                className="graph-sidebar-resize-handle"
                aria-label="拖拽调整网络图栏宽度"
                onPointerDown={handleGraphSidebarResizeStart}
              />
            </>
          ) : null}
        </aside>

        <aside className="page-sidebar-column">
          <section className="sidebar-panel page-sidebar">
            <div className="sidebar-panel-header">
              <div>
                <span className="page-sidebar-title" title={currentFileName}>{currentFileName}</span>
                <small>
                  {autosaveStatus === "pending" ? "自动保存中" : autosaveStatus === "saved" ? "已自动保存" : "文档结构"}
                </small>
              </div>
              <button type="button" className="sidebar-panel-action" onClick={handleAddPage}>新增页</button>
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
        onClick={() => {
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
            setSelectedNodeIds([]);
            if (editingNodeId) {
              return;
            }
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }

            const point = toWorldPoint(event.clientX, event.clientY, rect, documentFile.viewState);
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
          <div className="canvas-header">
            <input
              className="canvas-header-title-input"
              type="text"
              value={currentPageTitle}
              onChange={(event) => handlePageTitleChange(activePageIndex, event.currentTarget.value)}
              placeholder={pageSummaries[activePageIndex] ?? "页面标题"}
            />
            <div className="canvas-header-meta">最近更新：{formatUpdatedAt(documentFile.meta.updatedAt)}</div>
          </div>
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
              "--page-grid-color": documentFile.appearance.grid.color,
              "--page-grid-size": `${documentFile.appearance.grid.size}px`,
            } as CSSProperties}
          >
            <div
              className={[
                "page-sheet",
                documentFile.appearance.grid.enabled ? "has-grid" : "",
                "active",
              ].filter(Boolean).join(" ")}
              style={{
                top: "0px",
                height: `${documentFile.appearance.pages.height}px`,
                backgroundColor: documentFile.appearance.pageBackground,
              }}
            />
          </div>
          {visiblePageNodes.map((node) => {
              if (node.type === "text") {
                return (
                  <TextNode
                    key={node.id}
                    node={node}
                    assets={documentFile.assets}
                    selected={selectedNodeIds.includes(node.id)}
                    editing={editingNodeId === node.id}
                    command={editingNodeId === node.id ? editorCommand : null}
                    onSelect={() => selectNode(node.id)}
                    onBeginEdit={() => {
                      beginEditingTextNode(node.id);
                    }}
                    onCommit={(content) => {
                      setEditingNodeId(null);
                      updateNode(node.id, (current) => ({ ...current, content }));
                    }}
                    onDraftChange={(content) => {
                      updateNode(node.id, (current) => ({ ...current, content }));
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
