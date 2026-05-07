import cytoscape from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";

interface FileSidebarProps {
  entries: WorkspaceEntry[];
  rootPath: string | null;
  currentFilePath: string | null;
  expandedDirectories: string[];
  loading: boolean;
  errorMessage: string | null;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onMoveFileToDirectory: (filePath: string, directoryPath: string) => void;
  onReorderFile: (filePath: string, targetFilePath: string, placement: "before" | "after") => void;
  onFileContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, path: string, currentName: string) => void;
  onDirectoryContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, path: string, currentName: string) => void;
  onBlankContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  renamingFilePath: string | null;
  renamingFileName: string;
  onRenamingFileNameChange: (value: string) => void;
  onCommitFileRename: () => void;
  onCancelFileRename: () => void;
  renamingDirectoryPath: string | null;
  renamingDirectoryName: string;
  onRenamingDirectoryNameChange: (value: string) => void;
  onCommitDirectoryRename: () => void;
  onCancelDirectoryRename: () => void;
  onRefresh: () => void;
  selectedFilePaths?: string[];
  onSelectFile?: (filePath: string, ctrlKey: boolean, shiftKey: boolean) => void;
}

const FILE_SUFFIXES = [".icanvas.html", ".icanvas.json", ".onetoc2", ".html", ".htm", ".json", ".txt", ".md", ".xml", ".one"];
const GRAPH_MIN_ZOOM = 0.6;
const GRAPH_MAX_ZOOM = 1.6;

const getDepth = (relativePath: string) =>
  relativePath.length === 0 ? 0 : relativePath.split(/[\\/]/).length - 1;

const getRelativePathSegments = (relativePath: string) =>
  relativePath.split(/[\\/]/).filter(Boolean);

const getEditableBaseName = (fileName: string) => {
  const lowerName = fileName.toLowerCase();
  const suffix = FILE_SUFFIXES.find((item) => lowerName.endsWith(item));
  if (suffix) {
    return fileName.slice(0, fileName.length - suffix.length);
  }

  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
};

export const getDisplayFileName = getEditableBaseName;

