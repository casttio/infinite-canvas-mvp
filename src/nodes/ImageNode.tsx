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
    {asset ? (
      <img src={asset.data} alt={asset.name} draggable={false} />
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
