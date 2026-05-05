import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WORKSPACE_DIR_NAME = "Infinite Canvas";
const RUNTIME_PORT = 19876;
const DOCUMENT_EXTENSIONS = new Set([".icanvas.json", ".json"]);

const nowIso = () => new Date().toISOString();
const workspaceRoot = () => path.join(os.homedir(), "Documents", WORKSPACE_DIR_NAME);
const nodeId = (type) => `node_${type}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const docId = () => `doc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

const jsonResult = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const errorResult = (error) => ({
  isError: true,
  content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
});

const withToolErrors = (handler) => async (args) => {
  try {
    return jsonResult(await handler(args ?? {}));
  } catch (error) {
    return errorResult(error);
  }
};

const assertObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
};

const resolveDocumentPath = async (filePath) => {
  const root = path.resolve(workspaceRoot());
  const resolved = path.resolve(String(filePath || ""));
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("filePath must be inside ~/Documents/Infinite Canvas.");
  }
  return resolved;
};

const resolveNewDocumentPath = async (fileName) => {
  const cleanName = String(fileName || "").trim();
  if (!cleanName || cleanName === "." || cleanName === ".." || /[\\/]/.test(cleanName)) {
    throw new Error("fileName must be a file name, not a path.");
  }
  const finalName = cleanName.endsWith(".icanvas.json") ? cleanName : `${cleanName.replace(/\.json$/i, "")}.icanvas.json`;
  return path.join(workspaceRoot(), finalName);
};