const useWorkspaceGraph = (
  containerRef: RefObject<HTMLDivElement | null>,
  documentSummaries: WorkspaceDocumentSummary[],
  currentFilePath: string | null,
  currentPageIndex: number,
  onOpenFile: (path: string) => void,
  onOpenPage: (filePath: string, pageIndex: number, isCurrentFile: boolean) => void,
) => {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const onOpenFileRef = useRef(onOpenFile);
  const onOpenPageRef = useRef(onOpenPage);
  const currentFilePathRef = useRef(currentFilePath);
  const currentPageIndexRef = useRef(currentPageIndex);

  onOpenFileRef.current = onOpenFile;
  onOpenPageRef.current = onOpenPage;

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
    currentPageIndexRef.current = currentPageIndex;

    const cy = cyRef.current;
    if (!cy) {
      return;
    }

    cy.nodes().forEach((node) => {
      const kind = node.data("kind");
      const filePath = node.data("filePath");
      const isCurrentFile = typeof filePath === "string" && filePath === currentFilePath;
      node.data("isCurrentFile", isCurrentFile ? "true" : "false");
      node.data(
        "current",
        kind === "file"
          ? (isCurrentFile ? "true" : "false")
          : kind === "page" && isCurrentFile && Number(node.data("pageIndex")) === currentPageIndex
            ? "true"
            : "false",
      );
    });
  }, [currentFilePath, currentPageIndex]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const sortedDocumentSummaries = [...documentSummaries]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
    const depthGapX = 128;
    const fileGapY = 82;
    const pageGapX = 76;
    const pageGapY = 24;
    const graphCenterY = 0;
    const directoryMap = new Map<string, {
      label: string;
      path: string;
      parentPath: string | null;
      depth: number;
      yTotal: number;
      childCount: number;
    }>();
    const filePositions = new Map<string, { x: number; y: number }>();

    sortedDocumentSummaries.forEach((summary, fileIndex) => {
      const fileY = sortedDocumentSummaries.length <= 1
        ? graphCenterY
        : fileIndex * fileGapY - ((sortedDocumentSummaries.length - 1) * fileGapY) / 2;
      const segments = getRelativePathSegments(summary.relativePath || summary.fileName);
      const directorySegments = segments.slice(0, -1);

      directorySegments.forEach((segment, directoryIndex) => {
        const directoryPath = directorySegments.slice(0, directoryIndex + 1).join("/");
        const parentPath = directoryIndex === 0 ? null : directorySegments.slice(0, directoryIndex).join("/");
        const current = directoryMap.get(directoryPath);

        if (current) {
          current.yTotal += fileY;
          current.childCount += 1;
          return;
        }

        directoryMap.set(directoryPath, {
          label: segment,
          path: directoryPath,
          parentPath,
          depth: directoryIndex,
          yTotal: fileY,
          childCount: 1,
        });
      });

      filePositions.set(summary.filePath, {
        x: (directorySegments.length + 1) * depthGapX,
        y: fileY,
      });
    });

    const rootNode = {
      data: {
        id: "workspace-root",
        label: "工作区",
        kind: "root",
      },
      position: {
        x: 0,
        y: graphCenterY,
      },
    };
    const directoryNodes = Array.from(directoryMap.values()).map((directory) => ({
      data: {
        id: `directory:${directory.path}`,
        label: directory.label,
        kind: "directory",
        directoryPath: directory.path,
      },
      position: {
        x: (directory.depth + 1) * depthGapX,
        y: directory.yTotal / directory.childCount,
      },
    }));
    const fileNodes = sortedDocumentSummaries.map((summary) => ({
      data: {
        id: `file:${summary.filePath}`,
        label: getDisplayFileName(summary.fileName),
        kind: "file",
        filePath: summary.filePath,
        isCurrentFile: summary.filePath === currentFilePathRef.current ? "true" : "false",
        current: summary.filePath === currentFilePathRef.current ? "true" : "false",
      },
      position: filePositions.get(summary.filePath) ?? { x: depthGapX, y: graphCenterY },
    }));
    const pageNodes = sortedDocumentSummaries.flatMap((summary) => {
      const filePosition = filePositions.get(summary.filePath) ?? { x: depthGapX, y: graphCenterY };
      const pageCount = Math.max(summary.pages.length, 1);
      return summary.pages.map((page) => ({
        data: {
          id: `page:${summary.filePath}:${page.index}`,
          label: page.title.trim() || `第 ${page.index + 1} 页`,
          fullLabel: page.title,
          kind: "page",
          filePath: summary.filePath,
          pageIndex: String(page.index),
          isCurrentFile: summary.filePath === currentFilePathRef.current ? "true" : "false",
          current: summary.filePath === currentFilePathRef.current && page.index === currentPageIndexRef.current ? "true" : "false",
        },
        position: {
          x: filePosition.x + pageGapX,
          y: filePosition.y + (page.index - (pageCount - 1) / 2) * pageGapY,
        },
      }));
    });
    const directoryEdges = Array.from(directoryMap.values()).map((directory) => ({
      data: {
        id: `edge:directory:${directory.path}`,
        source: directory.parentPath ? `directory:${directory.parentPath}` : "workspace-root",
        target: `directory:${directory.path}`,
        kind: "workspace-directory",
      },
    }));
    const fileEdges = sortedDocumentSummaries.map((summary) => {
      const segments = getRelativePathSegments(summary.relativePath || summary.fileName);
      const parentDirectoryPath = segments.slice(0, -1).join("/");

      return {
        data: {
          id: `edge:file:${summary.filePath}`,
          source: parentDirectoryPath ? `directory:${parentDirectoryPath}` : "workspace-root",
          target: `file:${summary.filePath}`,
          kind: parentDirectoryPath ? "directory-file" : "workspace-file",
        },
      };
    });
    const pageEdges = sortedDocumentSummaries.flatMap((summary) =>
      summary.pages.map((page) => ({
        data: {
          id: `edge:${summary.filePath}:${page.index}`,
          source: `file:${summary.filePath}`,
          target: `page:${summary.filePath}:${page.index}`,
          kind: "file-page",
        },
      })));
    const cy = cytoscape({
      container: containerRef.current,
      elements: [rootNode, ...directoryNodes, ...fileNodes, ...pageNodes, ...directoryEdges, ...fileEdges, ...pageEdges],
      layout: { name: "preset", fit: true, padding: 16 },
      minZoom: GRAPH_MIN_ZOOM,
      maxZoom: GRAPH_MAX_ZOOM,
      userZoomingEnabled: false,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-family": "\"Segoe UI\", \"Noto Sans SC\", sans-serif",
            "font-size": 10,
            color: "#1e293b",
            "text-wrap": "ellipsis",
            "text-max-width": "120px",
            "text-valign": "bottom",
            "text-margin-y": 9,
            "text-events": "yes",
            "overlay-opacity": 0,
            "transition-property": "width height background-color border-color border-width",
            "transition-duration": 120,
            "transition-timing-function": "ease-out",
          },
        },
        {
          selector: 'node[kind = "root"]',
          style: {
            width: 28,
            height: 28,
            shape: "ellipse",
            "background-color": "#0f172a",
            "border-width": 3,
            "border-color": "#e2e8f0",
            color: "#0f172a",
            "font-weight": 700,
          },
        },
        {
          selector: 'node[kind = "root"].hovered',
          style: {
            width: 34,
            height: 34,
            "border-color": "#bfdbfe",
          },
        },
        {
          selector: 'node[kind = "directory"]',
          style: {
            width: 22,
            height: 16,
            shape: "round-rectangle",
            "background-color": "#10b981",
            "border-width": 2,
            "border-color": "#d1fae5",
            color: "#065f46",
            "font-weight": 700,
          },
        },
        {
          selector: 'node[kind = "directory"].hovered',
          style: {
            width: 30,
            height: 22,
            "background-color": "#059669",
            "border-color": "#a7f3d0",
            "border-width": 3,
          },
        },
        {
          selector: 'node[kind = "file"]',
          style: {
            width: 18,
            height: 18,
            shape: "round-rectangle",
            "background-color": "#2563eb",
            "border-width": 2,
            "border-color": "#dbeafe",
          },
        },
        {
          selector: 'node[kind = "file"].hovered',
          style: {
            width: 26,
            height: 26,
            "background-color": "#1d4ed8",
            "border-color": "#bfdbfe",
            "border-width": 3,
          },
        },
        {
          selector: 'node[kind = "file"][current = "true"]',
          style: {
            width: 22,
            height: 22,
            "background-color": "#1d4ed8",
            "border-color": "#93c5fd",
          },
        },
        {
          selector: 'node[kind = "file"][current = "true"].hovered',
          style: {
            width: 28,
            height: 28,
          },
        },
        {
          selector: 'node[kind = "page"]',
          style: {
            width: 14,
            height: 14,
            shape: "ellipse",
            "background-color": "#cbd5e1",
            "border-width": 1.5,
            "border-color": "#ffffff",
          },
        },
        {
          selector: 'node[kind = "page"].hovered',
          style: {
            width: 22,
            height: 22,
            "background-color": "#60a5fa",
            "border-color": "#dbeafe",
            "border-width": 3,
          },
        },
        {
          selector: 'node[kind = "page"][current = "true"]',
          style: {
            width: 18,
            height: 18,
            "background-color": "#f97316",
            "border-color": "#ffedd5",
          },
        },
        {
          selector: 'node[kind = "page"][current = "true"].hovered',
          style: {
            width: 24,
            height: 24,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#cbd5e1",
            "curve-style": "straight",
            "transition-property": "line-color width",
            "transition-duration": 120,
            "transition-timing-function": "ease-out",
          },
        },
        {
          selector: 'edge[kind = "workspace-file"]',
          style: {
            width: 2,
            "line-color": "#93c5fd",
          },
        },
        {
          selector: 'edge[kind = "workspace-directory"], edge[kind = "directory-file"]',
          style: {
            width: 2,
            "line-color": "#86efac",
          },
        },
      ],
    });

    cy.on("mouseover", "node", (event) => {
      event.target.addClass("hovered");
      const container = cy.container();
      if (container) {
        container.style.cursor = "pointer";
      }
    });

    cy.on("mouseout", "node", (event) => {
      event.target.removeClass("hovered");
      const container = cy.container();
      if (container) {
        container.style.cursor = "";
      }
    });

    const openGraphNode = (target: cytoscape.SingularElementReturnValue) => {
      const kind = target.data("kind");
      const filePath = target.data("filePath");
      if (typeof filePath !== "string" || filePath.length === 0) {
        return;
      }

      if (kind === "file") {
        onOpenFileRef.current(filePath);
        return;
      }

      const pageIndex = Number(target.data("pageIndex"));
      if (kind === "page" && Number.isFinite(pageIndex)) {
        onOpenPageRef.current(filePath, pageIndex, target.data("isCurrentFile") === "true");
      }
    };

    cy.on("tap", "node", (event) => openGraphNode(event.target));
    cyRef.current = cy;

    const handleGraphWheel = (event: WheelEvent) => {
      event.preventDefault();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        return;
      }

      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * containerRect.height
          : event.deltaY;
      const intensity = Math.min(Math.abs(delta) / 120, 4);
      const dynamicSensitivity = 0.0018 * (1 + intensity * 0.65);
      const nextZoom = Math.max(
        GRAPH_MIN_ZOOM,
        Math.min(GRAPH_MAX_ZOOM, cy.zoom() * Math.exp(-delta * dynamicSensitivity)),
      );

      cy.zoom({
        level: nextZoom,
        renderedPosition: {
          x: event.clientX - containerRect.left,
          y: event.clientY - containerRect.top,
        },
      });
    };

    containerRef.current.addEventListener("wheel", handleGraphWheel, { passive: false });

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cy.resize();
          cy.fit(undefined, 16);
        });
    resizeObserver?.observe(containerRef.current);

    return () => {
      resizeObserver?.disconnect();
      containerRef.current?.removeEventListener("wheel", handleGraphWheel);
      cyRef.current = null;
      cy.destroy();
    };
  }, [containerRef, documentSummaries]);
};

