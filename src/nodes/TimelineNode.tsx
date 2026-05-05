import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeHandle } from "../editor/resize";
import type { TimelineNode as TimelineNodeType, TimelineNodeFields } from "../model/types";

type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;

type DensityMode = "compact" | "standard" | "detailed";

interface TimelineNodeProps {
  node: TimelineNodeType;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
  onEntriesChange?: (entries: TimelineNodeFields[]) => void;
}

const KIND_ICONS: Record<string, string> = {
  paper: "📄",
  product: "📦",
  release: "🚀",
  policy: "🏛",
  benchmark: "📊",
  event: "📅",
};

const KIND_ICON_DEFAULT = "📌";

const CATEGORY_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#9333ea",
  "#ea580c", "#0891b2", "#4f46e5", "#be123c",
];

const getCategoryColor = (category: string, paletteIndex: number) => {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash) + category.charCodeAt(i);
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
};

const isRecent = (addedAt?: string) => {
  if (!addedAt) return false;
  const added = new Date(addedAt).getTime();
  return Date.now() - added < 30 * 24 * 60 * 60 * 1000;
};

const formatDate = (date: string) => {
  if (/^\d{4}$/.test(date)) return date;
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split("-");
    return `${y}年${parseInt(m)}月`;
  }
  return date;
};

