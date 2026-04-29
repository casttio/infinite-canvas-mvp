import { useState } from "react";
import type { CSSProperties } from "react";
import { MAX_ZOOM_SLIDER_VALUE, sliderValueToZoom, zoomToSliderValue } from "../editor/viewport";

const FONT_OPTIONS = [
  { label: "微软雅黑", value: "Microsoft YaHei, sans-serif" },
  { label: "宋体", value: "SimSun, serif" },
  { label: "黑体", value: "SimHei, sans-serif" },
  { label: "楷体", value: "KaiTi, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
];

const FONT_SIZE_OPTIONS = ["11", "12", "14", "16", "18", "24", "32"];
type ToolbarTab = "file" | "home" | "insert" | "table";
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
  { id: "title1", label: "标题 1", className: "title-1", tag: "h1", fontSize: "32", color: "#1d4ed8", fontFamily: "Georgia, serif", bold: true, italic: false },
  { id: "title2", label: "标题 2", className: "title-2", tag: "h2", fontSize: "28", color: "#2563eb", fontFamily: "Georgia, serif", bold: true, italic: false },
  { id: "title3", label: "标题 3", className: "title-3", tag: "h3", fontSize: "24", color: "#3b82f6", fontFamily: "Georgia, serif", bold: true, italic: false },
  { id: "title4", label: "标题 4", className: "title-4", tag: "h4", fontSize: "20", color: "#60a5fa", fontFamily: "Georgia, serif", bold: true, italic: true },
  { id: "title5", label: "标题 5", className: "title-5", tag: "h5", fontSize: "18", color: "#2563eb", fontFamily: "Georgia, serif", bold: true, italic: true },
  { id: "title6", label: "标题 6", className: "title-6", tag: "h6", fontSize: "16", color: "#3b82f6", fontFamily: "Georgia, serif", bold: true, italic: true },
  { id: "pageTitle", label: "页标题", className: "page-title", tag: "h1", fontSize: "36", color: "#0f172a", fontFamily: "Georgia, serif", bold: true, italic: false },
  { id: "lead", label: "引文", className: "lead", tag: "p", fontSize: "18", color: "#475569", fontFamily: "Microsoft YaHei, sans-serif", bold: false, italic: false },
  { id: "quote", label: "引用", className: "quote", tag: "blockquote", fontSize: "16", color: "#64748b", fontFamily: "Georgia, serif", bold: false, italic: true },
  { id: "code", label: "代码", className: "code", tag: "pre", fontSize: "15", color: "#0f172a", fontFamily: "Consolas, monospace", bold: false, italic: false },
  { id: "normal", label: "常规", className: "normal", tag: "p", fontSize: "16", color: "#0f172a", fontFamily: "Microsoft YaHei, sans-serif", bold: false, italic: false },
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

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  canFormatText: boolean;
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onSaveDocument: () => void;
  onSaveAsDocument: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddAttachment: () => void;
  onInsertTable: () => void;
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
}

export const Toolbar = ({
  zoom,
  dirty,
  canUndo,
  canRedo,
  canInsertTable,
  canInsertTableColumn,
  canFormatText,
  onNewDocument,
  onOpenDocument,
  onSaveDocument,
  onSaveAsDocument,
  onUndo,
  onRedo,
  onAddText,
  onAddImage,
  onAddAttachment,
  onInsertTable,
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
}: ToolbarProps) => {
  const [activeTab, setActiveTab] = useState<ToolbarTab>("home");
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState("11");
  const [textColor, setTextColor] = useState("#0f172a");
  const [highlightColor, setHighlightColor] = useState("#fef200");
  const [showBlockStyleMenu, setShowBlockStyleMenu] = useState(false);
  const [showBlockStyleEditor, setShowBlockStyleEditor] = useState(false);
  const [blockStylePresets, setBlockStylePresets] = useState(readBlockStylePresets);
  const [editingBlockStyleId, setEditingBlockStyleId] = useState(DEFAULT_BLOCK_STYLE_PRESETS[0].id);
  const editingBlockStyle = blockStylePresets.find((preset) => preset.id === editingBlockStyleId) ?? blockStylePresets[0];

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
    if (activeTab === "file") {
      return (
        <div className="toolbar-group">
          <button type="button" className="toolbar-button" onClick={onNewDocument}>新建</button>
          <button type="button" className="toolbar-button" onClick={onOpenDocument}>打开</button>
          <button type="button" className="toolbar-button primary" onClick={onSaveDocument}>保存</button>
          <button type="button" className="toolbar-button" onClick={onSaveAsDocument}>另存为</button>
        </div>
      );
    }

    if (activeTab === "insert") {
      return (
        <div className="toolbar-group">
          <button type="button" className="toolbar-button" onClick={onAddText}>文本块</button>
          <button type="button" className="toolbar-button" onPointerDown={(event) => event.preventDefault()} onClick={onAddImage}>图片</button>
          <button type="button" className="toolbar-button" onPointerDown={(event) => event.preventDefault()} onClick={onAddAttachment}>附件</button>
          <button
            type="button"
            className="toolbar-button"
            disabled={!canInsertTable}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onInsertTable}
          >
            表格
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
          <div className="toolbar-popover-anchor">
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
                  <div className="block-style-editor" onPointerDown={(event) => event.preventDefault()}>
                    <div className="block-style-editor-header">
                      <span>样式预设</span>
                      <button type="button" onClick={() => setShowBlockStyleEditor(false)}>完成</button>
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
                          setShowBlockStyleMenu(false);
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
                        setShowBlockStyleMenu(false);
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
