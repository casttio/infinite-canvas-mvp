import type {
  RichTextBlock,
  RichTextInline,
  RichTextTable,
  RichTextTableCell,
  TextNode,
} from "../model/types";

export interface TimelineRow {
  category: string;
  year: number;
  title: string;
  link?: string;
}

const inlineText = (inline: RichTextInline): string => {
  if (inline.type === "text") {
    return inline.text;
  }

  if (inline.type === "break") {
    return "\n";
  }

  return "";
};

const blockText = (block: RichTextBlock): string => {
  if (block.type === "paragraph") {
    return block.content.map(inlineText).join("");
  }

  return block.rows
    .map((row) => row.cells.map(cellText).join(" "))
    .join(" ");
};

const cellText = (cell: RichTextTableCell): string =>
  cell.content
    .map(blockText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeHeader = (value: string) => value.trim().toLowerCase();

const findFirstTable = (blocks: RichTextBlock[]): RichTextTable | null => {
  for (const block of blocks) {
    if (block.type === "table") {
      return block;
    }
  }

  return null;
};

const readYear = (value: string) => {
  const match = value.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
};

const normalizeLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^10\.\S+\/\S+$/i.test(trimmed)) {
    return `https://doi.org/${trimmed}`;
  }

  return trimmed;
};

export const parseTableToTimelineRows = (node: TextNode): TimelineRow[] => {
  const table = findFirstTable(node.content.content);
  if (!table) {
    return [];
  }

  const matrix = table.rows
    .map((row) => row.cells.map(cellText))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (matrix.length === 0) {
    return [];
  }

  const firstRow = matrix[0].map(normalizeHeader);
  const hasHeader = firstRow.some((header) => ["方向", "category", "lane", "泳道"].includes(header))
    && firstRow.some((header) => ["年份", "year", "date"].includes(header))
    && firstRow.some((header) => ["标题", "title", "name"].includes(header));

  const headerIndexes = hasHeader
    ? {
        category: firstRow.findIndex((header) => ["方向", "category", "lane", "泳道"].includes(header)),
        year: firstRow.findIndex((header) => ["年份", "year", "date"].includes(header)),
        title: firstRow.findIndex((header) => ["标题", "title", "name"].includes(header)),
        link: firstRow.findIndex((header) => ["doi", "链接", "link", "url"].includes(header)),
      }
    : {
        category: 0,
        year: 1,
        title: 2,
        link: 3,
      };
  const rows = hasHeader ? matrix.slice(1) : matrix;

  return rows.flatMap((row) => {
    const year = readYear(row[headerIndexes.year] ?? "");
    const category = (row[headerIndexes.category] ?? "").trim();
    const title = (row[headerIndexes.title] ?? "").trim();
    const link = headerIndexes.link >= 0 ? normalizeLink(row[headerIndexes.link] ?? "") : undefined;

    if (!category || !year || !title) {
      return [];
    }

    return [{ category, year, title, ...(link ? { link } : {}) }];
  });
};