const EntryPopover = ({ entry, x, y }: { entry: TimelineNodeFields; x: number; y: number }) => (
  <div
    className="timeline-popover"
    style={{
      position: "fixed",
      left: Math.min(x, window.innerWidth - 320),
      top: Math.min(y, window.innerHeight - 260),
      zIndex: 9999,
    }}
  >
    <div className="timeline-popover-header">
      <span className="timeline-popover-kind">{KIND_ICONS[entry.kind ?? ""] ?? KIND_ICON_DEFAULT}</span>
      <strong>{entry.title}</strong>
    </div>
    {entry.summary && <p className="timeline-popover-summary">{entry.summary}</p>}
    <div className="timeline-popover-meta">
      {entry.org && <span>🏢 {entry.org}</span>}
      {entry.authors && <span>✍️ {entry.authors}</span>}
      {entry.tags && entry.tags.length > 0 && (
        <div className="timeline-popover-tags">
          {entry.tags.map((tag) => (
            <span key={tag} className="timeline-popover-tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
    <div className="timeline-popover-links">
      {entry.doi && <a href={entry.doi} target="_blank" rel="noreferrer">DOI</a>}
      {entry.arxiv && <a href={entry.arxiv} target="_blank" rel="noreferrer">arXiv</a>}
      {entry.link && <a href={entry.link} target="_blank" rel="noreferrer">链接</a>}
    </div>
  </div>
);

const EntryCard = ({
  entry,
  density,
  categoryColor,
}: {
  entry: TimelineNodeFields;
  density: DensityMode;
  categoryColor: string;
}) => {
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopover({ x: rect.right + 8, y: rect.top });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setPopover(null);
  }, []);

  const recent = isRecent(entry.addedAt);
  const imp = entry.importance ?? 3;
  isRecent(entry.addedAt);

  return (
    <>
      <div
        ref={ref}
        className={`timeline-entry-card ${density === "compact" ? "compact" : ""} ${imp >= 5 ? "milestone" : ""}`}
        style={{
          borderLeftColor: categoryColor,
          fontSize: imp >= 5 ? "1.05em" : undefined,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="timeline-entry-main">
          {density !== "compact" && (
            <span className="timeline-entry-icon">
              {KIND_ICONS[entry.kind ?? ""] ?? KIND_ICON_DEFAULT}
            </span>
          )}
          <div className="timeline-entry-text">
            <div className="timeline-entry-title-row">
              <span className="timeline-entry-date">{formatDate(entry.date)}</span>
              <span className="timeline-entry-title">{entry.title}</span>
            </div>
            {density === "detailed" && entry.summary && (
              <div className="timeline-entry-summary">{entry.summary}</div>
            )}
            {(density === "standard" || density === "detailed") && entry.org && (
              <div className="timeline-entry-org">{entry.org}</div>
            )}
            {density === "detailed" && entry.tags && entry.tags.length > 0 && (
              <div className="timeline-entry-tags">
                {entry.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="timeline-entry-tag">{tag}</span>
                ))}
                {entry.tags.length > 4 && <span className="timeline-entry-tag">+{entry.tags.length - 4}</span>}
              </div>
            )}
          </div>
        </div>
        {recent && <span className="timeline-entry-dot" title="最近添加" />}
      </div>
      {popover && density !== "detailed" && (
        <EntryPopover entry={entry} x={popover.x} y={popover.y} />
      )}
    </>
  );
};

export const TimelineNode = ({
  node,
  selected,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onEntriesChange,
}: TimelineNodeProps) => {
  const [density, setDensity] = useState<DensityMode>("standard");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<string | null>(null);
  const [filterImportance, setFilterImportance] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const categories = useMemo(() => {
    const set = new Set(node.entries.map((e) => e.category));
    return Array.from(set);
  }, [node.entries]);

  const filteredEntries = useMemo(() => {
    let result = node.entries;
    if (filterCategory) {
      result = result.filter((e) => e.category === filterCategory);
    }
    if (filterKind) {
      result = result.filter((e) => e.kind === filterKind);
    }
    if (filterImportance) {
      result = result.filter((e) => (e.importance ?? 3) >= filterImportance);
    }
    return result;
  }, [node.entries, filterCategory, filterKind, filterImportance]);

  // Group by date for display
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimelineNodeFields[]>();
    for (const entry of filteredEntries) {
      const key = entry.date.length >= 7 ? entry.date.slice(0, 7) : entry.date;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEntries]);

  return (
    <div
      className={`canvas-node timeline-node ${selected ? "selected" : ""}`}
      data-node-id={node.id}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.w,
        height: node.h,
        zIndex: node.z,
      }}
      onPointerDown={onPointerDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {/* Toolbar */}
      <div className="timeline-node-toolbar">
        <div className="timeline-density-controls">
          {(["compact", "standard", "detailed"] as DensityMode[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`timeline-density-btn ${density === d ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setDensity(d); }}
              title={d === "compact" ? "紧凑" : d === "standard" ? "标准" : "详细"}
            >
              {d === "compact" ? "紧凑" : d === "standard" ? "标准" : "详细"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="timeline-filter-btn"
          onClick={(e) => { e.stopPropagation(); setShowFilters(!showFilters); }}
        >
          {showFilters ? "收起过滤" : "过滤"}
        </button>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="timeline-filter-bar" onClick={(e) => e.stopPropagation()}>
          <select
            value={filterCategory ?? ""}
            onChange={(e) => setFilterCategory(e.target.value || null)}
            className="timeline-filter-select"
          >
            <option value="">全部方向</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select
            value={filterKind ?? ""}
            onChange={(e) => setFilterKind(e.target.value || null)}
            className="timeline-filter-select"
          >
            <option value="">全部类型</option>
            <option value="paper">📄 论文</option>
            <option value="product">📦 产品</option>
            <option value="release">🚀 发布</option>
            <option value="policy">🏛 政策</option>
            <option value="benchmark">📊 基准</option>
            <option value="event">📅 事件</option>
          </select>
          <select
            value={filterImportance ?? ""}
            onChange={(e) => setFilterImportance(e.target.value ? Number(e.target.value) : null)}
            className="timeline-filter-select"
          >
            <option value="">全部重要度</option>
            <option value="1">≥ 1</option>
            <option value="3">≥ 3</option>
            <option value="4">≥ 4</option>
            <option value="5">★★★★★</option>
          </select>
        </div>
      )}

      {/* Entries */}
      <div className="timeline-entries-scroll">
        {groupedEntries.length === 0 && (
          <div className="timeline-empty">无匹配条目</div>
        )}
        {groupedEntries.map(([groupKey, entries]) => (
          <div key={groupKey} className="timeline-date-group">
            <div className="timeline-date-header">{groupKey}</div>
            {entries.map((entry, i) => (
              <EntryCard
                key={`${entry.title}-${i}`}
                entry={entry}
                density={density}
                categoryColor={getCategoryColor(entry.category, categories.indexOf(entry.category))}
              />
            ))}
          </div>
        ))}
      </div>

      {selected ? (
        <>
          <button
            type="button"
            className="resize-edge resize-edge-left"
            onPointerDown={(event) => onResizePointerDown(event, "left")}
            aria-label="调整左边界"
          />
          <button
            type="button"
            className="resize-edge resize-edge-right"
            onPointerDown={(event) => onResizePointerDown(event, "right")}
            aria-label="调整右边界"
          />
          <button
            type="button"
            className="resize-handle"
            onPointerDown={(event) => onResizePointerDown(event, "bottom-right")}
            aria-label="调整大小"
          />
        </>
      ) : null}
    </div>
  );
};
