import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { RichTextBlock, AssetMap } from "../model/types";
import { richTextDocToHtml } from "../nodes/richText";

export interface ReferenceLink {
  label: string;
  url: string;
  type: "doi" | "arxiv" | "url";
}

/** Zoom step factor per wheel tick */
const WHEEL_ZOOM_STEP = 0.08;

export interface ReferenceNodeRef {
  pageIndex: number;
  nodeId: string;
  label: string;
  preview?: string;
  filePath?: string;
}

export interface ReferenceBacklink {
  sourceNodeId: string;
  sourcePageIndex: number;
  label: string;
  context?: string;
}

/** Rich-text preview: render the node's full content blocks with assets */
export interface RichTextPreview {
  kind: "richText";
  blocks: RichTextBlock[];
  assets: AssetMap;
}

/** Plain-text preview (fallback / timeline summary) */
export interface TextPreview {
  kind: "text";
  text: string;
}

export type PreviewContent = RichTextPreview | TextPreview;

export interface ReferencePopoverProps {
  title?: string;
  x: number;
  y: number;
  links?: ReferenceLink[];
  nodeRefs?: ReferenceNodeRef[];
  backlinks?: ReferenceBacklink[];
  /** @deprecated Use previewContent instead */
  fullText?: string;
  previewContent?: PreviewContent;
  onNavigateTo?: (pageIndex: number, nodeId: string, filePath?: string) => void;
  onClose: () => void;
  onAddRef?: () => void;
  onRemoveRef?: () => void;
}

export const ReferencePopover = ({
  title,
  x,
  y,
  links = [],
  nodeRefs = [],
  backlinks = [],
  fullText,
  previewContent,
  onNavigateTo,
  onClose,
  onAddRef,
  onRemoveRef,
}: ReferencePopoverProps) => {
  if (typeof document === "undefined") return null;

  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const popoverRef = useRef<HTMLDivElement>(null);

  const clampTranslate = useCallback((tx: number, ty: number, vpW: number, vpH: number, cW: number, cH: number) => {
    if (cW <= vpW) tx = 0;
    else tx = Math.max(vpW - cW, Math.min(0, tx));
    if (cH <= vpH) ty = 0;
    else ty = Math.max(vpH - cH, Math.min(0, ty));
    return { x: tx, y: ty };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    vp.setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: translate.x, ty: translate.y };
  }, [translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const clamped = clampTranslate(
      dragRef.current.tx + dx,
      dragRef.current.ty + dy,
      vp.clientWidth,
      vp.clientHeight,
      ct.scrollWidth,
      ct.scrollHeight,
    );
    setTranslate(clamped);
  }, [clampTranslate]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    // Zoom on wheel (instead of scrolling)
    e.preventDefault();
    e.stopPropagation();
    setScale((prev) => {
      const delta = -e.deltaY;
      const factor = delta > 0 ? 1 + WHEEL_ZOOM_STEP : 1 - WHEEL_ZOOM_STEP;
      return Math.max(0.2, Math.min(5, prev * factor));
    });
  }, []);

  // Click outside popover to close
  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      const popover = popoverRef.current;
      if (!popover) return;
      const target = e.target as Node | null;
      if (target && !popover.contains(target)) {
        onClose();
      }
    };
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handleClickOutside, true);
    });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('pointerdown', handleClickOutside, true);
    };
  }, [onClose]);

  // Wheel zoom listener on the popover itself
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Reset zoom on double-click
  const handleDoubleClick = useCallback(() => {
    setScale(1);
  }, []);

  const zoomPercent = Math.round(scale * 100);

  const showRichContent = previewContent?.kind === "richText";
  const showTextContent = !showRichContent && (previewContent?.kind === "text" || (fullText && fullText.length > 0));

  // Render rich text HTML from blocks
  const richHtml = useMemo(() => {
    if (!showRichContent) return "";
    return richTextDocToHtml(
      { type: "doc", content: previewContent!.blocks },
      previewContent!.assets,
    );
  }, [showRichContent, previewContent]);

  // Resolve display text for plain-text preview
  const displayText = useMemo(() => {
    if (previewContent?.kind === "text") return previewContent.text;
    return fullText ?? "";
  }, [previewContent, fullText]);



  // In rich text mode, prevent image resize handles from appearing
  useEffect(() => {
    if (!showRichContent) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".text-inline-image-resize")) {
        e.stopPropagation();
      }
    };
    vp.addEventListener("mousedown", handler, true);
    return () => vp.removeEventListener("mousedown", handler, true);
  }, [showRichContent]);

  return createPortal(
    <div
      ref={popoverRef}
      className={`reference-popover${showRichContent ? " reference-popover--rich" : ""}`}
      role="dialog"
      aria-label={title ? `${title} 引用` : "引用"}
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="reference-popover-close"
        onClick={onClose}
        aria-label="关闭引用"
      >
        ×
      </button>
      {title && <div className="reference-popover-title">{title}</div>}

      {/* Content viewport */}
      {(showTextContent || showRichContent) && (
        <div
          ref={viewportRef}
          className={`reference-popover-viewport${dragging ? " dragging" : ""}${showRichContent ? " reference-popover-viewport--rich" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            ref={contentRef}
            className={`reference-popover-content${showRichContent ? " reference-popover-content--rich" : ""}`}
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: '0 0',
            }}
            onDoubleClick={handleDoubleClick}
          >
            {scale !== 1 && (
              <div className="reference-popover-zoom-badge">
                {zoomPercent}%
              </div>
            )}
            {showRichContent ? (
              <div
                className="reference-popover-rich-text"
                dangerouslySetInnerHTML={{ __html: richHtml }}
              />
            ) : (
              displayText
            )}
          </div>
        </div>
      )}

      {/* Bottom toolbar: icons row */}
      {(links.length > 0 || nodeRefs.length > 0 || backlinks.length > 0 || onAddRef || onRemoveRef) && (
        <div className="reference-popover-toolbar">
          {nodeRefs.map((ref) => (
            <button
              key={`ref-${ref.pageIndex}-${ref.nodeId}`}
              type="button"
              className="reference-popover-toolbar-btn"
              onClick={() => onNavigateTo?.(ref.pageIndex, ref.nodeId, ref.filePath)}
              title={ref.label}
            >
              ↗
            </button>
          ))}
          {backlinks.map((backlink) => (
            <button
              key={`bl-${backlink.sourcePageIndex}-${backlink.sourceNodeId}`}
              type="button"
              className="reference-popover-toolbar-btn"
              onClick={() => onNavigateTo?.(backlink.sourcePageIndex, backlink.sourceNodeId)}
              title={backlink.label}
            >
              ↖
            </button>
          ))}
          {links.map((link) => (
            <a
              key={`${link.type}-${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="reference-popover-toolbar-btn"
              title={link.label}
            >
              🔗
            </a>
          ))}
          {onAddRef && (
            <button
              type="button"
              className="reference-popover-toolbar-btn"
              onClick={() => { onClose(); onAddRef(); }}
              title="添加引用"
            >
              +
            </button>
          )}
          {onRemoveRef && (
            <button
              type="button"
              className="reference-popover-toolbar-btn"
              onClick={() => { onClose(); onRemoveRef(); }}
              title="删除引用"
            >
              −
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
};
