import { useEffect, useRef, useState } from "react";
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

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  canFormatText: boolean;
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
  canInsertTable,
  canInsertTableColumn,
  canFormatText,
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
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState("11");
  const [textColor, setTextColor] = useState("#0f172a");
  const [highlightColor, setHighlightColor] = useState("#fef200");
  const insertMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showInsertMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node)
        || insertMenuRef.current?.contains(target)
      ) {
        return;
      }
      setShowInsertMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowInsertMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showInsertMenu]);

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

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <div className="toolbar-popover-anchor" ref={insertMenuRef}>
          <button
            type="button"
            className={showInsertMenu ? "toolbar-button toolbar-file-button active" : "toolbar-button toolbar-file-button"}
            onClick={() => setShowInsertMenu((current) => !current)}
          >
            插入
          </button>
          {showInsertMenu ? (
            <div className="toolbar-file-menu">
              <button type="button" className="toolbar-file-menu-item" onClick={onAddText}>文本块</button>
              <button type="button" className="toolbar-file-menu-item" onPointerDown={(event) => event.preventDefault()} onClick={onAddImage}>插入图片</button>
              <button type="button" className="toolbar-file-menu-item" onPointerDown={(event) => event.preventDefault()} onClick={onAddAttachment}>插入附件</button>
              <button
                type="button"
                className="toolbar-file-menu-item"
                disabled={!canInsertTable}
                onPointerDown={(event) => event.preventDefault()}
                onClick={onInsertTable}
              >
                插入表格
              </button>
            </div>
          ) : null}
        </div>
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
          onClick={onInsertTableColumnLeft}
        >
          左加列
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
        <div className="text-format-toolbar" data-preserve-editor-focus="true">
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
      </div>
      <div className="toolbar-meta">
        <span>{dirty ? "未保存修改" : "已保存"}</span>
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
    </div>
  );
};
