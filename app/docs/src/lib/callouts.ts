export type CalloutKind = "note" | "warning" | "experimental";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

const markers: Record<string, CalloutKind> = {
  NOTE: "note",
  TIP: "note",
  IMPORTANT: "note",
  WARNING: "warning",
  CAUTION: "warning",
  EXPERIMENTAL: "experimental",
};

export const calloutLabels: Record<CalloutKind, string> = {
  note: "Note",
  warning: "Warning",
  experimental: "Experimental",
};

function markCallout(blockquote: MdNode) {
  const paragraph = blockquote.children?.[0];
  const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : null;
  if (!paragraph || text?.type !== "text" || !text.value) return;

  const match = /^\[!([A-Z]+)\][ \t]*\n?/.exec(text.value);
  const kind = match?.[1] ? markers[match[1]] : undefined;
  if (!match || !kind) return;

  text.value = text.value.slice(match[0].length);
  if (!text.value) paragraph.children?.shift();
  if (!paragraph.children?.length) blockquote.children?.shift();
  blockquote.data = { hProperties: { "data-callout": kind } };
}

function walk(node: MdNode) {
  if (node.type === "blockquote") markCallout(node);
  node.children?.forEach(walk);
}

export function remarkCallouts() {
  return (tree: MdNode) => walk(tree);
}
