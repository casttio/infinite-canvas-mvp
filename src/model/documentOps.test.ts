import { describe, it, expect } from "vitest";
import {
  addNodeToDocument,
  updateNodeInDocument,
  addImageNodeToDocument,
} from "./documentOps";
import { createEmptyDocument, createTextNode } from "./defaults";
import type { CanvasNode, DocumentFile, Asset } from "./types";

const emptyDoc = () => createEmptyDocument();

describe("addNodeToDocument", () => {
  it("adds a node and assigns next z", () => {
    const doc = emptyDoc();
    const node = createTextNode(100, 100);
    const result = addNodeToDocument(doc, node);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].z).toBe(1);
    // second add gets z=2
    const result2 = addNodeToDocument(result, createTextNode(200, 200));
    expect(result2.nodes).toHaveLength(2);
    expect(result2.nodes[1].z).toBe(2);
  });

  it("clamps node to pageBounds origin", () => {
    const doc = emptyDoc();
    const node = createTextNode(-100, -50);
    const result = addNodeToDocument(doc, node);
    expect(result.nodes[0].x).toBe(0);
    expect(result.nodes[0].y).toBe(0);
  });

  it("updates page count when node has higher pageIndex", () => {
    const doc = emptyDoc(); // count=1
    const node = { ...createTextNode(100, 100), pageIndex: 3 };
    const result = addNodeToDocument(doc, node);
    expect(result.appearance.pages.count).toBeGreaterThanOrEqual(4);
  });
});

describe("updateNodeInDocument", () => {
  it("updates a node by id", () => {
    const doc = addNodeToDocument(emptyDoc(), createTextNode(100, 100));
    const result = updateNodeInDocument(doc, doc.nodes[0].id, (n) => ({
      ...n,
      x: 999,
    }));
    expect(result.nodes[0].x).toBe(999);
  });

  it("returns original document if node id not found", () => {
    const doc = emptyDoc();
    const result = updateNodeInDocument(doc, "nonexistent", (n) => n);
    expect(result).toBe(doc);
  });

  it("clamps node position on update", () => {
    const doc = addNodeToDocument(emptyDoc(), createTextNode(100, 100));
    const result = updateNodeInDocument(doc, doc.nodes[0].id, (n) => ({
      ...n,
      x: -999,
      y: -999,
    }));
    expect(result.nodes[0].x).toBe(0);
    expect(result.nodes[0].y).toBe(0);
  });
});

describe("addImageNodeToDocument", () => {
  it("adds node and asset together", () => {
    const doc = emptyDoc();
    const node = { ...createTextNode(100, 100), type: "image" as const, assetId: "asset_xyz" };
    const asset: Asset = { id: "asset_xyz", type: "image", mimeType: "image/png", name: "test.png" };
    const result = addImageNodeToDocument(doc, node, asset);
    expect(result.nodes).toHaveLength(1);
    expect(result.assets["asset_xyz"]).toBeDefined();
    expect(result.assets["asset_xyz"].name).toBe("test.png");
  });
});
