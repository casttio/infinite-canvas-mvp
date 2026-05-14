import { describe, expect, it } from "vitest";
import { clearEmptyParagraphs } from "./textCleanup";

describe("clearEmptyParagraphs", () => {
  it("removes empty top-level paragraphs", () => {
    const result = clearEmptyParagraphs({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "" }] },
        { type: "paragraph", content: [{ type: "text", text: "保留" }] },
      ],
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("paragraph");
  });

  it("removes empty paragraphs inside tables", () => {
    const result = clearEmptyParagraphs({
      type: "doc",
      content: [{
        type: "table",
        rows: [{
          type: "tableRow",
          cells: [{
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "" }] },
              { type: "paragraph", content: [{ type: "text", text: "表格内容" }] },
            ],
          }],
        }],
      }],
    });

    const table = result.content[0];
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.rows[0].cells[0].content).toHaveLength(1);
    }
  });

  it("removes paragraphs that only contain invisible whitespace", () => {
    const result = clearEmptyParagraphs({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "\u200B\u00A0\uFEFF" }] },
        { type: "paragraph", content: [{ type: "text", text: "Rosetta 是一个用于蛋白质结构预测与对接的综合性计算平台。" }] },
        { type: "paragraph", content: [{ type: "text", text: "由 David Baker 实验室及 RosettaCommons 社区开发。" }] },
      ],
    });

    expect(result.content).toHaveLength(2);
  });

  it("keeps paragraphs that only contain images", () => {
    const result = clearEmptyParagraphs({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", assetId: "img-1" }] },
      ],
    });

    expect(result.content).toHaveLength(1);
  });

  it("collapses empty lines inside a paragraph", () => {
    const result = clearEmptyParagraphs({
      type: "doc",
      content: [{
        type: "paragraph",
        blockTag: "ul",
        content: [
          { type: "text", text: "\n\nRosetta 是一个用于蛋白质结构预测与对接的综合性计算平台。\n\n\n由 " },
          { type: "text", text: "David Baker 实验室", marks: ["bold"] },
          { type: "text", text: " 及 RosettaCommons 社区开发。\n\n\n能做蛋白设计等。\n\n" },
        ],
      }],
    });

    expect(result.content).toHaveLength(1);
    const paragraph = result.content[0];
    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type === "paragraph") {
      expect(paragraph.content).toEqual([
        { type: "text", text: "Rosetta 是一个用于蛋白质结构预测与对接的综合性计算平台。" },
        { type: "break" },
        { type: "text", text: "由 " },
        { type: "text", text: "David Baker 实验室", marks: ["bold"] },
        { type: "text", text: " 及 RosettaCommons 社区开发。" },
        { type: "break" },
        { type: "text", text: "能做蛋白设计等。" },
      ]);
    }
  });
});
