import { describe, expect, it } from "vitest";
import { buildReferenceIndex } from "./referenceIndex";
import type { DocumentFile } from "./types";

const baseDocument: DocumentFile = {
  format: "icanvas",
  version: 2,
  meta: { id: "doc", createdAt: "", updatedAt: "" },
  nodes: [],
  assets: {},
  pageBounds: { x: 0, y: 0, w: 1000, h: 1000 },
  viewState: { cameraX: 0, cameraY: 0, zoom: 1 },
  appearance: {
    pageBackground: "#fff",
    grid: { enabled: true, color: "#eee", size: 24 },
    pages: { count: 1, height: 1000, gap: 100 },
  },
};

describe("buildReferenceIndex", () => {
  it("indexes rich text node links and timeline node refs", () => {
    const document: DocumentFile = {
      ...baseDocument,
      nodes: [
        {
          id: "text-1",
          type: "text",
          pageIndex: 0,
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          z: 1,
          style: {},
          content: {
            type: "doc",
            content: [{
              type: "paragraph",
              content: [{
                type: "text",
                text: "see target",
                marks: ["link"],
                nodeLink: { pageIndex: 1, nodeId: "target", label: "Target" },
              }],
            }],
          },
        },
        {
          id: "timeline-1",
          type: "timeline",
          pageIndex: 0,
          x: 0,
          y: 100,
          w: 100,
          h: 80,
          z: 2,
          style: {},
          entries: [{
            category: "A",
            date: "2026",
            title: "Milestone",
            nodeRef: { pageIndex: 2, nodeId: "target-2" },
          }],
        },
      ],
    };

    const index = buildReferenceIndex(document);

    expect(index.outgoing.get("text-1")).toEqual([{
      targetNodeId: "target",
      targetPage: 1,
      label: "Target",
      context: "see target",
    }]);
    expect(index.incoming.get("target")).toEqual([{
      sourceNodeId: "text-1",
      sourcePage: 0,
      label: "Target",
      context: "see target",
    }]);
    expect(index.incoming.get("target-2")).toEqual([{
      sourceNodeId: "timeline-1",
      sourcePage: 0,
      label: "Milestone",
      context: "Milestone",
    }]);
  });
});
