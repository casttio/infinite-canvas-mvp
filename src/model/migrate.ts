import { createDefaultPageBounds, derivePageBoundsFromNodes } from "./defaults";
import { normalizeDocument } from "./normalize";
import type { DocumentFile, PageBounds } from "./types";

export const migrateDocument = (input: unknown): DocumentFile => {
  if (!input || typeof input !== "object") {
    throw new Error("文档内容不是合法对象。");
  }

  const rawInput = input as {
    version?: unknown;
    nodes?: Array<{ x?: unknown; y?: unknown; w?: unknown; h?: unknown }>;
  };

  if (rawInput.version === 1) {
    const migratedNodes = Array.isArray(rawInput.nodes)
      ? rawInput.nodes.filter(
          (node): node is { id: string; type: "text" | "image"; x: number; y: number; w: number; h: number; z: number; style: Record<string, unknown>; pageIndex?: number } =>
            !!node &&
            typeof node === "object" &&
            typeof (node as { x?: unknown }).x === "number" &&
            typeof (node as { y?: unknown }).y === "number" &&
            typeof (node as { w?: unknown }).w === "number" &&
            typeof (node as { h?: unknown }).h === "number",
        )
      : [];
    return normalizeDocument({
      ...(rawInput as Record<string, unknown>),
      version: 2,
      pageBounds: derivePageBoundsFromNodes(migratedNodes),
    } as DocumentFile);
  }

  if (rawInput.version === 2) {
    return normalizeDocument(input as DocumentFile);
  }

  throw new Error(`仅支持 version 1 或 version 2，当前文件版本为 ${String(rawInput.version)}。`);
};
