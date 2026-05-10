import { describe, it, expect } from "vitest";
import {
  resolveAnchorPoint,
  resolveConnectorEndpoint,
  nearestAnchor,
  distanceToSegment,
} from "./connectorGeometry";
import type { BoxCanvasNode, ConnectorNode, CanvasNode } from "../model/types";

const boxNode: BoxCanvasNode = {
  id: "n1", type: "text",
  pageIndex: 0, x: 100, y: 200, w: 200, h: 100, z: 1,
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
  style: {},
};

describe("resolveAnchorPoint", () => {
  it("center anchor returns middle of node", () => {
    const p = resolveAnchorPoint(boxNode, "center");
    expect(p).toEqual({ x: 200, y: 250 });
  });

  it("top anchor returns top-center", () => {
    const p = resolveAnchorPoint(boxNode, "top");
    expect(p).toEqual({ x: 200, y: 200 });
  });

  it("bottom anchor returns bottom-center", () => {
    const p = resolveAnchorPoint(boxNode, "bottom");
    expect(p).toEqual({ x: 200, y: 300 });
  });

  it("left anchor returns center-left", () => {
    const p = resolveAnchorPoint(boxNode, "left");
    expect(p).toEqual({ x: 100, y: 250 });
  });

  it("right anchor returns center-right", () => {
    const p = resolveAnchorPoint(boxNode, "right");
    expect(p).toEqual({ x: 300, y: 250 });
  });

  it("defaults to center when anchor undefined", () => {
    const p = resolveAnchorPoint(boxNode);
    expect(p).toEqual({ x: 200, y: 250 });
  });
});

describe("resolveConnectorEndpoint", () => {
  const connector: ConnectorNode = {
    id: "c1", type: "connector",
    pageIndex: 0, z: 1,
    x1: 0, y1: 0, x2: 400, y2: 300,
    startNodeId: "n1", startAnchor: "right",
    endNodeId: "n1", endAnchor: "bottom",
    stroke: "#000", strokeWidth: 2, lineStyle: "solid",
    startMarker: "none", endMarker: "arrow",
    style: {},
  };

  it("resolves start endpoint to node anchor", () => {
    const p = resolveConnectorEndpoint(connector, "start", [boxNode]);
    expect(p).toEqual({ x: 300, y: 250 }); // n1 right anchor
  });

  it("resolves end endpoint to node anchor", () => {
    const p = resolveConnectorEndpoint(connector, "end", [boxNode]);
    expect(p).toEqual({ x: 200, y: 300 }); // n1 bottom anchor
  });

  it("falls back to raw x1/y1 when node not found", () => {
    const c: ConnectorNode = { ...connector, startNodeId: "nonexistent" };
    const p = resolveConnectorEndpoint(c, "start", [boxNode]);
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it("falls back to raw x2/y2 when node not found", () => {
    const c: ConnectorNode = { ...connector, endNodeId: "nonexistent" };
    const p = resolveConnectorEndpoint(c, "end", [boxNode]);
    expect(p).toEqual({ x: 400, y: 300 });
  });
});

describe("nearestAnchor", () => {
  it("picks top anchor when point is above the node", () => {
    const a = nearestAnchor(boxNode, { x: 200, y: 0 });
    expect(a).toBe("top");
  });

  it("picks right anchor when point is to the right", () => {
    const a = nearestAnchor(boxNode, { x: 500, y: 250 });
    expect(a).toBe("right");
  });

  it("picks bottom anchor when point is below", () => {
    const a = nearestAnchor(boxNode, { x: 200, y: 500 });
    expect(a).toBe("bottom");
  });

  it("picks left anchor when point is to the left", () => {
    const a = nearestAnchor(boxNode, { x: 0, y: 250 });
    expect(a).toBe("left");
  });

  it("picks center when point is inside the node", () => {
    const a = nearestAnchor(boxNode, { x: 200, y: 250 });
    expect(a).toBe("center");
  });
});

describe("distanceToSegment", () => {
  it("returns 0 for point on the segment", () => {
    const d = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(0);
  });

  it("calculates perpendicular distance", () => {
    const d = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(3);
  });

  it("handles zero-length segment", () => {
    const d = distanceToSegment({ x: 5, y: 0 }, { x: 3, y: 3 }, { x: 3, y: 3 });
    expect(d).toBeCloseTo(Math.hypot(2, 3), 6);
  });

  it("returns distance to start when projection is before the segment", () => {
    const d = distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(5);
  });

  it("returns distance to end when projection is after the segment", () => {
    const d = distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBe(5);
  });
});
