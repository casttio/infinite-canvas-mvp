import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { loadDocumentFromFile } from "../file/loadDocument";
import { saveDocumentToDisk } from "../file/saveDocument";
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
import type { CanvasNode, DocumentFile, PageBounds, RichTextDoc, TextNode as TextNodeModel, ViewState } from "../model/types";
import { ImageNode } from "../nodes/ImageNode";
import { TextNode } from "../nodes/TextNode";
import type { TextEditorCommand } from "../nodes/TextNode";
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

const fileNameFromMeta = (document: DocumentFile) => `${document.meta.id}.icanvas.html`;
const CAMERA_OVERSCROLL_LEFT_TOP = 240;
const CAMERA_OVERSCROLL_RIGHT_BOTTOM = 180;
const ZOOM_SETTLE_DELAY_MS = 140;

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

const getPageInsertionPoint = (documentFile: DocumentFile) => {
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

export const App = () => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const suppressNextCanvasClickRef = useRef(false);
  const dragDidMoveRef = useRef(false);
  const resizeDidMoveRef = useRef(false);
  const editorCommandNonceRef = useRef(0);
  const zoomSettleTimeoutRef = useRef<number | null>(null);
  const [documentFile, setDocumentFile] = useState<DocumentFile>(() => createEmptyDocument());
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<InteractionState>({ type: "none" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [editorCommand, setEditorCommand] = useState<TextEditorCommand | null>(null);
  const [zoomTransitionActive, setZoomTransitionActive] = useState(false);

  const selectedTextNode = (
    selectedNodeIds.length === 1
      ? documentFile.nodes.find((node): node is TextNodeModel => node.id === selectedNodeIds[0] && node.type === "text")
      : undefined
  );

  const patchDocument = (updater: (current: DocumentFile) => DocumentFile, markDirty = true) => {
    setDocumentFile((current) => {
      const next = updater(current);
      const rect = canvasRef.current?.getBoundingClientRect();

      if (!rect) {
        return next;
      }

      return {
        ...next,
        viewState: clampViewStateToPage(next.viewState, next.pageBounds, rect),
      };
    });
    if (markDirty) {
      setIsDirty(true);
    }
  };

  const settleDocumentLayout = (document: DocumentFile) => {
    const nextPageBounds = fitPageBoundsToNodes(document.nodes);
    const rect = canvasRef.current?.getBoundingClientRect();

    return {
      ...document,
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

    setDocumentFile(createEmptyDocument());
    setSelectedNodeIds([]);
    setEditingNodeId(null);
    setErrorMessage(null);
    setIsDirty(false);
  };

  const handleSave = () => {
    const nextDocument = touchDocument(documentFile);
    saveDocumentToDisk(nextDocument, fileNameFromMeta(nextDocument));
    setDocumentFile(nextDocument);
    setIsDirty(false);
  };

  const handleOpenClick = () => {
    if (!canDiscardUnsavedChanges(isDirty)) {
      return;
    }

    openInputRef.current?.click();
  };
  const handleImageClick = () => imageInputRef.current?.click();
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
    const node = createTextNode(x, y);

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
      const rect = canvasRef.current?.getBoundingClientRect();
      setDocumentFile(
        rect
          ? {
              ...loaded,
              viewState: clampViewStateToPage(loaded.viewState, loaded.pageBounds, rect),
            }
          : loaded,
      );
      setSelectedNodeIds([]);
      setEditingNodeId(null);
      setErrorMessage(null);
      setIsDirty(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开文件失败。");
    }
  };

  const handleAddText = () => {
    if (!canvasRef.current) {
      return;
    }

    const node = createTextNode(0, 0);
    patchDocument((current) => {
      const insertionPoint = getPageInsertionPoint(current);
      const offset = getInsertOffset(current.nodes.length);

      return addNodeToDocument(current, {
        ...node,
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
          const insertionPoint = getPageInsertionPoint(current);
          const offset = getInsertOffset(current.nodes.length);
          return addImageNodeToDocument(
            current,
            {
              ...node,
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

  useEffect(() => () => {
    if (zoomSettleTimeoutRef.current !== null) {
      window.clearTimeout(zoomSettleTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [editingNodeId, selectedTextNode, selectedNodeIds]);

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

        setDocumentFile((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const startPosition = interaction.startPositions[node.id];

            if (!startPosition) {
              return node;
            }

            return {
              ...node,
              ...dragNode(startPosition, delta),
            };
          }),
        }));
        return;
      }

      if (interaction.type === "resize-node") {
        const delta = {
          x: (event.clientX - interaction.startPointerX) / documentFile.viewState.zoom,
          y: (event.clientY - interaction.startPointerY) / documentFile.viewState.zoom,
        };
        resizeDidMoveRef.current = resizeDidMoveRef.current || delta.x !== 0 || delta.y !== 0;
        setDocumentFile((current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
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
          }),
        }));
      }
    };

    const handlePointerUp = () => {
      if (interaction.type === "drag-node") {
        const didMove = dragDidMoveRef.current;
        dragDidMoveRef.current = false;

        if (didMove) {
          suppressNextCanvasClickRef.current = true;
          setDocumentFile((current) => settleDocumentLayout(current));
          setIsDirty(true);
        }
      }

      if (interaction.type === "marquee") {
        const selectionRect = normalizeRect(interaction);
        const movedEnough = selectionRect.w > 4 / documentFile.viewState.zoom || selectionRect.h > 4 / documentFile.viewState.zoom;

        if (movedEnough) {
          const selectedIds = documentFile.nodes
            .filter((node) => rectsIntersect(selectionRect, node))
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
          setDocumentFile((current) => settleDocumentLayout(current));
          setIsDirty(true);
        }
      }

      setInteraction({ type: "none" });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [documentFile, interaction]);

  const startNodeDrag = (
    event: Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation">,
    node: CanvasNode,
  ) => {
    if (editingNodeId === node.id) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    dragDidMoveRef.current = false;
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

  return (
    <div className="app-shell">
      <Toolbar
        zoom={documentFile.viewState.zoom}
        dirty={isDirty}
        canInsertTable={editingNodeId !== null || !!selectedTextNode}
        canInsertTableColumn={editingNodeId !== null}
        onNew={handleNewDocument}
        onOpen={handleOpenClick}
        onSave={handleSave}
        onAddText={handleAddText}
        onAddImage={handleImageClick}
        onInsertTable={handleInsertTable}
        onInsertTableColumn={handleInsertTableColumn}
        onInsertTableColumnLeft={handleInsertTableColumnLeft}
        onDeleteTableColumn={handleDeleteTableColumn}
        onZoomChange={handleZoomChange}
      />

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

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

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

          event.preventDefault();
          setInteraction({
            type: "pan",
            startX: event.clientX,
            startY: event.clientY,
            initialX: documentFile.viewState.cameraX,
            initialY: documentFile.viewState.cameraY,
          });
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
            transform: `translate(${documentFile.viewState.cameraX}px, ${documentFile.viewState.cameraY}px) scale(${documentFile.viewState.zoom})`,
          }}
        >
          <div
            className="page-surface"
            style={{
              transform: `translate(${documentFile.pageBounds.x}px, ${documentFile.pageBounds.y}px)`,
              width: documentFile.pageBounds.w,
              height: documentFile.pageBounds.h,
            }}
          />
          {documentFile.nodes
            .slice()
            .sort((left, right) => left.z - right.z)
            .map((node) => {
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
                    onResizePointerDown={(event, handle) => startResize(event, node, handle)}
                  />
                );
              }

              return (
                <ImageNode
                  key={node.id}
                  node={node}
                  asset={documentFile.assets[node.assetId]}
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
      </div>
    </div>
  );
};
