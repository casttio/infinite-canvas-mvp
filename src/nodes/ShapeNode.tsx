import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeHandle } from "../editor/resize";
import type { ShapeNode as ShapeNodeType } from "../model/types";
import { richTextDocToHtml } from "./richText";

type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;

interface ShapeNodeProps {
  node: ShapeNodeType;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
  onLabelChange?: (label: string) => void;
}

export const ShapeNode = ({
  node,
  selected,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onLabelChange,
}: ShapeNodeProps) => (
  <div
    className={`canvas-node shape-node shape-node-${node.shapeType} ${selected ? "selected" : ""}`}
    data-node-id={node.id}
    style={{
      transform: `translate(${node.x}px, ${node.y}px)`,
      width: node.w,
      height: node.h,
      zIndex: node.z,
      background: node.fill,
      borderColor: node.stroke,
      borderWidth: node.strokeWidth,
      borderRadius: node.shapeType === "ellipse" ? "50%" : node.borderRadius ?? 0,
    }}
    onPointerDown={onPointerDown}
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    onDoubleClick={(event) => {
      event.stopPropagation();
      const nextLabel = window.prompt("形状文字", node.label ? "" : "");
      if (nextLabel !== null) {
        onLabelChange?.(nextLabel);
      }
    }}
  >
    {node.label ? (
      <div
        className="shape-node-label"
        dangerouslySetInnerHTML={{ __html: richTextDocToHtml(node.label, {}) }}
      />
    ) : null}
    {selected ? (
      <>
        <button
          type="button"
          className="resize-edge resize-edge-left"
          onPointerDown={(event) => onResizePointerDown(event, "left")}
          aria-label="Resize shape node left edge"
        />
        <button
          type="button"
          className="resize-edge resize-edge-right"
          onPointerDown={(event) => onResizePointerDown(event, "right")}
          aria-label="Resize shape node right edge"
        />
        <button
          type="button"
          className="resize-handle"
          onPointerDown={(event) => onResizePointerDown(event, "bottom-right")}
          aria-label="Resize shape node"
        />
      </>
    ) : null}
  </div>
);
