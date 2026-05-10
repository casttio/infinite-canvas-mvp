import type {
  CanvasNode,
  DocumentFile,
  RichTextBlock,
  RichTextInline,
  RichTextNodeLink,
} from "./types";

export interface OutgoingReference {
  targetNodeId: string;
  targetPage: number;
  label?: string;
  context?: string;
}

export interface IncomingReference {
  sourceNodeId: string;
  sourcePage: number;
  label: string;
  context?: string;
}

export interface ReferenceIndex {
  outgoing: Map<string, OutgoingReference[]>;
  incoming: Map<string, IncomingReference[]>;
}

const appendReference = (
  index: ReferenceIndex,
  sourceNode: CanvasNode,
  nodeLink: RichTextNodeLink,
  context?: string,
) => {
  const outgoingRef: OutgoingReference = {
    targetNodeId: nodeLink.nodeId,
    targetPage: nodeLink.pageIndex,
    ...(nodeLink.label ? { label: nodeLink.label } : {}),
    ...(context ? { context } : {}),
  };
  const incomingRef: IncomingReference = {
    sourceNodeId: sourceNode.id,
    sourcePage: sourceNode.pageIndex,
    label: nodeLink.label ?? context ?? sourceNode.id,
    ...(context ? { context } : {}),
  };

  index.outgoing.set(sourceNode.id, [...(index.outgoing.get(sourceNode.id) ?? []), outgoingRef]);
  index.incoming.set(nodeLink.nodeId, [...(index.incoming.get(nodeLink.nodeId) ?? []), incomingRef]);
};

const collectTextReferences = (
  sourceNode: CanvasNode,
  inline: RichTextInline,
  index: ReferenceIndex,
) => {
  if (inline.type !== "text" || !inline.nodeLink) return;
  appendReference(index, sourceNode, inline.nodeLink, inline.text);
};

const walkRichTextBlocks = (
  blocks: RichTextBlock[],
  visitInline: (inline: RichTextInline) => void,
) => {
  blocks.forEach((block) => {
    if (block.type === "paragraph") {
      block.content.forEach(visitInline);
      return;
    }

    block.rows.forEach((row) => {
      row.cells.forEach((cell) => walkRichTextBlocks(cell.content, visitInline));
    });
  });
};

const collectNodeReferences = (node: CanvasNode, index: ReferenceIndex) => {
  if (node.type === "text") {
    walkRichTextBlocks(node.content.content, (inline) => collectTextReferences(node, inline, index));
    return;
  }

  if (node.type === "shape" && node.label) {
    walkRichTextBlocks(node.label.content, (inline) => collectTextReferences(node, inline, index));
    return;
  }

  if (node.type === "timeline") {
    node.entries.forEach((entry) => {
      if (!entry.nodeRef) return;
      appendReference(index, node, entry.nodeRef, entry.title);
    });
  }
};

export const buildReferenceIndex = (document: Pick<DocumentFile, "nodes">): ReferenceIndex => {
  const index: ReferenceIndex = {
    outgoing: new Map(),
    incoming: new Map(),
  };

  document.nodes.forEach((node) => collectNodeReferences(node, index));
  return index;
};
