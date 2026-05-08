import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { MAX_ZOOM_SLIDER_VALUE, sliderValueToZoom, zoomToSliderValue } from "../editor/viewport";

const FONT_SERIF = '"Newsreader", "Charter", "Georgia", "Noto Serif SC", "Songti SC", "STSong", serif';
const FONT_SANS = 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_MONO = '"JetBrains Mono", "Courier New", monospace';

const FONT_OPTIONS = [
  { label: "默认无衬线", value: FONT_SANS },
  { label: "衬线体", value: FONT_SERIF },
  { label: "等宽体", value: FONT_MONO },
  { label: "微软雅黑", value: '"Microsoft YaHei", sans-serif' },
  { label: "宋体", value: '"SimSun", serif' },
  { label: "黑体", value: '"SimHei", sans-serif' },
];

const FONT_SIZE_OPTIONS = ["12", "14", "15", "16", "18", "24", "32"];
type ToolbarTab = "file" | "search" | "home" | "insert" | "table";
type ConnectorStyleControls = {
  stroke: string;
  strokeWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  endMarker: "none" | "arrow" | "circle";
};
const BLOCK_STYLE_STORAGE_KEY = "icanvas.block-style-presets";
type BlockStylePreset = {
  id: string;
  label: string;
  className: string;
  tag: string;
  fontSize: string;
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
};
const DEFAULT_BLOCK_STYLE_PRESETS: BlockStylePreset[] = [
  { id: "title1", label: "标题 1", className: "title-1", tag: "h1", fontSize: "32", color: "#24211F", fontFamily: FONT_SERIF, bold: true, italic: false },
  { id: "title2", label: "标题 2", className: "title-2", tag: "h2", fontSize: "24", color: "#24211F", fontFamily: FONT_SERIF, bold: true, italic: false },
  { id: "title3", label: "标题 3", className: "title-3", tag: "h3", fontSize: "18", color: "#24211F", fontFamily: FONT_SERIF, bold: true, italic: false },
  { id: "quote", label: "引用", className: "quote", tag: "blockquote", fontSize: "15", color: "#6B6661", fontFamily: FONT_SERIF, bold: false, italic: true },
  { id: "normal", label: "常规", className: "normal", tag: "p", fontSize: "15", color: "#24211F", fontFamily: FONT_SANS, bold: false, italic: false },
  { id: "lead", label: "引文", className: "lead", tag: "p", fontSize: "16", color: "#6B6661", fontFamily: FONT_SANS, bold: false, italic: false },
  { id: "code", label: "代码", className: "code", tag: "pre", fontSize: "14", color: "#D57D61", fontFamily: FONT_MONO, bold: false, italic: false },
];

const readBlockStylePresets = () => {
  if (typeof window === "undefined") {
    return DEFAULT_BLOCK_STYLE_PRESETS;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(BLOCK_STYLE_STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed)) {
      return DEFAULT_BLOCK_STYLE_PRESETS;
    }

    return DEFAULT_BLOCK_STYLE_PRESETS.map((fallback) => ({
      ...fallback,
      ...(parsed.find((item) => item?.id === fallback.id) ?? {}),
    }));
  } catch {
    return DEFAULT_BLOCK_STYLE_PRESETS;
  }
};

export type SearchScope = "current-page" | "current-document" | "workspace";

