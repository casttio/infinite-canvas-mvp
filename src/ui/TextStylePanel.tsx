import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

const DEFAULT_FONT_OPTIONS = ["sans-serif", "serif", "monospace", "KaiTi"];
const DEFAULT_FONT_SIZE_OPTIONS = ["12px", "14px", "16px", "18px", "24px", "32px"];
const DEFAULT_TEXT_COLORS = ["#0f172a", "#2563eb", "#dc2626", "#16a34a", "#9333ea"];
const DEFAULT_HIGHLIGHT_COLORS = ["#fef08a", "#fed7aa", "#bfdbfe", "#bbf7d0", "#fbcfe8"];

const STORAGE_KEYS = {
  fonts: "icanvas.textStyle.fonts",
  fontSizes: "icanvas.textStyle.fontSizes",
  textColors: "icanvas.textStyle.textColors",
  highlightColors: "icanvas.textStyle.highlightColors",
};

const uniqueValues = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

const readStoredValues = (key: string, fallback: string[]) => {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? uniqueValues(parsed) : fallback;
  } catch {
    return fallback;
  }
};

interface TextStylePanelProps {
  disabled: boolean;
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
}

interface PresetButtonProps {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  disabled: boolean;
  onClick: () => void;
  onRemove: () => void;
  style?: CSSProperties;
}

const PresetButton = ({
  ariaLabel,
  children,
  className,
  disabled,
  onClick,
  onRemove,
  style,
}: PresetButtonProps) => (
  <button
    type="button"
    className={className ? `text-style-preset ${className}` : "text-style-preset"}
    disabled={disabled}
    onPointerDown={(event) => event.preventDefault()}
    onClick={onClick}
    style={style}
    aria-label={ariaLabel}
  >
    <span className="text-style-preset-label">{children}</span>
    <span
      className="text-style-preset-remove"
      role="button"
      aria-label="删除预设"
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      ×
    </span>
  </button>
);

