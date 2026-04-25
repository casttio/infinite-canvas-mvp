import { MAX_ZOOM_SLIDER_VALUE, sliderValueToZoom, zoomToSliderValue } from "../editor/viewport";

interface ToolbarProps {
  zoom: number;
  dirty: boolean;
  canInsertTable: boolean;
  canInsertTableColumn: boolean;
  canFormatText: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onAddText: () => void;
  onAddImage: () => void;
  onInsertTable: () => void;
  onInsertTableColumn: () => void;
  onInsertTableColumnLeft: () => void;
  onDeleteTableColumn: () => void;
  onSetFontFamily: (fontFamily: string) => void;
  onSetTextColor: (color: string) => void;
  onSetHighlightColor: (color: string) => void;
  onZoomChange: (zoom: number) => void;
}

const FONT_OPTIONS = [
  { label: "无衬线", value: "sans-serif" },
  { label: "衬线", value: "serif" },
  { label: "等宽", value: "monospace" },
  { label: "楷体", value: "KaiTi" },
];

const TEXT_COLORS = ["#0f172a", "#2563eb", "#dc2626", "#16a34a", "#9333ea"];
const HIGHLIGHT_COLORS = ["#fef08a", "#fed7aa", "#bfdbfe", "#bbf7d0", "#fbcfe8"];

export const Toolbar = ({
  zoom,
  dirty,
  canInsertTable,
  canInsertTableColumn,
  canFormatText,
  onNew,
  onOpen,
  onSave,
  onAddText,
  onAddImage,
  onInsertTable,
  onInsertTableColumn,
  onInsertTableColumnLeft,
  onDeleteTableColumn,
  onSetFontFamily,
  onSetTextColor,
  onSetHighlightColor,
  onZoomChange,
}: ToolbarProps) => (
  <div className="toolbar">
    <div className="toolbar-group">
      <button type="button" onClick={onNew}>新建</button>
      <button type="button" onClick={onOpen}>打开</button>
      <button type="button" onClick={onSave} style={{ background: "#0f172a", color: "#fff" }}>保存</button>
    </div>
    <div className="toolbar-group">
      <button type="button" onClick={onAddText}>文本块</button>
      <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onAddImage}>插入图片</button>
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
    </div>
    <div className="toolbar-group toolbar-group-format">
      {FONT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={!canFormatText}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onSetFontFamily(option.value)}
        >
          {option.label}
        </button>
      ))}
      <div className="toolbar-swatches">
        {TEXT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="toolbar-swatch"
            style={{ background: color }}
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSetTextColor(color)}
            aria-label={`设置文字颜色 ${color}`}
          />
        ))}
      </div>
      <div className="toolbar-swatches">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="toolbar-swatch toolbar-swatch-highlight"
            style={{ background: color }}
            disabled={!canFormatText}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSetHighlightColor(color)}
            aria-label={`设置高亮颜色 ${color}`}
          />
        ))}
        <button
          type="button"
          disabled={!canFormatText}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onSetHighlightColor("transparent")}
        >
          清高亮
        </button>
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
