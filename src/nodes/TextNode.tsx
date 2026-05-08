import { useEffect, useRef, useState } from "react";
import { createTimelineExampleTableHtml } from "../timeline/parseTable";
import { createPortal } from "react-dom";
import type {
  ClipboardEvent as ReactClipboardEvent,
  MouseEvent as ReactMouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { ResizeHandle } from "../editor/resize";
import type { AssetMap, RichTextBlock, RichTextDoc, RichTextInline, TextNode as TextNodeType } from "../model/types";
import {
  createRichTextTableHtml,
  htmlToRichTextDoc,
  readTableColumnWidths,
  richTextDocToHtml,
  wrapRichTextTableHtml,
  wrapTableCellContentHtml,
} from "./richText";
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
  type:
    | "insert-table"
    | "insert-table-column"
    | "insert-table-column-left"
    | "delete-table-column"
    | "insert-image"
    | "append-text"
    | "set-font-family"
    | "set-font-size"
    | "set-text-color"
    | "set-highlight-color"
    | "apply-block-style"
    | "toggle-bold"
    | "toggle-italic"
    | "toggle-underline"
    | "toggle-strike"
    | "insert-timeline-example"
    | "insert-node-link";
  nonce: number;
  placement?: "caret" | "end";
  text?: string;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  blockStyle?: string;
  blockStylePreset?: {
    tag: string;
    fontSize?: string;
    color?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
  };
  assetId?: string;
  name?: string;
  data?: string;
  w?: number;
  h?: number;
  nodeLinkPage?: number;
  nodeLinkId?: string;
  nodeLinkDoc?: string;
  nodeLinkLabel?: string;
}
interface TextNodeProps {
  node: TextNodeType;
  assets: AssetMap;
  selected: boolean;
  editing: boolean;
  command: TextEditorCommand | null;
  contentRevision: number;
  highlightQuery?: string;
  onSelect: () => void;
  onBeginEdit: (point: { x: number; y: number }) => void;
  onCommit: (content: TextNodeType["content"]) => void;
  onDraftChange: (content: TextNodeType["content"], options?: { history?: "checkpoint" | "coalesce" }) => void;
  onPasteImage: (file: File) => Promise<{ assetId: string; name: string; data: string; w: number; h: number }>;
  onAutoResize: (height: number) => void;
  onAutoResizeWidth: (width: number) => void;
  onDragHandlePointerDown: (event: PointerLikeEvent) => void;
  onMiddlePanPointerDown: (event: PointerLikeEvent) => void;
  onResizePointerDown: (event: PointerLikeEvent, handle: ResizeHandle) => void;
  onNavigateTo?: (pageIndex: number, nodeId: string) => void;
  onNodeLinkClick?: (pageIndex: number, nodeId: string, x: number, y: number, documentPath?: string) => void;
  onRequestInsertNodeLink?: (x: number, y: number) => void;
  onRequestSelectAll?: () => void;
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
    }
  | {
      type: "mixed-range";
      startBlockIndex: number;
      endBlockIndex: number;
      startTableKey?: string;
      startRow?: number;
      endTableKey?: string;
      endRow?: number;
    };
