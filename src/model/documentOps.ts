import type { Asset, CanvasNode, DocumentFile } from "./types";
import { fitPageBoundsToNodes } from "./defaults";

const VERTICAL_NODE_GAP = 24;

const nextZ = (nodes: CanvasNode[]) => (nodes.length ? Math.max(...nodes.map((node) => node.z)) + 1 : 1);

const clampNodeToPageOrigin = (node: CanvasNode, document: DocumentFile): CanvasNode => ({
  ...node,
  x: Math.max(document.pageBounds.x, node.x),
  y: Math.max(document.pageBounds.y, node.y),
} as CanvasNode);

const overlapsHorizontally = (first: CanvasNode, second: CanvasNode) =>
  first.x < second.x + second.w && first.x + first.w > second.x;

const pushOverlappingNodesDown = (
  nodes: CanvasNode[],
  sourceNodeIds: string[],
) => {
  const nextNodes = nodes.map((node) => ({ ...node }));
  const nodeMap = new Map(nextNodes.map((node) => [node.id, node]));
  const queue = [...sourceNodeIds];
  const queued = new Set(queue);

  while (queue.length > 0) {
    const sourceNodeId = queue.shift();
    if (!sourceNodeId) {
      continue;
    }

    queued.delete(sourceNodeId);
    const sourceNode = nodeMap.get(sourceNodeId);
    if (!sourceNode) {
      continue;
    }

    nextNodes
      .filter((candidate) => candidate.id !== sourceNode.id && candidate.y >= sourceNode.y && overlapsHorizontally(sourceNode, candidate))
      .sort((left, right) => (left.y - right.y) || (left.z - right.z))
      .forEach((candidate) => {
        const minY = sourceNode.y + sourceNode.h + VERTICAL_NODE_GAP;
        if (candidate.y >= minY) {
          return;
        }

        candidate.y = minY;

        if (!queued.has(candidate.id)) {
          queue.push(candidate.id);
          queued.add(candidate.id);
        }
      });
  }

  return nextNodes;
};

interface UpdateNodeOptions {
  avoidVerticalOverlap?: boolean;
}

export const addNodeToDocument = (document: DocumentFile, node: CanvasNode): DocumentFile => {
  const nextNode = {
    ...clampNodeToPageOrigin(node, document),
    z: nextZ(document.nodes),
  } as CanvasNode;
  const nextNodes = [...document.nodes, nextNode];

  return {
    ...document,
    nodes: nextNodes,
    pageBounds: fitPageBoundsToNodes(nextNodes),
  };
};

export const addImageNodeToDocument = (
  document: DocumentFile,
  node: CanvasNode,
  asset: Asset,
): DocumentFile => ({
  ...addNodeToDocument(document, node),
  assets: {
    ...document.assets,
    [asset.id]: asset,
  },
});

export const updateNodeInDocument = (
  document: DocumentFile,
  nodeId: string,
  updater: (node: CanvasNode) => CanvasNode,
  options: UpdateNodeOptions = {},
): DocumentFile => {
  let didUpdate = false;
  const updatedNodes = document.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    didUpdate = true;
    return clampNodeToPageOrigin(updater(node), document);
  });

  if (!didUpdate) {
    return document;
  }

  const nextNodes = options.avoidVerticalOverlap
    ? pushOverlappingNodesDown(updatedNodes, [nodeId])
    : updatedNodes;

  return {
    ...document,
    nodes: nextNodes,
    pageBounds: fitPageBoundsToNodes(nextNodes),
  };
};
