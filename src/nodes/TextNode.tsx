import { useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ResizeHandle } from "../editor/resize";
import type { AssetMap, TextNode as TextNodeType } from "../model/types";
import { createRichTextTableHtml, htmlToRichTextDoc, richTextDocToHtml, wrapRichTextTableHtml } from "./richText";

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export interface TextEditorCommand {
  type: "insert-table" | "insert-table-column" | "insert-table-column-left" | "delete-table-column" | "insert-image" | "append-text";
  nonce: number;
  placement?: "caret" | "end";
  text?: string;
  assetId?: string;
  name?: string;
  data?: string;
  w?: number;
  h?: number;
}

interface TextNodeProps {
  node: TextNodeType;
  assets: AssetMap;
  selected: boolean;
  editing: boolean;
  command: TextEditorCommand | null;
  onSelect: () => void;
  onBeginEdit: (point: { x: number; y: number }) => void;
  onCommit: (content: TextNodeType["content"]) => void;
  onDraftChange: (content: TextNodeType["content"]) => void;
  onPasteImage: (file: File) => Promise<{ assetId: string; name: string; data: string; w: number; h: number }>;
  onAutoResize: (height: number) => void;
  onAutoResizeWidth: (width: number) => void;
  onDragHandlePointerDown: (event: PointerLikeEvent) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
}

type EditorSelectionState =
  | { type: "none" }
  | {
      type: "cell-range";
      tableKey: string;
      startRow: number;
      endRow: number;
      startColumn: number;
      endColumn: number;
    }
  | {
      type: "block-range";
      startBlockIndex: number;
      endBlockIndex: number;
    };

type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;

const COLUMN_RESIZE_HIT_SLOP = 14;
const TABLE_RESIZE_HIT_SLOP = 18;
const NODE_RESIZE_HIT_SLOP = 14;
const TABLE_SELECTION_DRAG_THRESHOLD = 6;
const EMPTY_PARAGRAPH_HTML = `<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p><br /></p></div>`;