interface SearchResultRow {
  id: string;
  scope: SearchScope;
  filePath?: string;
  fileName?: string;
  pageIndex: number;
  nodeId: string;
  nodeType: string;
  title: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  canFormatText: boolean;
  canGenerateTimeline: boolean;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onSaveDocument: () => void;
  onOpenTrash: () => void;
  onSaveAsDocument: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddText: () => void;
  onAddShape: (shapeType: "rect" | "ellipse") => void;
  onAddImage: () => void;
  onAddAttachment: () => void;
  connectorMode: boolean;
  onToggleConnectorMode: () => void;
  selectedConnectorStyle: ConnectorStyleControls | null;
  onSetConnectorStroke: (stroke: string) => void;
  onSetConnectorStrokeWidth: (strokeWidth: number) => void;
  onSetConnectorLineStyle: (lineStyle: ConnectorStyleControls["lineStyle"]) => void;
  onSetConnectorEndMarker: (endMarker: ConnectorStyleControls["endMarker"]) => void;
  onInsertTable: () => void;
  onGenerateTimeline: () => void;
  onInsertTimelineExample: () => void;
  onInsertTableColumn: () => void;
  onInsertTableColumnLeft: () => void;
  onDeleteTableColumn: () => void;
  onSetFontFamily: (fontFamily: string) => void;
  onSetFontSize: (fontSize: string) => void;
  onSetTextColor: (color: string) => void;
  onSetHighlightColor: (color: string) => void;
  onApplyBlockStyle: (style: string, preset?: {
    tag: string;
    fontSize?: string;
    color?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
  }) => void;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleUnderline: () => void;
  onToggleStrike: () => void;
  pageBackground: string;
  gridEnabled: boolean;
  gridColor: string;
  gridSize: number;
  onSetPageBackground: (color: string) => void;
  onSetGridEnabled: (enabled: boolean) => void;
  onSetGridColor: (color: string) => void;
  onSetGridSize: (size: number) => void;
  onZoomChange: (zoom: number) => void;
  // Search props
  searchQuery: string;
  searchScope: SearchScope;
  searchResults: SearchResultRow[];
  searchActiveIndex: number;
  onSearchChange: (query: string) => void;
  onSearchScopeChange: (scope: SearchScope) => void;
  onSearchResultClick: (result: SearchResultRow) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent) => void;
  onSearchClose: () => void;
}

