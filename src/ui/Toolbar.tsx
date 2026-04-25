import { useEffect, useRef, useState } from "react";
import { MAX_ZOOM_SLIDER_VALUE, sliderValueToZoom, zoomToSliderValue } from "../editor/viewport";
import { TextStylePanel } from "./TextStylePanel";

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  canFormatText: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
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
  onNew,
  onOpen,
  onSave,
  onSaveAs,
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
  const [showStylePanel, setShowStylePanel] = useState(false);
  const stylePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showStylePanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || stylePanelRef.current?.contains(target)) {
        return;
      }
      setShowStylePanel(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowStylePanel(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showStylePanel]);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button type="button" onClick={onNew}>新建</button>
        <button type="button" onClick={onOpen}>打开</button>
        <button type="button" onClick={onSave} style={{ background: "#0f172a", color: "#fff" }}>保存</button>
        <button type="button" onClick={onSaveAs}>另存为</button>
        <button type="button" disabled={!canUndo} onClick={onUndo}>撤销</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}>重做</button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onAddText}>文本块</button>
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onAddImage}>插入图片</button>
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onAddAttachment}>插入附件</button>
        <button
          type="button"
          disabled={!canInsertTable}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onInsertTable}
        >
          插入表格
        </button>
        <button
          type="button"
          disabled={!canInsertTableColumn}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onInsertTableColumn}
        >
          右加列
        </button>
        <button
          type="button"
          disabled={!canInsertTableColumn}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onInsertTableColumnLeft}
        >
          左加列
        </button>
        <button
          type="button"
          disabled={!canInsertTableColumn}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onDeleteTableColumn}
        >
          删除列
        </button>
        <div className="toolbar-popover-anchor" ref={stylePanelRef}>
          <button
            type="button"
            className={showStylePanel ? "toolbar-style-toggle active" : "toolbar-style-toggle"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setShowStylePanel((current) => !current)}
          >
            文字样式
          </button>
          {showStylePanel ? (
            <div className="text-style-popover" data-preserve-editor-focus="true">
              <TextStylePanel
                disabled={!canFormatText}
                onSetFontFamily={onSetFontFamily}
                onSetFontSize={onSetFontSize}
                onSetTextColor={onSetTextColor}
                onSetHighlightColor={onSetHighlightColor}
                pageBackground={pageBackground}
                gridEnabled={gridEnabled}
                gridColor={gridColor}
                gridSize={gridSize}
                onSetPageBackground={onSetPageBackground}
                onSetGridEnabled={onSetGridEnabled}
                onSetGridColor={onSetGridColor}
                onSetGridSize={onSetGridSize}
              />
            </div>
          ) : null}
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
