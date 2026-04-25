import { useMemo } from "react";
import type { ChangeEvent as ReactChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

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
    <section className="sidebar-panel">
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
