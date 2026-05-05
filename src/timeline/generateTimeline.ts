import type { TimelineRow } from "./parseTable";

export interface TimelineOptions {
  title?: string;
  width?: number;
  laneHeight?: number;
  palette?: string[];
}

const DEFAULT_WIDTH = 1800;
const DEFAULT_LANE_HEIGHT = 190;
const HEADER_HEIGHT = 140;
const FOOTER_HEIGHT = 72;
const LEFT_GUTTER = 230;
const RIGHT_GUTTER = 120;
const CARD_WIDTH = 250;
const CARD_HEIGHT = 74;
const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#4f46e5", "#be123c"];

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll("\"", "&quot;");

const uniqueInOrder = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
};

const wrapText = (value: string, maxChars = 22) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  words.forEach((word) => {
    const current = lines[lines.length - 1] ?? "";
    if (!current || `${current} ${word}`.length > maxChars) {
      lines.push(word);
      return;
    }
    lines[lines.length - 1] = `${current} ${word}`;
  });

  if (lines.length <= 1 && value.length > maxChars) {
    return value.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [value];
  }

  return lines.slice(0, 3);
};

export const getTimelineSize = (rows: TimelineRow[], options: TimelineOptions = {}) => {
  const categories = uniqueInOrder(rows.map((row) => row.category));
  const width = options.width ?? DEFAULT_WIDTH;
  const laneHeight = options.laneHeight ?? DEFAULT_LANE_HEIGHT;

  return {
    width,
    height: HEADER_HEIGHT + Math.max(1, categories.length) * laneHeight + FOOTER_HEIGHT,
    laneHeight,
    categories,
  };
};

