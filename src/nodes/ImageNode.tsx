import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeHandle } from "../editor/resize";
import type { Asset, ImageNode as ImageNodeType } from "../model/types";

type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;

interface ImageNodeProps {
  node: ImageNodeType;
  asset?: Asset;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
}

const attachmentBadge = (asset?: Asset) => {
  if (!asset) {
    return "附件";
  }

  if (asset.type === "pdf") {
    return "PDF";
  }

  const extension = asset.name.split(".").pop()?.trim().toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
};

export const ImageNode = ({
  node,
  asset,
  selected,
  onSelect,
  onPointerDown,
  onResizePointerDown,
}: ImageNodeProps) => (
  <div
    className={`canvas-node image-node ${selected ? "selected" : ""}`}
    style={{
      transform: `translate(${node.x}px, ${node.y}px)`,
      width: node.w,
      height: node.h,
      zIndex: node.z,
    }}
    onPointerDown={onPointerDown}
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
  >
    {asset?.type === "image" && asset.data ? (
      <img src={asset.data} alt={asset.name} draggable={false} />
    ) : asset?.type === "pdf" && asset.data ? (
      <div className="html-preview-frame" aria-label={asset.name}>
        <div className="html-preview-toolbar">
          <span className="html-preview-dot" />
          <span className="html-preview-dot" />
          <span className="html-preview-dot" />
          <span className="html-preview-title">{asset.name}</span>
        </div>
        <iframe
          className="html-preview-iframe"
          src={asset.data}
          title={asset.name}
        />
      </div>
    ) : asset?.type === "html" && asset.data ? (
      <div className="html-preview-frame" aria-label={asset.name}>
        <div className="html-preview-toolbar">
          <span className="html-preview-dot" />
          <span className="html-preview-dot" />
          <span className="html-preview-dot" />
          <span className="html-preview-title">{asset.name}</span>
        </div>
        <iframe
          className="html-preview-iframe"
          srcDoc={asset.data}
          sandbox=""
          title={asset.name}
        />
      </div>
    ) : asset?.type === "file" ? (
      <div className="attachment-card" aria-label={asset.name}>
        <div className="attachment-card-icon">{attachmentBadge(asset)}</div>
        <div className="attachment-card-meta">
          <strong className="attachment-card-name">{asset.name}</strong>
          <span className="attachment-card-type">{asset.mimeType || "附件"}</span>
        </div>
      </div>
    ) : asset?.storage === "managed" ? (
      <div className="image-placeholder">附件缺失或当前路径不可访问</div>
    ) : (
      <div className="image-placeholder">图片资源缺失或已损坏</div>
    )}
    {selected ? (
      <>
        <button
          type="button"
          className="resize-edge resize-edge-left"
          onPointerDown={(event) => onResizePointerDown(event, "left")}
          aria-label="Resize image node left edge"
        />
        <button
          type="button"
          className="resize-edge resize-edge-right"
          onPointerDown={(event) => onResizePointerDown(event, "right")}
          aria-label="Resize image node right edge"
        />
        <button
          type="button"
          className="resize-handle"
          onPointerDown={(event) => onResizePointerDown(event, "bottom-right")}
          aria-label="Resize image node"
        />
      </>
    ) : null}
  </div>
);