export const FileSidebar = ({
  entries,
  rootPath,
  currentFilePath,
  expandedDirectories,
  loading,
  errorMessage,
  onToggleDirectory,
  onOpenFile,
  onMoveFileToDirectory,
  onReorderFile,
  onFileContextMenu,
  onDirectoryContextMenu,
  onBlankContextMenu,
  renamingFilePath,
  renamingFileName,
  onRenamingFileNameChange,
  onCommitFileRename,
  onCancelFileRename,
  renamingDirectoryPath,
  renamingDirectoryName,
  onRenamingDirectoryNameChange,
  onCommitDirectoryRename,
  onCancelDirectoryRename,
  onRefresh,
  selectedFilePaths = [],
  onSelectFile,
}: FileSidebarProps) => {
  const expandedSet = useMemo(() => new Set(expandedDirectories), [expandedDirectories]);
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null);
  const [dropTargetFile, setDropTargetFile] = useState<{ path: string; placement: "before" | "after" } | null>(null);
  const [rootDropTarget, setRootDropTarget] = useState(false);

  const getDraggedFilePath = (event: ReactDragEvent<HTMLElement>) =>
    event.dataTransfer.getData("application/x-icanvas-file-path") || draggingFilePath;

  const handleDirectoryDragOver = (event: ReactDragEvent<HTMLButtonElement>, directoryPath: string) => {
    const filePath = getDraggedFilePath(event);
    if (!filePath) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath(directoryPath);
  };

  const handleDirectoryDrop = (event: ReactDragEvent<HTMLButtonElement>, directoryPath: string) => {
    const filePath = getDraggedFilePath(event);
    if (!filePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDraggingFilePath(null);
    setDropTargetDirectoryPath(null);
    setDropTargetFile(null);
    setRootDropTarget(false);
    onMoveFileToDirectory(filePath, directoryPath);
  };

  const handleFileDragOver = (event: ReactDragEvent<HTMLButtonElement>, targetFilePath: string) => {
    const filePath = getDraggedFilePath(event);
    if (!filePath || filePath === targetFilePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTargetDirectoryPath(null);
    setRootDropTarget(false);
    setDropTargetFile({
      path: targetFilePath,
      placement: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLButtonElement>, targetFilePath: string) => {
    const filePath = getDraggedFilePath(event);
    if (!filePath || filePath === targetFilePath || !dropTargetFile) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDraggingFilePath(null);
    setDropTargetDirectoryPath(null);
    setRootDropTarget(false);
    setDropTargetFile(null);
    onReorderFile(filePath, targetFilePath, dropTargetFile.placement);
  };

  const handleRootDragOver = (event: ReactDragEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".file-tree-row")) {
      return;
    }

    const filePath = getDraggedFilePath(event);
    if (!filePath || !rootPath) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath(null);
    setDropTargetFile(null);
    setRootDropTarget(true);
  };

  const handleRootDrop = (event: ReactDragEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".file-tree-row")) {
      return;
    }

    const filePath = getDraggedFilePath(event);
    if (!filePath || !rootPath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDraggingFilePath(null);
    setDropTargetDirectoryPath(null);
    setDropTargetFile(null);
    setRootDropTarget(false);
    onMoveFileToDirectory(filePath, rootPath);
  };

  const renderEntries = (items: WorkspaceEntry[]) =>
    items.map((entry) => {
      const depth = getDepth(entry.relativePath);

      if (entry.type === "directory") {
        const expanded = expandedSet.has(entry.path);
        const dropTarget = dropTargetDirectoryPath === entry.path;
        const renaming = renamingDirectoryPath === entry.path;

        if (renaming) {
          return (
            <div
              key={entry.path}
              className="file-tree-row directory active renaming"
              style={{ paddingLeft: `${0.65 + depth * 0.9}rem` }}
            >
              <span className="file-tree-caret">{expanded ? "▾" : "▸"}</span>
              <input
                className="file-tree-inline-input"
                autoFocus
                value={renamingDirectoryName}
                onChange={(event: ReactChangeEvent<HTMLInputElement>) => onRenamingDirectoryNameChange(event.currentTarget.value)}
                onBlur={onCommitDirectoryRename}
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    onCommitDirectoryRename();
                  }
                  if (event.key === "Escape") {
                    onCancelDirectoryRename();
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
              />
            </div>
          );
        }

        return (
          <div key={entry.path} className="file-tree-item">
            <button
              type="button"
              className={[
                "file-tree-row",
                "directory",
                expanded ? "expanded" : "",
                dropTarget ? "drop-target" : "",
              ].filter(Boolean).join(" ")}
              style={{ paddingLeft: `${0.65 + depth * 0.9}rem` }}
              onClick={() => onToggleDirectory(entry.path)}
              onContextMenu={(event) => onDirectoryContextMenu(event, entry.path, entry.name)}
              onDragOver={(event) => handleDirectoryDragOver(event, entry.path)}
              onDragEnter={(event) => handleDirectoryDragOver(event, entry.path)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTargetDirectoryPath((current) => (current === entry.path ? null : current));
                }
              }}
              onDrop={(event) => handleDirectoryDrop(event, entry.path)}
            >
              <span className="file-tree-caret">{expanded ? "▾" : "▸"}</span>
              <span className="file-tree-name">{entry.name}</span>
            </button>
            {expanded ? <div className="file-tree-children">{renderEntries(entry.children)}</div> : null}
          </div>
        );
      }

      const active = currentFilePath === entry.path;
      const multiSelected = selectedFilePaths.includes(entry.path);
      const renaming = renamingFilePath === entry.path;

      if (renaming) {
        return (
          <div
            key={entry.path}
            className="file-tree-row file active renaming"
            style={{ paddingLeft: `${1.8 + depth * 0.9}rem` }}
          >
            <span className="file-tree-bullet">•</span>
            <input
              className="file-tree-inline-input"
              autoFocus
              value={renamingFileName}
              onChange={(event: ReactChangeEvent<HTMLInputElement>) => onRenamingFileNameChange(event.currentTarget.value)}
              onBlur={onCommitFileRename}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  onCommitFileRename();
                }
                if (event.key === "Escape") {
                  onCancelFileRename();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            />
          </div>
        );
      }

      return (
        <button
          key={entry.path}
          type="button"
          className={[
            "file-tree-row",
            "file",
            active ? "active" : "",
            multiSelected ? "multi-selected" : "",
            draggingFilePath === entry.path ? "dragging" : "",
            dropTargetFile?.path === entry.path ? `drop-${dropTargetFile.placement}` : "",
          ].filter(Boolean).join(" ")}
          style={{ paddingLeft: `${1.8 + depth * 0.9}rem` }}
          draggable
          onDragStart={(event) => {
            setDraggingFilePath(entry.path);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-icanvas-file-path", entry.path);
            event.dataTransfer.setData("text/plain", entry.name);
          }}
          onDragEnd={() => {
            setDraggingFilePath(null);
            setDropTargetDirectoryPath(null);
            setDropTargetFile(null);
            setRootDropTarget(false);
          }}
          onDragOver={(event) => handleFileDragOver(event, entry.path)}
          onDragEnter={(event) => handleFileDragOver(event, entry.path)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropTargetFile((current) => (current?.path === entry.path ? null : current));
            }
          }}
          onDrop={(event) => handleFileDrop(event, entry.path)}
          onClick={(event) => {
            if (onSelectFile && (event.ctrlKey || event.metaKey || event.shiftKey)) {
              event.preventDefault();
              event.stopPropagation();
              onSelectFile(entry.path, event.ctrlKey || event.metaKey, event.shiftKey);
              return;
            }
            // Plain click: set this file as the only selection and open
            if (onSelectFile) onSelectFile(entry.path, false, false);
            onOpenFile(entry.path);
          }}
          onContextMenu={(event) => onFileContextMenu(event, entry.path, getEditableBaseName(entry.name))}
        >
          <span className="file-tree-bullet">•</span>
          <span className="file-tree-name">{entry.name}</span>
        </button>
      );
    });

  return (
    <section
      className="sidebar-panel file-sidebar-panel"
      onDragOver={handleRootDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setRootDropTarget(false);
        }
      }}
      onDrop={handleRootDrop}
      onContextMenu={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          (target.closest(".file-tree-row") || target.closest(".sidebar-panel-header"))
        ) {
          return;
        }
        onBlankContextMenu(event);
      }}
    >
      <div className="sidebar-panel-header">
        <div>
          <span>文件</span>
          <small>{rootPath ?? "工作目录"}</small>
        </div>
        <button type="button" className="sidebar-panel-action" onClick={onRefresh}>刷新</button>
      </div>
      {loading ? <div className="sidebar-panel-hint">正在读取目录…</div> : null}
      {errorMessage ? <div className="sidebar-panel-error">{errorMessage}</div> : null}
      {!loading && !errorMessage && entries.length === 0 ? (
        <div className="sidebar-panel-hint">默认目录还是空的。先保存一个文档进来，后面就能做文件关系和网络图了。</div>
      ) : null}
      {!loading && !errorMessage ? (
        <div
          className={rootDropTarget ? "file-tree root-drop-target" : "file-tree"}
          onContextMenu={(event) => onBlankContextMenu(event)}
          onDragOver={handleRootDragOver}
          onDrop={handleRootDrop}
        >
          {renderEntries(entries)}
          {draggingFilePath ? <div className="file-tree-root-drop-hint">拖到这里移出文件夹</div> : null}
        </div>
      ) : null}
    </section>
  );
};