export const TextNode = ({
  node,
  assets,
  selected,
  editing,
  command,
  onSelect,
  onBeginEdit,
  onCommit,
  onDraftChange,
  onPasteImage,
  onAutoResize,
  onAutoResizeWidth,
  onDragHandlePointerDown,
  onResizePointerDown,
}: TextNodeProps) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draftHtmlRef = useRef(richTextDocToHtml(node.content, assets));
  const pendingCaretPointRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredColumnCellRef = useRef<HTMLTableCellElement | null>(null);
  const hoveredTableWrapRef = useRef<HTMLElement | null>(null);
  const activeTableCellRef = useRef<HTMLTableCellElement | null>(null);
  const suppressBlurCommitRef = useRef(false);
  const customClipboardRef = useRef<{ text: string; html: string } | null>(null);
  const pendingSelectionRef = useRef<{
    startBlockIndex: number;
    startTableKey: string | null;
    startRow: number | null;
    startColumn: number | null;
    startX: number;
    startY: number;
    mode: EditorSelectionState["type"];
  } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    blockIndex: number;
    tableKey: string | null;
    row: number | null;
    column: number | null;
  } | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelectionState>({ type: "none" });

  const placeCaretFromPoint = () => {
    if (!editorRef.current) {
      return;
    }

    const point = pendingCaretPointRef.current;
    pendingCaretPointRef.current = null;

    if (!point) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    if ("caretPositionFromPoint" in document) {
      const position = document.caretPositionFromPoint(point.x, point.y);
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }

    if ("caretRangeFromPoint" in document) {
      const range = (document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }).caretRangeFromPoint?.(point.x, point.y);
      if (range) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

  const syncHeightToContent = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const editorStyle = window.getComputedStyle(editor);
    const paddingBottom = Number.parseFloat(editorStyle.paddingBottom) || 0;
    const contentBottom = Array.from(editor.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .reduce((bottom, child) => {
        const childStyle = window.getComputedStyle(child);
        const marginBottom = Number.parseFloat(childStyle.marginBottom) || 0;
        return Math.max(bottom, child.offsetTop + child.offsetHeight + marginBottom);
      }, 0);
    const measuredHeight = Math.max(180, Math.ceil(contentBottom + paddingBottom));
    onAutoResize(measuredHeight);
  };

  const restoreEditorFocus = () => {
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      suppressBlurCommitRef.current = false;
    });
  };

  const syncDimensionsToContent = () => {
    if (!editorRef.current) {
      return;
    }

    expandTablesToFitContent();
    const measuredWidth = Math.max(320, Math.ceil(editorRef.current.scrollWidth));
    onAutoResizeWidth(measuredWidth);
    syncHeightToContent();
  };

  const commitDraftFromDom = () => {
    if (!editorRef.current) {
      return;
    }

    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current));
  };

  const getCurrentRichTextDoc = () => {
    if (!editorRef.current) {
      return htmlToRichTextDoc(draftHtmlRef.current);
    }

    draftHtmlRef.current = editorRef.current.innerHTML;
    return htmlToRichTextDoc(draftHtmlRef.current);
  };

  const getTableElement = (wrapper: HTMLElement) => {
    const table = Array.from(wrapper.children).find((child) => child instanceof HTMLTableElement);
    return table instanceof HTMLTableElement ? table : null;
  };

  const getTableColumnWidths = (wrapper: HTMLElement) => {
    const explicitWidths = (wrapper.getAttribute("data-col-widths") ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (explicitWidths.length > 0) {
      return explicitWidths;
    }

    const table = getTableElement(wrapper);
    const firstRow = table?.rows.item(0);

    if (!firstRow) {
      return [];
    }

    return Array.from(firstRow.cells).map((cell) => Math.max(72, cell.offsetWidth));
  };

  const applyTableColumnWidths = (wrapper: HTMLElement, widths: number[]) => {
    const table = getTableElement(wrapper);
    if (!table) {
      return;
    }

    const normalizedWidths = widths.map((width) => Math.max(72, Math.round(width)));
    let colGroup = table.querySelector(":scope > colgroup");

    if (!(colGroup instanceof HTMLTableColElement) && !(colGroup instanceof HTMLTableSectionElement)) {
      colGroup = document.createElement("colgroup");
      table.insertBefore(colGroup, table.firstChild);
    }

    while (colGroup.children.length > normalizedWidths.length) {
      colGroup.removeChild(colGroup.lastElementChild as ChildNode);
    }

    normalizedWidths.forEach((width, index) => {
      const current = colGroup?.children.item(index);
      const col = current instanceof HTMLTableColElement ? current : document.createElement("col");
      col.style.width = `${width}px`;
      if (current !== col) {
        colGroup?.appendChild(col);
      }
    });

    const totalWidth = normalizedWidths.reduce((sum, width) => sum + width, 0);
    wrapper.style.width = `${totalWidth}px`;
    wrapper.setAttribute("data-w", String(totalWidth));
    wrapper.setAttribute("data-col-widths", normalizedWidths.join(","));
  };

  const expandTablesToFitContent = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    // Walk inner tables first so their expanded width can push outer cells wider.
    const wrappers = Array.from(editor.querySelectorAll(".text-block-table-wrap"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .reverse();

    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;

      wrappers.forEach((wrapper) => {
        const table = getTableElement(wrapper);
        if (!table || table.rows.length === 0) {
          return;
        }

        const widths = getTableColumnWidths(wrapper);
        if (widths.length === 0) {
          return;
        }

        const nextWidths = [...widths];
        Array.from(table.rows).forEach((row) => {
          Array.from(row.cells).forEach((cell) => {
            if (!(cell instanceof HTMLTableCellElement)) {
              return;
            }

            const content = cell.querySelector(":scope > .text-block-table-cell-content");
            const contentWidth = content instanceof HTMLElement
              ? Math.ceil(content.scrollWidth)
              : Math.ceil(cell.scrollWidth);
            const style = window.getComputedStyle(cell);
            const paddingX = (Number.parseFloat(style.paddingLeft) || 0)
              + (Number.parseFloat(style.paddingRight) || 0);
            const requiredWidth = Math.max(72, contentWidth + paddingX);
            const columnIndex = cell.cellIndex;

            if (requiredWidth > nextWidths[columnIndex]) {
              nextWidths[columnIndex] = requiredWidth;
            }
          });
        });

        if (nextWidths.some((width, index) => width > widths[index])) {
          applyTableColumnWidths(wrapper, nextWidths);
          changed = true;
        }
      });

      if (!changed) {
        break;
      }
    }
  };

  const startInlineImageResize = (event: ReactPointerEvent<HTMLDivElement>, handle: HTMLElement) => {
    const frame = handle.closest(".text-inline-image-frame");
    if (!(frame instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = Number(frame.getAttribute("data-w")) || frame.offsetWidth;
    const startHeight = Number(frame.getAttribute("data-h")) || frame.offsetHeight;
    const screenScale = Math.max(0.01, frame.getBoundingClientRect().width / startWidth);
    const aspectRatio = startHeight / startWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(80, startWidth + (moveEvent.clientX - startX) / screenScale);
      const nextHeight = Math.max(40, nextWidth * aspectRatio);

      frame.style.width = `${nextWidth}px`;
      frame.setAttribute("data-w", String(Math.round(nextWidth)));
      frame.setAttribute("data-h", String(Math.round(nextHeight)));
      syncDimensionsToContent();
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      commitDraftFromDom();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const startTableResize = (event: PointerLikeEvent, wrapper: HTMLElement) => {
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();

    const startX = event.clientX;
    const startWidth = Number(wrapper.getAttribute("data-w")) || wrapper.offsetWidth;
    const screenScale = Math.max(0.01, wrapper.getBoundingClientRect().width / startWidth);
    const startColumnWidths = getTableColumnWidths(wrapper);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(180, startWidth + (moveEvent.clientX - startX) / screenScale);
      if (startColumnWidths.length > 0) {
        const nextWidths = [...startColumnWidths];
        nextWidths[nextWidths.length - 1] = Math.max(72, startColumnWidths[startColumnWidths.length - 1] + (nextWidth - startWidth));
        applyTableColumnWidths(wrapper, nextWidths);
      } else {
        wrapper.style.width = `${nextWidth}px`;
        wrapper.setAttribute("data-w", String(Math.round(nextWidth)));
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      commitDraftFromDom();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const startColumnResize = (event: PointerLikeEvent, cell: HTMLTableCellElement) => {
    const wrapper = cell.closest(".text-block-table-wrap");
    if (!(wrapper instanceof HTMLElement)) {
      return;
    }

    const columnIndex = cell.cellIndex;

    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();

    const startX = event.clientX;
    const startWidths = getTableColumnWidths(wrapper);
    const startWidth = startWidths[columnIndex];
    const totalWidth = startWidths.reduce((sum, width) => sum + width, 0);
    const rectWidth = wrapper.getBoundingClientRect().width;
    const screenScale = Math.max(0.01, rectWidth / Math.max(totalWidth, 1));

    if (!Number.isFinite(startWidth) || startWidth <= 0) {
      return;
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidths = [...startWidths];
      nextWidths[columnIndex] = Math.max(72, startWidth + (moveEvent.clientX - startX) / screenScale);
      applyTableColumnWidths(wrapper, nextWidths);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      commitDraftFromDom();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const getColumnResizeCell = (
    event: Pick<PointerLikeEvent, "clientX">,
    cell: HTMLTableCellElement,
  ) => {
    const rect = cell.getBoundingClientRect();
    if (Math.abs(rect.right - event.clientX) <= COLUMN_RESIZE_HIT_SLOP) {
      return cell;
    }

    if (Math.abs(rect.left - event.clientX) <= COLUMN_RESIZE_HIT_SLOP) {
      const previousCell = cell.parentElement instanceof HTMLTableRowElement
        ? cell.parentElement.cells.item(cell.cellIndex - 1)
        : null;
      return previousCell instanceof HTMLTableCellElement ? previousCell : null;
    }

    return null;
  };

  const getTableResizeWrapper = (
    event: Pick<PointerLikeEvent, "clientX">,
    element: HTMLElement | null,
  ) => {
    const wrapper = element?.closest(".text-block-table-wrap");
    if (!(wrapper instanceof HTMLElement)) {
      return null;
    }

    if (element?.dataset.tableResizeHandle === "true") {
      return wrapper;
    }

    return Math.abs(wrapper.getBoundingClientRect().right - event.clientX) <= TABLE_RESIZE_HIT_SLOP
      ? wrapper
      : null;
  };

  const getNodeResizeHandle = (event: Pick<PointerLikeEvent, "clientX">) => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }

    const rect = editor.getBoundingClientRect();
    if (Math.abs(rect.left - event.clientX) <= NODE_RESIZE_HIT_SLOP) {
      return "left";
    }

    if (Math.abs(rect.right - event.clientX) <= NODE_RESIZE_HIT_SLOP) {
      return "right";
    }

    return null;
  };

  const setColumnResizeHover = (cell: HTMLTableCellElement | null) => {
    if (hoveredColumnCellRef.current === cell) {
      return;
    }

    hoveredColumnCellRef.current?.classList.remove("column-resize-hover");
    hoveredColumnCellRef.current = cell;
    hoveredColumnCellRef.current?.classList.add("column-resize-hover");

    if (editorRef.current) {
      editorRef.current.style.cursor = cell ? "col-resize" : "";
    }
  };

  const setTableResizeHover = (wrapper: HTMLElement | null) => {
    if (hoveredTableWrapRef.current === wrapper) {
      return;
    }

    hoveredTableWrapRef.current?.classList.remove("table-resize-hover");
    hoveredTableWrapRef.current = wrapper;
    hoveredTableWrapRef.current?.classList.add("table-resize-hover");
  };

  const clearTableCellSelection = () => {
    setEditorSelection({ type: "none" });
  };

  const getBlockLocation = (element: Element | null) => {
    const block = element?.closest("[data-block-kind][data-block-index]");
    if (!(block instanceof HTMLElement)) {
      return null;
    }

    const blockIndex = Number(block.dataset.blockIndex);
    if (!Number.isInteger(blockIndex)) {
      return null;
    }

    return {
      block,
      blockIndex,
      blockKind: block.dataset.blockKind ?? "",
    };
  };

  const getCellLocation = (cell: HTMLTableCellElement) => {
    const wrapper = cell.closest(".text-block-table-wrap");
    const row = cell.parentElement;
    const blockLocation = getBlockLocation(cell);

    if (!(wrapper instanceof HTMLElement) || !(row instanceof HTMLTableRowElement) || !blockLocation) {
      return null;
    }

    return {
      blockIndex: blockLocation.blockIndex,
      tableKey: wrapper.dataset.tableKey ?? "",
      row: row.rowIndex,
      column: cell.cellIndex,
    };
  };

  const rememberActiveTableCell = (cell: HTMLTableCellElement | null) => {
    if (cell && editorRef.current?.contains(cell)) {
      activeTableCellRef.current = cell;
    }
  };

  const applyCellRangeSelection = (
    start: { tableKey: string; row: number; column: number },
    end: { tableKey: string; row: number; column: number },
  ) => {
    if (!start.tableKey || !end.tableKey || start.tableKey !== end.tableKey) {
      return;
    }

    setEditorSelection({
      type: "cell-range",
      tableKey: start.tableKey,
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startColumn: Math.min(start.column, end.column),
      endColumn: Math.max(start.column, end.column),
    });
  };

  const applyBlockRangeSelection = (startBlockIndex: number, endBlockIndex: number) => {
    setEditorSelection({
      type: "block-range",
      startBlockIndex: Math.min(startBlockIndex, endBlockIndex),
      endBlockIndex: Math.max(startBlockIndex, endBlockIndex),
    });
  };

  const startPendingSelection = (
    event: ReactPointerEvent<HTMLDivElement>,
    startBlockIndex: number,
    startCell?: HTMLTableCellElement | null,
  ) => {
    suppressBlurCommitRef.current = true;
    const startCellLocation = startCell ? getCellLocation(startCell) : null;

    pendingSelectionRef.current = {
      startBlockIndex,
      startTableKey: startCellLocation?.tableKey ?? null,
      startRow: startCellLocation?.row ?? null,
      startColumn: startCellLocation?.column ?? null,
      startX: event.clientX,
      startY: event.clientY,
      mode: "none",
    };

    const cleanupPendingSelection = () => {
      pendingSelectionRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = pendingSelectionRef.current;
      if (!session) {
        return;
      }

      const movedX = Math.abs(moveEvent.clientX - session.startX);
      const movedY = Math.abs(moveEvent.clientY - session.startY);
      if (movedX < TABLE_SELECTION_DRAG_THRESHOLD && movedY < TABLE_SELECTION_DRAG_THRESHOLD) {
        return;
      }

      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const targetElement = target instanceof Element ? target : null;
      const cell = targetElement instanceof HTMLTableCellElement
        ? targetElement
        : targetElement instanceof HTMLElement
          ? targetElement.closest("td")
          : null;
      const endCell = cell instanceof HTMLTableCellElement ? getCellLocation(cell) : null;
      const endBlock = getBlockLocation(targetElement);

      const resizeCell = cell instanceof HTMLTableCellElement && session.mode === "none"
        ? getColumnResizeCell(moveEvent, cell)
        : null;
      const movedMostlyHorizontally = movedX > movedY * 1.6;
      if (resizeCell && session.startTableKey === null && movedMostlyHorizontally) {
        cleanupPendingSelection();
        suppressBlurCommitRef.current = false;
        startColumnResize(moveEvent, resizeCell);
        return;
      }

      if (
        session.startTableKey &&
        endCell &&
        endCell.tableKey === session.startTableKey &&
        (endCell.row !== session.startRow || endCell.column !== session.startColumn)
      ) {
        if (session.mode !== "cell-range") {
          session.mode = "cell-range";
          window.getSelection()?.removeAllRanges();
        }
        moveEvent.preventDefault();
        applyCellRangeSelection(
          {
            tableKey: session.startTableKey,
            row: session.startRow ?? 0,
            column: session.startColumn ?? 0,
          },
          {
            tableKey: endCell.tableKey,
            row: endCell.row,
            column: endCell.column,
          },
        );
        return;
      }

      if (endBlock && endBlock.blockIndex !== session.startBlockIndex) {
        if (session.mode !== "block-range") {
          session.mode = "block-range";
          window.getSelection()?.removeAllRanges();
        }
        moveEvent.preventDefault();
        applyBlockRangeSelection(session.startBlockIndex, endBlock.blockIndex);
      }
    };

    const handlePointerUp = () => {
      const session = pendingSelectionRef.current;
      cleanupPendingSelection();

      if (!session) {
        return;
      }

      setSelectionAnchor({
        blockIndex: session.startBlockIndex,
        tableKey: session.startTableKey,
        row: session.startRow,
        column: session.startColumn,
      });

      if (session.mode === "none") {
        setEditorSelection({ type: "none" });
        suppressBlurCommitRef.current = false;
      } else {
        restoreEditorFocus();
        window.getSelection()?.removeAllRanges();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const serializeTableRange = (
    wrapper: HTMLElement,
    startRow: number,
    endRow: number,
    startColumn: number,
    endColumn: number,
  ) => {
    const table = getTableElement(wrapper);
    if (!table) {
      return null;
    }

    const lines: string[] = [];
    const htmlRows: string[] = [];

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
      const row = table.rows.item(rowIndex);
      if (!row) {
        continue;
      }

      const textCells: string[] = [];
      const htmlCells: string[] = [];

      for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
        const cell = row.cells.item(columnIndex);
        if (!(cell instanceof HTMLTableCellElement)) {
          continue;
        }

        textCells.push((cell.innerText || cell.textContent || "").replace(/\n+$/g, "").trimEnd());
        htmlCells.push(`<td>${cell.innerHTML}</td>`);
      }

      lines.push(textCells.join("\t"));
      htmlRows.push(`<tr>${htmlCells.join("")}</tr>`);
    }

    const colWidths = (wrapper.getAttribute("data-col-widths") ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(startColumn, endColumn + 1);
    const tableInnerHtml = `${colWidths.length > 0 ? `<colgroup>${colWidths.map((width) => `<col style="width: ${width}px;" />`).join("")}</colgroup>` : ""}<tbody>${htmlRows.join("")}</tbody>`;

    return {
      text: lines.join("\n"),
      html: wrapRichTextTableHtml(tableInnerHtml, {
        colWidths,
        width: colWidths.length > 0 ? colWidths.reduce((sum, width) => sum + width, 0) : undefined,
      }),
    };
  };

  const copySelectedTableCells = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "cell-range" || !clipboardData) {
      return false;
    }

    const wrapper = editorRef.current?.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
    if (!(wrapper instanceof HTMLElement)) {
      return false;
    }

    const serialized = serializeTableRange(
      wrapper,
      editorSelection.startRow,
      editorSelection.endRow,
      editorSelection.startColumn,
      editorSelection.endColumn,
    );
    if (!serialized) {
      return false;
    }

    clipboardData.setData("text/plain", serialized.text);
    clipboardData.setData("text/html", serialized.html);
    customClipboardRef.current = serialized;
    return true;
  };

  const clearSelectedTableCells = () => {
    if (editorSelection.type !== "cell-range") {
      return false;
    }

    const wrapper = editorRef.current?.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
    if (!(wrapper instanceof HTMLElement)) {
      return false;
    }

    const table = getTableElement(wrapper);
    if (!table) {
      return false;
    }

    for (let rowIndex = editorSelection.startRow; rowIndex <= editorSelection.endRow; rowIndex += 1) {
      const row = table.rows.item(rowIndex);
      if (!row) {
        continue;
      }

      for (let columnIndex = editorSelection.startColumn; columnIndex <= editorSelection.endColumn; columnIndex += 1) {
        const cell = row.cells.item(columnIndex);
        if (cell instanceof HTMLTableCellElement) {
          cell.innerHTML = "<p><br /></p>";
        }
      }
    }

    commitDraftFromDom();
    setEditorSelection({ type: "none" });
    return true;
  };

  const cutSelectedTableCells = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "cell-range" || !copySelectedTableCells(clipboardData)) {
      return false;
    }

    return clearSelectedTableCells();
  };

  const deleteSelectedBlocks = () => {
    if (editorSelection.type !== "block-range" || !editorRef.current) {
      return false;
    }

    const blocks = Array.from(editorRef.current.querySelectorAll("[data-block-kind][data-block-index]"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => {
        const blockIndex = Number(element.dataset.blockIndex);
        return Number.isInteger(blockIndex)
          && blockIndex >= editorSelection.startBlockIndex
          && blockIndex <= editorSelection.endBlockIndex;
      });

    if (blocks.length === 0) {
      return false;
    }

    blocks.forEach((block) => block.remove());

    if (!editorRef.current.querySelector("[data-block-kind]")) {
      editorRef.current.innerHTML = EMPTY_PARAGRAPH_HTML;
    }

    commitDraftFromDom();
    setEditorSelection({ type: "none" });
    return true;
  };

  const copySelectedBlocks = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "block-range" || !clipboardData || !editorRef.current) {
      return false;
    }

    const blocks = Array.from(editorRef.current.querySelectorAll("[data-block-kind][data-block-index]"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => {
        const blockIndex = Number(element.dataset.blockIndex);
        return Number.isInteger(blockIndex)
          && blockIndex >= editorSelection.startBlockIndex
          && blockIndex <= editorSelection.endBlockIndex;
      });

    if (blocks.length === 0) {
      return false;
    }

    const plainText = blocks.map((block) => {
      if (block.dataset.blockKind === "table") {
        const table = getTableElement(block);
        if (table) {
          const serialized = serializeTableRange(
            block,
            0,
            Math.max(0, table.rows.length - 1),
            0,
            Math.max(0, (table.rows.item(0)?.cells.length ?? 1) - 1),
          );
          if (serialized) {
            return serialized.text;
          }
        }
      }

      return block.innerText.trim();
    }).join("\n\n");

    const html = blocks.map((block) => block.outerHTML).join("");
    clipboardData.setData("text/plain", plainText);
    clipboardData.setData("text/html", html);
    customClipboardRef.current = { text: plainText, html };
    return true;
  };

  const writeCurrentSelectionToClipboard = (clipboardData: DataTransfer | null) =>
    copySelectedTableCells(clipboardData) || copySelectedBlocks(clipboardData);

  const insertHtmlAtCaret = (html: string) => {
    if (!editorRef.current) {
      return null;
    }

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const firstNode = fragment.firstChild;
    const lastNode = fragment.lastChild;

    if (!range || !editorRef.current.contains(range.commonAncestorContainer)) {
      editorRef.current.appendChild(fragment);
      return { firstNode, lastNode };
    }

    range.deleteContents();
    range.insertNode(fragment);

    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    return { firstNode, lastNode };
  };

  const isStructuredHtml = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    return !!root.querySelector("table, [data-block-kind]");
  };

  const insertStructuredHtmlAtSelection = (html: string) => {
    if (!editorRef.current) {
      return;
    }

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const template = document.createElement("template");
    template.innerHTML = html;
    const fragment = template.content;
    const firstElement = fragment.firstElementChild;
    const lastElement = fragment.lastElementChild;

    if (!range || !editorRef.current.contains(range.commonAncestorContainer)) {
      editorRef.current.appendChild(fragment);
      return { firstNode: firstElement, lastNode: lastElement };
    }

    const anchorElement = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const currentBlock = anchorElement?.closest("[data-block-kind]");

    if (currentBlock instanceof HTMLElement && editorRef.current.contains(currentBlock)) {
      currentBlock.after(fragment);
    } else {
      editorRef.current.appendChild(fragment);
    }

    if (lastElement) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastElement);
      nextRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
    }

    return { firstNode: firstElement, lastNode: lastElement };
  };

  const placeCaretInside = (container: Node) => {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    let targetNode: Node = container;
    let offset = 0;

    while (targetNode.firstChild) {
      targetNode = targetNode.firstChild;
    }

    if (targetNode.nodeType === Node.TEXT_NODE) {
      offset = 0;
    } else if (targetNode instanceof HTMLElement && targetNode.tagName.toLowerCase() === "br") {
      targetNode = container;
      offset = 0;
    }

    range.setStart(targetNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const placeCaretAtEnd = () => {
    if (!editorRef.current) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editorRef.current);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const insertTextAtCaret = (text: string) => {
    if (!editorRef.current) {
      return;
    }

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

    if (!range || !editorRef.current.contains(range.commonAncestorContainer)) {
      placeCaretAtEnd();
      return insertTextAtCaret(text);
    }

    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const insertHtmlAndCommit = (html: string, placement: "caret" | "end" = "caret") => {
    if (placement === "end") {
      placeCaretAtEnd();
    }

    if (isStructuredHtml(html)) {
      insertStructuredHtmlAtSelection(html);
    } else {
      insertHtmlAtCaret(html);
    }

    if (!editorRef.current) {
      return;
    }

    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current));
    editorRef.current.focus();
  };

  const tsvToTableHtml = (text: string) => {
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => line.split("\t"));

    if (rows.length === 0) {
      return "";
    }

    const hasMultipleColumns = rows.some((cells) => cells.length > 1);
    if (!hasMultipleColumns) {
      return "";
    }

    return wrapRichTextTableHtml(
      `<tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td><p>${escapeHtml(cell) || "<br />"}</p></td>`).join("")}</tr>`).join("")}</tbody>`,
    );
  };

  const normalizePastedHtml = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;

    Array.from(root.querySelectorAll("script, style")).forEach((node) => node.remove());
    Array.from(root.querySelectorAll("table")).forEach((table) => {
      if (!(table instanceof HTMLTableElement)) {
        return;
      }

      const existingWrapper = table.closest(".text-block-table-wrap");
      if (existingWrapper instanceof HTMLElement) {
        table.classList.add("text-block-table");
        if (!existingWrapper.classList.contains("text-block")) {
          existingWrapper.classList.add("text-block");
        }
        existingWrapper.dataset.blockKind = existingWrapper.dataset.blockKind || "table";
        if (!existingWrapper.querySelector(":scope > .text-block-table-resize")) {
          const handle = document.createElement("span");
          handle.className = "text-block-table-resize";
          handle.contentEditable = "false";
          handle.dataset.tableResizeHandle = "true";
          existingWrapper.appendChild(handle);
        }
        return;
      }

      const colWidths = Array.from(table.querySelectorAll(":scope > colgroup > col"))
        .map((col) => Number.parseFloat((col as HTMLElement).style.width))
        .filter((value) => Number.isFinite(value) && value > 0);
      const wrapped = document.createElement("div");
      wrapped.innerHTML = wrapRichTextTableHtml(table.innerHTML, { colWidths });
      const wrapper = wrapped.firstElementChild;
      if (wrapper) {
        table.replaceWith(wrapper);
      }
    });

    const hasStructuredContent = root.querySelector("table, [data-block-kind], p, div, ul, ol, li, blockquote, h1, h2, h3, h4, h5, h6");
    return hasStructuredContent ? root.innerHTML : "";
  };

  const insertTableAtCaret = (placement: "caret" | "end" = "caret") => {
    if (placement === "end") {
      placeCaretAtEnd();
    }

    const inserted = insertStructuredHtmlAtSelection(createRichTextTableHtml());
    const table = inserted?.firstNode instanceof HTMLTableElement
      ? inserted.firstNode
      : inserted?.firstNode instanceof HTMLElement
        ? inserted.firstNode.querySelector("table")
        : null;
    const firstCellParagraph = table?.querySelector("td p");

    if (firstCellParagraph) {
      placeCaretInside(firstCellParagraph);
    }

    if (editorRef.current) {
      draftHtmlRef.current = editorRef.current.innerHTML;
      syncDimensionsToContent();
      onDraftChange(htmlToRichTextDoc(draftHtmlRef.current));
      editorRef.current.focus();
    }
  };

  const insertImageAtCaret = (
    image: { assetId: string; name: string; data: string; w: number; h: number },
    placement: "caret" | "end" = "caret",
  ) => {
    insertHtmlAndCommit(
      `<span class="text-inline-image-frame" contenteditable="false" data-asset-id="${escapeAttribute(image.assetId)}" data-w="${image.w}" data-h="${image.h}" style="width: ${image.w}px;"><img src="${escapeAttribute(image.data)}" alt="${escapeAttribute(image.name)}" draggable="false" /><span class="text-inline-image-resize" data-image-resize-handle="true"></span></span>`,
      placement,
    );
  };

  const appendTextAtEnd = (text: string) => {
    placeCaretAtEnd();
    insertTextAtCaret(text);

    if (!editorRef.current) {
      return;
    }

    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current));
    editorRef.current.focus();
  };

  const insertTableRowAtSelection = () => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const cell = anchorNode instanceof Element
      ? anchorNode.closest("td")
      : anchorNode?.parentElement?.closest("td");
    const row = cell?.closest("tr");

    if (!(cell instanceof HTMLTableCellElement) || !(row instanceof HTMLTableRowElement)) {
      return false;
    }

    const nextRow = row.cloneNode(false) as HTMLTableRowElement;
    const columnCount = row.cells.length;

    for (let index = 0; index < columnCount; index += 1) {
      const nextCell = document.createElement("td");
      nextCell.innerHTML = "<p><br /></p>";
      nextRow.appendChild(nextCell);
    }

    row.parentElement?.insertBefore(nextRow, row.nextSibling);
    const firstParagraph = nextRow.querySelector("td p");
    if (firstParagraph) {
      placeCaretInside(firstParagraph);
    }

    commitDraftFromDom();
    editorRef.current?.focus();
    return true;
  };

  const getActiveTableCell = () => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const selectionCell = anchorNode instanceof Element
      ? anchorNode.closest("td")
      : anchorNode?.parentElement?.closest("td");

    if (selectionCell instanceof HTMLTableCellElement && editorRef.current?.contains(selectionCell)) {
      activeTableCellRef.current = selectionCell;
      return selectionCell;
    }

    if (activeTableCellRef.current && editorRef.current?.contains(activeTableCellRef.current)) {
      return activeTableCellRef.current;
    }

    return null;
  };

  const mutateTableColumnAtSelection = (mode: "insert-right" | "insert-left" | "delete") => {
    const cell = getActiveTableCell();
    const row = cell?.closest("tr");
    const wrapper = cell?.closest(".text-block-table-wrap");

    if (
      !(cell instanceof HTMLTableCellElement) ||
      !(row instanceof HTMLTableRowElement) ||
      !(wrapper instanceof HTMLElement)
    ) {
      return false;
    }

    const table = getTableElement(wrapper);
    if (!table) {
      return false;
    }

    const columnIndex = cell.cellIndex;
    const currentColumnCount = table.rows.item(0)?.cells.length ?? row.cells.length;
    const targetIndex = mode === "insert-left" ? columnIndex : columnIndex + 1;

    if (mode === "delete") {
      if (currentColumnCount <= 1) {
        return false;
      }

      Array.from(table.rows).forEach((currentRow) => {
        const currentCell = currentRow.cells.item(columnIndex);
        currentCell?.remove();
      });

      const currentWidths = getTableColumnWidths(wrapper);
      if (currentWidths.length > 0) {
        const nextWidths = [...currentWidths];
        nextWidths.splice(columnIndex, 1);
        applyTableColumnWidths(wrapper, nextWidths);
      }

      const fallbackCell = row.cells.item(Math.max(0, columnIndex - 1)) ?? row.cells.item(0);
      const firstParagraph = fallbackCell?.querySelector("p");
      if (firstParagraph) {
        placeCaretInside(firstParagraph);
      }

      commitDraftFromDom();
      activeTableCellRef.current = fallbackCell instanceof HTMLTableCellElement ? fallbackCell : null;
      editorRef.current?.focus();
      return true;
    }

    Array.from(table.rows).forEach((currentRow) => {
      const nextCell = document.createElement("td");
      nextCell.innerHTML = "<p><br /></p>";
      const referenceCell = currentRow.cells.item(targetIndex);
      currentRow.insertBefore(nextCell, referenceCell ?? null);
    });

    const currentWidths = getTableColumnWidths(wrapper);
    if (currentWidths.length > 0) {
      const referenceWidth = currentWidths[Math.min(columnIndex, currentWidths.length - 1)] ?? 120;
      const nextWidths = [...currentWidths];
      nextWidths.splice(targetIndex, 0, referenceWidth);
      applyTableColumnWidths(wrapper, nextWidths);
    }

    const nextCell = row.cells.item(targetIndex);
    const firstParagraph = nextCell?.querySelector("p");
    if (firstParagraph) {
      placeCaretInside(firstParagraph);
    }

    commitDraftFromDom();
    activeTableCellRef.current = nextCell instanceof HTMLTableCellElement ? nextCell : null;
    editorRef.current?.focus();
    return true;
  };

  const insertTableColumnAtSelection = () => mutateTableColumnAtSelection("insert-right");

  const insertTableColumnLeftAtSelection = () => mutateTableColumnAtSelection("insert-left");

  const deleteTableColumnAtSelection = () => mutateTableColumnAtSelection("delete");

  const getSelectionTableContext = () => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const cell = anchorNode instanceof Element
      ? anchorNode.closest("td")
      : anchorNode?.parentElement?.closest("td");
    const row = cell?.closest("tr");
    const table = row?.closest("table");
    const tbody = row?.parentElement;

    if (
      !(cell instanceof HTMLTableCellElement) ||
      !(row instanceof HTMLTableRowElement) ||
      !(table instanceof HTMLTableElement) ||
      !(tbody instanceof HTMLTableSectionElement)
    ) {
      return null;
    }

    return {
      cell,
      row,
      table,
      tbody,
      isLastRow: row.rowIndex === table.rows.length - 1,
      columnCount: table.rows.item(0)?.cells.length ?? row.cells.length,
    };
  };

  const appendRowsToCurrentTable = (rows: string[][]) => {
    const context = getSelectionTableContext();
    if (!context || !context.isLastRow || rows.length === 0) {
      return false;
    }

    const normalizedRows = rows.filter((cells) => cells.length > 0);
    if (normalizedRows.length === 0 || normalizedRows.some((cells) => cells.length !== context.columnCount)) {
      return false;
    }

    normalizedRows.forEach((cells) => {
      const nextRow = document.createElement("tr");
      cells.forEach((cellHtml) => {
        const nextCell = document.createElement("td");
        nextCell.innerHTML = cellHtml;
        nextRow.appendChild(nextCell);
      });
      context.tbody.appendChild(nextRow);
    });

    const firstParagraph = context.tbody.lastElementChild?.querySelector?.("td p");
    if (firstParagraph instanceof HTMLElement) {
      placeCaretInside(firstParagraph);
    }

    commitDraftFromDom();
    editorRef.current?.focus();
    return true;
  };

  const tryAppendPastedTableHtml = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    const tables = Array.from(root.querySelectorAll("table"));
    if (tables.length !== 1) {
      return false;
    }

    const table = tables[0];
    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((cell) => cell.innerHTML || "<p><br /></p>"),
    );

    return appendRowsToCurrentTable(rows);
  };

  const tryAppendPastedPlainTextTable = (text: string) => {
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => line.split("\t"));

    if (rows.length === 0 || !rows.some((cells) => cells.length > 1)) {
      return false;
    }

    return appendRowsToCurrentTable(
      rows.map((cells) => cells.map((cell) => `<p>${escapeHtml(cell) || "<br />"}</p>`)),
    );
  };

  const handlePaste = async (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!editing) {
      return;
    }

    if (editorSelection.type !== "none") {
      clearTableCellSelection();
      placeCaretAtEnd();
    }

    const imageFile = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();

    if (imageFile) {
      event.preventDefault();
      const pasted = await onPasteImage(imageFile);
      insertImageAtCaret(pasted);
      return;
    }

    const html = normalizePastedHtml(event.clipboardData.getData("text/html") || customClipboardRef.current?.html || "");
    if (html) {
      if (tryAppendPastedTableHtml(html)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      insertHtmlAndCommit(html);
      return;
    }

    const plainText = event.clipboardData.getData("text/plain") || customClipboardRef.current?.text || "";
    if (!plainText) {
      return;
    }

    const tableHtml = tsvToTableHtml(plainText);
    event.preventDefault();

    if (tryAppendPastedPlainTextTable(plainText)) {
      return;
    }

    if (tableHtml) {
      insertHtmlAndCommit(tableHtml);
      return;
    }

    insertTextAtCaret(plainText);
    if (!editorRef.current) {
      return;
    }

    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editing) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onCommit(getCurrentRichTextDoc());
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      if (insertTableRowAtSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    if (event.key === "Tab" && event.altKey && event.shiftKey) {
      if (insertTableColumnLeftAtSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    if (event.key === "Tab" && event.altKey && !event.shiftKey) {
      if (insertTableColumnAtSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    if (event.key === "Insert" && event.altKey) {
      if (insertTableColumnLeftAtSelection()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    if (event.key === "Delete" && event.altKey) {
      if (deleteTableColumnAtSelection()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (clearSelectedTableCells() || deleteSelectedBlocks()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  const handleCopy = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!editing) {
      return;
    }

    if (writeCurrentSelectionToClipboard(event.clipboardData)) {
      event.preventDefault();
    }
  };

  const handleCut = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (!editing) {
      return;
    }

    if (cutSelectedTableCells(event.clipboardData)) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    if (editing && editorRef.current) {
      draftHtmlRef.current = richTextDocToHtml(node.content, assets);
      editorRef.current.innerHTML = draftHtmlRef.current;
      editorRef.current.focus();
      placeCaretFromPoint();
      syncDimensionsToContent();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing && editorRef.current) {
      draftHtmlRef.current = richTextDocToHtml(node.content, assets);
      editorRef.current.innerHTML = draftHtmlRef.current;
      syncDimensionsToContent();
    }
  }, [assets, editing, node.content]);

  useEffect(() => {
    if (!editing && editorRef.current) {
      syncHeightToContent();
    }
  }, [editing, node.w]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const handleImageLoad = () => syncDimensionsToContent();
    editor.addEventListener("load", handleImageLoad, true);

    return () => editor.removeEventListener("load", handleImageLoad, true);
  }, [assets, editing, node.content]);

  useEffect(() => () => {
    setColumnResizeHover(null);
    setTableResizeHover(null);
    clearTableCellSelection();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    Array.from(editor.querySelectorAll("[data-block-kind]")).forEach((element, index) => {
      if (element instanceof HTMLElement) {
        element.dataset.blockIndex = String(index);
        element.dataset.tableKey = `table-${index}`;
      }
    });
  }, [editing, node.content, assets]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    Array.from(editor.querySelectorAll(".table-cell-range-selected, .block-range-selected")).forEach((element) => {
      element.classList.remove("table-cell-range-selected", "block-range-selected");
    });

    if (editorSelection.type === "none") {
      return;
    }

    if (editorSelection.type === "cell-range") {
      const wrapper = editor.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
      if (!(wrapper instanceof HTMLElement)) {
        return;
      }

      const table = getTableElement(wrapper);
      if (!table) {
        return;
      }

      for (let rowIndex = editorSelection.startRow; rowIndex <= editorSelection.endRow; rowIndex += 1) {
        const row = table.rows.item(rowIndex);
        if (!row) {
          continue;
        }

        for (let columnIndex = editorSelection.startColumn; columnIndex <= editorSelection.endColumn; columnIndex += 1) {
          const cell = row.cells.item(columnIndex);
          if (cell instanceof HTMLTableCellElement) {
            cell.classList.add("table-cell-range-selected");
          }
        }
      }
      return;
    }

    Array.from(editor.querySelectorAll("[data-block-kind][data-block-index]"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .forEach((element) => {
        const blockIndex = Number(element.dataset.blockIndex);
        if (
          Number.isInteger(blockIndex)
          && blockIndex >= editorSelection.startBlockIndex
          && blockIndex <= editorSelection.endBlockIndex
        ) {
          element.classList.add("block-range-selected");
        }
      });
  }, [editorSelection, editing, node.content, assets]);

  useEffect(() => {
    const handleDocumentCopy = (event: ClipboardEvent) => {
      if (!editing || editorSelection.type === "none") {
        return;
      }

      if (writeCurrentSelectionToClipboard(event.clipboardData)) {
        event.preventDefault();
      }
    };

    const handleDocumentCut = (event: ClipboardEvent) => {
      if (!editing || editorSelection.type === "none") {
        return;
      }

      if (cutSelectedTableCells(event.clipboardData)) {
        event.preventDefault();
      }
    };

    document.addEventListener("copy", handleDocumentCopy, true);
    document.addEventListener("cut", handleDocumentCut, true);

    return () => {
      document.removeEventListener("copy", handleDocumentCopy, true);
      document.removeEventListener("cut", handleDocumentCut, true);
    };
  }, [editing, editorSelection]);

  useEffect(() => {
    if (!editing || !command) {
      return;
    }

    if (command.type === "insert-table") {
      insertTableAtCaret(command.placement ?? "caret");
      return;
    }

    if (command.type === "insert-table-column") {
      insertTableColumnAtSelection();
      return;
    }

    if (command.type === "insert-table-column-left") {
      insertTableColumnLeftAtSelection();
      return;
    }

    if (command.type === "delete-table-column") {
      deleteTableColumnAtSelection();
      return;
    }

    if (
      command.type === "insert-image" &&
      typeof command.assetId === "string" &&
      typeof command.name === "string" &&
      typeof command.data === "string" &&
      typeof command.w === "number" &&
      typeof command.h === "number"
    ) {
      insertImageAtCaret({
        assetId: command.assetId,
        name: command.name,
        data: command.data,
        w: command.w,
        h: command.h,
      }, command.placement ?? "caret");
      return;
    }

    if (command.type === "append-text" && typeof command.text === "string" && command.text.length > 0) {
      appendTextAtEnd(command.text);
    }
  }, [command, editing]);

  return (
    <div
      className={`canvas-node text-node ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: node.w,
        height: node.h,
        zIndex: node.z,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <div
        className="text-node-drag-handle"
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
          onDragHandlePointerDown(event);
        }}
      >
        {selected && !editing ? (
          <button
            type="button"
            className="text-node-top-resize"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResizePointerDown(event, "right");
            }}
            aria-label="Resize text node width"
          >
            &lt;&gt;
          </button>
        ) : null}
      </div>
      <div
        ref={editorRef}
        className="text-node-content"
        contentEditable={editing}
        suppressContentEditableWarning
        onPointerDownCapture={(event) => {
          const target = event.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const resizeWrapper = getTableResizeWrapper(event, targetElement);
          if (resizeWrapper) {
            onSelect();
            startTableResize(event, resizeWrapper);
          }
        }}
        onPointerDown={(event) => {
          const target = event.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const resizeWrapper = getTableResizeWrapper(event, targetElement);
          if (resizeWrapper) {
            onSelect();
            startTableResize(event, resizeWrapper);
            return;
          }

          if (!editing) {
            const nodeResizeHandle = getNodeResizeHandle(event);
            if (nodeResizeHandle) {
              onSelect();
              onResizePointerDown(event, nodeResizeHandle);
              return;
            }
          }

          const cell = target instanceof HTMLTableCellElement
            ? target
            : target instanceof HTMLElement
              ? target.closest("td")
              : null;
          rememberActiveTableCell(cell instanceof HTMLTableCellElement ? cell : null);
          const hoveredResizeCell = hoveredColumnCellRef.current;
          const targetTableWrap = target instanceof HTMLElement ? target.closest(".text-block-table-wrap") : null;
          if (
            hoveredResizeCell &&
            targetTableWrap &&
            hoveredResizeCell.closest(".text-block-table-wrap") === targetTableWrap
          ) {
            onSelect();
            startColumnResize(event, hoveredResizeCell);
            return;
          }
          const resizeCell = cell instanceof HTMLTableCellElement ? getColumnResizeCell(event, cell) : null;
          if (resizeCell) {
            onSelect();
            startColumnResize(event, resizeCell);
            return;
          }

          if (editing) {
            const block = target instanceof Element ? getBlockLocation(target) : null;
            if (event.shiftKey && cell instanceof HTMLTableCellElement) {
              const current = getCellLocation(cell);
              if (
                current?.tableKey &&
                selectionAnchor?.tableKey === current.tableKey &&
                selectionAnchor.row !== null &&
                selectionAnchor.column !== null
              ) {
                event.preventDefault();
                event.stopPropagation();
                applyCellRangeSelection(
                  {
                    tableKey: selectionAnchor.tableKey,
                    row: selectionAnchor.row,
                    column: selectionAnchor.column,
                  },
                  current,
                );
                return;
              }
            }
            if (event.shiftKey && block && selectionAnchor) {
              event.preventDefault();
              event.stopPropagation();
              applyBlockRangeSelection(selectionAnchor.blockIndex, block.blockIndex);
              return;
            }
            if (block) {
              startPendingSelection(event, block.blockIndex, cell instanceof HTMLTableCellElement ? cell : null);
            }
          }

          if (editing && target instanceof HTMLElement && target.dataset.imageResizeHandle === "true") {
            startInlineImageResize(event, target);
            return;
          }

          if (!editing) {
            event.stopPropagation();
            return;
          }

          if (editing) {
            event.stopPropagation();
          }
        }}
        onClick={(event) => {
          if (editing) {
            event.stopPropagation();
            return;
          }

          const nodeResizeHandle = getNodeResizeHandle(event);
          const target = event.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const resizeWrapper = getTableResizeWrapper(event, targetElement);
          const cell = target instanceof HTMLTableCellElement
            ? target
            : target instanceof HTMLElement
              ? target.closest("td")
              : null;
          const resizeCell = cell instanceof HTMLTableCellElement ? getColumnResizeCell(event, cell) : null;

          if (nodeResizeHandle || resizeWrapper || resizeCell) {
            event.stopPropagation();
            return;
          }

          event.stopPropagation();
          pendingCaretPointRef.current = { x: event.clientX, y: event.clientY };
          onSelect();
          onBeginEdit({ x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => {
          const target = event.target;
          const cell = target instanceof HTMLTableCellElement
            ? target
            : target instanceof HTMLElement
              ? target.closest("td")
              : null;
          const wrapper = target instanceof HTMLElement ? getTableResizeWrapper(event, target) : null;

          setTableResizeHover(wrapper instanceof HTMLElement ? wrapper : null);
          setColumnResizeHover(cell instanceof HTMLTableCellElement ? getColumnResizeCell(event, cell) : null);
        }}
        onPointerLeave={() => {
          setColumnResizeHover(null);
          setTableResizeHover(null);
        }}
        onInput={(event) => {
          draftHtmlRef.current = event.currentTarget.innerHTML;
          syncDimensionsToContent();
        }}
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onBlur={() => {
          if (pendingSelectionRef.current || suppressBlurCommitRef.current) {
            restoreEditorFocus();
            return;
          }
          syncDimensionsToContent();
          onCommit(getCurrentRichTextDoc());
        }}
      />
      {selected && !editing ? (
        <>
          <button
            type="button"
            className="resize-edge resize-edge-left"
            onPointerDown={(event) => onResizePointerDown(event, "left")}
            aria-label="Resize text node left edge"
          />
          <button
            type="button"
            className="resize-edge resize-edge-right"
            onPointerDown={(event) => onResizePointerDown(event, "right")}
            aria-label="Resize text node right edge"
          />
        </>
      ) : null}
    </div>
  );
};
