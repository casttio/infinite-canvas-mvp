import type { RichTextBlock, RichTextDoc, RichTextInline, RichTextParagraph } from "./types";

const INVISIBLE_CHAR_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
const ALL_WHITESPACE_RE = /^[\s\u00A0]*$/;

type CleanupToken =
  | { type: "break" }
  | { type: "image"; inline: Extract<RichTextInline, { type: "image" }> }
  | {
    type: "text";
    inline: Extract<RichTextInline, { type: "text" }>;
    text: string;
    whitespaceOnly: boolean;
  };

const normalizeTextForCleanup = (value: string) =>
  value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(INVISIBLE_CHAR_RE, "")
    .replaceAll("\u00A0", " ");

const tokenizeParagraphContent = (content: RichTextInline[]): CleanupToken[] => {
  const tokens: CleanupToken[] = [];

  content.forEach((inline) => {
    if (inline.type === "break") {
      tokens.push({ type: "break" });
      return;
    }

    if (inline.type === "image") {
      tokens.push({ type: "image", inline });
      return;
    }

    const normalizedText = normalizeTextForCleanup(inline.text);
    const parts = normalizedText.split("\n");
    parts.forEach((part, index) => {
      tokens.push({
        type: "text",
        inline,
        text: part,
        whitespaceOnly: ALL_WHITESPACE_RE.test(part),
      });
      if (index < parts.length - 1) {
        tokens.push({ type: "break" });
      }
    });
  });

  return tokens;
};

const hasUpcomingContentBeforeBreak = (tokens: CleanupToken[], startIndex: number): boolean => {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "break") {
      return false;
    }
    if (token.type === "image") {
      return true;
    }
    if (!token.whitespaceOnly) {
      return true;
    }
  }
  return false;
};

const normalizeParagraphContent = (paragraph: RichTextParagraph): RichTextParagraph => {
  const tokens = tokenizeParagraphContent(paragraph.content);
  const nextContent: RichTextInline[] = [];
  let pendingBreak = false;
  let seenContent = false;

  tokens.forEach((token, index) => {
    if (token.type === "break") {
      if (seenContent) {
        pendingBreak = true;
      }
      return;
    }

    if (token.type === "image") {
      if (pendingBreak) {
        nextContent.push({ type: "break" });
        pendingBreak = false;
      }
      nextContent.push(token.inline);
      seenContent = true;
      return;
    }

    if (token.whitespaceOnly) {
      if (!pendingBreak && seenContent && hasUpcomingContentBeforeBreak(tokens, index + 1)) {
        nextContent.push({
          ...token.inline,
          text: " ",
        });
      }
      return;
    }

    if (pendingBreak) {
      nextContent.push({ type: "break" });
      pendingBreak = false;
    }
    nextContent.push({
      ...token.inline,
      text: token.text,
    });
    seenContent = true;
  });

  return {
    ...paragraph,
    content: nextContent,
  };
};

const isParagraphEmpty = (paragraph: RichTextParagraph): boolean =>
  !paragraph.content.some((inline) => {
    if (inline.type === "image") {
      return true;
    }
    if (inline.type === "text") {
      return !ALL_WHITESPACE_RE.test(inline.text);
    }
    return false;
  });

const cleanCellBlocks = (blocks: RichTextBlock[]): RichTextBlock[] =>
  blocks
    .map((block) => {
      if (block.type === "paragraph") {
        return normalizeParagraphContent(block);
      }

      if (block.type !== "table") {
        return block;
      }

      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: cleanCellBlocks(cell.content),
          })),
        })),
      };
    })
    .filter((block) => block.type === "table" || !isParagraphEmpty(block));

export const clearEmptyParagraphs = (doc: RichTextDoc): RichTextDoc => ({
  ...doc,
  content: cleanCellBlocks(doc.content),
});
