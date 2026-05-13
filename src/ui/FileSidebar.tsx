import { useMemo, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { getFileTreeIndent } from "./fileTree";

interface FileSidebarProps {
  entries: WorkspaceEntry[];
  rootPath: string | null;
  currentFilePath: string | null;
  openingFilePath?: string | null;
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
const getDepth = (relativePath: string) =>
  relativePath.length === 0 ? 0 : relativePath.split(/[\\/]/).length - 1;

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

export const FileSidebar = ({
  entries,
  rootPath,
  currentFilePath,
  openingFilePath = null,
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
              style={{ paddingLeft: getFileTreeIndent(depth) }}
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
              style={{ paddingLeft: getFileTreeIndent(depth) }}
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
              <span className="file-tree-name">{getEditableBaseName(entry.name)}</span>
            </button>
            {expanded ? <div className="file-tree-children">{renderEntries(entry.children)}</div> : null}
          </div>
        );
      }

      const active = currentFilePath === entry.path;
      const opening = openingFilePath === entry.path;
      const multiSelected = selectedFilePaths.includes(entry.path);
      const renaming = renamingFilePath === entry.path;

      if (renaming) {
        return (
          <div
            key={entry.path}
            className="file-tree-row file active renaming"
            style={{ paddingLeft: getFileTreeIndent(depth) }}
          >
            <span className="file-tree-bullet file-tree-book" aria-hidden="true" />
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
            opening ? "opening" : "",
            multiSelected ? "multi-selected" : "",
            draggingFilePath === entry.path ? "dragging" : "",
            dropTargetFile?.path === entry.path ? `drop-${dropTargetFile.placement}` : "",
          ].filter(Boolean).join(" ")}
          style={{ paddingLeft: getFileTreeIndent(depth) }}
          draggable
          disabled={opening}
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
            if (opening) {
              return;
            }
            if (onSelectFile) onSelectFile(entry.path, false, false);
            onOpenFile(entry.path);
          }}
          onContextMenu={(event) => onFileContextMenu(event, entry.path, getEditableBaseName(entry.name))}
        >
          <span className="file-tree-bullet file-tree-book" aria-hidden="true" />
          <span className="file-tree-name">{getEditableBaseName(entry.name)}</span>
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
      {loading ? <div className="sidebar-panel-hint">正在读取目录...</div> : null}
      {errorMessage ? <div className="sidebar-panel-error">{errorMessage}</div> : null}
      {!loading && !errorMessage && entries.length === 0 ? (
        <div className="sidebar-panel-hint">默认目录还是空的。先保存一个文档进来，后面就能在这里管理文件了。</div>
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
