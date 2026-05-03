import type { BoxCanvasNode, CanvasNode, ConnectorAnchor, ConnectorNode } from "../model/types";

export const isBoxCanvasNode = (node: CanvasNode): node is BoxCanvasNode => node.type !== "connector";

export const resolveAnchorPoint = (
  node: BoxCanvasNode,
  anchor: ConnectorAnchor = "center",
): { x: number; y: number } => {
  switch (anchor) {
    case "top":
      return { x: node.x + node.w / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.w / 2, y: node.y + node.h };
    case "left":
      return { x: node.x, y: node.y + node.h / 2 };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h / 2 };
    case "center":
    default:
      return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  }
};

export const resolveConnectorEndpoint = (
  connector: ConnectorNode,
  endpoint: "start" | "end",
  nodes: CanvasNode[],
): { x: number; y: number } => {
  const nodeId = endpoint === "start" ? connector.startNodeId : connector.endNodeId;
  const anchor = endpoint === "start" ? connector.startAnchor : connector.endAnchor;
  const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;

  if (node && isBoxCanvasNode(node)) {
    return resolveAnchorPoint(node, anchor);
  }

  return endpoint === "start"
    ? { x: connector.x1, y: connector.y1 }
    : { x: connector.x2, y: connector.y2 };
};

export const nearestAnchor = (
  node: BoxCanvasNode,
  point: { x: number; y: number },
): ConnectorAnchor => {
  const anchors: ConnectorAnchor[] = ["top", "right", "bottom", "left", "center"];
  return anchors.reduce<ConnectorAnchor>((best, anchor) => {
    const bestPoint = resolveAnchorPoint(node, best);
    const anchorPoint = resolveAnchorPoint(node, anchor);
    const bestDistance = Math.hypot(point.x - bestPoint.x, point.y - bestPoint.y);
    const anchorDistance = Math.hypot(point.x - anchorPoint.x, point.y - anchorPoint.y);
    return anchorDistance < bestDistance ? anchor : best;
  }, "center");
};

export const distanceToSegment = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};
