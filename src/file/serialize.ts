import type { DocumentFile } from "../model/types";

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

const escapeScriptJson = (value: string) =>
  value
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");

const plainTextFromInline = (inline: unknown): string => {
  if (!inline || typeof inline !== "object") {
    return "";
  }

  const record = inline as Record<string, unknown>;
  if (record.type === "text") {
    return typeof record.text === "string" ? record.text : "";
  }

  if (record.type === "break") {
    return "\n";
  }

  if (record.type === "image") {
    return "[图片]";
  }

  return "";
};

const plainTextFromBlock = (block: unknown): string => {
  if (!block || typeof block !== "object") {
    return "";
  }

  const record = block as Record<string, unknown>;
  if (record.type === "paragraph") {
    return Array.isArray(record.content)
      ? record.content.map(plainTextFromInline).join("")
      : "";
  }

  if (record.type === "table") {
    const rows = Array.isArray(record.rows) ? record.rows : [];
    return rows.map((row) => {
      if (!row || typeof row !== "object") {
        return "";
      }

      const cells = Array.isArray((row as Record<string, unknown>).cells)
        ? (row as Record<string, unknown>).cells as unknown[]
        : [];

      return cells.map((cell) => {
        if (!cell || typeof cell !== "object") {
          return "";
        }

        const content = Array.isArray((cell as Record<string, unknown>).content)
          ? (cell as Record<string, unknown>).content as unknown[]
          : [];
        return content.map(plainTextFromBlock).join(" ").trim();
      }).join(" | ");
    }).join("\n");
  }

  return "";
};

const documentPreviewHtml = (document: DocumentFile) => {
  const nodes = [...document.nodes].sort((left, right) =>
    (left.pageIndex - right.pageIndex)
    || (left.y - right.y)
    || (left.x - right.x)
    || (left.z - right.z));

  return nodes.map((node) => {
    if (node.type === "image") {
      const asset = document.assets[node.assetId];
      if (!asset) {
        return `<section class="node image-node"><h2>附件块</h2><p>资源缺失</p></section>`;
      }

      if (asset.storage === "managed") {
        return `<section class="node image-node"><h2>${asset.type === "pdf" ? "PDF 附件" : "附件"}</h2><p>${escapeHtml(asset.name)}</p><p class="hint">${escapeHtml(asset.relativePath ?? "受管附件")}</p></section>`;
      }

      if (asset.type === "image" && asset.data) {
        return `<section class="node image-node"><h2>图片块</h2><img src="${asset.data}" alt="${escapeHtml(asset.name)}" /></section>`;
      }

      if (asset.type === "html" && asset.data) {
        return `<section class="node image-node"><h2>HTML 预览</h2><p>${escapeHtml(asset.name)}</p></section>`;
      }

      if (asset.type === "pdf" && asset.data) {
        return `<section class="node image-node"><h2>PDF 附件</h2><iframe src="${asset.data}" title="${escapeHtml(asset.name)}"></iframe></section>`;
      }

      return `<section class="node image-node"><h2>附件</h2><p>${escapeHtml(asset.name)}</p><p class="hint">${escapeHtml(asset.mimeType || "application/octet-stream")}</p></section>`;
    }

    const text = node.content.content.map(plainTextFromBlock).join("\n\n").trim();
    return `<section class="node text-node"><h2>文本块</h2><pre>${escapeHtml(text)}</pre></section>`;
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
    body { margin: 0; padding: 32px; font-family: sans-serif; color: #16202a; background: #f6f7f9; }
    main { max-width: 920px; margin: 0 auto; }
    .node { margin: 0 0 24px; padding: 20px; border-radius: 16px; background: white; box-shadow: 0 8px 24px rgba(31, 58, 95, 0.08); }
    h1, h2 { margin: 0 0 12px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; line-height: 1.6; }
    img, iframe { max-width: 100%; width: 100%; height: auto; border-radius: 12px; border: 0; }
    iframe { min-height: 480px; background: white; }
    .hint { color: #64748b; margin-bottom: 24px; }
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
