import { describe, it, expect } from "vitest";
import { parseMarkdownToRichTextDoc } from "./parseMarkdown";

// Helper: collect text from paragraph inlines
const paragraphTexts = (doc: { content: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> }): string => {
  const p = doc.content.find(b => b.type === "paragraph");
  if (!p || !p.content) return "";
  return p.content.map((i: any) => i.text ?? "").join("");
};

describe("parseMarkdownToRichTextDoc", () => {
  it("parses plain text into a single paragraph", () => {
    const doc = parseMarkdownToRichTextDoc("hello world");
    expect(doc.type).toBe("doc");
    expect(paragraphTexts(doc)).toBe("hello world");
  });

  it("parses headings", () => {
    const doc = parseMarkdownToRichTextDoc("# Title\n\n## Subtitle");
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].type).toBe("paragraph");
    expect(doc.content[1].type).toBe("paragraph");
  });

  it("parses bold and italic", () => {
    const doc = parseMarkdownToRichTextDoc("**bold** and *italic*");
    expect(paragraphTexts(doc)).toContain("bold");
    expect(paragraphTexts(doc)).toContain("italic");
    // first inline should be bold
    if (doc.content[0].type === "paragraph") {
      expect(doc.content[0].content[0]).toMatchObject({ type: "text", text: "bold", marks: ["bold"] });
    }
  });

  it("parses inline code", () => {
    const doc = parseMarkdownToRichTextDoc("use `code` here");
    if (doc.content[0].type === "paragraph") {
      const codeInline = doc.content[0].content.find(i => i.type === "text" && i.text === "code");
      expect(codeInline).toBeDefined();
    }
  });

  it("parses unordered list items", () => {
    const doc = parseMarkdownToRichTextDoc("- item1\n- item2");
    expect(doc.content).toHaveLength(2);
    // each item gets a bullet prefix as separate inline, then the text
    const texts = doc.content.map(b =>
      b.type === "paragraph" ? b.content.map((i: any) => i.text ?? "").join("") : ""
    );
    expect(texts[0]).toContain("item1");
    expect(texts[1]).toContain("item2");
  });

  it("parses ordered list items", () => {
    const doc = parseMarkdownToRichTextDoc("1. first\n2. second");
    expect(doc.content).toHaveLength(2);
    const texts = doc.content.map(b =>
      b.type === "paragraph" ? b.content.map((i: any) => i.text ?? "").join("") : ""
    );
    expect(texts[0]).toContain("first");
    expect(texts[1]).toContain("second");
  });

  it("parses tables", () => {
    const md = "| h1 | h2 |\n|---|---|\n| a | b |";
    const doc = parseMarkdownToRichTextDoc(md);
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe("table");
    if (doc.content[0].type === "table") {
      expect(doc.content[0].rows).toHaveLength(2);
    }
  });

  it("returns content for empty input", () => {
    const doc = parseMarkdownToRichTextDoc("");
    expect(doc.content.length).toBeGreaterThan(0);
  });

  it("parses multi-line text", () => {
    const doc = parseMarkdownToRichTextDoc("line one\nline two");
    expect(paragraphTexts(doc)).toBe("line one line two");
  });
});