type BlockStyleCommandPreset = NonNullable<TextEditorCommand["blockStylePreset"]>;
type RichTextTextLeaf = Extract<RichTextInline, { type: "text" }>;
type RichTextMark = NonNullable<RichTextTextLeaf["marks"]>[number];
type PointerLikeEvent = Pick<PointerEvent, "clientX" | "clientY" | "preventDefault" | "stopPropagation" | "altKey">;
type TableContextMenuState = {
  x: number;
  y: number;
  measured: boolean;
  tableKey: string;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
};
type TextContextMenuState = {
  x: number;
  y: number;
  measured: boolean;
};
const COLUMN_RESIZE_HIT_SLOP = 14;
const TABLE_RESIZE_HIT_SLOP = 18;
const NODE_RESIZE_HIT_SLOP = 22;
const TABLE_SELECTION_DRAG_THRESHOLD = 6;
const CONTEXT_MENU_VIEWPORT_PADDING = 8;
const TABLE_MIN_COLUMN_WIDTH = 72;
const NESTED_TABLE_MIN_COLUMN_WIDTH = 48;
const EMPTY_PARAGRAPH_HTML = `<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p><br /></p></div>`;
export const TextNode = ({
  node,
  assets,
  selected,
  editing,
  command,
  contentRevision,
  highlightQuery,
  onSelect,
  onBeginEdit,
  onCommit,
  onDraftChange,
  onPasteImage,
  onAutoResize,
  onAutoResizeWidth,
  onDragHandlePointerDown,
  onMiddlePanPointerDown,
  onResizePointerDown,
  onNavigateTo,
  onNodeLinkClick,
  onRequestInsertNodeLink,
  onRequestSelectAll,
}: TextNodeProps) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draftHtmlRef = useRef(richTextDocToHtml(node.content, assets));
  const appliedContentRevisionRef = useRef(contentRevision);
  const savedSelectionRangeRef = useRef<Range | null>(null);
  const cursorPathRef = useRef<{ path: number[]; offset: number } | null>(null);
  const pendingCaretPointRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredColumnCellRef = useRef<HTMLTableCellElement | null>(null);
  const hoveredTableWrapRef = useRef<HTMLElement | null>(null);
  const hoveredNodeResizeHandleRef = useRef<ResizeHandle | null>(null);
  const activeTableCellRef = useRef<HTMLTableCellElement | null>(null);
  const selectAllCycleRef = useRef<{
    scopeKey: string;
    stage: "line" | "cell" | "block" | "table" | "node";
  } | null>(null);
  const tableContextMenuRef = useRef<HTMLDivElement | null>(null);
  const textContextMenuRef = useRef<HTMLDivElement | null>(null);
  const suppressBlurCommitRef = useRef(false);
  const preserveToolbarBlurRef = useRef(false);
  const customClipboardRef = useRef<{ text: string; html: string } | null>(null);
  const middlePasteGuardRef = useRef<{ until: number; html: string } | null>(null);
  const pendingSelectionRef = useRef<{
    startBlockIndex: number;
    startTopBlockIndex: number;
    startTableKey: string | null;
    startRow: number | null;
    startColumn: number | null;
    startX: number;
    startY: number;
    mode: EditorSelectionState["type"];
  } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    blockIndex: number;
    topBlockIndex: number;
    tableKey: string | null;
    row: number | null;
    column: number | null;
  } | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelectionState>({ type: "none" });
  const editorSelectionRef = useRef<EditorSelectionState>({ type: "none" });
  const [tableContextMenu, setTableContextMenu] = useState<TableContextMenuState | null>(null);
  const [textContextMenu, setTextContextMenu] = useState<TextContextMenuState | null>(null);
  const updateEditorSelection = (nextSelection: EditorSelectionState) => {
    editorSelectionRef.current = nextSelection;
    setEditorSelection(nextSelection);
  };
  const getDeclaredElementWidth = (element: HTMLElement) => {
    const dataWidth = Number(element.getAttribute("data-w"));
    if (Number.isFinite(dataWidth) && dataWidth > 0) {
      return dataWidth;
    }
    const styleWidth = Number.parseFloat(element.style.width);
    return Number.isFinite(styleWidth) && styleWidth > 0 ? styleWidth : 0;
  };
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
  const measureEditorContentWidth = () => {
    const editor = editorRef.current;
    if (!editor) {
      return 320;
    }
    const editorStyle = window.getComputedStyle(editor);
    const paddingLeft = Number.parseFloat(editorStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
    const contentRight = Array.from(editor.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .reduce((right, child) => {
        const childStyle = window.getComputedStyle(child);
        const marginRight = Number.parseFloat(childStyle.marginRight) || 0;
        const childWidth = Math.max(child.offsetWidth, getDeclaredElementWidth(child));
        return Math.max(right, child.offsetLeft + childWidth + marginRight);
      }, 0);
    return Math.max(320, Math.ceil(Math.max(editor.scrollWidth, contentRight + paddingRight, paddingLeft + paddingRight)));
  };
  const applyImmediateNodeWidth = (width: number) => {
    const editor = editorRef.current;
    const nodeElement = editor?.closest(".text-node");
    if (!(nodeElement instanceof HTMLElement) || !Number.isFinite(width) || width <= 0) {
      return;
    }
    nodeElement.style.width = `${Math.ceil(width)}px`;
  };
  const restoreEditorFocus = () => {
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      suppressBlurCommitRef.current = false;
    });
  };
  const isSelectionInsideEditor = (selection: Selection | null) => {
    const editor = editorRef.current;
    if (!editor || !selection || selection.rangeCount === 0) {
      return false;
    }
    return editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
  };
  const isRangeInsideEditor = (range: Range | null) => {
    const editor = editorRef.current;
    if (!editor || !range) {
      return false;
    }
    return editor.contains(range.startContainer) && editor.contains(range.endContainer);
  };
  const saveCurrentSelectionRange = () => {
    const selection = window.getSelection();
    if (!isSelectionInsideEditor(selection)) {
      return false;
    }
    savedSelectionRangeRef.current = selection!.getRangeAt(0).cloneRange();
    return true;
  };
  const restoreSavedSelectionRange = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const savedRange = savedSelectionRangeRef.current;
    if (!editor || !selection || !savedRange || !isRangeInsideEditor(savedRange)) {
      return false;
    }
    try {
      editor.focus();
      selection.removeAllRanges();
      selection.addRange(savedRange.cloneRange());
      return true;
    } catch {
      return false;
    }
  };
  /** Save cursor position as DOM child-node indices + text offset.
   *  Survives text-node normalization because it stores numeric paths
   *  instead of raw DOM references. */
  const saveCursorPath = (): boolean => {
    const sel = window.getSelection();
    const editor = editorRef.current;
    if (!sel || !sel.rangeCount || !editor) return false;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    const path: number[] = [];
    let node: Node | null = range.startContainer;
    while (node && node !== editor) {
      const parent: Node | null = node.parentNode;
      if (!parent) return false;
      let index = -1;
      for (let i = 0; i < parent.childNodes.length; i += 1) {
        if (parent.childNodes[i] === node) { index = i; break; }
      }
      if (index === -1) return false;
      path.unshift(index);
      node = parent;
    }
    cursorPathRef.current = { path, offset: range.startOffset };
    return true;
  };
  const restoreCursorPath = (): boolean => {
    const editor = editorRef.current;
    const saved = cursorPathRef.current;
    if (!editor || !saved) return false;
    let node: Node = editor;
    for (const index of saved.path) {
      if (index >= node.childNodes.length) return false;
      node = node.childNodes[index];
    }
    try {
      const range = document.createRange();
      range.setStart(node, Math.min(saved.offset, node.textContent?.length ?? 0));
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        editor.focus();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    } catch {
      return false;
    }
  };
  const hasCollapsedEditorSelection = () => {
    const selection = window.getSelection();
    return isSelectionInsideEditor(selection) ? selection!.isCollapsed : false;
  };
  const applyInlineStyleAtCaret = (styles: Partial<CSSStyleDeclaration>) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !isSelectionInsideEditor(selection)) {
      return false;
    }
    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      return false;
    }
    const marker = document.createElement("span");
    marker.dataset.inlineStyleCaret = "true";
    Object.assign(marker.style, styles);
    const textNode = document.createTextNode("\u200b");
    marker.appendChild(textNode);
    range.insertNode(marker);
    const markerRange = document.createRange();
    markerRange.setStart(textNode, 0);
    markerRange.setEnd(textNode, textNode.textContent?.length ?? 1);
    selection.removeAllRanges();
    selection.addRange(markerRange);
    savedSelectionRangeRef.current = markerRange.cloneRange();
    return true;
  };
  const applyStyleToElement = (element: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
    Object.assign(element.style, styles);
    if (styles.fontFamily) {
      element.dataset.fontFamily = styles.fontFamily;
    }
    if (styles.fontSize) {
      element.dataset.fontSize = styles.fontSize;
    }
    if (styles.color) {
      element.dataset.textColor = styles.color;
    }
    if (styles.backgroundColor) {
      element.dataset.highlightColor = styles.backgroundColor;
    }
  };
  const wrapTextRangeWithStyle = (
    textNode: Text,
    startOffset: number,
    endOffset: number,
    styles: Partial<CSSStyleDeclaration>,
  ) => {
    if (startOffset >= endOffset) {
      return null;
    }
    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, endOffset);
    const span = document.createElement("span");
    applyStyleToElement(span, styles);
    span.appendChild(range.extractContents());
    range.insertNode(span);
    return span;
  };
  const applyInlineStylesToSelection = (styles: Partial<CSSStyleDeclaration>) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !isSelectionInsideEditor(selection)) {
      return false;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      return false;
    }
    const selectedTextNodes: Text[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!(node instanceof Text) || !node.textContent || !range.intersectsNode(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest(".text-inline-image-frame")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current = walker.nextNode();
    while (current) {
      if (current instanceof Text) {
        selectedTextNodes.push(current);
      }
      current = walker.nextNode();
    }
    if (selectedTextNodes.length === 0) {
      return false;
    }
    const styledElements: HTMLElement[] = [];
    selectedTextNodes.forEach((textNode) => {
      const length = textNode.textContent?.length ?? 0;
      const startOffset = textNode === range.startContainer ? range.startOffset : 0;
      const endOffset = textNode === range.endContainer ? range.endOffset : length;
      if (startOffset === 0 && endOffset === length && textNode.parentElement instanceof HTMLElement) {
        applyStyleToElement(textNode.parentElement, styles);
        styledElements.push(textNode.parentElement);
        return;
      }
      const span = wrapTextRangeWithStyle(textNode, startOffset, endOffset, styles);
      if (span) {
        styledElements.push(span);
      }
    });
    if (styledElements.length > 0) {
      const nextRange = document.createRange();
      nextRange.setStartBefore(styledElements[0]);
      nextRange.setEndAfter(styledElements[styledElements.length - 1]);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      savedSelectionRangeRef.current = nextRange.cloneRange();
    }
    draftHtmlRef.current = editor.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
    editor.focus();
    return true;
  };
  const getInlineStylesForCommand = (nextCommand: TextEditorCommand): Partial<CSSStyleDeclaration> | null => {
    if (nextCommand.type === "set-font-family" && typeof nextCommand.fontFamily === "string") {
      return { fontFamily: nextCommand.fontFamily };
    }
    if (nextCommand.type === "set-font-size" && typeof nextCommand.fontSize === "string") {
      return { fontSize: nextCommand.fontSize };
    }
    if (nextCommand.type === "set-text-color" && typeof nextCommand.color === "string") {
      return { color: nextCommand.color };
    }
    if (nextCommand.type === "set-highlight-color" && typeof nextCommand.color === "string") {
      return { backgroundColor: nextCommand.color };
    }
    return null;
  };
  const getBlockStyleForCommand = (nextCommand: TextEditorCommand): BlockStyleCommandPreset | null => {
    if (nextCommand.type !== "apply-block-style" || typeof nextCommand.blockStyle !== "string") {
      return null;
    }
    const stylesById: Record<string, BlockStyleCommandPreset> = {
      title1: { tag: "h1", fontSize: "32px", bold: true, color: "#24211F" },
      title2: { tag: "h2", fontSize: "28px", bold: true, color: "#24211F" },
      title3: { tag: "h3", fontSize: "24px", bold: true, color: "#24211F" },
      title4: { tag: "h4", fontSize: "20px", bold: true, italic: true, color: "#6B6661" },
      title5: { tag: "h5", fontSize: "18px", bold: true, italic: true, color: "#6B6661" },
      title6: { tag: "h6", fontSize: "16px", bold: true, italic: true, color: "#6B6661" },
      pageTitle: { tag: "h1", fontSize: "36px", bold: true, color: "#24211F" },
      lead: { tag: "p", fontSize: "18px", color: "#6B6661" },
      quote: { tag: "blockquote", fontSize: "16px", italic: true, color: "#9E9993" },
      code: { tag: "pre", fontSize: "15px", fontFamily: "Consolas, monospace", color: "#D57D61" },
      normal: { tag: "p", fontSize: "16px", color: "#24211F" },
    };
    return nextCommand.blockStylePreset ?? stylesById[nextCommand.blockStyle] ?? null;
  };
  const getSelectedTableCells = () => {
    const selection = editorSelectionRef.current;
    const highlightedCells = Array.from(editorRef.current?.querySelectorAll("td.table-cell-range-selected") ?? [])
      .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
    const getRangeSelectedCells = () => {
      const editor = editorRef.current;
      const browserSelection = window.getSelection();
      const range = isSelectionInsideEditor(browserSelection)
        ? browserSelection!.getRangeAt(0)
        : savedSelectionRangeRef.current;
      if (!editor || !range || !isRangeInsideEditor(range) || range.collapsed) {
        return [];
      }
      return Array.from(editor.querySelectorAll("td"))
        .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement && range.intersectsNode(cell));
    };
    if (selection.type !== "cell-range") {
      if (highlightedCells.length > 0) {
        return highlightedCells;
      }
      const rangeSelectedCells = getRangeSelectedCells();
      return rangeSelectedCells.length > 1 ? rangeSelectedCells : [];
    }
    const wrapper = editorRef.current?.querySelector(`[data-table-key="${selection.tableKey}"]`);
    const table = wrapper instanceof HTMLElement ? getTableElement(wrapper) : null;
    if (!table) {
      if (highlightedCells.length > 0) {
        return highlightedCells;
      }
      const rangeSelectedCells = getRangeSelectedCells();
      return rangeSelectedCells.length > 1 ? rangeSelectedCells : [];
    }
    const cells: HTMLTableCellElement[] = [];
    for (let rowIndex = selection.startRow; rowIndex <= selection.endRow; rowIndex += 1) {
      const row = table.rows.item(rowIndex);
      if (!row) {
        continue;
      }
      for (let columnIndex = selection.startColumn; columnIndex <= selection.endColumn; columnIndex += 1) {
        const cell = row.cells.item(columnIndex);
        if (cell instanceof HTMLTableCellElement) {
          cells.push(cell);
        }
      }
    }
    if (cells.length > 0) {
      return cells;
    }
    if (highlightedCells.length > 0) {
      return highlightedCells;
    }
    const rangeSelectedCells = getRangeSelectedCells();
    return rangeSelectedCells.length > 1 ? rangeSelectedCells : [];
  };
  const getSelectedTableCellLocations = () => {
    const uniqueLocations = new Map<string, NonNullable<ReturnType<typeof getCellLocation>>>();
    getSelectedTableCells().forEach((cell) => {
      const location = getCellLocation(cell);
      if (!location) {
        return;
      }
      uniqueLocations.set(`${location.topBlockIndex}:${location.row}:${location.column}`, location);
    });
    return Array.from(uniqueLocations.values());
  };
  const setTextMark = (marks: RichTextMark[] | undefined, mark: RichTextMark, enabled: boolean) => {
    const nextMarks = marks ?? [];
    return enabled
      ? Array.from(new Set([...nextMarks, mark]))
      : nextMarks.filter((current) => current !== mark);
  };
  const toggleTextMark = (marks: RichTextMark[] | undefined, mark: RichTextMark, remove: boolean) => {
    const nextMarks = marks ?? [];
    return remove
      ? nextMarks.filter((current) => current !== mark)
      : Array.from(new Set([...nextMarks, mark]));
  };
  const mapTextInBlocks = (
    blocks: RichTextBlock[],
    mapText: (inline: RichTextTextLeaf) => RichTextTextLeaf,
  ): RichTextBlock[] =>
    blocks.map((block) => {
      if (block.type === "paragraph") {
        const hasText = block.content.some((inline) => inline.type === "text");
        return {
          ...block,
          content: hasText
            ? block.content.map((inline) => (inline.type === "text" ? mapText(inline) : inline))
            : [mapText({ type: "text", text: "" })],
        };
      }
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: mapTextInBlocks(cell.content, mapText),
          })),
        })),
      };
    });
  const collectTextLeavesInBlocks = (blocks: RichTextBlock[]): RichTextTextLeaf[] =>
    blocks.flatMap((block) => {
      if (block.type === "paragraph") {
        return block.content.filter((inline): inline is RichTextTextLeaf => inline.type === "text");
      }
      return block.rows.flatMap((row) => row.cells.flatMap((cell) => collectTextLeavesInBlocks(cell.content)));
    });
  const mapSelectedTableCellsInDoc = (
    doc: RichTextDoc,
    locations: Array<NonNullable<ReturnType<typeof getCellLocation>>>,
    mapCellBlocks: (blocks: RichTextBlock[]) => RichTextBlock[],
  ) => {
    const locationsByTable = new Map<number, Map<string, true>>();
    locations.forEach((location) => {
      const tableLocations = locationsByTable.get(location.topBlockIndex) ?? new Map<string, true>();
      tableLocations.set(`${location.row}:${location.column}`, true);
      locationsByTable.set(location.topBlockIndex, tableLocations);
    });
    return {
      ...doc,
      content: doc.content.map((block, blockIndex) => {
        const tableLocations = locationsByTable.get(blockIndex);
        if (!tableLocations || block.type !== "table") {
          return block;
        }
        return {
          ...block,
          rows: block.rows.map((row, rowIndex) => ({
            ...row,
            cells: row.cells.map((cell, columnIndex) => (
              tableLocations.has(`${rowIndex}:${columnIndex}`)
                ? { ...cell, content: mapCellBlocks(cell.content) }
                : cell
            )),
          })),
        };
      }),
    };
  };
  const applyTextCommandToLeaf = (
    inline: RichTextTextLeaf,
    nextCommand: TextEditorCommand,
    options: { removeBold: boolean; removeItalic: boolean; removeUnderline: boolean; removeStrike: boolean },
  ): RichTextTextLeaf => {
    if (nextCommand.type === "set-font-family" && typeof nextCommand.fontFamily === "string") {
      return { ...inline, fontFamily: nextCommand.fontFamily };
    }
    if (nextCommand.type === "set-font-size" && typeof nextCommand.fontSize === "string") {
      return { ...inline, fontSize: nextCommand.fontSize };
    }
    if (nextCommand.type === "set-text-color" && typeof nextCommand.color === "string") {
      return { ...inline, color: nextCommand.color };
    }
    if (nextCommand.type === "set-highlight-color" && typeof nextCommand.color === "string") {
      if (nextCommand.color === "transparent") {
        const { highlightColor: _highlightColor, ...rest } = inline;
        return rest;
      }
      return { ...inline, highlightColor: nextCommand.color };
    }
    if (nextCommand.type === "toggle-bold") {
      return { ...inline, marks: toggleTextMark(inline.marks, "bold", options.removeBold) };
    }
    if (nextCommand.type === "toggle-italic") {
      return { ...inline, marks: toggleTextMark(inline.marks, "italic", options.removeItalic) };
    }
    if (nextCommand.type === "toggle-underline") {
      return { ...inline, marks: toggleTextMark(inline.marks, "underline", options.removeUnderline) };
    }
    if (nextCommand.type === "toggle-strike") {
      return { ...inline, marks: toggleTextMark(inline.marks, "strike", options.removeStrike) };
    }
    const blockStyle = getBlockStyleForCommand(nextCommand);
    if (!blockStyle) {
      return inline;
    }
    return {
      ...inline,
      ...(blockStyle.fontFamily ? { fontFamily: blockStyle.fontFamily } : {}),
      ...(blockStyle.fontSize ? { fontSize: blockStyle.fontSize } : {}),
      ...(blockStyle.color ? { color: blockStyle.color } : {}),
      marks: setTextMark(
        setTextMark(inline.marks, "bold", blockStyle.bold ?? inline.marks?.includes("bold") ?? false),
        "italic",
        blockStyle.italic ?? inline.marks?.includes("italic") ?? false,
      ),
    };
  };
  const applyFormatCommandToSelectedTableCellModel = (nextCommand: TextEditorCommand) => {
    const locations = getSelectedTableCellLocations();
    if (locations.length === 0) {
      return false;
    }
    const currentDoc = getCurrentRichTextDoc();
    const selectedTextLeaves = locations.flatMap((location) => {
      const block = currentDoc.content[location.topBlockIndex];
      if (block?.type !== "table") {
        return [];
      }
      const cell = block.rows[location.row]?.cells[location.column];
      return cell ? collectTextLeavesInBlocks(cell.content) : [];
    });
    const options = {
      removeBold: selectedTextLeaves.length > 0 && selectedTextLeaves.every((inline) => inline.marks?.includes("bold")),
      removeItalic: selectedTextLeaves.length > 0 && selectedTextLeaves.every((inline) => inline.marks?.includes("italic")),
      removeUnderline: selectedTextLeaves.length > 0 && selectedTextLeaves.every((inline) => inline.marks?.includes("underline")),
      removeStrike: selectedTextLeaves.length > 0 && selectedTextLeaves.every((inline) => inline.marks?.includes("strike")),
    };
    const nextDoc = mapSelectedTableCellsInDoc(currentDoc, locations, (blocks) =>
      mapTextInBlocks(blocks, (inline) => applyTextCommandToLeaf(inline, nextCommand, options)));
    draftHtmlRef.current = richTextDocToHtml(nextDoc, assets);
    if (editorRef.current) {
      editorRef.current.innerHTML = draftHtmlRef.current;
    }
    syncDimensionsToContent();
    onDraftChange(nextDoc, { history: "checkpoint" });
    editorRef.current?.focus();
    return true;
  };
  const getCellBlockFormattingTargets = (cell: HTMLTableCellElement) => {
    const root = cell.querySelector(":scope > .text-block-table-cell-content") ?? cell;
    const blocks = Array.from(root.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.blockKind === "paragraph")
      .map((block) => Array.from(block.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() !== "br") ?? block);
    return blocks.length > 0 ? blocks : [root instanceof HTMLElement ? root : cell];
  };
  const getCellInlineFormattingTargets = (cell: HTMLTableCellElement) => {
    const root = cell.querySelector(":scope > .text-block-table-cell-content") ?? cell;
    if (!(root instanceof HTMLElement)) {
      return [cell];
    }
    const targets = new Set<HTMLElement>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      if ((current.textContent ?? "").length > 0) {
        const parent = current.parentElement;
        if (
          parent
          && !parent.closest(".text-inline-image-frame")
          && !parent.closest("[data-table-resize-handle='true']")
        ) {
          targets.add(parent);
        }
      }
      current = walker.nextNode();
    }
    Array.from(root.querySelectorAll("[data-font-family], [data-font-size], [data-text-color], [data-highlight-color], font"))
      .forEach((element) => {
        if (element instanceof HTMLElement && !element.closest(".text-inline-image-frame")) {
          targets.add(element);
        }
      });
    return targets.size > 0 ? Array.from(targets) : getCellBlockFormattingTargets(cell);
  };
  const applyStyleToFormattingTarget = (target: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
    Object.assign(target.style, styles);
    if (styles.fontFamily) {
      target.dataset.fontFamily = styles.fontFamily;
    }
    if (styles.fontSize) {
      target.dataset.fontSize = styles.fontSize;
    }
    if (styles.color) {
      target.dataset.textColor = styles.color;
    }
    if (styles.backgroundColor) {
      target.dataset.highlightColor = styles.backgroundColor;
    }
  };
  const replaceFormattingTargetTag = (target: HTMLElement, tagName: string) => {
    if (target.tagName.toLowerCase() === tagName) {
      return target;
    }
    const replacement = document.createElement(tagName);
    Array.from(target.attributes).forEach((attribute) => replacement.setAttribute(attribute.name, attribute.value));
    replacement.innerHTML = target.innerHTML;
    target.replaceWith(replacement);
    return replacement;
  };
  const applyBlockStyleToFormattingTarget = (target: HTMLElement, style: BlockStyleCommandPreset) => {
    const nextTarget = replaceFormattingTargetTag(target, style.tag);
    applyStyleToFormattingTarget(nextTarget, {
      ...(style.fontSize ? { fontSize: style.fontSize } : {}),
      ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
      ...(style.color ? { color: style.color } : {}),
      ...(typeof style.bold === "boolean" ? { fontWeight: style.bold ? "700" : "400" } : {}),
      ...(typeof style.italic === "boolean" ? { fontStyle: style.italic ? "italic" : "normal" } : {}),
    });
  };
  const applyFormatCommandToSelectedTableCells = (nextCommand: TextEditorCommand) => {
    const cells = getSelectedTableCells();
    if (cells.length === 0) {
      return false;
    }
    const inlineStyles = getInlineStylesForCommand(nextCommand);
    const blockStyle = getBlockStyleForCommand(nextCommand);
    if (!inlineStyles && !blockStyle) {
      return false;
    }
    cells.forEach((cell) => {
      if (blockStyle) {
        getCellBlockFormattingTargets(cell).forEach((target) => applyBlockStyleToFormattingTarget(target, blockStyle));
        getCellInlineFormattingTargets(cell).forEach((target) => applyStyleToFormattingTarget(target, {
          ...(blockStyle.fontSize ? { fontSize: blockStyle.fontSize } : {}),
          ...(blockStyle.fontFamily ? { fontFamily: blockStyle.fontFamily } : {}),
          ...(blockStyle.color ? { color: blockStyle.color } : {}),
          ...(typeof blockStyle.bold === "boolean" ? { fontWeight: blockStyle.bold ? "700" : "400" } : {}),
          ...(typeof blockStyle.italic === "boolean" ? { fontStyle: blockStyle.italic ? "italic" : "normal" } : {}),
        }));
        return;
      }
      getCellInlineFormattingTargets(cell).forEach((target) => {
        applyStyleToFormattingTarget(target, inlineStyles!);
      });
    });
    commitDraftFromDom();
    editorRef.current?.focus();
    return true;
  };
  const syncDimensionsToContent = (options?: { expandTables?: boolean }) => {
    if (!editorRef.current) {
      return;
    }
    if (options?.expandTables) {
      expandTablesToFitContent();
    }
    const measuredWidth = measureEditorContentWidth();
    applyImmediateNodeWidth(measuredWidth);
    onAutoResizeWidth(measuredWidth);
    syncHeightToContent();
  };
  const commitDraftFromDom = (options?: { expandTables?: boolean; history?: "checkpoint" | "coalesce" }) => {
    if (!editorRef.current) {
      return;
    }
    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent(options);
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: options?.history ?? "checkpoint" });
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
  const isNestedTableWrapper = (wrapper: HTMLElement) => !!wrapper.closest("td");
  const getTableBaseColumnWidth = (wrapper: HTMLElement) =>
    isNestedTableWrapper(wrapper) ? NESTED_TABLE_MIN_COLUMN_WIDTH : TABLE_MIN_COLUMN_WIDTH;
  const getHorizontalPadding = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  };
  const getElementPixelWidth = (element: HTMLElement) => {
    const declaredWidth = getDeclaredElementWidth(element);
    if (declaredWidth > 0) {
      return declaredWidth;
    }
    const rectWidth = element.getBoundingClientRect().width;
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
      return rectWidth;
    }
    return element.offsetWidth;
  };
  const getTopLevelEditorBlock = (element: HTMLElement) => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }
    let current: HTMLElement | null = element;
    while (current && current.parentElement !== editor) {
      current = current.parentElement;
    }
    return current?.parentElement === editor ? current : null;
  };
  const syncDimensionsToTableWrapper = (wrapper: HTMLElement) => {
    const editor = editorRef.current;
    const topBlock = getTopLevelEditorBlock(wrapper);
    if (!editor || !topBlock) {
      syncDimensionsToContent();
      return;
    }
    const editorStyle = window.getComputedStyle(editor);
    const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
    const topBlockStyle = window.getComputedStyle(topBlock);
    const marginRight = Number.parseFloat(topBlockStyle.marginRight) || 0;
    const tableDrivenWidth = topBlock.offsetLeft + getElementPixelWidth(topBlock) + marginRight + paddingRight;
    const measuredWidth = Math.max(measureEditorContentWidth(), Math.ceil(tableDrivenWidth));
    applyImmediateNodeWidth(measuredWidth);
    onAutoResizeWidth(measuredWidth);
    syncHeightToContent();
  };
  const getMeasuredTableColumnWidths = (wrapper: HTMLElement, table: HTMLTableElement) => {
    const firstRow = table.rows.item(0);
    if (!firstRow) {
      return [];
    }
    return Array.from(firstRow.cells).map((cell) =>
      Math.max(getTableBaseColumnWidth(wrapper), Math.round(cell.getBoundingClientRect().width || cell.offsetWidth || 120)),
    );
  };
  const getCellNestedTableWidthRequirement = (cell: HTMLTableCellElement) => {
    const nestedWidths = Array.from(cell.querySelectorAll(".text-block-table-wrap"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => getElementPixelWidth(element))
      .filter((width) => Number.isFinite(width) && width > 0);
    if (nestedWidths.length === 0) {
      return 0;
    }
    return Math.ceil(Math.max(...nestedWidths) + getHorizontalPadding(cell));
  };
  const getTableColumnMinimumWidths = (wrapper: HTMLElement, table: HTMLTableElement) => {
    const columnCount = table.rows.item(0)?.cells.length ?? 0;
    if (columnCount === 0) {
      return [];
    }
    const minimumWidths: number[] = Array.from({ length: columnCount }, () => getTableBaseColumnWidth(wrapper));
    Array.from(table.rows).forEach((row) => {
      Array.from(row.cells).forEach((cell) => {
        if (!(cell instanceof HTMLTableCellElement)) {
          return;
        }
        const columnIndex = cell.cellIndex;
        minimumWidths[columnIndex] = Math.max(
          minimumWidths[columnIndex] ?? getTableBaseColumnWidth(wrapper),
          getCellNestedTableWidthRequirement(cell),
        );
      });
    });
    return minimumWidths;
  };
  const getTableMinimumWidth = (wrapper: HTMLElement) => {
    const table = getTableElement(wrapper);
    if (!table) {
      return isNestedTableWrapper(wrapper) ? 96 : 180;
    }
    return getTableColumnMinimumWidths(wrapper, table).reduce((sum, width) => sum + width, 0);
  };
  const normalizeTableColumnWidths = (wrapper: HTMLElement, table: HTMLTableElement, widths: number[]) => {
    const columnCount = table.rows.item(0)?.cells.length ?? 0;
    if (columnCount === 0) {
      return [];
    }
    const fallbackWidths = getMeasuredTableColumnWidths(wrapper, table);
    const minimumWidths = getTableColumnMinimumWidths(wrapper, table);
    return Array.from({ length: columnCount }, (_, index) =>
      Math.max(minimumWidths[index] ?? getTableBaseColumnWidth(wrapper), Math.round(widths[index] ?? fallbackWidths[index] ?? 120)),
    );
  };
  const getTableColumnWidths = (wrapper: HTMLElement) => {
    const table = getTableElement(wrapper);
    if (!table) {
      return [];
    }
    const explicitWidths = readTableColumnWidths(wrapper, table);
    if (explicitWidths.length > 0) {
      return normalizeTableColumnWidths(wrapper, table, explicitWidths);
    }
    return getMeasuredTableColumnWidths(wrapper, table);
  };
  const expandAncestorColumnsForNestedTable = (wrapper: HTMLElement, childWidth = getElementPixelWidth(wrapper)) => {
    let currentWrapper: HTMLElement | null = wrapper;
    let requiredNestedWidth = childWidth;
    let containingCell = currentWrapper.closest("td");
    while (containingCell instanceof HTMLTableCellElement) {
      const parentWrapper = containingCell.closest(".text-block-table-wrap");
      if (!(parentWrapper instanceof HTMLElement) || parentWrapper === currentWrapper) {
        break;
      }
      const parentTable = getTableElement(parentWrapper);
      if (!parentTable) {
        break;
      }
      const columnIndex = containingCell.cellIndex;
      const currentWidths = getTableColumnWidths(parentWrapper);
      if (currentWidths.length === 0) {
        break;
      }
      const requiredColumnWidth = Math.ceil(requiredNestedWidth + getHorizontalPadding(containingCell));
      const nextWidths = [...currentWidths];
      nextWidths[columnIndex] = Math.max(nextWidths[columnIndex] ?? 0, requiredColumnWidth);
      const nextTotalWidth = nextWidths.reduce((sum, width) => sum + width, 0);
      const currentMaterializedWidth = getElementPixelWidth(parentWrapper);
      const hasMaterializedColumnWidths = (parentWrapper.getAttribute("data-col-widths") ?? "").trim().length > 0;
      if (
        nextWidths.some((width, index) => width > currentWidths[index])
        || !hasMaterializedColumnWidths
        || nextTotalWidth > currentMaterializedWidth + 0.5
      ) {
        applyTableColumnWidths(parentWrapper, nextWidths, { expandAncestors: false });
      }
      currentWrapper = parentWrapper;
      requiredNestedWidth = Math.max(
        getElementPixelWidth(parentWrapper),
        nextTotalWidth,
      );
      containingCell = currentWrapper.closest("td");
    }
  };
  const applyTableColumnWidths = (
    wrapper: HTMLElement,
    widths: number[],
    options: { expandAncestors?: boolean } = {},
  ) => {
    const table = getTableElement(wrapper);
    if (!table) {
      return;
    }
    const normalizedWidths = normalizeTableColumnWidths(wrapper, table, widths);
    if (normalizedWidths.length === 0) {
      return;
    }
    let colGroup = table.querySelector(":scope > colgroup");
    if (!(colGroup instanceof HTMLTableColElement)) {
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
    if (options.expandAncestors !== false && isNestedTableWrapper(wrapper)) {
      expandAncestorColumnsForNestedTable(wrapper, totalWidth);
    }
  };
  const expandTablesToFitContent = () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const wrappers = Array.from(editor.querySelectorAll(".text-block-table-wrap"))
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .sort((left, right) => {
        const leftDepth = Number(left.dataset.tableDepth ?? (isNestedTableWrapper(left) ? 1 : 0));
        const rightDepth = Number(right.dataset.tableDepth ?? (isNestedTableWrapper(right) ? 1 : 0));
        return rightDepth - leftDepth;
      });
    wrappers.forEach((wrapper) => {
      const table = getTableElement(wrapper);
      if (!table || table.rows.length === 0) {
        return;
      }
      const widths = getTableColumnWidths(wrapper);
      if (widths.length > 0) {
        applyTableColumnWidths(wrapper, widths);
      }
    });
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
      const nextWidth = Math.max(getTableMinimumWidth(wrapper), startWidth + (moveEvent.clientX - startX) / screenScale);
      if (startColumnWidths.length > 0) {
        const nextWidths = [...startColumnWidths];
        nextWidths[nextWidths.length - 1] = Math.max(
          getTableBaseColumnWidth(wrapper),
          startColumnWidths[startColumnWidths.length - 1] + (nextWidth - startWidth),
        );
        applyTableColumnWidths(wrapper, nextWidths);
      } else {
        wrapper.style.width = `${nextWidth}px`;
        wrapper.setAttribute("data-w", String(Math.round(nextWidth)));
        if (isNestedTableWrapper(wrapper)) {
          expandAncestorColumnsForNestedTable(wrapper, nextWidth);
        }
      }
      syncDimensionsToTableWrapper(wrapper);
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
      nextWidths[columnIndex] = Math.max(getTableBaseColumnWidth(wrapper), startWidth + (moveEvent.clientX - startX) / screenScale);
      applyTableColumnWidths(wrapper, nextWidths);
      syncDimensionsToTableWrapper(wrapper);
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
    event: Pick<PointerLikeEvent, "clientX" | "clientY">,
    element: HTMLElement | null,
  ) => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }
    const wrappers = Array.from(editor.querySelectorAll(".text-block-table-wrap"))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map((wrapper) => ({
        wrapper,
        rect: wrapper.getBoundingClientRect(),
      }))
      .filter(({ rect }) =>
        event.clientY >= rect.top - TABLE_RESIZE_HIT_SLOP
        && event.clientY <= rect.bottom + TABLE_RESIZE_HIT_SLOP
        && Math.abs(rect.right - event.clientX) <= TABLE_RESIZE_HIT_SLOP
      )
      .sort((left, right) => {
        const rightDistanceDiff = Math.abs(left.rect.right - event.clientX) - Math.abs(right.rect.right - event.clientX);
        if (rightDistanceDiff !== 0) {
          return rightDistanceDiff;
        }
        return left.rect.width - right.rect.width;
      });
    if (wrappers.length > 0) {
      return wrappers[0].wrapper;
    }
    return null;
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
      editorRef.current.style.cursor = cell ? "ew-resize" : "";
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
  const setNodeResizeHover = (handle: ResizeHandle | null) => {
    if (hoveredNodeResizeHandleRef.current === handle) {
      return;
    }
    hoveredNodeResizeHandleRef.current = handle;
    if (editorRef.current) {
      editorRef.current.style.cursor = handle ? "ew-resize" : "";
    }
  };
  const clearTableCellSelection = () => {
    updateEditorSelection({ type: "none" });
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
  const getTopLevelBlockLocation = (element: Element | null) => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }
    let current = element instanceof HTMLElement ? element : element?.parentElement ?? null;
    while (current && current.parentElement !== editor) {
      current = current.parentElement;
    }
    if (!(current instanceof HTMLElement) || current.parentElement !== editor || !current.dataset.blockKind) {
      return null;
    }
    const topBlockIndex = Number(current.dataset.topBlockIndex);
    if (!Number.isInteger(topBlockIndex)) {
      return null;
    }
    return {
      block: current,
      topBlockIndex,
      blockKind: current.dataset.blockKind ?? "",
    };
  };
  const getCellLocation = (cell: HTMLTableCellElement) => {
    const wrapper = cell.closest(".text-block-table-wrap");
    const row = cell.parentElement;
    const blockLocation = getBlockLocation(cell);
    const topLevelBlockLocation = getTopLevelBlockLocation(cell);
    if (!(wrapper instanceof HTMLElement) || !(row instanceof HTMLTableRowElement) || !blockLocation || !topLevelBlockLocation) {
      return null;
    }
    return {
      blockIndex: blockLocation.blockIndex,
      topBlockIndex: topLevelBlockLocation.topBlockIndex,
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
  const syncActiveTableCellFromSelection = () => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const selectionCell = anchorNode instanceof Element
      ? anchorNode.closest("td")
      : anchorNode?.parentElement?.closest("td");
    if (selectionCell instanceof HTMLTableCellElement && editorRef.current?.contains(selectionCell)) {
      activeTableCellRef.current = selectionCell;
    }
  };
  const applyInlineFormatCommand = (nextCommand: TextEditorCommand) => {
    if (!editorRef.current) {
      return false;
    }
    if (applyFormatCommandToSelectedTableCellModel(nextCommand)) {
      return true;
    }
    if (applyFormatCommandToSelectedTableCells(nextCommand)) {
      return true;
    }
    if (!restoreSavedSelectionRange()) {
      if (!saveCurrentSelectionRange()) {
        editorRef.current.focus();
      }
      if (!restoreSavedSelectionRange()) {
        return false;
      }
    }
    const selection = window.getSelection();
    if (!isSelectionInsideEditor(selection)) {
      return false;
    }
    if (hasCollapsedEditorSelection()) {
      const collapsedStyles = getInlineStylesForCommand(nextCommand);
      if (collapsedStyles && applyInlineStyleAtCaret(collapsedStyles)) {
        draftHtmlRef.current = editorRef.current.innerHTML;
        syncDimensionsToContent();
        onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
        saveCurrentSelectionRange();
        editorRef.current.focus();
        return true;
      }
    }
    if (nextCommand.type === "set-font-size" && typeof nextCommand.fontSize === "string") {
      if (applyInlineStylesToSelection({ fontSize: nextCommand.fontSize })) {
        return true;
      }
    }
    document.execCommand("styleWithCSS", false, "true");
    if (nextCommand.type === "set-font-family" && typeof nextCommand.fontFamily === "string") {
      document.execCommand("fontName", false, nextCommand.fontFamily);
    }
    if (nextCommand.type === "set-font-size" && typeof nextCommand.fontSize === "string") {
      document.execCommand("fontSize", false, "7");
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const fontElements = editorRef.current.querySelectorAll("font[size='7']");
      fontElements.forEach((element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }
        if (range && !range.intersectsNode(element)) {
          return;
        }
        element.removeAttribute("size");
        element.style.fontSize = nextCommand.fontSize!;
        element.dataset.fontSize = nextCommand.fontSize!;
      });
    }
    if (nextCommand.type === "set-text-color" && typeof nextCommand.color === "string") {
      document.execCommand("foreColor", false, nextCommand.color);
    }
    if (nextCommand.type === "set-highlight-color" && typeof nextCommand.color === "string") {
      document.execCommand("hiliteColor", false, nextCommand.color);
    }
    if (nextCommand.type === "apply-block-style" && typeof nextCommand.blockStyle === "string") {
      const style = getBlockStyleForCommand(nextCommand);
      if (style) {
        document.execCommand("formatBlock", false, style.tag);
        if (style.fontSize) {
          document.execCommand("fontSize", false, "7");
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const fontElements = editorRef.current.querySelectorAll("font[size='7']");
          fontElements.forEach((element) => {
            if (!(element instanceof HTMLElement)) {
              return;
            }
            if (range && !range.intersectsNode(element)) {
              return;
            }
            element.removeAttribute("size");
            element.style.fontSize = style.fontSize!;
            element.dataset.fontSize = style.fontSize!;
          });
        }
        if (style.fontFamily) {
          document.execCommand("fontName", false, style.fontFamily);
        }
        if (style.color) {
          document.execCommand("foreColor", false, style.color);
        }
        if (style.bold) {
          document.execCommand("bold");
        }
        if (style.italic) {
          document.execCommand("italic");
        }
      }
    }
    if (nextCommand.type === "toggle-bold") {
      document.execCommand("bold");
    }
    if (nextCommand.type === "toggle-italic") {
      document.execCommand("italic");
    }
    if (nextCommand.type === "toggle-underline") {
      document.execCommand("underline");
    }
    if (nextCommand.type === "toggle-strike") {
      document.execCommand("strikeThrough");
    }
    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
    saveCurrentSelectionRange();
    editorRef.current.focus();
    return true;
  };
  const applyCellRangeSelection = (
    start: { tableKey: string; row: number; column: number },
    end: { tableKey: string; row: number; column: number },
  ) => {
    if (!start.tableKey || !end.tableKey || start.tableKey !== end.tableKey) {
      return;
    }
    updateEditorSelection({
      type: "cell-range",
      tableKey: start.tableKey,
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startColumn: Math.min(start.column, end.column),
      endColumn: Math.max(start.column, end.column),
    });
  };
  const applyBlockRangeSelection = (startBlockIndex: number, endBlockIndex: number) => {
    updateEditorSelection({
      type: "block-range",
      startBlockIndex: Math.min(startBlockIndex, endBlockIndex),
      endBlockIndex: Math.max(startBlockIndex, endBlockIndex),
    });
  };
  const applyMixedRangeSelection = (options: {
    startBlockIndex: number;
    endBlockIndex: number;
    startTableKey?: string;
    startRow?: number;
    endTableKey?: string;
    endRow?: number;
  }) => {
    updateEditorSelection({
      type: "mixed-range",
      startBlockIndex: Math.min(options.startBlockIndex, options.endBlockIndex),
      endBlockIndex: Math.max(options.startBlockIndex, options.endBlockIndex),
      ...(options.startTableKey ? { startTableKey: options.startTableKey } : {}),
      ...(typeof options.startRow === "number" ? { startRow: options.startRow } : {}),
      ...(options.endTableKey ? { endTableKey: options.endTableKey } : {}),
      ...(typeof options.endRow === "number" ? { endRow: options.endRow } : {}),
    });
  };
  const startPendingSelection = (
    event: ReactPointerEvent<HTMLDivElement>,
    startBlockIndex: number,
    startTopBlockIndex: number,
    startCell?: HTMLTableCellElement | null,
  ) => {
    suppressBlurCommitRef.current = true;
    const startCellLocation = startCell ? getCellLocation(startCell) : null;
    pendingSelectionRef.current = {
      startBlockIndex,
      startTopBlockIndex,
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
      const endTopBlock = getTopLevelBlockLocation(targetElement);
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
      if (session.startTableKey && endTopBlock && endTopBlock.topBlockIndex !== session.startTopBlockIndex) {
        if (session.mode !== "block-range") {
          session.mode = "block-range";
          window.getSelection()?.removeAllRanges();
        }
        moveEvent.preventDefault();
        applyMixedRangeSelection({
          startBlockIndex: session.startTopBlockIndex,
          endBlockIndex: endTopBlock.topBlockIndex,
          startTableKey: session.startTableKey,
          startRow: session.startRow ?? 0,
        });
        return;
      }
      if (!session.startTableKey && endCell) {
        if (session.mode !== "block-range") {
          session.mode = "block-range";
          window.getSelection()?.removeAllRanges();
        }
        moveEvent.preventDefault();
        applyMixedRangeSelection({
          startBlockIndex: session.startTopBlockIndex,
          endBlockIndex: endCell.topBlockIndex,
          endTableKey: endCell.tableKey,
          endRow: endCell.row,
        });
        return;
      }
      if (!session.startTableKey && !endCell) {
        if (session.mode !== "none") {
          session.mode = "none";
          updateEditorSelection({ type: "none" });
        }
        suppressBlurCommitRef.current = false;
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
        topBlockIndex: session.startTopBlockIndex,
        tableKey: session.startTableKey,
        row: session.startRow,
        column: session.startColumn,
      });
      if (session.mode === "none") {
        updateEditorSelection({ type: "none" });
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
          cell.innerHTML = wrapTableCellContentHtml();
        }
      }
    }
    commitDraftFromDom();
    updateEditorSelection({ type: "none" });
    return true;
  };
  const deleteSelectedTableStructure = () => {
    if (editorSelection.type !== "cell-range" || !editorRef.current) {
      return false;
    }
    const wrapper = editorRef.current.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
    if (!(wrapper instanceof HTMLElement)) {
      return false;
    }
    const table = getTableElement(wrapper);
    if (!table || table.rows.length === 0) {
      return false;
    }
    const rowCount = table.rows.length;
    const columnCount = table.rows.item(0)?.cells.length ?? 0;
    if (columnCount === 0) {
      return false;
    }
    const allRowsSelected = editorSelection.startRow === 0
      && editorSelection.endRow >= rowCount - 1;
    const allColumnsSelected = editorSelection.startColumn === 0
      && editorSelection.endColumn >= columnCount - 1;
    if (!allRowsSelected && !allColumnsSelected) {
      return false;
    }
    if (allRowsSelected && allColumnsSelected) {
      const nextFocusTarget = wrapper.nextElementSibling ?? wrapper.previousElementSibling;
      wrapper.remove();
      if (nextFocusTarget instanceof HTMLElement) {
        placeCaretInside(nextFocusTarget);
      } else if (editorRef.current.children.length === 0) {
        editorRef.current.innerHTML = EMPTY_PARAGRAPH_HTML;
        placeCaretAtEnd();
      }
      clearTableCellSelection();
      commitDraftFromDom();
      editorRef.current.focus();
      return true;
    }
    if (allColumnsSelected) {
      const firstRow = Math.max(0, editorSelection.startRow);
      const lastRow = Math.min(rowCount - 1, editorSelection.endRow);
      const fallbackRow = table.rows.item(firstRow - 1) ?? table.rows.item(lastRow + 1);
      const fallbackColumn = Math.min(editorSelection.startColumn, Math.max(0, (fallbackRow?.cells.length ?? 1) - 1));
      const fallbackCell = fallbackRow?.cells.item(fallbackColumn);
      for (let rowIndex = lastRow; rowIndex >= firstRow; rowIndex -= 1) {
        table.rows.item(rowIndex)?.remove();
      }
      if (table.rows.length === 0) {
        wrapper.remove();
        if (!editorRef.current.querySelector("[data-block-kind]")) {
          editorRef.current.innerHTML = EMPTY_PARAGRAPH_HTML;
          placeCaretAtEnd();
        }
      } else {
        const firstParagraph = fallbackCell?.querySelector("p") ?? table.rows.item(Math.min(firstRow, table.rows.length - 1))?.querySelector("td p");
        if (firstParagraph instanceof HTMLElement) {
          placeCaretInside(firstParagraph);
        }
      }
      clearTableCellSelection();
      commitDraftFromDom();
      editorRef.current.focus();
      return true;
    }
    return false;
  };
  const clearMixedRange = () => {
    if (editorSelection.type !== "mixed-range" || !editorRef.current) {
      return false;
    }
    const topBlocks = Array.from(editorRef.current.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.blockKind)
      .filter((element) => {
        const blockIndex = Number(element.dataset.topBlockIndex);
        return Number.isInteger(blockIndex)
          && blockIndex >= editorSelection.startBlockIndex
          && blockIndex <= editorSelection.endBlockIndex;
      });
    if (topBlocks.length === 0) {
      return false;
    }
    topBlocks.forEach((block) => {
      if (block.dataset.blockKind !== "table") {
        block.remove();
        return;
      }
      const table = getTableElement(block);
      if (!table) {
        block.remove();
        return;
      }
      const isStartBoundary = block.dataset.tableKey === editorSelection.startTableKey;
      const isEndBoundary = block.dataset.tableKey === editorSelection.endTableKey;
      const firstRow = isEndBoundary ? 0 : (isStartBoundary ? (editorSelection.startRow ?? 0) : 0);
      const lastRow = isStartBoundary && isEndBoundary
        ? (editorSelection.endRow ?? Math.max(0, table.rows.length - 1))
        : isEndBoundary
          ? (editorSelection.endRow ?? Math.max(0, table.rows.length - 1))
          : Math.max(0, table.rows.length - 1);
      for (let rowIndex = lastRow; rowIndex >= firstRow; rowIndex -= 1) {
        table.rows.item(rowIndex)?.remove();
      }
      if (table.rows.length === 0) {
        block.remove();
      }
    });
    if (!editorRef.current.querySelector("[data-block-kind]")) {
      editorRef.current.innerHTML = EMPTY_PARAGRAPH_HTML;
    }
    commitDraftFromDom();
    updateEditorSelection({ type: "none" });
    return true;
  };
  const cutSelectedTableCells = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "cell-range" || !copySelectedTableCells(clipboardData)) {
      return false;
    }
    return clearSelectedTableCells();
  };
  const cutMixedRange = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "mixed-range" || !copyMixedRange(clipboardData)) {
      return false;
    }
    return clearMixedRange();
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
    updateEditorSelection({ type: "none" });
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
  const copyMixedRange = (clipboardData: DataTransfer | null) => {
    if (editorSelection.type !== "mixed-range" || !clipboardData || !editorRef.current) {
      return false;
    }
    const topBlocks = Array.from(editorRef.current.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.blockKind)
      .filter((element) => {
        const blockIndex = Number(element.dataset.topBlockIndex);
        return Number.isInteger(blockIndex)
          && blockIndex >= editorSelection.startBlockIndex
          && blockIndex <= editorSelection.endBlockIndex;
      });
    if (topBlocks.length === 0) {
      return false;
    }
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    topBlocks.forEach((block) => {
      if (block.dataset.blockKind === "table") {
        const table = getTableElement(block);
        if (!table) {
          return;
        }
        const startRow = block.dataset.tableKey === editorSelection.startTableKey
          ? (editorSelection.startRow ?? 0)
          : 0;
        const endRow = block.dataset.tableKey === editorSelection.endTableKey
          ? (editorSelection.endRow ?? Math.max(0, table.rows.length - 1))
          : Math.max(0, table.rows.length - 1);
        const serialized = serializeTableRange(
          block,
          startRow,
          endRow,
          0,
          Math.max(0, (table.rows.item(0)?.cells.length ?? 1) - 1),
        );
        if (serialized) {
          htmlParts.push(serialized.html);
          textParts.push(serialized.text);
        }
        return;
      }
      htmlParts.push(block.outerHTML);
      textParts.push(block.innerText.trim());
    });
    const text = textParts.filter(Boolean).join("\n\n");
    const html = htmlParts.join("");
    if (!html) {
      return false;
    }
    clipboardData.setData("text/plain", text);
    clipboardData.setData("text/html", html);
    customClipboardRef.current = { text, html };
    return true;
  };
  const writeCurrentSelectionToClipboard = (clipboardData: DataTransfer | null) =>
    copySelectedTableCells(clipboardData) || copyMixedRange(clipboardData) || copySelectedBlocks(clipboardData);
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
    // When inside a table cell, insert into the cell-content container (enables nesting)
    const td = anchorElement instanceof HTMLTableCellElement
      ? anchorElement
      : anchorElement?.closest("td");
    if (td instanceof HTMLTableCellElement && editorRef.current.contains(td)) {
      const cellContent = td.querySelector(":scope > .text-block-table-cell-content") ?? td;
      const blockInCell = anchorElement?.closest("[data-block-kind]");
      if (blockInCell instanceof HTMLElement && cellContent.contains(blockInCell)) {
        if (blockInCell.dataset.blockKind === "paragraph" && !blockInCell.textContent?.trim()) {
          blockInCell.replaceWith(fragment);
        } else {
          blockInCell.after(fragment);
        }
      } else {
        cellContent.appendChild(fragment);
      }
    } else {
      const currentBlock = anchorElement?.closest("[data-block-kind]");
      if (currentBlock instanceof HTMLElement && editorRef.current.contains(currentBlock)) {
        if (currentBlock.dataset.blockKind === "paragraph" && !currentBlock.textContent?.trim()) {
          currentBlock.replaceWith(fragment);
        } else {
          currentBlock.after(fragment);
        }
      } else {
        editorRef.current.appendChild(fragment);
      }
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
      targetNode = targetNode.parentElement ?? container;
      offset = 0;
    }
    range.setStart(targetNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    saveCurrentSelectionRange();
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
    saveCurrentSelectionRange();
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
    saveCurrentSelectionRange();
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
    syncDimensionsToContent({ expandTables: isStructuredHtml(html) });
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
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
      `<tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${wrapTableCellContentHtml(`<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p>${escapeHtml(cell) || "<br />"}</p></div>`)}</td>`).join("")}</tr>`).join("")}</tbody>`,
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
      syncDimensionsToContent({ expandTables: true });
      onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
      editorRef.current.focus();
    }
  };
  const insertTimelineExampleTable = (placement: "caret" | "end" = "caret") => {
    const html = createTimelineExampleTableHtml();
    const wrappedHtml = `<div class="text-block text-block-table-wrap" data-block-kind="table"><table class="text-block-table">${html.replace(/<table>/, "").replace("</table>", "")}</table></div>`;
    if (placement === "end") {
      placeCaretAtEnd();
    }
    const inserted = insertStructuredHtmlAtSelection(wrappedHtml);
    const firstCellParagraph = inserted?.firstNode?.querySelector?.("td p");
    if (firstCellParagraph) {
      placeCaretInside(firstCellParagraph);
    }
    if (editorRef.current) {
      draftHtmlRef.current = editorRef.current.innerHTML;
      syncDimensionsToContent({ expandTables: true });
      onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
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
  /** Cross-platform range insertion that works around Windows Chromium
   *  bug where insertNode into a collapsed text-node range places
   *  content at the parent element start instead of the cursor position. */
  const insertFragmentAtRange = (range: Range, frag: DocumentFragment) => {
    const { startContainer, startOffset } = range;
    if (range.collapsed && startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer as Text;
      const parent = text.parentNode!;
      const after = text.splitText(startOffset);
      const last = frag.lastChild;
      parent.insertBefore(frag, after);
      range.setStartAfter(last || after);
      range.collapse(true);
    } else {
      if (!range.collapsed) range.deleteContents();
      range.insertNode(frag);
      range.collapse(false);
    }
  };
  const insertNodeLinkAtSelection = (cmd: TextEditorCommand) => {
    if (!editorRef.current || cmd.nodeLinkPage == null || !cmd.nodeLinkId) return;

    const restored = restoreSavedSelectionRange() || restoreCursorPath();

    const label = cmd.nodeLinkLabel || cmd.nodeLinkId;
    const docAttr = cmd.nodeLinkDoc ? ` data-node-link-doc="${escapeAttribute(cmd.nodeLinkDoc)}"` : "";

    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount > 0 && !selection.isCollapsed;
    let range: Range | null = null;

    if (hasSelection) {
      range = selection!.getRangeAt(0);
      if (!editorRef.current.contains(range.commonAncestorContainer)) {
        range = null;
      }
    }

    // If no valid text selection, insert at collapsed caret or end
    if (!range) {
      if (selection && selection.rangeCount > 0 && editorRef.current.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        range = selection.getRangeAt(0);
      } else if (!restored && activeTableCellRef.current && editorRef.current.contains(activeTableCellRef.current)) {
        placeCaretInside(activeTableCellRef.current);
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          range = sel.getRangeAt(0);
        }
      } else {
        placeCaretAtEnd();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          range = sel.getRangeAt(0);
        }
      }
      if (range) {
        const linkHtml = `<a class="rich-text-link" href="#" data-node-link-page="${cmd.nodeLinkPage}" data-node-link-id="${escapeAttribute(cmd.nodeLinkId)}"${docAttr} data-node-link-label="${escapeAttribute(label)}">${escapeHtml(label)}</a>`;
        const wrapper = document.createElement("div");
        wrapper.innerHTML = linkHtml;
        const frag = document.createDocumentFragment();
        while (wrapper.firstChild) {
          frag.appendChild(wrapper.firstChild);
        }
        insertFragmentAtRange(range, frag);
        selection?.removeAllRanges();
        selection?.addRange(range);
        draftHtmlRef.current = editorRef.current.innerHTML;
        syncDimensionsToContent({ expandTables: true });
        onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
        editorRef.current.focus();
      }
      return;
    }

    const selectedText = range.toString().trim();
    const displayText = selectedText || label;
    const linkHtml = `<a class="rich-text-link" href="#" data-node-link-page="${cmd.nodeLinkPage}" data-node-link-id="${escapeAttribute(cmd.nodeLinkId)}"${docAttr} data-node-link-label="${escapeAttribute(label)}">${escapeHtml(displayText)}</a>`;

    range.deleteContents();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = linkHtml;
    const frag = document.createDocumentFragment();
    while (wrapper.firstChild) {
      frag.appendChild(wrapper.firstChild);
    }
    insertFragmentAtRange(range, frag);
    selection!.removeAllRanges();
    selection!.addRange(range);

    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent({ expandTables: true });
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
    editorRef.current.focus();
  };

  const appendTextAtEnd = (text: string) => {
    placeCaretAtEnd();
    insertTextAtCaret(text);
    if (!editorRef.current) {
      return;
    }
    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
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
      nextCell.innerHTML = wrapTableCellContentHtml();
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
    syncActiveTableCellFromSelection();
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
      nextCell.innerHTML = wrapTableCellContentHtml();
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
  const getTableContextCell = (context = tableContextMenu) => {
    const editor = editorRef.current;
    if (!editor || !context) {
      return null;
    }
    const wrapper = editor.querySelector(`[data-table-key="${context.tableKey}"]`);
    if (!(wrapper instanceof HTMLElement)) {
      return null;
    }
    const table = getTableElement(wrapper);
    const cell = table?.rows.item(context.rowIndex)?.cells.item(context.columnIndex);
    return cell instanceof HTMLTableCellElement ? cell : null;
  };
  const runTableContextAction = (action: (cell: HTMLTableCellElement) => boolean | void) => {
    const cell = getTableContextCell();
    if (!cell) {
      setTableContextMenu(null);
      return;
    }
    rememberActiveTableCell(cell);
    action(cell);
    setTableContextMenu(null);
    restoreEditorFocus();
  };
  const insertTableRowAtCell = (cell: HTMLTableCellElement, placement: "above" | "below") => {
    const row = cell.closest("tr");
    if (!(row instanceof HTMLTableRowElement)) {
      return false;
    }
    const nextRow = row.cloneNode(false) as HTMLTableRowElement;
    const columnCount = row.cells.length;
    for (let index = 0; index < columnCount; index += 1) {
      const nextCell = document.createElement("td");
      nextCell.innerHTML = wrapTableCellContentHtml();
      nextRow.appendChild(nextCell);
    }
    row.parentElement?.insertBefore(nextRow, placement === "above" ? row : row.nextSibling);
    const firstParagraph = nextRow.querySelector("td p");
    if (firstParagraph) {
      placeCaretInside(firstParagraph);
    }
    commitDraftFromDom();
    activeTableCellRef.current = nextRow.cells.item(cell.cellIndex) instanceof HTMLTableCellElement
      ? nextRow.cells.item(cell.cellIndex) as HTMLTableCellElement
      : null;
    editorRef.current?.focus();
    return true;
  };
  const deleteTableRowAtCell = (cell: HTMLTableCellElement) => {
    const row = cell.closest("tr");
    const table = row?.closest("table");
    if (!(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement) || table.rows.length <= 1) {
      return false;
    }
    const fallbackRow = table.rows.item(Math.max(0, row.rowIndex - 1)) ?? table.rows.item(row.rowIndex + 1);
    const fallbackCell = fallbackRow?.cells.item(Math.min(cell.cellIndex, Math.max(0, (fallbackRow?.cells.length ?? 1) - 1)));
    row.remove();
    const firstParagraph = fallbackCell?.querySelector("p");
    if (firstParagraph) {
      placeCaretInside(firstParagraph);
    }
    commitDraftFromDom();
    activeTableCellRef.current = fallbackCell instanceof HTMLTableCellElement ? fallbackCell : null;
    editorRef.current?.focus();
    return true;
  };
  const deleteTableAtCell = (cell: HTMLTableCellElement) => {
    const wrapper = cell.closest(".text-block-table-wrap");
    if (!(wrapper instanceof HTMLElement)) {
      return false;
    }
    const nextFocusTarget = wrapper.nextElementSibling ?? wrapper.previousElementSibling;
    wrapper.remove();
    if (nextFocusTarget instanceof HTMLElement) {
      placeCaretInside(nextFocusTarget);
    } else if (editorRef.current && editorRef.current.children.length === 0) {
      editorRef.current.innerHTML = EMPTY_PARAGRAPH_HTML;
      placeCaretAtEnd();
    }
    clearTableCellSelection();
    commitDraftFromDom();
    editorRef.current?.focus();
    return true;
  };
  const clearTableCellAtCell = (cell: HTMLTableCellElement) => {
    cell.innerHTML = wrapTableCellContentHtml();
    const firstParagraph = cell.querySelector("p");
    if (firstParagraph) {
      placeCaretInside(firstParagraph);
    }
    commitDraftFromDom();
    editorRef.current?.focus();
    return true;
  };
  const selectTableRangeAtCell = (cell: HTMLTableCellElement, mode: "table" | "row" | "column" | "cell") => {
    const location = getCellLocation(cell);
    const table = cell.closest("table");
    if (!location || !(table instanceof HTMLTableElement)) {
      return false;
    }
    const columnCount = table.rows.item(0)?.cells.length ?? cell.parentElement?.children.length ?? 1;
    updateEditorSelection({
      type: "cell-range",
      tableKey: location.tableKey,
      startRow: mode === "table" || mode === "column" ? 0 : location.row,
      endRow: mode === "table" || mode === "column" ? Math.max(0, table.rows.length - 1) : location.row,
      startColumn: mode === "table" || mode === "row" ? 0 : location.column,
      endColumn: mode === "table" || mode === "row" ? Math.max(0, columnCount - 1) : location.column,
    });
    return true;
  };
  const getSelectionAnchorElement = () => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    if (anchorNode instanceof HTMLElement) {
      return anchorNode;
    }
    return anchorNode?.parentElement ?? null;
  };
  const getCellFromSelectionOrActiveRange = () => {
    const anchorElement = getSelectionAnchorElement();
    const selectionCell = anchorElement instanceof HTMLTableCellElement
      ? anchorElement
      : anchorElement?.closest("td");
    if (selectionCell instanceof HTMLTableCellElement && editorRef.current?.contains(selectionCell)) {
      activeTableCellRef.current = selectionCell;
      return selectionCell;
    }
    if (editorSelection.type === "cell-range") {
      const wrapper = editorRef.current?.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
      const table = wrapper instanceof HTMLElement ? getTableElement(wrapper) : null;
      const cell = table?.rows.item(editorSelection.startRow)?.cells.item(editorSelection.startColumn);
      if (cell instanceof HTMLTableCellElement) {
        activeTableCellRef.current = cell;
        return cell;
      }
    }
    if (activeTableCellRef.current && editorRef.current?.contains(activeTableCellRef.current)) {
      return activeTableCellRef.current;
    }
    return null;
  };
  const getSelectAllScope = () => {
    const cell = getCellFromSelectionOrActiveRange();
    if (cell) {
      const location = getCellLocation(cell);
      if (location) {
        return {
          type: "table-cell" as const,
          key: `cell:${location.tableKey}:${location.row}:${location.column}`,
          cell,
          location,
        };
      }
    }
    const anchorElement = getSelectionAnchorElement();
    const block = getBlockLocation(anchorElement);
    const topBlock = getTopLevelBlockLocation(anchorElement);
    if (block && topBlock) {
      return {
        type: "block" as const,
        key: `block:${topBlock.topBlockIndex}:${block.blockIndex}`,
        block,
        topBlock,
      };
    }
    return null;
  };
  const selectCurrentLineOrBlockContents = (scope: NonNullable<ReturnType<typeof getSelectAllScope>>) => {
    const target = scope.type === "table-cell"
      ? (getSelectionAnchorElement()?.closest("[data-block-kind]") ?? scope.cell.querySelector("[data-block-kind]") ?? scope.cell)
      : scope.block.block;
    if (!(target instanceof Node)) {
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    updateEditorSelection({ type: "none" });
    saveCurrentSelectionRange();
    return true;
  };
  const handleProgressiveSelectAll = () => {
    const currentCycle = selectAllCycleRef.current;
    if (currentCycle?.stage === "block") {
      const editor = editorRef.current;
      if (editor) {
        let maxIndex = -1;
        for (const child of editor.children) {
          const index = child instanceof HTMLElement ? Number(child.dataset.topBlockIndex) : NaN;
          if (Number.isInteger(index) && index > maxIndex) {
            maxIndex = index;
          }
        }
        if (maxIndex >= 0) {
          applyBlockRangeSelection(0, maxIndex);
          window.getSelection()?.removeAllRanges();
          selectAllCycleRef.current = { scopeKey: currentCycle.scopeKey, stage: "node" };
          return true;
        }
      }
    }
    if (currentCycle?.stage === "node") {
      selectAllCycleRef.current = null;
      if (onRequestSelectAll) {
        onRequestSelectAll();
        return true;
      }
    }
    const scope = getSelectAllScope();
    if (!scope) {
      return false;
    }
    const sameScope = currentCycle?.scopeKey === scope.key;
    if (!sameScope || currentCycle?.stage === "table") {
      selectAllCycleRef.current = { scopeKey: scope.key, stage: "line" };
      return selectCurrentLineOrBlockContents(scope);
    }
    if (scope.type === "table-cell") {
      if (currentCycle.stage === "line") {
        if (selectTableRangeAtCell(scope.cell, "cell")) {
          window.getSelection()?.removeAllRanges();
          selectAllCycleRef.current = { scopeKey: scope.key, stage: "cell" };
          return true;
        }
      }
      if (currentCycle.stage === "cell") {
        if (selectTableRangeAtCell(scope.cell, "table")) {
          window.getSelection()?.removeAllRanges();
          selectAllCycleRef.current = { scopeKey: scope.key, stage: "table" };
          return true;
        }
      }
      return false;
    }
    applyBlockRangeSelection(scope.topBlock.topBlockIndex, scope.topBlock.topBlockIndex);
    window.getSelection()?.removeAllRanges();
    selectAllCycleRef.current = { scopeKey: scope.key, stage: "block" };
    return true;
  };
  const openTableContextMenu = (event: ReactMouseEvent<HTMLDivElement>, cell: HTMLTableCellElement) => {
    const location = getCellLocation(cell);
    const row = cell.closest("tr");
    const table = row?.closest("table");
    if (!location || !(row instanceof HTMLTableRowElement) || !(table instanceof HTMLTableElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressBlurCommitRef.current = true;
    rememberActiveTableCell(cell);
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !editorRef.current?.contains(sel.anchorNode)) {
      pendingCaretPointRef.current = { x: event.clientX, y: event.clientY };
      placeCaretFromPoint();
    }
    saveCurrentSelectionRange();
    setSelectionAnchor(location);
    setTextContextMenu(null);
    setTableContextMenu({
      x: event.clientX,
      y: event.clientY,
      measured: false,
      tableKey: location.tableKey,
      rowIndex: row.rowIndex,
      columnIndex: cell.cellIndex,
      rowCount: table.rows.length,
      columnCount: table.rows.item(0)?.cells.length ?? row.cells.length,
    });
  };
  const openTextContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    suppressBlurCommitRef.current = true;
    // Only place caret if there's no existing selection (to preserve selected text)
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !editorRef.current?.contains(sel.anchorNode)) {
      pendingCaretPointRef.current = { x: event.clientX, y: event.clientY };
      placeCaretFromPoint();
    }
    saveCurrentSelectionRange();
    setTableContextMenu(null);
    setTextContextMenu({
      x: event.clientX,
      y: event.clientY,
      measured: false,
    });
  };
  const insertTableFromTextContextMenu = () => {
    insertTableAtCaret();
    setTextContextMenu(null);
    restoreEditorFocus();
  };
  const requestInsertNodeLinkFromTextContextMenu = () => {
    const context = textContextMenu;
    saveCurrentSelectionRange();
    saveCursorPath();
    setTextContextMenu(null);
    if (context) {
      onRequestInsertNodeLink?.(context.x, context.y);
    }
  };
  const requestInsertNodeLinkFromTableContextMenu = () => {
    const context = tableContextMenu;
    const cell = getTableContextCell(context);
    if (cell) {
      rememberActiveTableCell(cell);
    }
    saveCurrentSelectionRange();
    saveCursorPath();
    setTableContextMenu(null);
    if (context) {
      onRequestInsertNodeLink?.(context.x, context.y);
    }
  };
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
  const getPreviousTableContext = (): { tbody: HTMLTableSectionElement; columnCount: number } | null => {
    if (!editorRef.current) {
      return null;
    }
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    if (!anchorNode) {
      return null;
    }
    const currentBlock = anchorNode instanceof Element
      ? anchorNode.closest("[data-block-kind]")
      : anchorNode.parentElement?.closest("[data-block-kind]");
    if (
      !(currentBlock instanceof HTMLElement) ||
      !editorRef.current.contains(currentBlock) ||
      currentBlock.dataset.blockKind !== "paragraph" ||
      currentBlock.textContent?.trim()
    ) {
      return null;
    }
    const previousBlock = currentBlock.previousElementSibling;
    if (!(previousBlock instanceof HTMLElement) || previousBlock.dataset.blockKind !== "table") {
      return null;
    }
    const table = getTableElement(previousBlock);
    const tbody = table?.querySelector("tbody");
    if (!table || !(tbody instanceof HTMLTableSectionElement)) {
      return null;
    }
    return {
      tbody,
      columnCount: table.rows.item(0)?.cells.length ?? 0,
    };
  };
  const appendRowsToCurrentTable = (rows: string[][]) => {
    const normalizedRows = rows.filter((cells) => cells.length > 0);
    if (normalizedRows.length === 0) {
      return false;
    }
    let context: { tbody: HTMLTableSectionElement; columnCount: number } | null = getSelectionTableContext();
    if (!context) {
      context = getPreviousTableContext();
    }
    if (!context || normalizedRows.some((cells) => cells.length !== context.columnCount)) {
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
      rows.map((cells) => cells.map((cell) => wrapTableCellContentHtml(`<div class="text-block text-block-paragraph" data-block-kind="paragraph"><p>${escapeHtml(cell) || "<br />"}</p></div>`))),
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
    syncActiveTableCellFromSelection();
    if (!editorRef.current) {
      return;
    }
    draftHtmlRef.current = editorRef.current.innerHTML;
    syncDimensionsToContent();
    onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "checkpoint" });
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editing) {
      return;
    }
    const lowerKey = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && lowerKey === "a") {
      if (handleProgressiveSelectAll()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    } else if (!(event.shiftKey && ["shift", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(lowerKey))) {
      selectAllCycleRef.current = null;
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
      if (editorSelection.type === "cell-range") {
        if (!deleteSelectedTableStructure()) {
          const wrapper = editorRef.current?.querySelector(`[data-table-key="${editorSelection.tableKey}"]`);
          const table = wrapper instanceof HTMLElement ? getTableElement(wrapper) : null;
          if (table) {
            const allRowsSelected = editorSelection.startRow === 0
              && editorSelection.endRow === table.rows.length - 1;
            if (allRowsSelected) {
              for (let columnIndex = editorSelection.endColumn; columnIndex >= editorSelection.startColumn; columnIndex -= 1) {
                const cell = table.rows.item(0)?.cells.item(columnIndex);
                if (!(cell instanceof HTMLTableCellElement)) {
                  break;
                }
                activeTableCellRef.current = cell;
                if (!deleteTableColumnAtSelection()) {
                  break;
                }
              }
            } else {
              clearSelectedTableCells();
            }
          }
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (clearSelectedTableCells() || clearMixedRange() || deleteSelectedBlocks()) {
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
    if (cutSelectedTableCells(event.clipboardData) || cutMixedRange(event.clipboardData)) {
      event.preventDefault();
    }
  };
  useEffect(() => {
    if (editing && editorRef.current) {
      appliedContentRevisionRef.current = contentRevision;
      draftHtmlRef.current = richTextDocToHtml(node.content, assets);
      editorRef.current.innerHTML = draftHtmlRef.current;
      editorRef.current.focus();
      placeCaretFromPoint();
      syncDimensionsToContent();
    }
  }, [editing]);
  useEffect(() => {
    if (!editing || !editorRef.current || appliedContentRevisionRef.current === contentRevision) {
      return;
    }
    appliedContentRevisionRef.current = contentRevision;
    draftHtmlRef.current = richTextDocToHtml(node.content, assets);
    editorRef.current.innerHTML = draftHtmlRef.current;
    syncDimensionsToContent();
    editorRef.current.focus();
    placeCaretAtEnd();
    saveCurrentSelectionRange();
  }, [assets, contentRevision, editing, node.content]);
  useEffect(() => {
    if (!editing && editorRef.current) {
      appliedContentRevisionRef.current = contentRevision;
      draftHtmlRef.current = richTextDocToHtml(node.content, assets, highlightQuery);
      editorRef.current.innerHTML = draftHtmlRef.current;
      syncDimensionsToContent();
    }
  }, [assets, editing, node.content, highlightQuery]);
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
  useEffect(() => {
    if (!editing) {
      return;
    }
    const handleSelectionChange = () => {
      syncActiveTableCellFromSelection();
      saveCurrentSelectionRange();
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [editing]);
  useEffect(() => {
    if (!editing) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      preserveToolbarBlurRef.current = target instanceof Element && !!target.closest("[data-preserve-editor-focus='true']");
      if (preserveToolbarBlurRef.current) {
        saveCurrentSelectionRange();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editing]);
  useEffect(() => {
    if (!tableContextMenu) {
      return;
    }
    if (!tableContextMenu.measured) {
      window.requestAnimationFrame(() => {
        const menu = tableContextMenuRef.current;
        if (!menu) {
          return;
        }
        const rect = menu.getBoundingClientRect();
        const maxLeft = Math.max(CONTEXT_MENU_VIEWPORT_PADDING, window.innerWidth - rect.width - CONTEXT_MENU_VIEWPORT_PADDING);
        const maxTop = Math.max(CONTEXT_MENU_VIEWPORT_PADDING, window.innerHeight - rect.height - CONTEXT_MENU_VIEWPORT_PADDING);
        const nextX = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, tableContextMenu.x), maxLeft);
        const nextY = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, tableContextMenu.y), maxTop);
        setTableContextMenu((current) => current && current.tableKey === tableContextMenu.tableKey
          ? {
              ...current,
              x: nextX,
              y: nextY,
              measured: true,
            }
          : current);
      });
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".table-context-menu")) {
        return;
      }
      setTableContextMenu(null);
      suppressBlurCommitRef.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTableContextMenu(null);
        suppressBlurCommitRef.current = false;
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tableContextMenu]);
  useEffect(() => {
    if (!textContextMenu) {
      return;
    }
    if (!textContextMenu.measured) {
      window.requestAnimationFrame(() => {
        const menu = textContextMenuRef.current;
        if (!menu) {
          return;
        }
        const rect = menu.getBoundingClientRect();
        const maxLeft = Math.max(CONTEXT_MENU_VIEWPORT_PADDING, window.innerWidth - rect.width - CONTEXT_MENU_VIEWPORT_PADDING);
        const maxTop = Math.max(CONTEXT_MENU_VIEWPORT_PADDING, window.innerHeight - rect.height - CONTEXT_MENU_VIEWPORT_PADDING);
        const nextX = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, textContextMenu.x), maxLeft);
        const nextY = Math.min(Math.max(CONTEXT_MENU_VIEWPORT_PADDING, textContextMenu.y), maxTop);
        setTextContextMenu((current) => current
          ? {
              ...current,
              x: nextX,
              y: nextY,
              measured: true,
            }
          : current);
      });
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".text-context-menu")) {
        return;
      }
      setTextContextMenu(null);
      suppressBlurCommitRef.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTextContextMenu(null);
        suppressBlurCommitRef.current = false;
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [textContextMenu]);
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
    Array.from(editor.children).forEach((element, index) => {
      if (element instanceof HTMLElement && element.dataset.blockKind) {
        element.dataset.topBlockIndex = String(index);
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
    if (editorSelection.type === "mixed-range") {
      Array.from(editor.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.blockKind)
        .forEach((element) => {
          const blockIndex = Number(element.dataset.topBlockIndex);
          if (
            Number.isInteger(blockIndex)
            && blockIndex >= editorSelection.startBlockIndex
            && blockIndex <= editorSelection.endBlockIndex
          ) {
            element.classList.add("block-range-selected");
          }
        });
      const applyTableRows = (tableKey: string | undefined, startRow: number, endRow: number) => {
        if (!tableKey) {
          return;
        }
        const wrapper = editor.querySelector(`[data-table-key="${tableKey}"]`);
        if (!(wrapper instanceof HTMLElement)) {
          return;
        }
        const table = getTableElement(wrapper);
        if (!table) {
          return;
        }
        for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
          const row = table.rows.item(rowIndex);
          if (!row) {
            continue;
          }
          Array.from(row.cells).forEach((cell) => {
            if (cell instanceof HTMLTableCellElement) {
              cell.classList.add("table-cell-range-selected");
            }
          });
        }
      };
      if (editorSelection.startTableKey) {
        const wrapper = editor.querySelector(`[data-table-key="${editorSelection.startTableKey}"]`);
        const table = wrapper instanceof HTMLElement ? getTableElement(wrapper) : null;
        if (table) {
          applyTableRows(editorSelection.startTableKey, editorSelection.startRow ?? 0, Math.max(0, table.rows.length - 1));
        }
      }
      if (editorSelection.endTableKey) {
        applyTableRows(editorSelection.endTableKey, 0, editorSelection.endRow ?? 0);
      }
      return;
    }
    Array.from(editor.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.blockKind)
      .forEach((element) => {
        const blockIndex = Number(element.dataset.topBlockIndex);
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
      if (cutSelectedTableCells(event.clipboardData) || cutMixedRange(event.clipboardData)) {
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
    if (command.type === "insert-timeline-example") {
      insertTimelineExampleTable(command.placement ?? "caret");
      return;
    }
    if (command.type === "insert-node-link") {
      insertNodeLinkAtSelection(command);
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
      return;
    }
    if (
      command.type === "set-font-family"
      || command.type === "set-font-size"
      || command.type === "set-text-color"
      || command.type === "set-highlight-color"
      || command.type === "apply-block-style"
      || command.type === "toggle-bold"
      || command.type === "toggle-italic"
      || command.type === "toggle-underline"
      || command.type === "toggle-strike"
    ) {
      applyInlineFormatCommand(command);
    }
  }, [command, editing]);
  const armMiddlePasteGuard = () => {
    middlePasteGuardRef.current = {
      until: performance.now() + 1200,
      html: editorRef.current?.innerHTML ?? draftHtmlRef.current,
    };
  };

  return (
    <div
      className={`canvas-node text-node ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      data-node-id={node.id}
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
      />
      <div
        ref={editorRef}
        className="text-node-content"
        contentEditable={editing}
        suppressContentEditableWarning
        onMouseDownCapture={(event) => {
          if (event.button === 1) {
            armMiddlePasteGuard();
            event.preventDefault();
          }
        }}
        onMouseUpCapture={(event) => {
          if (event.button === 1) {
            armMiddlePasteGuard();
            event.preventDefault();
          }
        }}
        onPointerDownCapture={(event) => {
          if (event.button === 1) {
            armMiddlePasteGuard();
            onMiddlePanPointerDown(event);
            return;
          }
          const target = event.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const resizeWrapper = getTableResizeWrapper(event, targetElement);
          if (resizeWrapper) {
            onSelect();
            startTableResize(event, resizeWrapper);
          }
        }}
        onPointerUpCapture={(event) => {
          if (event.button === 1) {
            armMiddlePasteGuard();
            event.preventDefault();
          }
        }}
        onPointerDown={(event) => {
          selectAllCycleRef.current = null;
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
            if (event.shiftKey && block && selectionAnchor && (selectionAnchor.tableKey || cell instanceof HTMLTableCellElement)) {
              const topBlock = target instanceof Element ? getTopLevelBlockLocation(target) : null;
              if (!topBlock) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              applyBlockRangeSelection(selectionAnchor.topBlockIndex, topBlock.topBlockIndex);
              return;
            }
            if (block) {
              const topBlock = target instanceof Element ? getTopLevelBlockLocation(target) : null;
              if (topBlock) {
                startPendingSelection(event, block.blockIndex, topBlock.topBlockIndex, cell instanceof HTMLTableCellElement ? cell : null);
              }
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
          // Check for rich text link click
          const targetLink = event.target instanceof HTMLElement ? event.target.closest("a.rich-text-link") : null;
          if (targetLink) {
            const href = targetLink.getAttribute("href");
            const nodeLinkPage = targetLink.getAttribute("data-node-link-page");
            const nodeLinkId = targetLink.getAttribute("data-node-link-id");
            const nodeLinkDoc = targetLink.getAttribute("data-node-link-doc");
            if (nodeLinkId && nodeLinkPage !== null) {
              event.stopPropagation();
              onNodeLinkClick?.(Number(nodeLinkPage), nodeLinkId, event.clientX, event.clientY, nodeLinkDoc || undefined);
              return;
            }
            if (href && href !== "#") {
              event.stopPropagation();
              window.open(href, "_blank", "noreferrer");
              return;
            }
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
          const resizeCell = cell instanceof HTMLTableCellElement ? getColumnResizeCell(event, cell) : null;
          const nodeResizeHandle = !editing && !wrapper && !resizeCell ? getNodeResizeHandle(event) : null;
          setTableResizeHover(wrapper instanceof HTMLElement ? wrapper : null);
          setColumnResizeHover(resizeCell);
          setNodeResizeHover(nodeResizeHandle);
        }}
        onPointerLeave={() => {
          setColumnResizeHover(null);
          setTableResizeHover(null);
          setNodeResizeHover(null);
        }}
        onInput={(event) => {
          const guard = middlePasteGuardRef.current;
          const nativeEvent = event.nativeEvent as InputEvent;
          if (
            guard &&
            performance.now() <= guard.until &&
            nativeEvent.inputType.startsWith("insertFromPaste")
          ) {
            event.currentTarget.innerHTML = guard.html;
            draftHtmlRef.current = guard.html;
            middlePasteGuardRef.current = null;
            syncActiveTableCellFromSelection();
            saveCurrentSelectionRange();
            syncDimensionsToContent();
            onDraftChange(htmlToRichTextDoc(guard.html), { history: "coalesce" });
            return;
          }

          draftHtmlRef.current = event.currentTarget.innerHTML;
          syncActiveTableCellFromSelection();
          saveCurrentSelectionRange();
          syncDimensionsToContent();
          onDraftChange(htmlToRichTextDoc(draftHtmlRef.current), { history: "coalesce" });
        }}
        onBeforeInput={(event) => {
          const nativeEvent = event.nativeEvent as InputEvent;
          const guard = middlePasteGuardRef.current;
          if (
            nativeEvent.inputType.startsWith("insertFromPaste") &&
            guard &&
            performance.now() <= guard.until
          ) {
            event.preventDefault();
          }
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          if (!editing) {
            return;
          }
          const target = event.target;
          const cell = target instanceof HTMLTableCellElement
            ? target
            : target instanceof HTMLElement
              ? target.closest("td")
              : null;
          if (cell instanceof HTMLTableCellElement) {
            openTableContextMenu(event, cell);
            return;
          }
          openTextContextMenu(event);
        }}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onBlur={(event) => {
          saveCurrentSelectionRange();
          if (pendingSelectionRef.current || suppressBlurCommitRef.current) {
            restoreEditorFocus();
            return;
          }
          const relatedTarget = event.relatedTarget;
          if (
            preserveToolbarBlurRef.current ||
            (relatedTarget instanceof HTMLElement && relatedTarget.closest("[data-preserve-editor-focus='true']"))
          ) {
            preserveToolbarBlurRef.current = false;
            return;
          }
          syncDimensionsToContent();
          onCommit(getCurrentRichTextDoc());
        }}
      />
      {tableContextMenu && typeof document !== "undefined" ? createPortal(
        <div
          ref={tableContextMenuRef}
          className="table-context-menu"
          data-preserve-editor-focus="true"
          style={{
            left: tableContextMenu.x,
            top: tableContextMenu.y,
            visibility: tableContextMenu.measured ? "visible" : "hidden",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button type="button" onClick={() => runTableContextAction((cell) => {
            placeCaretInside(cell);
            insertTableAtCaret();
          })}>
            插入表格...
          </button>
          <button type="button" onClick={requestInsertNodeLinkFromTableContextMenu}>
            添加引用
          </button>
          <div className="table-context-menu-separator" />
          <button type="button" onClick={() => runTableContextAction((cell) => {
            activeTableCellRef.current = cell;
            return insertTableColumnLeftAtSelection();
          })}>
            在左侧插入列
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => {
            activeTableCellRef.current = cell;
            return insertTableColumnAtSelection();
          })}>
            在右侧插入列
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => insertTableRowAtCell(cell, "above"))}>
            在上方插入行
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => insertTableRowAtCell(cell, "below"))}>
            在下方插入行
          </button>
          <div className="table-context-menu-separator" />
          <button type="button" className="danger" onClick={() => runTableContextAction((cell) => deleteTableAtCell(cell))}>
            删除表格
          </button>
          <button
            type="button"
            className="danger"
            disabled={tableContextMenu.columnCount <= 1}
            onClick={() => runTableContextAction((cell) => {
              activeTableCellRef.current = cell;
              return deleteTableColumnAtSelection();
            })}
          >
            删除列
          </button>
          <button
            type="button"
            className="danger"
            disabled={tableContextMenu.rowCount <= 1}
            onClick={() => runTableContextAction((cell) => deleteTableRowAtCell(cell))}
          >
            删除行
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => clearTableCellAtCell(cell))}>
            清空单元格
          </button>
          <div className="table-context-menu-separator" />
          <button type="button" onClick={() => runTableContextAction((cell) => selectTableRangeAtCell(cell, "table"))}>
            选择表格
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => selectTableRangeAtCell(cell, "column"))}>
            选择列
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => selectTableRangeAtCell(cell, "row"))}>
            选择行
          </button>
          <button type="button" onClick={() => runTableContextAction((cell) => selectTableRangeAtCell(cell, "cell"))}>
            选择单元格
          </button>
        </div>,
        document.body,
      ) : null}
      {textContextMenu && typeof document !== "undefined" ? createPortal(
        <div
          ref={textContextMenuRef}
          className="table-context-menu text-context-menu"
          data-preserve-editor-focus="true"
          style={{
            left: textContextMenu.x,
            top: textContextMenu.y,
            visibility: textContextMenu.measured ? "visible" : "hidden",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button type="button" onClick={insertTableFromTextContextMenu}>
            插入表格...
          </button>
          <button type="button" onClick={requestInsertNodeLinkFromTextContextMenu}>
            添加引用
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
};