interface WorkspaceGraphPanelProps {
  documentSummaries: WorkspaceDocumentSummary[];
  rootPath: string | null;
  currentFilePath: string | null;
  currentPageIndex: number;
  onOpenFile: (path: string) => void;
  onOpenPage: (filePath: string, pageIndex: number, isCurrentFile: boolean) => void;
}

export const WorkspaceGraphPanel = ({
  documentSummaries,
  rootPath,
  currentFilePath,
  currentPageIndex,
  onOpenFile,
  onOpenPage,
}: WorkspaceGraphPanelProps) => {
  const graphRef = useRef<HTMLDivElement | null>(null);

  useWorkspaceGraph(graphRef, documentSummaries, currentFilePath, currentPageIndex, onOpenFile, onOpenPage);

  return (
    <section className="sidebar-panel file-sidebar-panel">
      <div className="sidebar-panel-header">
        <div>
          <span>网络图</span>
          <small>{rootPath ?? "工作目录"}</small>
        </div>
      </div>
      {documentSummaries.length === 0 ? (
        <div className="sidebar-panel-hint">还没有可视化节点。先在工作区里保存或打开文件。</div>
      ) : (
        <>
          <div ref={graphRef} className="workspace-graph" />
          <div className="workspace-graph-legend">
            <span><i className="legend-dot folder-dot" />文件夹</span>
            <span><i className="legend-dot file-dot" />文件</span>
            <span><i className="legend-dot page-dot" />页面</span>
            <span><i className="legend-dot active-dot" />当前页</span>
          </div>
        </>
      )}
    </section>
  );
};
