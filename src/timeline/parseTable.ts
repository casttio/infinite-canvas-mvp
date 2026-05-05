import type {
  RichTextBlock,
  RichTextInline,
  RichTextTable,
  RichTextTableCell,
  TextNode,
} from "../model/types";

export interface TimelineRow {
  category: string;
  date: string;           // YYYY or YYYY-MM
  title: string;
  summary?: string;
  kind?: 'paper' | 'product' | 'release' | 'policy' | 'benchmark' | 'event';
  org?: string;
  authors?: string;
  link?: string;
  doi?: string;
  arxiv?: string;
  tags?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
  addedAt?: string;       // ISO date
  source?: 'manual' | 'arxiv' | 'rss';
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
        date: firstRow.findIndex((header) => ["年份", "year", "date", "日期"].includes(header)),
        title: firstRow.findIndex((header) => ["标题", "title", "name"].includes(header)),
        summary: firstRow.findIndex((header) => ["摘要", "summary", "description", "描述"].includes(header)),
        kind: firstRow.findIndex((header) => ["类型", "kind", "type", "类别"].includes(header)),
        org: firstRow.findIndex((header) => ["机构", "org", "organization", "单位"].includes(header)),
        authors: firstRow.findIndex((header) => ["作者", "authors", "author"].includes(header)),
        link: firstRow.findIndex((header) => ["doi", "链接", "link", "url"].includes(header)),
        doi: firstRow.findIndex((header) => ["doi"].includes(header)),
        arxiv: firstRow.findIndex((header) => ["arxiv"].includes(header)),
        tags: firstRow.findIndex((header) => ["标签", "tags", "关键词", "keywords"].includes(header)),
        importance: firstRow.findIndex((header) => ["重要", "importance", "priority", "权重", "star"].includes(header)),
      }
    : {
        category: 0,
        date: 1,
        title: 2,
        summary: -1,
        kind: -1,
        org: -1,
        authors: -1,
        link: 3,
        doi: -1,
        arxiv: -1,
        tags: -1,
        importance: -1,
      };
  const rows = hasHeader ? matrix.slice(1) : matrix;

  return rows.flatMap((row) => {
    const rawDate = (row[headerIndexes.date] ?? "").trim();
    const year = readYear(rawDate);
    const category = (row[headerIndexes.category] ?? "").trim();
    const title = (row[headerIndexes.title] ?? "").trim();
    const summary = headerIndexes.summary >= 0 ? (row[headerIndexes.summary] ?? "").trim() : undefined;
    const kind = headerIndexes.kind >= 0 ? (row[headerIndexes.kind] ?? "").trim().toLowerCase() : undefined;
    const org = headerIndexes.org >= 0 ? (row[headerIndexes.org] ?? "").trim() : undefined;
    const authors = headerIndexes.authors >= 0 ? (row[headerIndexes.authors] ?? "").trim() : undefined;
    const link = headerIndexes.link >= 0 ? normalizeLink(row[headerIndexes.link] ?? "") : undefined;
    const doi = headerIndexes.doi >= 0 ? normalizeLink(row[headerIndexes.doi] ?? "") : undefined;
    const arxiv = headerIndexes.arxiv >= 0 ? normalizeLink(row[headerIndexes.arxiv] ?? "") : undefined;
    const tags = headerIndexes.tags >= 0
      ? (row[headerIndexes.tags] ?? "").split(/[,;、\s]+/).map((t) => t.trim()).filter(Boolean)
      : undefined;
    const importance = headerIndexes.importance >= 0
      ? (() => {
          const v = Number((row[headerIndexes.importance] ?? "").trim());
          return v >= 1 && v <= 5 ? (v as 1|2|3|4|5) : undefined;
        })()
      : undefined;

    const date = rawDate.includes("-") ? rawDate : (year ? String(year) : "");
    if (!category || !title || !date) {
      return [];
    }

    const validKind = kind && ["paper","product","release","policy","benchmark","event"].includes(kind)
      ? kind as TimelineRow["kind"]
      : undefined;

    const rowOut: TimelineRow = {
      category,
      date,
      title,
    };
    if (summary) rowOut.summary = summary;
    if (validKind) rowOut.kind = validKind;
    if (org) rowOut.org = org;
    if (authors) rowOut.authors = authors;
    if (link) rowOut.link = link;
    if (doi) rowOut.doi = doi;
    if (arxiv) rowOut.arxiv = arxiv;
    if (tags && tags.length > 0) rowOut.tags = tags;
    if (importance) rowOut.importance = importance;

    return [rowOut];
  });
};
