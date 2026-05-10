import { describe, it, expect } from "vitest";
import { parseTableToTimelineRows } from "./parseTable";
import type { TextNode } from "../model/types";

const makeTextNode = (doc: any): TextNode => ({
  id: "n1", type: "text",
  pageIndex: 0, x: 0, y: 0, w: 500, h: 200, z: 1,
  content: doc,
  style: {},
});

describe("parseTableToTimelineRows", () => {
  it("parses a table with header row", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "科技" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2024" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "AI突破" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "科技", date: "2024", title: "AI突破" });
  });

  it("parses table without header row (positional)", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "商业" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2023" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "新产品发布" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "商业", date: "2023", title: "新产品发布" });
  });

  it("returns empty array when no table exists", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });
    expect(parseTableToTimelineRows(node)).toEqual([]);
  });

  it("skips rows with missing year", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "科技" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "nope" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "忽略" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows).toHaveLength(0);
  });

  it("parses link column", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "链接" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "科学" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2025" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "发现" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "https://example.com" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows[0]).toMatchObject({ category: "科学", date: "2025", title: "发现", link: "https://example.com" });
  });

  it("converts DOI to URL", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "doi" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "科学" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2022" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "论文" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "10.1234/test.567" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows[0]).toMatchObject({ category: "科学", date: "2022", title: "论文", link: "https://doi.org/10.1234/test.567" });
  });
});

  it("parses nodeRef columns", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "页码" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "节点" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方法" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2023" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "实验A" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "node-abc-123" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "方法",
      date: "2023",
      title: "实验A",
      nodeRef: { pageIndex: 2, nodeId: "node-abc-123" },
    });
  });

  it("skips nodeRef when page is not a number", () => {
    const node = makeTextNode({
      type: "doc",
      content: [{
        type: "table",
        rows: [
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方向" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "年份" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "标题" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "页码" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "节点" }] }] },
          ]},
          { type: "tableRow", cells: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "方法" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2023" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "实验B" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "node-xyz" }] }] },
          ]},
        ],
      }],
    });
    const rows = parseTableToTimelineRows(node);
    expect(rows).toHaveLength(1);
    expect(rows[0].nodeRef).toBeUndefined();
  });
