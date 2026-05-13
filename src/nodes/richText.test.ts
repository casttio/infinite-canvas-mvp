import { describe, expect, it } from "vitest";
import { richTextDocToHtml } from "./richText";

describe("rich text links", () => {
  it("renders and parses external links", () => {
    const html = richTextDocToHtml({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "OpenAI",
          marks: ["link"],
          href: "https://openai.com",
        }],
      }],
    });

    expect(html).toContain('class="rich-text-link"');
    expect(html).toContain('href="https://openai.com"');

    expect(html).toContain('data-href="https://openai.com"');
  });

  it("renders and parses internal node links", () => {
    const html = richTextDocToHtml({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Target",
          nodeLink: { pageIndex: 2, nodeId: "node-1", label: "Node 1" },
        }],
      }],
    });

    expect(html).toContain('data-node-link-page="2"');
    expect(html).toContain('data-node-link-id="node-1"');

    expect(html).toContain('data-node-link-label="Node 1"');
  });
});

describe("rich text block styles", () => {
  it("renders visual heading styles on paragraph blocks", () => {
    const html = richTextDocToHtml({
      type: "doc",
      content: [{
        type: "paragraph",
        blockTag: "h3",
        content: [{
          type: "text",
          text: "Title",
          fontSize: "6px",
          lineHeight: "1.3",
        }],
      }],
    });

    expect(html).toContain('<p data-font-size="6px" data-line-height="1.3" style="font-size: 6px; line-height: 1.3;">');
    expect(html).not.toContain("<h3");
    expect(html).not.toContain("data-block-tag");
  });
});

describe("rich text attachments", () => {
  it("renders managed attachments as inline attachment cards", () => {
    const html = richTextDocToHtml(
      {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "image", assetId: "asset_pdf" }],
        }],
      },
      {
        asset_pdf: {
          id: "asset_pdf",
          type: "pdf",
          storage: "managed",
          mimeType: "application/pdf",
          name: "paper.pdf",
          relativePath: "doc.attachments/paper.pdf",
        },
      },
    );

    expect(html).toContain('class="text-inline-attachment-card"');
    expect(html).toContain('data-asset-id="asset_pdf"');
    expect(html).toContain(">PDF<");
    expect(html).toContain("paper.pdf");
  });

  it("renders non-pdf managed files with extension badge", () => {
    const html = richTextDocToHtml(
      {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "image", assetId: "asset_zip" }],
        }],
      },
      {
        asset_zip: {
          id: "asset_zip",
          type: "file",
          storage: "managed",
          mimeType: "application/zip",
          name: "archive.zip",
          relativePath: "doc.attachments/archive.zip",
        },
      },
    );

    expect(html).toContain('class="text-inline-attachment-card"');
    expect(html).toContain(">ZIP<");
    expect(html).toContain("archive.zip");
  });
});
