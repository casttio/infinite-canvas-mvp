import { describe, it, expect } from "vitest";
import { migrateDocument } from "./migrate";
import type { DocumentFile } from "./types";

describe("migrateDocument", () => {
  it("migrates version 1 to version 2 with content added", () => {
    const v1 = {
      format: "icanvas",
      version: 1,
      meta: { id: "doc_xxx", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      nodes: [
        {
          id: "n1", type: "text", x: 100, y: 100, w: 300, h: 200, z: 1, style: {},
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
          },
        },
      ],
      assets: {},
      viewState: { cameraX: 0, cameraY: 0, zoom: 1 },
      appearance: {
        pageBackground: "#ffffff",
        grid: { enabled: false, color: "rgba(0,0,0,0.08)", size: 24 },
        pages: { count: 1, height: 1200, gap: 72 },
      },
    };
    const result = migrateDocument(v1);
    expect(result.version).toBe(2);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0] as any;
    expect(node.content).toBeDefined();
    expect(node.content.type).toBe("doc");
  });

  it("normalizes version 2 documents", () => {
    const v2: DocumentFile = {
      format: "icanvas",
      version: 2,
      meta: { id: "doc_yyy", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      nodes: [],
      assets: {},
      pageBounds: { x: 0, y: 0, w: 1600, h: 1200 },
      viewState: { cameraX: 0, cameraY: 0, zoom: 1 },
      appearance: {
        pageBackground: "#ffffff",
        grid: { enabled: false, color: "rgba(0,0,0,0.08)", size: 24 },
        pages: { count: 1, height: 1200, gap: 72 },
      },
    };
    const result = migrateDocument(v2);
    expect(result.version).toBe(2);
  });

  it("throws for non-object input", () => {
    expect(() => migrateDocument(null)).toThrow("文档内容不是合法对象");
    expect(() => migrateDocument("not an object")).toThrow("文档内容不是合法对象");
  });

  it("throws for unsupported versions", () => {
    expect(() => migrateDocument({ version: 3 })).toThrow("仅支持 version 1 或 version 2");
  });
});
