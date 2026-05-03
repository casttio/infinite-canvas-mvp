import type { BoxCanvasNode, CanvasNode, ConnectorNode, DocumentFile } from "../model/types";
import { richTextDocToHtml } from "../nodes/richText";
import { resolveConnectorEndpoint } from "../nodes/connectorGeometry";

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll("\"", "&quot;");

const escapeScriptJson = (value: string) =>
  value
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");

const pageTitle = (document: DocumentFile, pageIndex: number) =>
  document.appearance.pages.titles?.[pageIndex]?.trim() || `页面 ${pageIndex + 1}`;

const isBoxNode = (node: CanvasNode): node is BoxCanvasNode => node.type !== "connector";

const nodeStyle = (document: DocumentFile, node: BoxCanvasNode) => [
  `left: ${node.x - document.pageBounds.x}px;`,
  `top: ${node.y - document.pageBounds.y}px;`,
  `width: ${node.w}px;`,
  `height: ${node.h}px;`,
  `z-index: ${node.z};`,
].join(" ");

const renderImageNode = (document: DocumentFile, node: Extract<CanvasNode, { type: "image" }>) => {
  const asset = document.assets[node.assetId];
  const style = nodeStyle(document, node);

  if (!asset) {
    return `<div class="canvas-node preview-attachment-node" style="${style}">资源缺失</div>`;
  }

  if (asset.storage === "managed") {
    return `<div class="canvas-node preview-attachment-node" style="${style}"><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.relativePath ?? "受管附件")}</span></div>`;
  }

  if (asset.type === "image" && asset.data) {
    return `<div class="canvas-node preview-image-node" style="${style}"><img src="${escapeAttribute(asset.data)}" alt="${escapeAttribute(asset.name)}" /></div>`;
  }

  if (asset.type === "html" && asset.data) {
    return `<div class="canvas-node preview-frame-node" style="${style}"><iframe srcdoc="${escapeAttribute(asset.data)}" sandbox="" title="${escapeAttribute(asset.name)}"></iframe></div>`;
  }

  if (asset.type === "pdf" && asset.data) {
    return `<div class="canvas-node preview-frame-node" style="${style}"><iframe src="${escapeAttribute(asset.data)}" title="${escapeAttribute(asset.name)}"></iframe></div>`;
  }

  return `<div class="canvas-node preview-attachment-node" style="${style}"><strong>${escapeHtml(asset.name)}</strong><span>${escapeHtml(asset.mimeType || "附件")}</span></div>`;
};

const renderShapeNode = (document: DocumentFile, node: Extract<CanvasNode, { type: "shape" }>) => {
  const radius = node.shapeType === "ellipse" ? "50%" : `${node.borderRadius ?? 0}px`;
  const style = [
    nodeStyle(document, node),
    `background: ${escapeAttribute(node.fill)};`,
    `border: ${node.strokeWidth}px solid ${escapeAttribute(node.stroke)};`,
    `border-radius: ${radius};`,
  ].join(" ");
  const label = node.label ? richTextDocToHtml(node.label, document.assets) : "";

  return `<div class="canvas-node preview-shape-node" style="${style}">${label}</div>`;
};

const renderConnectorNode = (document: DocumentFile, node: ConnectorNode, nodes: CanvasNode[]) => {
  const start = resolveConnectorEndpoint(node, "start", nodes);
  const end = resolveConnectorEndpoint(node, "end", nodes);
  const minX = Math.min(start.x, end.x) - document.pageBounds.x;
  const minY = Math.min(start.y, end.y) - document.pageBounds.y;
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));
  const x1 = start.x <= end.x ? 0 : width;
  const y1 = start.y <= end.y ? 0 : height;
  const x2 = start.x <= end.x ? width : 0;
  const y2 = start.y <= end.y ? height : 0;
  const dash = node.lineStyle === "dashed" ? " stroke-dasharray=\"8 4\"" : node.lineStyle === "dotted" ? " stroke-dasharray=\"2 5\"" : "";

  return `<svg class="preview-connector-node" style="left:${minX}px;top:${minY}px;width:${width}px;height:${height}px;z-index:${node.z};"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeAttribute(node.stroke)}" stroke-width="${node.strokeWidth}"${dash} /></svg>`;
};

const renderNode = (document: DocumentFile, node: CanvasNode) => {
  if (node.type === "image") {
    return renderImageNode(document, node);
  }
  if (node.type === "shape") {
    return renderShapeNode(document, node);
  }
  if (node.type === "connector") {
    return renderConnectorNode(document, node, document.nodes);
  }

  return `<div class="canvas-node preview-text-node" style="${nodeStyle(document, node)}">${richTextDocToHtml(node.content, document.assets)}</div>`;
};