const parseDocumentText = (rawText) => {
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith("<")) {
    const match = rawText.match(/<script[^>]*id=(["'])icanvas-document\1[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      throw new Error("HTML document does not contain an icanvas-document script.");
    }
    return JSON.parse(match[2]);
  }
  return JSON.parse(rawText);
};

const readDocument = async (filePath) => {
  const resolved = await resolveDocumentPath(filePath);
  const rawText = await fs.readFile(resolved, "utf8");
  const document = parseDocumentText(rawText);
  if (document?.format !== "icanvas" || !Array.isArray(document.nodes)) {
    throw new Error("File is not a valid Infinite Canvas document.");
  }
  return { filePath: resolved, document };
};

const writeDocument = async (filePath, document) => {
  const resolved = await resolveDocumentPath(filePath);
  const nextDocument = {
    ...document,
    meta: {
      ...document.meta,
      updatedAt: nowIso(),
    },
  };
  await fs.writeFile(resolved, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");
  return nextDocument;
};

const defaultAppearance = (pageCount = 1) => ({
  pageBackground: "#ffffff",
  grid: {
    enabled: false,
    color: "rgba(15, 23, 42, 0.08)",
    size: 24,
  },
  pages: {
    count: Math.max(1, Math.floor(pageCount)),
    height: 1200,
    gap: 72,
    titles: [],
  },
});

const createEmptyDocument = (pageCount = 1) => {
  const timestamp = nowIso();
  return {
    format: "icanvas",
    version: 2,
    meta: {
      id: docId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    nodes: [],
    assets: {},
    pageBounds: { x: 0, y: 0, w: 1600, h: 1200 },
    viewState: { cameraX: 0, cameraY: 0, zoom: 1 },
    appearance: defaultAppearance(pageCount),
  };
};

const inferPageCount = (document) => {
  const explicit = Number(document?.appearance?.pages?.count);
  const fromNodes = Array.isArray(document?.nodes)
    ? document.nodes.reduce((max, item) => Math.max(max, Math.floor(Number(item?.pageIndex) || 0) + 1), 1)
    : 1;
  return Math.max(1, Number.isFinite(explicit) ? Math.floor(explicit) : 1, fromNodes);
};

const summarizeNode = (node) => {
  const base = {
    id: node.id,
    type: node.type,
    pageIndex: node.pageIndex,
    z: node.z,
  };
  if (node.type === "connector") {
    return { ...base, x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2, label: node.label };
  }
  if (node.type === "timeline") {
    return { ...base, x: node.x, y: node.y, w: node.w, h: node.h, entryCount: node.entries?.length ?? 0 };
  }
  return { ...base, x: node.x, y: node.y, w: node.w, h: node.h };
};

const maxZ = (nodes) => nodes.reduce((max, item) => Math.max(max, Number(item?.z) || 0), 0);

const fitPageBoundsToNodes = (nodes) => {
  const fallback = { x: 0, y: 0, w: 1600, h: 1200 };
  if (!nodes.length) {
    return fallback;
  }
  const margin = 240;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of nodes) {
    if (item.type === "connector") {
      maxX = Math.max(maxX, item.x1 + margin, item.x2 + margin);
      maxY = Math.max(maxY, item.y1 + margin, item.y2 + margin);
    } else {
      maxX = Math.max(maxX, item.x + item.w + margin);
      maxY = Math.max(maxY, item.y + item.h + margin);
    }
  }
  return {
    ...fallback,
    w: Math.max(fallback.w, maxX - fallback.x),
    h: Math.max(fallback.h, maxY - fallback.y),
  };
};

const settleDocument = (document) => {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const pageCount = inferPageCount({ ...document, nodes });
  return {
    ...document,
    nodes,
    pageBounds: {
      ...(document.pageBounds ?? {}),
      ...fitPageBoundsToNodes(nodes),
      h: Math.max(fitPageBoundsToNodes(nodes).h, Number(document?.appearance?.pages?.height) || 1200),
    },
    appearance: {
      ...document.appearance,
      pages: {
        ...document.appearance?.pages,
        count: pageCount,
      },
    },
  };
};

const addNode = async (filePath, node) => {
  const { document } = await readDocument(filePath);
  const nextNode = {
    ...node,
    pageIndex: Math.max(0, Math.floor(Number(node.pageIndex) || 0)),
    z: maxZ(document.nodes) + 1,
  };
  const nextDocument = settleDocument({
    ...document,
    nodes: [...document.nodes, nextNode],
  });
  const saved = await writeDocument(filePath, nextDocument);
  return { node: nextNode, document: { filePath, updatedAt: saved.meta.updatedAt } };
};

const textInline = (text, patch = {}) => ({
  type: "text",
  text,
  ...(patch.marks ? { marks: patch.marks } : {}),
  ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
  ...(patch.fontFamily ? { fontFamily: patch.fontFamily } : {}),
  ...(patch.color ? { color: patch.color } : {}),
});

const parseInlineMarkdown = (input) => {
  const result = [];
  let index = 0;
  while (index < input.length) {
    const rest = input.slice(index);
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      result.push(textInline(code[1], { fontFamily: "Consolas, monospace", color: "#334155" }));
      index += code[0].length;
      continue;
    }
    const bold = rest.match(/^\*\*([^*]+)\*\*/);
    if (bold) {
      result.push(textInline(bold[1], { marks: ["bold"] }));
      index += bold[0].length;
      continue;
    }
    const italic = rest.match(/^\*([^*]+)\*/);
    if (italic) {
      result.push(textInline(italic[1], { marks: ["italic"] }));
      index += italic[0].length;
      continue;
    }
    const nextSpecial = rest.search(/(`|\*\*)/);
    if (nextSpecial > 0) {
      result.push(textInline(rest.slice(0, nextSpecial)));
      index += nextSpecial;
      continue;
    }
    result.push(textInline(rest[0]));
    index += 1;
  }
  return result.length ? result : [{ type: "break" }];
};

const richParagraph = (text, patch = {}) => ({
  type: "paragraph",
  content: parseInlineMarkdown(text).map((inline) => {
    if (inline.type !== "text") {
      return inline;
    }
    const marks = Array.from(new Set([...(inline.marks ?? []), ...(patch.marks ?? [])]));
    return {
      ...inline,
      ...(marks.length ? { marks } : {}),
      ...(patch.fontSize ? { fontSize: patch.fontSize } : {}),
      ...(patch.color ? { color: patch.color } : {}),
    };
  }),
});

const richTextDoc = (text = "") => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const parseMarkdownToRichTextDoc = (markdown) => {
  const headingSizes = ["32px", "28px", "24px", "20px", "18px", "16px"];
  const blocks = [];
  const pending = [];
  const flush = () => {
    const text = pending.join(" ").trim();
    pending.length = 0;
    if (text) {
      blocks.push(richParagraph(text));
    }
  };
  for (const line of String(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      blocks.push(richParagraph(heading[2], {
        marks: ["bold"],
        fontSize: headingSizes[heading[1].length - 1],
        color: "#0f172a",
      }));
      continue;
    }
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flush();
      blocks.push(richParagraph(`• ${unordered[1]}`));
      continue;
    }
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flush();
      blocks.push(richParagraph(`${blocks.length + 1}. ${ordered[1]}`));
      continue;
    }
    pending.push(trimmed);
  }
  flush();
  return { type: "doc", content: blocks.length ? blocks : [richParagraph("")] };
};

const walkDocuments = async (root, current = root) => {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const documents = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === ".attachments") {
      continue;
    }
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      documents.push(...await walkDocuments(root, absolute));
      continue;
    }
    if (entry.isFile() && Array.from(DOCUMENT_EXTENSIONS).some((ext) => absolute.toLowerCase().endsWith(ext))) {
      documents.push(absolute);
    }
  }
  return documents;
};

const requestRuntime = (method, route, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const request = http.request({
    hostname: "127.0.0.1",
    port: RUNTIME_PORT,
    path: route,
    method,
    headers: payload ? {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    } : undefined,
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const parsed = text ? JSON.parse(text) : null;
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(parsed?.error || `Runtime request failed with ${response.statusCode}.`));
        return;
      }
      resolve(parsed);
    });
  });
  request.on("error", (error) => reject(new Error(`Infinite Canvas runtime is unavailable: ${error.message}`)));
  if (payload) {
    request.write(payload);
  }
  request.end();
});

const server = new McpServer({
  name: "infinite-canvas",
  version: "0.1.0",
});

server.registerTool("list_documents", {
  description: "Scan ~/Documents/Infinite Canvas and return .icanvas.json documents.",
}, withToolErrors(async () => {
  await fs.mkdir(workspaceRoot(), { recursive: true });
  const root = workspaceRoot();
  const paths = await walkDocuments(root);
  const documents = await Promise.all(paths.map(async (filePath) => {
    const stats = await fs.stat(filePath);
    try {
      const { document } = await readDocument(filePath);
      return {
        filePath,
        relativePath: path.relative(root, filePath),
        pageCount: inferPageCount(document),
        updatedAt: document.meta?.updatedAt ?? stats.mtime.toISOString(),
      };
    } catch {
      return {
        filePath,
        relativePath: path.relative(root, filePath),
        pageCount: 1,
        updatedAt: stats.mtime.toISOString(),
      };
    }
  }));
  return { rootPath: root, documents };
}));

server.registerTool("read_document", {
  description: "Read an Infinite Canvas document and return full JSON or node summaries.",
  inputSchema: {
    filePath: z.string(),
    full: z.boolean().optional(),
  },
}, withToolErrors(async ({ filePath, full }) => {
  const { document } = await readDocument(filePath);
  return full ? document : {
    format: document.format,
    version: document.version,
    meta: document.meta,
    pageCount: inferPageCount(document),
    nodeCount: document.nodes.length,
    nodes: document.nodes.map(summarizeNode),
    assets: Object.keys(document.assets ?? {}),
    pageBounds: document.pageBounds,
    viewState: document.viewState,
    appearance: document.appearance,
  };
}));

server.registerTool("create_document", {
  description: "Create a blank .icanvas.json document in the workspace.",
  inputSchema: {
    fileName: z.string(),
    pageCount: z.number().int().positive().optional(),
  },
}, withToolErrors(async ({ fileName, pageCount }) => {
  await fs.mkdir(workspaceRoot(), { recursive: true });
  const filePath = await resolveNewDocumentPath(fileName);
  const document = createEmptyDocument(pageCount ?? 1);
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { filePath, document };
}));

server.registerTool("add_text_node", {
  description: "Add a text node. Uses markdownText when provided.",
  inputSchema: {
    filePath: z.string(),
    node: z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      pageIndex: z.number().int().nonnegative().optional(),
      text: z.string().optional(),
      markdownText: z.string().optional(),
    }),
  },
}, withToolErrors(async ({ filePath, node }) => {
  const content = node.markdownText !== undefined
    ? parseMarkdownToRichTextDoc(node.markdownText)
    : richTextDoc(node.text ?? "");
  return addNode(filePath, {
    id: nodeId("text"),
    type: "text",
    pageIndex: node.pageIndex ?? 0,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z: 1,
    content,
    style: { fontSize: 16 },
  });
}));

server.registerTool("add_shape_node", {
  description: "Add a shape node.",
  inputSchema: {
    filePath: z.string(),
    node: z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      pageIndex: z.number().int().nonnegative().optional(),
      shapeType: z.enum(["rect", "ellipse"]).optional(),
      fill: z.string().optional(),
      label: z.string().optional(),
    }),
  },
}, withToolErrors(async ({ filePath, node }) => {
  const shapeType = node.shapeType ?? "rect";
  return addNode(filePath, {
    id: nodeId("shape"),
    type: "shape",
    pageIndex: node.pageIndex ?? 0,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z: 1,
    shapeType,
    fill: node.fill ?? (shapeType === "ellipse" ? "#fef3c7" : "#dbeafe"),
    stroke: "#1d4ed8",
    strokeWidth: 2,
    ...(shapeType === "rect" ? { borderRadius: 12 } : {}),
    ...(node.label ? { label: richTextDoc(node.label) } : {}),
    style: {},
  });
}));

server.registerTool("add_timeline_entries", {
  description: "Append timeline entries to an existing or new timeline node.",
  inputSchema: {
    filePath: z.string(),
    nodeId: z.string().optional(),
    entries: z.array(z.object({}).passthrough()),
  },
}, withToolErrors(async ({ filePath, nodeId: targetNodeId, entries }) => {
  const { document } = await readDocument(filePath);
  const normalizedEntries = entries.map((entry) => assertObject(entry, "timeline entry"));
  const existing = targetNodeId
    ? document.nodes.find((item) => item.id === targetNodeId)
    : document.nodes.find((item) => item.type === "timeline");
  if (existing && existing.type !== "timeline") {
    throw new Error("nodeId does not reference a timeline node.");
  }
  if (existing) {
    const nextNodes = document.nodes.map((item) => item.id === existing.id
      ? { ...item, entries: [...(item.entries ?? []), ...normalizedEntries] }
      : item);
    const saved = await writeDocument(filePath, settleDocument({ ...document, nodes: nextNodes }));
    return { nodeId: existing.id, entryCount: normalizedEntries.length, updatedAt: saved.meta.updatedAt };
  }
  return addNode(filePath, {
    id: nodeId("timeline"),
    type: "timeline",
    pageIndex: 0,
    x: 80,
    y: 80,
    w: 640,
    h: 400,
    z: 1,
    entries: normalizedEntries,
    style: {},
  });
}));

server.registerTool("update_node", {
  description: "Patch a node by id.",
  inputSchema: {
    filePath: z.string(),
    nodeId: z.string(),
    patch: z.object({}).passthrough(),
  },
}, withToolErrors(async ({ filePath, nodeId: targetNodeId, patch }) => {
  const { document } = await readDocument(filePath);
  let found = false;
  const nextNodes = document.nodes.map((item) => {
    if (item.id !== targetNodeId) {
      return item;
    }
    found = true;
    return { ...item, ...patch, id: item.id, type: item.type };
  });
  if (!found) {
    throw new Error(`Node not found: ${targetNodeId}`);
  }
  const saved = await writeDocument(filePath, settleDocument({ ...document, nodes: nextNodes }));
  return { nodeId: targetNodeId, updatedAt: saved.meta.updatedAt };
}));

server.registerTool("delete_node", {
  description: "Delete a node by id.",
  inputSchema: {
    filePath: z.string(),
    nodeId: z.string(),
  },
}, withToolErrors(async ({ filePath, nodeId: targetNodeId }) => {
  const { document } = await readDocument(filePath);
  const nextNodes = document.nodes.filter((item) => item.id !== targetNodeId);
  if (nextNodes.length === document.nodes.length) {
    throw new Error(`Node not found: ${targetNodeId}`);
  }
  const saved = await writeDocument(filePath, settleDocument({ ...document, nodes: nextNodes }));
  return { nodeId: targetNodeId, deleted: true, updatedAt: saved.meta.updatedAt };
}));

server.registerTool("add_connector", {
  description: "Add a connector node.",
  inputSchema: {
    filePath: z.string(),
    connector: z.object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      pageIndex: z.number().int().nonnegative().optional(),
      startNodeId: z.string().optional(),
      endNodeId: z.string().optional(),
      label: z.string().optional(),
    }),
  },
}, withToolErrors(async ({ filePath, connector }) => addNode(filePath, {
  id: nodeId("connector"),
  type: "connector",
  pageIndex: connector.pageIndex ?? 0,
  z: 1,
  x1: connector.x1,
  y1: connector.y1,
  x2: connector.x2,
  y2: connector.y2,
  ...(connector.startNodeId ? { startNodeId: connector.startNodeId } : {}),
  ...(connector.endNodeId ? { endNodeId: connector.endNodeId } : {}),
  stroke: "#2563eb",
  strokeWidth: 2,
  lineStyle: "solid",
  startMarker: "none",
  endMarker: "arrow",
  ...(connector.label ? { label: connector.label } : {}),
  style: {},
})));

server.registerTool("get_app_state", {
  description: "Get current running Electron app state from localhost runtime.",
}, withToolErrors(async () => requestRuntime("GET", "/state")));

server.registerTool("open_document_in_app", {
  description: "Open a document in the running Electron app.",
  inputSchema: { filePath: z.string() },
}, withToolErrors(async ({ filePath }) => requestRuntime("POST", "/open", { filePath })));

server.registerTool("navigate_to_node", {
  description: "Navigate the running Electron app viewport to a node.",
  inputSchema: { nodeId: z.string() },
}, withToolErrors(async ({ nodeId }) => requestRuntime("POST", "/navigate", { nodeId })));

await server.connect(new StdioServerTransport());
