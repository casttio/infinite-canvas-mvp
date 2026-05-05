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
  imageRefs?: { assetId: string; w?: number; h?: number }[];
  nodeRef?: {
    pageIndex: number;
    nodeId: string;
    label?: string;
  };
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

const cellImages = (cell: RichTextTableCell): { assetId: string; w?: number; h?: number }[] => {
  const refs: { assetId: string; w?: number; h?: number }[] = [];
  for (const block of cell.content) {
    if (block.type === "paragraph") {
      for (const inline of block.content) {
        if (inline.type === "image" && inline.assetId) {
          refs.push({ assetId: inline.assetId, w: inline.w, h: inline.h });
        }
      }
    }
  }
  return refs;
};

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

  // Build parallel text and image matrices from original table cells
  const cellData = table.rows.map((row) => ({
    texts: row.cells.map(cellText),
    images: row.cells.map(cellImages),
  })).filter((row) => row.texts.some((cell) => cell.length > 0));

  if (cellData.length === 0) {
    return [];
  }

  const firstRow = cellData[0].texts.map(normalizeHeader);
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
        images: firstRow.findIndex((header) => ["图片", "image", "img", "icon"].includes(header)),
        nodeRefPage: firstRow.findIndex((header) => ["页码", "page", "pageindex"].includes(header)),
        nodeRefId: firstRow.findIndex((header) => ["节点id", "nodeid", "节点"].includes(header)),
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
        images: -1,
        arxiv: -1,
        nodeRefPage: -1,
        nodeRefId: -1,
        tags: -1,
        importance: -1,
      };
  const rows = hasHeader ? cellData.slice(1) : cellData;

  return rows.flatMap((row) => {
    const texts = row.texts;
    const images = row.images;
    const rawDate = (texts[headerIndexes.date] ?? "").trim();
    const year = readYear(rawDate);
    const category = (texts[headerIndexes.category] ?? "").trim();
    const title = (texts[headerIndexes.title] ?? "").trim();
    const summary = headerIndexes.summary >= 0 ? (texts[headerIndexes.summary] ?? "").trim() : undefined;
    const kind = headerIndexes.kind >= 0 ? (texts[headerIndexes.kind] ?? "").trim().toLowerCase() : undefined;
    const org = headerIndexes.org >= 0 ? (texts[headerIndexes.org] ?? "").trim() : undefined;
    const authors = headerIndexes.authors >= 0 ? (texts[headerIndexes.authors] ?? "").trim() : undefined;
    const link = headerIndexes.link >= 0 ? normalizeLink(texts[headerIndexes.link] ?? "") : undefined;
    const doi = headerIndexes.doi >= 0 ? normalizeLink(texts[headerIndexes.doi] ?? "") : undefined;
    const arxiv = headerIndexes.arxiv >= 0 ? normalizeLink(texts[headerIndexes.arxiv] ?? "") : undefined;
    const tags = headerIndexes.tags >= 0
      ? (texts[headerIndexes.tags] ?? "").split(/[,;、\s]+/).map((t) => t.trim()).filter(Boolean)
      : undefined;
    const importance = headerIndexes.importance >= 0
      ? (() => {
          const v = Number((texts[headerIndexes.importance] ?? "").trim());
          return v >= 1 && v <= 5 ? (v as 1|2|3|4|5) : undefined;
        })()
      : undefined;

    // Collect images from all cells, plus dedicated images column if present
    const allImageRefs = images.flat();
    if (headerIndexes.images >= 0) {
      allImageRefs.push(...(images[headerIndexes.images] ?? []));
    }
    const dedupedImageRefs = allImageRefs.filter(
      (ref, idx, arr) => arr.findIndex((r) => r.assetId === ref.assetId) === idx
    );

    const nodeRef = headerIndexes.nodeRefPage >= 0 && headerIndexes.nodeRefId >= 0
      ? (() => {
          const pageVal = (texts[headerIndexes.nodeRefPage] ?? "").trim();
          const nodeIdVal = (texts[headerIndexes.nodeRefId] ?? "").trim();
          const pageNum = Number(pageVal);
          if (pageVal && nodeIdVal && Number.isInteger(pageNum)) {
            return { pageIndex: pageNum, nodeId: nodeIdVal };
          }
          return undefined;
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
    if (dedupedImageRefs.length > 0) rowOut.imageRefs = dedupedImageRefs;
    if (nodeRef) rowOut.nodeRef = nodeRef;

    return [rowOut];
  });
};

export const createTimelineExampleTableHtml = (): string => {
  return `<div class="text-block text-block-table-wrap" data-block-kind="table"><table class="text-block-table"><thead>
<tr>
<th>方向</th>
<th>年份</th>
<th>标题</th>
<th>摘要</th>
<th>链接</th>
<th>类型</th>
<th>机构</th>
</tr>
</thead>
<tbody>
<tr>
<td>AI</td>
<td>2024</td>
<td>GPT-5 发布</td>
<td>新一代大语言模型，推理能力大幅提升</td>
<td>https://example.com/gpt5</td>
<td>release</td>
<td>OpenAI</td>
</tr>
<tr>
<td>AI</td>
<td>2024</td>
<td>Gemini 2.0</td>
<td>多模态模型，支持视频理解</td>
<td>https://example.com/gemini2</td>
<td>release</td>
<td>Google</td>
</tr>
<tr>
<td>硬件</td>
<td>2024</td>
<td>Blackwell GPU</td>
<td>NVIDIA 新一代架构，AI 训练速度翻倍</td>
<td>https://example.com/blackwell</td>
<td>product</td>
<td>NVIDIA</td>
</tr>
<tr>
<td>AI</td>
<td>2023</td>
<td>LLaMA 2 开源</td>
<td>Meta 开源大语言模型</td>
<td>https://example.com/llama2</td>
<td>release</td>
<td>Meta</td>
</tr>
<tr>
<td>政策</td>
<td>2023</td>
<td>AI 安全峰会</td>
<td>各国签署 AI 安全协议</td>
<td>https://example.com/ai-safety</td>
<td>policy</td>
<td>UK Gov</td>
</tr>
</tbody></table></div>`;
};