const pagePreviewHeight = (document: DocumentFile, nodes: CanvasNode[]) => {
  const maxNodeBottom = nodes.reduce(
    (bottom, node) => {
      if (!isBoxNode(node)) {
        return Math.max(bottom, node.y1 - document.pageBounds.y + 80, node.y2 - document.pageBounds.y + 80);
      }

      return Math.max(bottom, node.y - document.pageBounds.y + node.h + 80);
    },
    0,
  );

  return Math.max(document.appearance.pages.height, maxNodeBottom);
};

const documentPreviewHtml = (document: DocumentFile) => {
  const pageCount = Math.max(
    document.appearance.pages.count,
    document.nodes.reduce((count, node) => Math.max(count, node.pageIndex + 1), 1),
  );

  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const nodes = document.nodes
      .filter((node) => node.pageIndex === pageIndex)
      .sort((left, right) => left.z - right.z);
    const height = pagePreviewHeight(document, nodes);
    const gridClass = document.appearance.grid.enabled ? " has-grid" : "";

    return `<section class="page-preview" style="width: ${document.pageBounds.w}px;">
      <div
        class="page-preview-canvas${gridClass}"
        style="width: ${document.pageBounds.w}px; height: ${height}px; background: ${escapeAttribute(document.appearance.pageBackground)}; --page-grid-color: ${escapeAttribute(document.appearance.grid.color)}; --page-grid-size: ${document.appearance.grid.size}px;"
      >
        <div class="page-preview-title">${escapeHtml(pageTitle(document, pageIndex))}</div>
        ${nodes.map((node) => renderNode(document, node)).join("\n")}
      </div>
    </section>`;
  }).join("\n");
};

export const serializeDocumentJson = (document: DocumentFile): string =>
  JSON.stringify(sortValue(document), null, 2);

export const serializeDocument = (document: DocumentFile): string => {
  const json = serializeDocumentJson(document);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Infinite Canvas Document</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #16202a; background: #eef2f6; }
    main { min-width: min-content; }
    h1 { margin: 0 0 6px; font-size: 20px; }
    .hint { margin: 0 0 18px; color: #64748b; font-size: 13px; }
    .page-preview { margin: 0 0 28px; overflow: hidden; border: 1px solid rgba(15, 23, 42, 0.14); background: white; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.10); }
    .page-preview-title { position: absolute; top: 10px; left: 12px; z-index: 3; display: flex; align-items: center; min-height: 34px; max-width: 360px; padding: 0 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.78); color: #0f172a; font-size: 22px; font-weight: 700; line-height: 1.25; }
    .page-preview-canvas { position: relative; overflow: hidden; isolation: isolate; }
    .page-preview-canvas.has-grid::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; background-image: linear-gradient(var(--page-grid-color) 1px, transparent 1px), linear-gradient(90deg, var(--page-grid-color) 1px, transparent 1px); background-size: var(--page-grid-size) var(--page-grid-size); }
    .canvas-node { position: absolute; z-index: 1; overflow: hidden; }
    .preview-text-node { padding: 10px 12px; border: 1px solid rgba(15, 23, 42, 0.12); background: rgba(255, 255, 255, 0.96); color: #111827; font-size: 16px; line-height: 1.55; overflow: visible; }
    .preview-text-node p { margin: 0; min-height: 1.55em; }
    .text-block { margin: 0 0 8px; }
    .text-block:last-child { margin-bottom: 0; }
    .text-block-table-wrap { overflow: auto; max-width: 100%; }
    .text-block-table { border-collapse: collapse; table-layout: fixed; min-width: 100%; background: white; }
    .text-block-table td { min-width: 72px; padding: 8px 10px; border: 1px solid rgba(15, 23, 42, 0.32); vertical-align: top; }
    .text-block-table-cell-content .text-block { margin-bottom: 6px; }
    .text-inline-image-frame img { max-width: 100%; height: auto; vertical-align: middle; }
    .preview-image-node img, .preview-frame-node iframe { display: block; width: 100%; height: 100%; border: 0; background: white; object-fit: contain; }
    .preview-shape-node { display: flex; align-items: center; justify-content: center; padding: 12px; color: #0f172a; }
    .preview-shape-node p { margin: 0; }
    .preview-connector-node { position: absolute; overflow: visible; pointer-events: none; }
    .preview-frame-node { border: 1px solid rgba(15, 23, 42, 0.14); background: white; }
    .preview-attachment-node { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 16px; border: 1px solid rgba(15, 23, 42, 0.16); background: #f8fafc; color: #475569; }
    .preview-attachment-node strong { color: #16202a; }
  </style>
</head>
<body>
  <main>
    <h1>Infinite Canvas Document</h1>
    <p class="hint">这个 HTML 文件包含可读预览，也内嵌了完整画布数据，可直接在应用里打开恢复编辑。</p>
    ${documentPreviewHtml(document)}
  </main>
  <script id="icanvas-document" type="application/json">${escapeScriptJson(json)}</script>
</body>
</html>
`;
};
