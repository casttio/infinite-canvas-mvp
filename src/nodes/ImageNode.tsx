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
  onOpenAttachment?: (assetId: string) => void;
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
  onOpenAttachment,
}: ImageNodeProps) => {
  const isAttachment = asset && (asset.type === "file" || asset.type === "pdf" || asset.storage === "managed");

  const handleOpenAttachment = (event: React.MouseEvent) => {
    if (isAttachment && onOpenAttachment) {
      event.stopPropagation();
      onOpenAttachment(node.assetId);
    }
  };

  return (
  <div
    className={`canvas-node image-node ${selected ? "selected" : ""}`}
    data-node-id={node.id}
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
    ) : isAttachment ? (
      <div className="attachment-card" aria-label={asset.name} onClick={handleOpenAttachment}>
        <div className="attachment-card-icon">{attachmentBadge(asset)}</div>
        <div className="attachment-card-meta">
          <strong className="attachment-card-name">{asset.name}</strong>
          <span className="attachment-card-type">{asset.mimeType || "附件"}</span>
        </div>
      </div>
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
};