export const Toolbar = ({
  zoom,
  dirty,
  canUndo,
  canRedo,
  canInsertTable,
  canInsertTableColumn,
  canFormatText,
  canGenerateTimeline,
  onNewDocument,
  onOpenDocument,
  onSaveDocument,
  onOpenTrash,
  onSaveAsDocument,
  onUndo,
  onRedo,
  onAddText,
  onAddShape,
  onAddImage,
  onAddAttachment,
  connectorMode,
  onToggleConnectorMode,
  selectedConnectorStyle,
  onSetConnectorStroke,
  onSetConnectorStrokeWidth,
  onSetConnectorLineStyle,
  onSetConnectorEndMarker,
  onInsertTable,
  onGenerateTimeline,
  onInsertTimelineExample,
  onInsertTableColumn,
  onInsertTableColumnLeft,
  onDeleteTableColumn,
  onSetFontFamily,
  onSetFontSize,
  onSetTextColor,
  onSetHighlightColor,
  onApplyBlockStyle,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onToggleStrike,
  pageBackground,
  gridEnabled,
  gridColor,
  gridSize,
  onSetPageBackground,
  onSetGridEnabled,
  onSetGridColor,
  onSetGridSize,
  onZoomChange,
  searchQuery,
  searchScope,
  searchResults,
  searchActiveIndex,
  onSearchChange,
  onSearchScopeChange,
  onSearchResultClick,
  onSearchKeyDown,
  onSearchClose,
}: ToolbarProps) => {
  const [activeTab, setActiveTab] = useState<ToolbarTab>("home");
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState("11");
  const [textColor, setTextColor] = useState("#24211F");
  const [highlightColor, setHighlightColor] = useState("#fef200");
  const [showBlockStyleMenu, setShowBlockStyleMenu] = useState(false);
  const [showBlockStyleEditor, setShowBlockStyleEditor] = useState(false);
  const [blockStylePresets, setBlockStylePresets] = useState(readBlockStylePresets);
  const [editingBlockStyleId, setEditingBlockStyleId] = useState(DEFAULT_BLOCK_STYLE_PRESETS[0].id);
  const blockStyleMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const editingBlockStyle = blockStylePresets.find((preset) => preset.id === editingBlockStyleId) ?? blockStylePresets[0];

  const closeBlockStyleMenu = () => {
    setShowBlockStyleMenu(false);
    setShowBlockStyleEditor(false);
  };

  useEffect(() => {
    if (!showBlockStyleMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && blockStyleMenuRef.current?.contains(target)) {
        return;
      }
      closeBlockStyleMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBlockStyleMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showBlockStyleMenu]);

  // Close search dropdown on outside click / Escape
  useEffect(() => {
    if (!searchDropdownOpen) return;
    const handler = (e: PointerEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchDropdownOpen(false);
    };
    // Delay so the same click that opened it doesn't close it
    requestAnimationFrame(() => {
      window.addEventListener("pointerdown", handler, true);
    });
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [searchDropdownOpen]);

  // Auto-focus search input when the search tab is activated
  useEffect(() => {
    if (activeTab === "search") {
      if (searchQuery.trim().length > 0) {
        setSearchDropdownOpen(true);
      }
      requestAnimationFrame(() => {
        searchRef.current?.querySelector<HTMLInputElement>(".toolbar-search-input")?.focus();
      });
    }
  }, [activeTab, searchQuery]);

  const applyFontFamily = (value: string) => {
    setFontFamily(value);
    onSetFontFamily(value);
  };

  const applyFontSize = (value: string) => {
    setFontSize(value);
    onSetFontSize(`${value}px`);
  };

  const applyTextColor = (value: string) => {
    setTextColor(value);
    onSetTextColor(value);
  };

  const applyHighlightColor = (value: string) => {
    setHighlightColor(value);
    onSetHighlightColor(value);
  };

  const persistBlockStylePresets = (nextPresets: BlockStylePreset[]) => {
    setBlockStylePresets(nextPresets);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BLOCK_STYLE_STORAGE_KEY, JSON.stringify(nextPresets));
    }
  };

  const updateBlockStylePreset = (id: string, patch: Partial<BlockStylePreset>) => {
    persistBlockStylePresets(blockStylePresets.map((preset) =>
      preset.id === id ? { ...preset, ...patch } : preset));
  };

  const resetBlockStylePresets = () => {
    persistBlockStylePresets(DEFAULT_BLOCK_STYLE_PRESETS);
  };

  const getBlockStyleCommandPreset = (preset: BlockStylePreset) => ({
    tag: preset.tag,
    fontSize: `${preset.fontSize}px`,
    color: preset.color,
    fontFamily: preset.fontFamily,
    bold: preset.bold,
    italic: preset.italic,
  });

  const getBlockStylePreviewStyle = (preset: BlockStylePreset): CSSProperties => ({
    color: preset.color,
    fontSize: `${preset.fontSize}px`,
    fontFamily: preset.fontFamily,
    fontWeight: preset.bold ? 700 : 400,
    fontStyle: preset.italic ? "italic" : "normal",
  });

  const renderSubToolbar = () => {
    if (activeTab === "search") {
      return (
        <div className="toolbar-search" ref={searchRef}>
          <input
            type="search"
            className="toolbar-search-input"
            placeholder="搜索…"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.currentTarget.value);
              setSearchDropdownOpen(true);
            }}
            onFocus={() => setSearchDropdownOpen(true)}
            onKeyDown={(e) => {
              onSearchKeyDown(e);
              if (e.key === "Escape") {
                setSearchDropdownOpen(false);
              }
            }}
          />
          <select
            className="toolbar-search-scope"
            value={searchScope}
            onChange={(e) => onSearchScopeChange(e.currentTarget.value as SearchScope)}
          >
            <option value="current-page">当前页</option>
            <option value="current-document">当前文档</option>
            <option value="workspace">工作区</option>
          </select>
          {searchQuery.trim().length > 0 && (
            <button type="button" className="toolbar-search-close" onClick={onSearchClose}>×</button>
          )}
          {searchQuery.trim().length > 0 && searchDropdownOpen && (
            <div className="toolbar-search-dropdown">
              {searchResults.length > 0 ? (
                <>
                  <div className="toolbar-search-dropdown-info">
                    {searchResults.length >= 100 ? "前 100 个结果" : `${searchResults.length} 个结果`}
                  </div>
                  {searchResults.slice(0, 50).map((result, idx) => (
                    <button
                      key={result.id}
                      type="button"
                      className={`toolbar-search-result ${idx === searchActiveIndex ? "active" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSearchResultClick(result);
                      }}
                    >
                      <div className="toolbar-search-result-header">
                        <span className="toolbar-search-result-title">{result.title}</span>
                        <span className="toolbar-search-result-scope">
                          {result.scope === "workspace" && result.fileName ? result.fileName : `P${result.pageIndex + 1}`}
                        </span>
                      </div>
                      <div className="toolbar-search-result-snippet">
                        {result.snippet}
                      </div>
                    </button>
                  ))}
                </>
              ) : (
                <div className="toolbar-search-empty">无结果</div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (activeTab === "file") {
      return (
        <div className="toolbar-group">
          <button type="button" className="toolbar-button" onClick={onNewDocument}>新建</button>
          <button type="button" className="toolbar-button" onClick={onOpenDocument}>打开</button>
          <button type="button" className="toolbar-button primary" onClick={onSaveDocument}>保存</button>
          <button type="button" className="toolbar-button" onClick={onSaveAsDocument}>另存为</button>
          <button type="button" className="toolbar-button" onClick={onOpenTrash}>回收站</button>
        </div>
      );
    }

    if (activeTab === "insert") {
      return (
        <div className="toolbar-group">
          <button type="button" className="toolbar-button" onClick={onAddText}>文本块</button>
          <button type="button" className="toolbar-button" onClick={() => onAddShape("rect")}>矩形</button>
          <button type="button" className="toolbar-button" onClick={() => onAddShape("ellipse")}>椭圆</button>
          <button
            type="button"
            className={`toolbar-button ${connectorMode ? "active" : ""}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggleConnectorMode}
            aria-pressed={connectorMode}
          >
            连线
          </button>
          <button type="button" className="toolbar-button" onPointerDown={(event) => event.preventDefault()} onClick={onAddImage}>图片</button>
          <button type="button" className="toolbar-button" onPointerDown={(event) => event.preventDefault()} onClick={onAddAttachment}>附件</button>
          <input
            className="connector-color-input"
            type="color"
            value={selectedConnectorStyle?.stroke ?? "#D57D61"}
            disabled={!selectedConnectorStyle}
            onChange={(event) => onSetConnectorStroke(event.currentTarget.value)}
            aria-label="连线颜色"
          />
          <select
            className="text-format-select connector-width-select"
            value={String(selectedConnectorStyle?.strokeWidth ?? 2)}
            disabled={!selectedConnectorStyle}
            onChange={(event) => onSetConnectorStrokeWidth(Number(event.currentTarget.value))}
            aria-label="连线粗细"
          >
            <option value="1">1px</option>
            <option value="2">2px</option>
            <option value="4">4px</option>
            <option value="6">6px</option>
          </select>
          <select
            className="text-format-select connector-style-select"
            value={selectedConnectorStyle?.lineStyle ?? "solid"}
            disabled={!selectedConnectorStyle}
            onChange={(event) => onSetConnectorLineStyle(event.currentTarget.value as ConnectorStyleControls["lineStyle"])}
            aria-label="连线样式"
          >
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="dotted">点线</option>
          </select>
          <select
            className="text-format-select connector-marker-select"
            value={selectedConnectorStyle?.endMarker ?? "arrow"}
            disabled={!selectedConnectorStyle}
            onChange={(event) => onSetConnectorEndMarker(event.currentTarget.value as ConnectorStyleControls["endMarker"])}
            aria-label="线尾标记"
          >
            <option value="none">无线尾</option>
            <option value="arrow">箭头</option>
            <option value="circle">圆点</option>
          </select>
          <button
            type="button"
            className="toolbar-button"
            disabled={!canInsertTable}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onInsertTable}
          >
            表格
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!canGenerateTimeline}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onGenerateTimeline}
          >
            生成时间线
          </button>
          <button
            type="button"
            className="toolbar-button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onInsertTimelineExample}
          >
            时间线范例
          </button>
        </div>
      );
    }

    if (activeTab === "table") {
      return (
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-button"
            disabled={!canInsertTableColumn}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onInsertTableColumnLeft}
          >
            左加列
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!canInsertTableColumn}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onInsertTableColumn}
          >
            右加列
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!canInsertTableColumn}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onDeleteTableColumn}
          >
            删除列
          </button>
        </div>
      );
    }

    return (
      <div className="toolbar-group">
        <button type="button" className="toolbar-button toolbar-icon-button" disabled={!canUndo} onClick={onUndo} aria-label="撤销">↶</button>
        <button type="button" className="toolbar-button toolbar-icon-button" disabled={!canRedo} onClick={onRedo} aria-label="重做">↷</button>
        <div className="text-format-toolbar" data-preserve-editor-focus="true">
          <div className="toolbar-popover-anchor" ref={blockStyleMenuRef}>
            <button
              type="button"
              className={showBlockStyleMenu ? "toolbar-button block-style-button active" : "toolbar-button block-style-button"}
              disabled={!canFormatText}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setShowBlockStyleMenu((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={showBlockStyleMenu}
            >
              <span className="block-style-icon">A</span>
              <span>样式</span>
              <span className="block-style-caret">⌄</span>
            </button>
            {showBlockStyleMenu ? (
              <div className="block-style-menu" role="menu">
                {showBlockStyleEditor ? (
                  <div className="block-style-editor">
                    <div className="block-style-editor-header">
                      <span>样式预设</span>
                      <button type="button" onClick={closeBlockStyleMenu}>完成</button>
                    </div>
                    <label>
                      <span>预设</span>
                      <select
                        value={editingBlockStyleId}
                        onChange={(event) => setEditingBlockStyleId(event.currentTarget.value)}
                      >
                        {blockStylePresets.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>名称</span>
                      <input
                        value={editingBlockStyle.label}
                        onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { label: event.currentTarget.value })}
                      />
                    </label>
                    <label>
                      <span>字体</span>
                      <select
                        value={editingBlockStyle.fontFamily}
                        onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { fontFamily: event.currentTarget.value })}
                      >
                        {FONT_OPTIONS.map((font) => (
                          <option key={font.value} value={font.value}>{font.label}</option>
                        ))}
                        <option value="Georgia, serif">Georgia</option>
                        <option value="Consolas, monospace">Consolas</option>
                      </select>
                    </label>
                    <div className="block-style-editor-grid">
                      <label>
                        <span>字号</span>
                        <input
                          type="number"
                          min={10}
                          max={72}
                          value={editingBlockStyle.fontSize}
                          onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { fontSize: event.currentTarget.value })}
                        />
                      </label>
                      <label>
                        <span>颜色</span>
                        <input
                          type="color"
                          value={editingBlockStyle.color}
                          onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { color: event.currentTarget.value })}
                        />
                      </label>
                    </div>
                    <label>
                      <span>块类型</span>
                      <select
                        value={editingBlockStyle.tag}
                        onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { tag: event.currentTarget.value })}
                      >
                        <option value="p">段落</option>
                        <option value="h1">H1</option>
                        <option value="h2">H2</option>
                        <option value="h3">H3</option>
                        <option value="h4">H4</option>
                        <option value="h5">H5</option>
                        <option value="h6">H6</option>
                        <option value="blockquote">引用</option>
                        <option value="pre">代码</option>
                      </select>
                    </label>
                    <div className="block-style-editor-toggles">
                      <label><input type="checkbox" checked={editingBlockStyle.bold} onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { bold: event.currentTarget.checked })} />加粗</label>
                      <label><input type="checkbox" checked={editingBlockStyle.italic} onChange={(event) => updateBlockStylePreset(editingBlockStyle.id, { italic: event.currentTarget.checked })} />斜体</label>
                    </div>
                    <div className="block-style-editor-preview" style={getBlockStylePreviewStyle(editingBlockStyle)}>
                      {editingBlockStyle.label}
                    </div>
                    <button type="button" className="block-style-editor-reset" onClick={resetBlockStylePresets}>恢复默认</button>
                  </div>
                ) : (
                  <>
                    {blockStylePresets.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        className={`block-style-menu-item ${style.className}`}
                        style={getBlockStylePreviewStyle(style)}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onApplyBlockStyle(style.id, getBlockStyleCommandPreset(style));
                          closeBlockStyleMenu();
                        }}
                      >
                        {style.label}
                      </button>
                    ))}
                    <div className="block-style-menu-separator" />
                    <button
                      type="button"
                      className="block-style-menu-clear"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const normalPreset = blockStylePresets.find((preset) => preset.id === "normal");
                        onApplyBlockStyle("normal", normalPreset ? getBlockStyleCommandPreset(normalPreset) : undefined);
                        closeBlockStyleMenu();
                      }}
                    >
                      <span>A◇</span>
                      清除格式(C)
                    </button>
                    <button
                      type="button"
                      className="block-style-menu-edit"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => setShowBlockStyleEditor(true)}
                    >
                      编辑样式预设
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <select
            className="text-format-select font-select"
            value={fontFamily}
            disabled={!canFormatText}
            onChange={(event) => applyFontFamily(event.currentTarget.value)}
            aria-label="字体"
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>{font.label}</option>
            ))}
          </select>
          <select
            className="text-format-select size-select"
            value={fontSize}
            disabled={!canFormatText}
            onChange={(event) => applyFontSize(event.currentTarget.value)}
            aria-label="字号"
          >
            {FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <button
            type="button"
            className="text-format-button text-format-bold"
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggleBold}
            aria-label="加粗"
          >
            B
          </button>
          <button
            type="button"
            className="text-format-button text-format-italic"
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggleItalic}
            aria-label="斜体"
          >
            I
          </button>
          <button
            type="button"
            className="text-format-button text-format-underline"
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggleUnderline}
            aria-label="下划线"
          >
            U
          </button>
          <button
            type="button"
            className="text-format-button text-format-strike"
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onToggleStrike}
            aria-label="删除线"
          >
            ab
          </button>
          <label
            className="text-format-color-button text-color-control"
            style={{ "--format-color": textColor } as CSSProperties}
            aria-label="文字颜色"
          >
            <span>A</span>
            <input
              type="color"
              value={textColor}
              disabled={!canFormatText}
              onChange={(event) => applyTextColor(event.currentTarget.value)}
            />
          </label>
          <label
            className="text-format-color-button highlight-color-control"
            style={{ "--format-color": highlightColor } as CSSProperties}
            aria-label="高亮颜色"
          >
            <span className="highlight-pen-icon" />
            <input
              type="color"
              value={highlightColor}
              disabled={!canFormatText}
              onChange={(event) => applyHighlightColor(event.currentTarget.value)}
            />
          </label>
        </div>
        <label className="zoom-control">
          <span>{Math.round(zoom * 100)}%</span>
          <input
            type="range"
            min={0}
            max={MAX_ZOOM_SLIDER_VALUE}
            step={1}
            value={zoomToSliderValue(zoom)}
            onChange={(event) => onZoomChange(sliderValueToZoom(Number(event.currentTarget.value)))}
            aria-label="缩放"
          />
        </label>
      </div>
    );
  };

  return (
    <div className="toolbar">
      <div className="toolbar-tabs" role="tablist" aria-label="工具栏">
        {[
          { id: "file", label: "文件" },
          { id: "search", label: "搜索" },
          { id: "home", label: "开始" },
          { id: "insert", label: "插入" },
          { id: "table", label: "表格" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "toolbar-tab active" : "toolbar-tab"}
            onClick={() => setActiveTab(tab.id as ToolbarTab)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="toolbar-subrow">
        {renderSubToolbar()}
        <div className="toolbar-meta">
          <span>{dirty ? "未保存修改" : "已保存"}</span>
        </div>
      </div>
    </div>
  );
};
