import cytoscape from "cytoscape";
import { useEffect, useMemo, useRef } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
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
  onFileContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, path: string, currentName: string) => void;
  renamingFilePath: string | null;
  renamingFileName: string;
  onRenamingFileNameChange: (value: string) => void;
  onCommitFileRename: () => void;
  onCancelFileRename: () => void;
  onRefresh: () => void;
}

const FILE_SUFFIXES = [".icanvas.html", ".icanvas.json", ".onetoc2", ".html", ".htm", ".json", ".txt", ".md", ".xml", ".one"];

const getDepth = (relativePath: string) =>
  relativePath.length === 0 ? 0 : relativePath.split("/").length - 1;

const getEditableBaseName = (fileName: string) => {
  const lowerName = fileName.toLowerCase();
  const suffix = FILE_SUFFIXES.find((item) => lowerName.endsWith(item));
  if (suffix) {
    return fileName.slice(0, fileName.length - suffix.length);
  }

  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
};

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

    const rootNode = {
      data: {
        id: "workspace-root",
        label: "工作区",
        kind: "root",
      },
      position: {
        x: 0,
        y: 0,
      },
    };
    const fileRadius = 120;
    const pageRadius = 64;
    const pageAngleStep = 0.28;
    const getFileAngle = (fileIndex: number) => {
      if (documentSummaries.length <= 1) {
        return -Math.PI / 2;
      }

      return -Math.PI / 2 + (fileIndex / documentSummaries.length) * Math.PI * 2;
    };
    const fileNodes = documentSummaries.map((summary, fileIndex) => ({
      data: {
        id: `file:${summary.filePath}`,
        label: summary.fileName,
        kind: "file",
        filePath: summary.filePath,
        isCurrentFile: summary.filePath === currentFilePathRef.current ? "true" : "false",
        current: summary.filePath === currentFilePathRef.current ? "true" : "false",
      },
      position: {
        x: Math.cos(getFileAngle(fileIndex)) * fileRadius,
        y: Math.sin(getFileAngle(fileIndex)) * fileRadius,
      },
    }));
    const pageNodes = documentSummaries.flatMap((summary, fileIndex) => {
      const fileAngle = getFileAngle(fileIndex);
      const fileX = Math.cos(fileAngle) * fileRadius;
      const fileY = Math.sin(fileAngle) * fileRadius;
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
          x: fileX + Math.cos(fileAngle + (page.index - (pageCount - 1) / 2) * pageAngleStep) * pageRadius,
          y: fileY + Math.sin(fileAngle + (page.index - (pageCount - 1) / 2) * pageAngleStep) * pageRadius,
        },
      }));
    });
    const fileEdges = documentSummaries.map((summary) => ({
      data: {
        id: `edge:workspace:${summary.filePath}`,
        source: "workspace-root",
        target: `file:${summary.filePath}`,
        kind: "workspace-file",
      },
    }));
    const pageEdges = documentSummaries.flatMap((summary) =>
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
      elements: [rootNode, ...fileNodes, ...pageNodes, ...fileEdges, ...pageEdges],
      layout: { name: "preset", fit: true, padding: 16 },
      minZoom: 0.6,
      maxZoom: 1.6,
      wheelSensitivity: 0.18,
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

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cy.resize();
          cy.fit(undefined, 16);
        });
    resizeObserver?.observe(containerRef.current);

    return () => {
      resizeObserver?.disconnect();
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
  onFileContextMenu,
  renamingFilePath,
  renamingFileName,
  onRenamingFileNameChange,
  onCommitFileRename,
  onCancelFileRename,
  onRefresh,
}: FileSidebarProps) => {
  const expandedSet = useMemo(() => new Set(expandedDirectories), [expandedDirectories]);

  const renderEntries = (items: WorkspaceEntry[]) =>
    items.map((entry) => {
      const depth = getDepth(entry.relativePath);

      if (entry.type === "directory") {
        const expanded = expandedSet.has(entry.path);

        return (
          <div key={entry.path} className="file-tree-item">
            <button
              type="button"
              className={expanded ? "file-tree-row directory expanded" : "file-tree-row directory"}
              style={{ paddingLeft: `${0.65 + depth * 0.9}rem` }}
              onClick={() => onToggleDirectory(entry.path)}
            >
              <span className="file-tree-caret">{expanded ? "▾" : "▸"}</span>
              <span className="file-tree-name">{entry.name}</span>
            </button>
            {expanded ? <div className="file-tree-children">{renderEntries(entry.children)}</div> : null}
          </div>
        );
      }

      const active = currentFilePath === entry.path;
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
          className={active ? "file-tree-row file active" : "file-tree-row file"}
          style={{ paddingLeft: `${1.8 + depth * 0.9}rem` }}
          onClick={() => onOpenFile(entry.path)}
          onContextMenu={(event) => onFileContextMenu(event, entry.path, getEditableBaseName(entry.name))}
        >
          <span className="file-tree-bullet">•</span>
          <span className="file-tree-name">{entry.name}</span>
        </button>
      );
    });

  return (
    <section className="sidebar-panel file-sidebar-panel">
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
      {!loading && !errorMessage ? <div className="file-tree">{renderEntries(entries)}</div> : null}
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
            <span><i className="legend-dot file-dot" />文件</span>
            <span><i className="legend-dot page-dot" />页面</span>
            <span><i className="legend-dot active-dot" />当前页</span>
          </div>
        </>
      )}
    </section>
  );
};
