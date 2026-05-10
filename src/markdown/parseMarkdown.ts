import type {
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextParagraph,
  RichTextTable,
  RichTextTableCell,
} from "../model/types";

const headingSizes = ["32px", "28px", "24px", "20px", "18px", "16px"];

const trimEscapedPipe = (value: string) => value.replaceAll("\\|", "|").trim();

const splitTableRow = (line: string) => {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "|") {
      cells.push(trimEscapedPipe(current));
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(trimEscapedPipe(current));
  return cells;
};

const isTableSeparator = (line: string) => {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
};

const isTableStart = (lines: string[], index: number) =>
  index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1]);

const textInline = (
  text: string,
  patch: Partial<Extract<RichTextInline, { type: "text" }>> = {},
): RichTextInline => ({
  type: "text",
  text,
  ...(patch.marks ? { marks: patch.marks } : {}),
  ...(patch.fontFamily ? { fontFamily: patch.fontFamily } : {}),
  ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
  ...(patch.color ? { color: patch.color } : {}),
  ...(patch.highlightColor ? { highlightColor: patch.highlightColor } : {}),
});

const pushPlainText = (target: RichTextInline[], text: string) => {
  if (!text) {
    return;
  }

  target.push(textInline(text));
};

const parseInlineMarkdown = (input: string): RichTextInline[] => {
  const result: RichTextInline[] = [];
  let index = 0;

  while (index < input.length) {
    const rest = input.slice(index);
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      result.push(textInline(code[1], { fontFamily: "Consolas, monospace", color: "#334155" }));
      index += code[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      result.push(textInline(bold[1], { marks: ["bold"] }));
      index += bold[0].length;
      continue;
    }

    const italic = rest.match(/^\*([^*]+)\*/);
    if (italic) {
      result.push(textInline(italic[1], { marks: ["italic"] }));
      index += italic[0].length;
      continue;
    }

    const nextSpecial = rest.search(/(`|\*\*)/);
    if (nextSpecial > 0) {
      pushPlainText(result, rest.slice(0, nextSpecial));
      index += nextSpecial;
      continue;
    }

    pushPlainText(result, rest[0]);
    index += 1;
  }

  return result.length > 0 ? result : [{ type: "break" }];
};

const paragraph = (
  text: string,
  patch: Partial<Extract<RichTextInline, { type: "text" }>> = {},
): RichTextParagraph => {
  const content = parseInlineMarkdown(text).map((inline) => {
    if (inline.type !== "text") {
      return inline;
    }

    return {
      ...inline,
      marks: Array.from(new Set([...(inline.marks ?? []), ...(patch.marks ?? [])])),
      ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
      ...(patch.fontFamily ? { fontFamily: patch.fontFamily } : {}),
      ...(patch.color ? { color: patch.color } : {}),
    };
  });

  return {
    type: "paragraph",
    content,
  };
};

const tableCell = (value: string): RichTextTableCell => ({
  type: "tableCell",
  content: [paragraph(value)],
});

const parseTable = (lines: string[], startIndex: number): { table: RichTextTable; nextIndex: number } => {
  const rows: string[][] = [splitTableRow(lines[startIndex])];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim().length > 0) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalizedRows = rows.map((row) => ({
    type: "tableRow" as const,
    cells: Array.from({ length: columnCount }, (_, cellIndex) => tableCell(row[cellIndex] ?? "")),
  }));

  return {
    table: {
      type: "table",
      w: Math.max(480, columnCount * 180),
      colWidths: Array.from({ length: columnCount }, () => 180),
      rows: normalizedRows,
    },
    nextIndex: index,
  };
};

const flushParagraph = (blocks: RichTextBlock[], pending: string[]) => {
  const text = pending.join(" ").trim();
  pending.length = 0;

  if (text) {
    blocks.push(paragraph(text));
  }
};

export const parseMarkdownToRichTextDoc = (markdown: string): RichTextDoc => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichTextBlock[] = [];
  const pendingParagraph: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(blocks, pendingParagraph);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph(blocks, pendingParagraph);
      const parsed = parseTable(lines, index);
      blocks.push(parsed.table);
      index = parsed.nextIndex;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(blocks, pendingParagraph);
      blocks.push(paragraph(heading[2], {
        marks: ["bold"],
        fontSize: headingSizes[heading[1].length - 1],
        color: "#0f172a",
      }));
      index += 1;
      continue;
    }

    const unorderedList = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedList) {
      flushParagraph(blocks, pendingParagraph);
      blocks.push(paragraph(`• ${unorderedList[1]}`));
      index += 1;
      continue;
    }

    const orderedList = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedList) {
      flushParagraph(blocks, pendingParagraph);
      blocks.push(paragraph(`${blocks.length + 1}. ${orderedList[1]}`));
      index += 1;
      continue;
    }

    pendingParagraph.push(trimmed);
    index += 1;
  }

  flushParagraph(blocks, pendingParagraph);

  return {
    type: "doc",
    content: blocks.length > 0 ? blocks : [paragraph("")],
  };
};
