import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeHandle } from "../editor/resize";
import type { AssetMap } from "../model/types";
import type { TimelineNode as TimelineNodeType, TimelineNodeFields } from "../model/types";

type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;

type EntryDensityMode = "compact" | "detailed";
type DensityMode = EntryDensityMode | "auto";

interface TimelineNodeProps {
  node: TimelineNodeType;
  assets: AssetMap;
  selected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
  onHeightChange?: (h: number) => void;
  onEntriesChange?: (entries: TimelineNodeFields[]) => void;
  onNavigateTo?: (pageIndex: number, nodeId: string) => void;
}

const CATEGORY_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#9333ea",
  "#ea580c", "#0891b2", "#4f46e5", "#be123c",
];

const getCategoryColor = (category: string) => {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash << 5) - hash) + category.charCodeAt(i);
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
};

const formatDate = (date: string) => {
  if (/^\d{4}$/.test(date)) return date;
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split("-");
    return `${y}年${parseInt(m)}月`;
  }
  return date;
};

const formatGroupDate = (date: string) => formatDate(date);

const formatEntryDate = (date: string, groupKey: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && groupKey === date.slice(0, 7)) {
    return `${parseInt(date.slice(8, 10))}日`;
  }
  return null;
};

const compareTimelineDateDesc = (left: string, right: string) =>
  right.localeCompare(left);

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
      <strong>{entry.title}</strong>
    </div>
    {entry.summary && <p className="timeline-popover-summary">{entry.summary}</p>}
    <div className="timeline-popover-meta">
      {entry.org && <span>{entry.org}</span>}
      {entry.authors && <span>{entry.authors}</span>}
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
  groupKey,
  density,
  categoryColor,
  onNavigateTo,
}: {
  entry: TimelineNodeFields;
  groupKey: string;
  density: EntryDensityMode;
  categoryColor: string;
  onNavigateTo?: (pageIndex: number, nodeId: string) => void;
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

  const handleNavigate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (entry.nodeRef && onNavigateTo) {
      onNavigateTo(entry.nodeRef.pageIndex, entry.nodeRef.nodeId);
    }
  }, [entry.nodeRef, onNavigateTo]);

  const imp = entry.importance ?? 3;
  const entryDate = formatEntryDate(entry.date, groupKey);

  return (
    <div
      ref={ref}
      className={`timeline-entry-card ${density === "compact" ? "compact" : ""} ${imp >= 5 ? "milestone" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="timeline-entry-main">
        <div className="timeline-entry-text">
          <div className="timeline-entry-title-row">
            {entryDate && <span className="timeline-entry-date">{entryDate}</span>}
            <span className="timeline-entry-title">{entry.title}</span>
            {entry.nodeRef && onNavigateTo && (
              <button
                type="button"
                className="timeline-entry-nav"
                onClick={handleNavigate}
                title="跳转到关联节点"
              >
                👁
              </button>
            )}
          </div>
          {density === "detailed" && entry.summary && (
            <div className="timeline-entry-summary">{entry.summary}</div>
          )}
          {(density === "detailed") && entry.org && (
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
      {popover && density !== "detailed" && (
        <EntryPopover entry={entry} x={popover.x} y={popover.y} />
      )}
    </div>
  );
};

export const TimelineNode = ({
  node,
  assets,
  selected,
  onSelect,
  onPointerDown,
  onResizePointerDown,
  onHeightChange,
  onEntriesChange,
  onNavigateTo,
}: TimelineNodeProps) => {
  const [density, setDensity] = useState<DensityMode>("auto");
  const nodeRef = useRef<HTMLDivElement>(null);
  const lastMeasuredHRef = useRef(0);

  const category = node.entries[0]?.category ?? "";
  const categoryColor = getCategoryColor(category);

  const getEffectiveDensity = useCallback((entry: TimelineNodeFields): EntryDensityMode => {
    if (density !== "auto") return density;
    const imp = entry.importance ?? 3;
    if (imp >= 5) return "detailed";
    return "compact";
  }, [density]);

  // Group by date for display
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimelineNodeFields[]>();
    for (const entry of node.entries) {
      const key = entry.date.length >= 7 ? entry.date.slice(0, 7) : entry.date;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([key, entries]) => [
        key,
        [...entries].sort((left, right) => compareTimelineDateDesc(left.date, right.date)),
      ] as const)
      .sort(([a], [b]) => compareTimelineDateDesc(a, b));
  }, [node.entries]);

  // Auto-height: measure content and sync to DOM + data layer before paint
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    let contentH = 8;
    const scrollEl = el.querySelector(".timeline-entries-scroll");
    if (scrollEl) {
      contentH += scrollEl.scrollHeight;
    }
    const toolbar = el.querySelector(".timeline-node-toolbar") as HTMLElement | null;
    const toolbarH = toolbar?.offsetHeight ?? 0;
    const totalHeight = Math.max(60, toolbarH + contentH + 16);

    if (Math.abs(totalHeight - lastMeasuredHRef.current) > 2) {
      lastMeasuredHRef.current = totalHeight;
      el.style.height = totalHeight + "px";
      if (Math.abs(totalHeight - node.h) > 2) {
        onHeightChange?.(totalHeight);
      }
    }
  });

  return (
    <div
      ref={nodeRef}
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
      {/* Header with category name */}
      <div
        className="timeline-node-header"
        style={{ borderBottomColor: categoryColor, color: categoryColor }}
      >
        {category}
      </div>

      {/* Toolbar */}
      <div className="timeline-node-toolbar">
        <div className="timeline-density-controls">
          {(["compact", "detailed", "auto"] as DensityMode[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`timeline-density-btn ${density === d ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setDensity(d); }}
            >
              {d === "compact" ? "紧凑" : d === "detailed" ? "详细" : "自适应"}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="timeline-entries-scroll">
        {groupedEntries.length === 0 && (
          <div className="timeline-empty">无条目</div>
        )}
        {groupedEntries.map(([groupKey, entries]) => (
          <div key={groupKey} className="timeline-date-group">
            <div className="timeline-date-header">{formatGroupDate(groupKey)}</div>
            {entries.map((entry, i) => (
              <EntryCard
                key={`${entry.title}-${i}`}
                entry={entry}
                groupKey={groupKey}
                density={getEffectiveDensity(entry)}
                categoryColor={categoryColor}
                onNavigateTo={onNavigateTo}
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
