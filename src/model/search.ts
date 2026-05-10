import type { CanvasNode, RichTextBlock, RichTextDoc, TimelineNodeFields } from "./types";

export interface SearchResult {
  id: string;
  scope: "current-page" | "current-document" | "workspace";
  filePath?: string;
  fileName?: string;
  pageIndex: number;
  nodeId: string;
  nodeType: string;
  title: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

/** Extract all searchable text segments from a single rich-text block (recursive). */
const collectBlockTexts = (block: RichTextBlock): string[] => {
  if (block.type === "paragraph") {
    const text = block.content
      .map((inline) => {
        if (inline.type === "text") return inline.text;
        if (inline.type === "break") return "\n";
        return "";
      })
      .join("");
    return text.trim() ? [text] : [];
  }

  if (block.type === "table") {
    const texts: string[] = [];
    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const childBlock of cell.content) {
          texts.push(...collectBlockTexts(childBlock));
        }
      }
    }
    return texts;
  }

  return [];
};

/** Extract all searchable text from a RichTextDoc (paragraphs + nested tables). */
const collectRichTextDocTexts = (doc: RichTextDoc): string[] => {
  const texts: string[] = [];
  for (const block of doc.content) {
    texts.push(...collectBlockTexts(block));
  }
  return texts;
};

interface IndexedNode {
  nodeId: string;
  nodeType: string;
  pageIndex: number;
  title: string;
  texts: string[];
}

/** Build an array of {title, textSegments} for a single node. */
const indexNode = (node: CanvasNode): IndexedNode => {
  const base = { nodeId: node.id, nodeType: node.type, pageIndex: node.pageIndex ?? 0 };

  if (node.type === "text" && "content" in node) {
    const texts = collectRichTextDocTexts(node.content);
    const title = texts[0]?.slice(0, 60) || node.id;
    return { ...base, title, texts };
  }

  if (node.type === "shape" && "label" in node && node.label) {
    const texts = collectRichTextDocTexts(node.label);
    const title = texts[0]?.slice(0, 60) || node.id;
    return { ...base, title, texts };
  }

  if (node.type === "timeline") {
    const texts: string[] = [];
    for (const entry of node.entries) {
      if (entry.title) texts.push(entry.title);
      if (entry.summary) texts.push(entry.summary);
      if (entry.category) texts.push(entry.category);
      if (entry.tags) texts.push(...entry.tags);
      if (entry.authors) texts.push(entry.authors);
      if (entry.org) texts.push(entry.org);
    }
    const title = node.entries[0]?.category || node.entries[0]?.title || node.id;
    return { ...base, title, texts };
  }

  if (node.type === "image") {
    const name = node.id;
    return { ...base, title: name, texts: [name] };
  }

  return { ...base, title: node.id, texts: [] };
};

/** Find matches of `query` (case-insensitive) in a list of text segments. */
const findMatches = (
  texts: string[],
  query: string,
  nodeId: string,
  nodeType: string,
  pageIndex: number,
  title: string,
  scope: SearchResult["scope"],
  filePath?: string,
  fileName?: string,
): SearchResult[] => {
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];
  let idCounter = 0;

  for (const text of texts) {
    const lower = text.toLowerCase();
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(lowerQuery, pos);
      if (idx === -1) break;

      // Build snippet around match
      const snippetStart = Math.max(0, idx - 30);
      const snippetEnd = Math.min(text.length, idx + query.length + 30);
      const snippet = (snippetStart > 0 ? "…" : "") +
        text.slice(snippetStart, snippetEnd) +
        (snippetEnd < text.length ? "…" : "");

      results.push({
        id: `${nodeId}-${idCounter++}`,
        scope,
        filePath,
        fileName,
        pageIndex,
        nodeId,
        nodeType,
        title,
        snippet,
        matchStart: idx,
        matchEnd: idx + query.length,
      });

      pos = idx + 1;

      if (results.length >= 100) return results;
    }
  }

  return results;
};

/** Search within a list of nodes (current document or page). */
export const searchInNodes = (
  nodes: CanvasNode[],
  query: string,
  scope: "current-page" | "current-document",
  activePageIndex?: number,
): SearchResult[] => {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 1) return [];

  const results: SearchResult[] = [];

  for (const node of nodes) {
    if (scope === "current-page" && node.pageIndex !== activePageIndex) continue;

    const indexed = indexNode(node);
    const matches = findMatches(
      indexed.texts, trimmed, indexed.nodeId, indexed.nodeType,
      indexed.pageIndex, indexed.title, scope,
    );
    results.push(...matches);

    if (results.length >= 100) break;
  }

  return results;
};

/** Structure that represents pre-built search index for a workspace document. */
export interface DocumentSearchIndex {
  filePath: string;
  fileName: string;
  nodes: Array<{
    nodeId: string;
    nodeType: string;
    pageIndex: number;
    title: string;
    texts: string[];
  }>;
}
