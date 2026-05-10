import { describe, it, expect } from "vitest";
import {
  createEmptyDocument,
  createTextNode,
  createImageNode,
  createShapeNode,
  createConnectorNode,
  createNodeId,
  createAssetId,
  createDocumentId,
  fitPageBoundsToNodes,
  derivePageBoundsFromNodes,
} from "./defaults";
import type { CanvasNode } from "./types";

describe("ID generators", () => {
  it("createDocumentId starts with doc_", () => {
    expect(createDocumentId()).toMatch(/^doc_/);
  });

  it("createNodeId starts with node_{type}", () => {
    expect(createNodeId("text")).toMatch(/^node_text_/);
    expect(createNodeId("image")).toMatch(/^node_image_/);
    expect(createNodeId("shape")).toMatch(/^node_shape_/);
    expect(createNodeId("connector")).toMatch(/^node_connector_/);
  });

  it("createAssetId starts with asset_", () => {
    expect(createAssetId()).toMatch(/^asset_/);
  });
});

describe("createEmptyDocument", () => {
  it("returns a valid empty document", () => {
    const doc = createEmptyDocument();
    expect(doc.format).toBe("icanvas");
    expect(doc.version).toBe(2);
    expect(doc.nodes).toEqual([]);
    expect(doc.assets).toEqual({});
    expect(doc.meta.id).toMatch(/^doc_/);
    expect(typeof doc.meta.createdAt).toBe("string");
    expect(doc.appearance.pages.count).toBe(1);
  });
});

describe("createTextNode", () => {
  it("creates a text node at given position", () => {
    const n = createTextNode(100, 200);
    expect(n.type).toBe("text");
    expect(n.x).toBe(100);
    expect(n.y).toBe(200);
    expect(n.w).toBe(320);
    expect(n.h).toBe(180);
    expect(n.content.type).toBe("doc");
    expect(n.content.content[0].type).toBe("paragraph");
  });
});

describe("createImageNode", () => {
  it("creates an image node with asset reference", () => {
    const n = createImageNode(50, 60, "asset_abc", 800, 600);
    expect(n.type).toBe("image");
    expect(n.x).toBe(50);
    expect(n.y).toBe(60);
    expect(n.assetId).toBe("asset_abc");
    expect(n.w).toBe(800);
    expect(n.h).toBe(600);
  });
});

describe("createShapeNode", () => {
  it("creates a rect shape by default", () => {
    const n = createShapeNode(10, 20);
    expect(n.type).toBe("shape");
    expect(n.shapeType).toBe("rect");
    expect(n.fill).toBe("#FFFFFF");
    expect(n.borderRadius).toBe(8);
  });

  it("creates an ellipse shape", () => {
    const n = createShapeNode(10, 20, "ellipse");
    expect(n.shapeType).toBe("ellipse");
    expect(n.fill).toBe("#FFFFFF");
    expect(n.borderRadius).toBeUndefined();
  });
});

describe("createConnectorNode", () => {
  it("creates a connector between two points", () => {
    const n = createConnectorNode(0, 0, 200, 100);
    expect(n.type).toBe("connector");
    expect(n.x1).toBe(0);
    expect(n.y1).toBe(0);
    expect(n.x2).toBe(200);
    expect(n.y2).toBe(100);
    expect(n.endMarker).toBe("arrow");
    expect(n.stroke).toBe("#9E9993");
  });

  it("accepts custom options", () => {
    const n = createConnectorNode(0, 0, 100, 100, {
      startNodeId: "node_text_abc",
      startAnchor: "bottom",
      endNodeId: "node_text_def",
      endAnchor: "top",
      stroke: "#B55B5B",
      strokeWidth: 3,
      lineStyle: "dashed",
      endMarker: "circle",
      label: "hello",
    });
    expect(n.startNodeId).toBe("node_text_abc");
    expect(n.startAnchor).toBe("bottom");
    expect(n.endNodeId).toBe("node_text_def");
    expect(n.endAnchor).toBe("top");
    expect(n.stroke).toBe("#B55B5B");
    expect(n.strokeWidth).toBe(3);
    expect(n.lineStyle).toBe("dashed");
    expect(n.endMarker).toBe("circle");
    expect(n.label).toBe("hello");
  });
});

describe("fitPageBoundsToNodes", () => {
  it("returns default bounds for empty nodes", () => {
    const b = fitPageBoundsToNodes([]);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.w).toBe(1600);
    expect(b.h).toBe(1200);
  });

  it("expands bounds to fit nodes", () => {
    const nodes: CanvasNode[] = [
      { type: "text", x: 0, y: 0, w: 500, h: 300 } as CanvasNode,
      { type: "text", x: 600, y: 400, w: 400, h: 200 } as CanvasNode,
    ];
    const b = fitPageBoundsToNodes(nodes, 100);
    expect(b.w).toBeGreaterThanOrEqual(600 + 400 + 100);
    expect(b.h).toBeGreaterThanOrEqual(400 + 200 + 100);
  });

  it("accounts for connector endpoints", () => {
    const nodes: CanvasNode[] = [
      { type: "connector", x1: 0, y1: 0, x2: 3000, y2: 2000 } as CanvasNode,
    ];
    const b = fitPageBoundsToNodes(nodes, 240);
    expect(b.w).toBeGreaterThanOrEqual(3000 + 240);
    expect(b.h).toBeGreaterThanOrEqual(2000 + 240);
  });
});

describe("derivePageBoundsFromNodes", () => {
  it("handles zero nodes", () => {
    const b = derivePageBoundsFromNodes([]);
    expect(b.w).toBe(1600);
    expect(b.h).toBe(1200);
  });
});