export const generateTimelineSvg = (rows: TimelineRow[], options: TimelineOptions = {}): string => {
  const extractYear = (date: string) => {
    const m = date.match(/^(\d{4})/);
    return m ? Number(m[1]) : NaN;
  };

  const normalizedRows = rows
    .filter((row) => row.category.trim() && Number.isFinite(extractYear(row.date)) && row.title.trim())
    .map((row) => ({
      ...row,
      category: row.category.trim(),
      title: row.title.trim(),
    }))
    .sort((left, right) => extractYear(left.date) - extractYear(right.date) || left.category.localeCompare(right.category));
  if (normalizedRows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width ?? DEFAULT_WIDTH}" height="320" viewBox="0 0 ${options.width ?? DEFAULT_WIDTH} 320" role="img" aria-label="空时间线"><rect width="100%" height="100%" fill="#ffffff" /><text x="40" y="72" font-size="28" font-weight="800" fill="#0f172a">没有可用的时间线数据</text></svg>`;
  }
  const size = getTimelineSize(normalizedRows, options);
  const palette = options.palette ?? PALETTE;
  const years = normalizedRows.map((row) => extractYear(row.date));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearSpan = Math.max(1, maxYear - minYear);
  const plotLeft = LEFT_GUTTER;
  const plotRight = size.width - RIGHT_GUTTER;
  const plotWidth = plotRight - plotLeft;
  const title = options.title?.trim() || "时间线";
  const yearTicks = Array.from(
    { length: maxYear - minYear + 1 },
    (_, index) => minYear + index,
  );
  const laneUsage = new Map<string, number>();

  const yearToX = (year: number) => plotLeft + ((year - minYear) / yearSpan) * plotWidth;

  const laneY = (category: string) => HEADER_HEIGHT + size.categories.indexOf(category) * size.laneHeight;

  const laneBlocks = size.categories.map((category, index) => {
    const y = laneY(category);
    const color = palette[index % palette.length];
    return `<g>
      <rect x="0" y="${y}" width="${size.width}" height="${size.laneHeight}" fill="${index % 2 === 0 ? "#f8fafc" : "#ffffff"}" />
      <rect x="28" y="${y + 22}" width="8" height="${size.laneHeight - 44}" rx="4" fill="${color}" opacity="0.82" />
      <text x="52" y="${y + 58}" class="lane-title">${escapeHtml(category)}</text>
      <line x1="${plotLeft}" y1="${y + size.laneHeight / 2}" x2="${plotRight}" y2="${y + size.laneHeight / 2}" stroke="${color}" stroke-width="2" opacity="0.25" />
    </g>`;
  }).join("\n");

  const tickBlocks = yearTicks.map((year) => {
    const x = yearToX(year);
    return `<g>
      <line x1="${x}" y1="${HEADER_HEIGHT - 24}" x2="${x}" y2="${size.height - FOOTER_HEIGHT + 10}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="4 8" />
      <text x="${x}" y="${HEADER_HEIGHT - 42}" class="year-label" text-anchor="middle">${year}</text>
    </g>`;
  }).join("\n");

  const itemBlocks = normalizedRows.map((row, index) => {
    const color = palette[size.categories.indexOf(row.category) % palette.length];
    const usageKey = `${row.category}:${extractYear(row.date)}`;
    const used = laneUsage.get(usageKey) ?? 0;
    laneUsage.set(usageKey, used + 1);
    const laneMidY = laneY(row.category) + size.laneHeight / 2;
    const direction = used % 2 === 0 ? -1 : 1;
    const offsetStep = Math.floor(used / 2) * 22;
    const cardY = laneMidY + direction * (54 + offsetStep) - CARD_HEIGHT / 2;
    const x = yearToX(extractYear(row.date));
    const cardX = Math.max(plotLeft, Math.min(plotRight - CARD_WIDTH, x - CARD_WIDTH / 2));
    const textLines = wrapText(row.title);
    const titleText = textLines.map((line, lineIndex) =>
      `<tspan x="${cardX + 18}" dy="${lineIndex === 0 ? 0 : 19}">${escapeHtml(line)}</tspan>`,
    ).join("");
    const card = `<g class="timeline-item">
      <line x1="${x}" y1="${laneMidY}" x2="${x}" y2="${cardY + CARD_HEIGHT / 2}" stroke="${color}" stroke-width="2" opacity="0.55" />
      <circle cx="${x}" cy="${laneMidY}" r="8" fill="${color}" stroke="#ffffff" stroke-width="3" />
      <rect x="${cardX}" y="${cardY}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="12" fill="#ffffff" stroke="${color}" stroke-width="2" />
      <text x="${cardX + 18}" y="${cardY + 28}" class="item-title">${titleText}</text>
      <text x="${cardX + CARD_WIDTH - 16}" y="${cardY + CARD_HEIGHT - 15}" class="item-year" text-anchor="end">${row.date}</text>
    </g>`;

    if (!row.link) {
      return card;
    }

    return `<a href="${escapeAttribute(row.link)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttribute(row.title)}">${card}</a>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="${escapeAttribute(title)}">
    <rect width="${size.width}" height="${size.height}" fill="#ffffff" />
    <text x="40" y="58" class="chart-title">${escapeHtml(title)}</text>
    <text x="42" y="92" class="chart-subtitle">${minYear} - ${maxYear} · ${normalizedRows.length} 项 · ${size.categories.length} 个方向</text>
    ${tickBlocks}
    ${laneBlocks}
    ${itemBlocks}
  </svg>`;
};

export const generateTimelineHtml = (rows: TimelineRow[], options: TimelineOptions = {}) => {
  const svg = generateTimelineSvg(rows, options);
  const size = getTimelineSize(rows, options);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title?.trim() || "时间线")}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; min-height: 100%; background: #ffffff; font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif; color: #0f172a; }
    body { overflow: auto; }
    svg { display: block; width: ${size.width}px; height: ${size.height}px; }
    a { cursor: pointer; text-decoration: none; }
    .chart-title { font-size: 34px; font-weight: 800; fill: #0f172a; }
    .chart-subtitle { font-size: 16px; fill: #64748b; }
    .year-label { font-size: 14px; font-weight: 700; fill: #475569; }
    .lane-title { font-size: 21px; font-weight: 800; fill: #0f172a; }
    .item-title { font-size: 17px; font-weight: 700; fill: #0f172a; }
    .item-year { font-size: 13px; font-weight: 800; fill: #64748b; }
    .timeline-item:hover rect { filter: drop-shadow(0 8px 16px rgba(15, 23, 42, 0.18)); }
  </style>
</head>
<body>
  ${svg}
</body>
</html>`;
};