export const TextStylePanel = ({
  disabled,
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
}: TextStylePanelProps) => {
  const [fontOptions, setFontOptions] = useState(DEFAULT_FONT_OPTIONS);
  const [fontSizeOptions, setFontSizeOptions] = useState(DEFAULT_FONT_SIZE_OPTIONS);
  const [textColors, setTextColors] = useState(DEFAULT_TEXT_COLORS);
  const [highlightColors, setHighlightColors] = useState(DEFAULT_HIGHLIGHT_COLORS);
  const [customFont, setCustomFont] = useState("");
  const [customFontSize, setCustomFontSize] = useState("");
  const [customTextColor, setCustomTextColor] = useState("#0f172a");
  const [customHighlightColor, setCustomHighlightColor] = useState("#fef08a");

  useEffect(() => {
    setFontOptions(readStoredValues(STORAGE_KEYS.fonts, DEFAULT_FONT_OPTIONS));
    setFontSizeOptions(readStoredValues(STORAGE_KEYS.fontSizes, DEFAULT_FONT_SIZE_OPTIONS));
    setTextColors(readStoredValues(STORAGE_KEYS.textColors, DEFAULT_TEXT_COLORS));
    setHighlightColors(readStoredValues(STORAGE_KEYS.highlightColors, DEFAULT_HIGHLIGHT_COLORS));
  }, []);

  const persistValues = (key: string, values: string[], setter: (values: string[]) => void) => {
    const nextValues = uniqueValues(values);
    setter(nextValues);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, JSON.stringify(nextValues));
    }
  };

  const removeValue = (key: string, values: string[], value: string, setter: (values: string[]) => void) => {
    persistValues(key, values.filter((item) => item !== value), setter);
  };

  const addFont = () => {
    if (!customFont.trim()) {
      return;
    }

    const nextValue = customFont.trim();
    persistValues(STORAGE_KEYS.fonts, [...fontOptions, nextValue], setFontOptions);
    setCustomFont("");
    onSetFontFamily(nextValue);
  };

  const addFontSize = () => {
    if (!customFontSize.trim()) {
      return;
    }

    const nextValue = customFontSize.trim();
    persistValues(STORAGE_KEYS.fontSizes, [...fontSizeOptions, nextValue], setFontSizeOptions);
    setCustomFontSize("");
    onSetFontSize(nextValue);
  };

  const addTextColor = () => {
    persistValues(STORAGE_KEYS.textColors, [...textColors, customTextColor], setTextColors);
    onSetTextColor(customTextColor);
  };

  const addHighlightColor = () => {
    persistValues(STORAGE_KEYS.highlightColors, [...highlightColors, customHighlightColor], setHighlightColors);
    onSetHighlightColor(customHighlightColor);
  };

  return (
    <div
      className="text-style-panel"
      data-preserve-editor-focus="true"
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement) {
          return;
        }
        event.preventDefault();
      }}
    >
      <div className="text-style-section">
        <div className="text-style-label">字体</div>
        <div className="text-style-presets">
          {fontOptions.map((font) => (
            <PresetButton
              key={font}
              disabled={disabled}
              onClick={() => onSetFontFamily(font)}
              onRemove={() => removeValue(STORAGE_KEYS.fonts, fontOptions, font, setFontOptions)}
              style={{ fontFamily: font }}
            >
              {font}
            </PresetButton>
          ))}
        </div>
        <div className="text-style-input-row">
          <input
            type="text"
            value={customFont}
            onChange={(event) => setCustomFont(event.currentTarget.value)}
            placeholder="自定义字体"
            disabled={disabled}
            data-preserve-editor-focus="true"
          />
          <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={addFont}>
            添加
          </button>
        </div>
      </div>

      <div className="text-style-section">
        <div className="text-style-label">字号</div>
        <div className="text-style-presets">
          {fontSizeOptions.map((size) => (
            <PresetButton
              key={size}
              disabled={disabled}
              onClick={() => onSetFontSize(size)}
              onRemove={() => removeValue(STORAGE_KEYS.fontSizes, fontSizeOptions, size, setFontSizeOptions)}
            >
              {size}
            </PresetButton>
          ))}
        </div>
        <div className="text-style-input-row">
          <input
            type="text"
            value={customFontSize}
            onChange={(event) => setCustomFontSize(event.currentTarget.value)}
            placeholder="如 20px / 1.2em"
            disabled={disabled}
            data-preserve-editor-focus="true"
          />
          <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={addFontSize}>
            添加
          </button>
        </div>
      </div>

      <div className="text-style-section">
        <div className="text-style-row-header">
          <div className="text-style-label">字色</div>
          <div className="text-style-input-row text-style-color-row">
            <input
              type="color"
              value={customTextColor}
              onChange={(event) => setCustomTextColor(event.currentTarget.value)}
              disabled={disabled}
              data-preserve-editor-focus="true"
            />
            <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={addTextColor}>
              添加
            </button>
          </div>
        </div>
        <div className="toolbar-swatches">
          {textColors.map((color) => (
            <PresetButton
              key={color}
              ariaLabel={`设置文字颜色 ${color}`}
              className="text-style-preset-swatch"
              disabled={disabled}
              onClick={() => onSetTextColor(color)}
              onRemove={() => removeValue(STORAGE_KEYS.textColors, textColors, color, setTextColors)}
              style={{ background: color }}
            >
              <span className="sr-only">{color}</span>
            </PresetButton>
          ))}
        </div>
      </div>

      <div className="text-style-section">
        <div className="text-style-row-header">
          <div className="text-style-label">高亮</div>
          <div className="text-style-input-row text-style-color-row">
            <input
              type="color"
              value={customHighlightColor}
              onChange={(event) => setCustomHighlightColor(event.currentTarget.value)}
              disabled={disabled}
              data-preserve-editor-focus="true"
            />
            <button type="button" disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={addHighlightColor}>
              添加
            </button>
          </div>
        </div>
        <div className="toolbar-swatches text-style-highlight-row">
          {highlightColors.map((color) => (
            <PresetButton
              key={color}
              ariaLabel={`设置高亮颜色 ${color}`}
              className="text-style-preset-swatch text-style-preset-highlight"
              disabled={disabled}
              onClick={() => onSetHighlightColor(color)}
              onRemove={() => removeValue(STORAGE_KEYS.highlightColors, highlightColors, color, setHighlightColors)}
              style={{ background: color }}
            >
              <span className="sr-only">{color}</span>
            </PresetButton>
          ))}
          <button
            type="button"
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSetHighlightColor("transparent")}
          >
            清除高亮
          </button>
        </div>
      </div>

      <div className="text-style-section">
        <div className="text-style-label">背景</div>
        <div className="text-style-row-header">
          <label className="text-style-inline-label">
            页面颜色
            <input
              type="color"
              value={pageBackground}
              onChange={(event) => onSetPageBackground(event.currentTarget.value)}
              data-preserve-editor-focus="true"
            />
          </label>
          <label className="text-style-checkbox">
            <input
              type="checkbox"
              checked={gridEnabled}
              onChange={(event) => onSetGridEnabled(event.currentTarget.checked)}
              data-preserve-editor-focus="true"
            />
            网格背景
          </label>
        </div>
        <div className="text-style-grid-controls">
          <label className="text-style-inline-label">
            网格颜色
            <input
              type="color"
              value={gridColor}
              onChange={(event) => onSetGridColor(event.currentTarget.value)}
              disabled={!gridEnabled}
              data-preserve-editor-focus="true"
            />
          </label>
          <label className="text-style-inline-label text-style-grid-size">
            间距
            <input
              type="range"
              min={8}
              max={64}
              step={2}
              value={gridSize}
              onChange={(event) => onSetGridSize(Number(event.currentTarget.value))}
              disabled={!gridEnabled}
              data-preserve-editor-focus="true"
            />
            <span>{gridSize}px</span>
          </label>
        </div>
      </div>
    </div>
  );
};
