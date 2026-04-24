import { MAX_ZOOM_SLIDER_VALUE, sliderValueToZoom, zoomToSliderValue } from "../editor/viewport";

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onAddText: () => void;
  onAddImage: () => void;
  onInsertTable: () => void;
  onInsertTableColumn: () => void;
  onInsertTableColumnLeft: () => void;
  onDeleteTableColumn: () => void;
  onZoomChange: (zoom: number) => void;
}

export const Toolbar = ({
  zoom,
  dirty,
  canInsertTable,
  canInsertTableColumn,
  onNew,
  onOpen,
  onSave,
  onAddText,
  onAddImage,
  onInsertTable,
  onInsertTableColumn,
  onInsertTableColumnLeft,
  onDeleteTableColumn,
  onZoomChange,
}: ToolbarProps) => (
  <div className="toolbar">
    <div className="toolbar-group">
      <button type="button" onClick={onNew}>新建</button>
      <button type="button" onClick={onOpen}>打开</button>
      <button type="button" onClick={onSave}>保存</button>
    </div>
    <div className="toolbar-group">
      <button type="button" onClick={onAddText}>文本块</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onAddImage}>插入图片</button>
      <button
        type="button"
        disabled={!canInsertTable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertTable}
      >
        插入表格
      </button>
      <button
        type="button"
        disabled={!canInsertTableColumn}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertTableColumn}
      >
        右加列
      </button>
      <button
        type="button"
        disabled={!canInsertTableColumn}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertTableColumnLeft}
      >
        左加列
      </button>
      <button
        type="button"
        disabled={!canInsertTableColumn}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDeleteTableColumn}
      >
        删除列
      </button>
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
