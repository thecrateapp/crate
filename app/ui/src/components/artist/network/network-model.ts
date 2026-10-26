export interface NetworkNode {
  id: string;
  group: number;
  in_library: boolean;
  score: number;
  artist_id?: number;
  artist_slug?: string;
}

export interface NetworkLink {
  source: string | { id?: string };
  target: string | { id?: string };
  value: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

export type NetworkFilter = "all" | "missing" | "shows";

export interface NetworkNeighbor {
  node: NetworkNode;
  score: number;
}

export function nodeKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function linkEndpoint(end: NetworkLink["source"]): string {
  return typeof end === "string" ? end : (end?.id ?? "");
}

export function sameArtist(a: string, b: string) {
  return nodeKey(a) === nodeKey(b);
}

/** Adds an expansion to the graph without duplicating artists that differ only by case. */
export function mergeNetwork(
  previous: NetworkData,
  next: NetworkData,
): { data: NetworkData; added: number } {
  const ids = new Map(
    previous.nodes.map((node) => [nodeKey(node.id), node.id]),
  );
  const nodes = [...previous.nodes];
  for (const node of next.nodes) {
    if (ids.has(nodeKey(node.id))) continue;
    ids.set(nodeKey(node.id), node.id);
    nodes.push(node);
  }
  const seen = new Set(
    previous.links.map((link) =>
      pairKey(linkEndpoint(link.source), linkEndpoint(link.target)),
    ),
  );
  const links = [...previous.links];
  for (const link of next.links) {
    const source = ids.get(nodeKey(linkEndpoint(link.source)));
    const target = ids.get(nodeKey(linkEndpoint(link.target)));
    if (!source || !target) continue;
    const key = pairKey(source, target);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target, value: link.value });
  }
  return {
    data: { nodes, links },
    added: nodes.length - previous.nodes.length,
  };
}

function pairKey(a: string, b: string) {
  const [left, right] = [nodeKey(a), nodeKey(b)].sort();
  return `${left}||${right}`;
}

export function neighborsOf(data: NetworkData, id: string): NetworkNeighbor[] {
  const nodes = new Map(data.nodes.map((node) => [nodeKey(node.id), node]));
  const best = new Map<string, number>();
  for (const link of data.links) {
    const source = linkEndpoint(link.source);
    const target = linkEndpoint(link.target);
    const other = sameArtist(source, id)
      ? target
      : sameArtist(target, id)
        ? source
        : null;
    if (!other) continue;
    const key = nodeKey(other);
    best.set(key, Math.max(best.get(key) ?? 0, link.value));
  }
  return [...best.entries()]
    .flatMap(([key, score]) => {
      const node = nodes.get(key);
      return node ? [{ node, score }] : [];
    })
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
}

/** Keeps the center and the selection visible whatever the filter. */
export function filterNetwork(
  data: NetworkData,
  filter: NetworkFilter,
  artistsWithShows: ReadonlySet<string>,
  pinned: readonly string[],
): NetworkData {
  if (filter === "all") return data;
  const keep = new Set(
    data.nodes
      .filter(
        (node) =>
          pinned.some((id) => sameArtist(id, node.id)) ||
          (filter === "missing"
            ? !node.in_library
            : artistsWithShows.has(nodeKey(node.id))),
      )
      .map((node) => nodeKey(node.id)),
  );
  return {
    nodes: data.nodes.filter((node) => keep.has(nodeKey(node.id))),
    links: data.links.filter(
      (link) =>
        keep.has(nodeKey(linkEndpoint(link.source))) &&
        keep.has(nodeKey(linkEndpoint(link.target))),
    ),
  };
}

export function labelVisible({
  node,
  center,
  selected,
  hovered,
  focus,
  scale,
}: {
  node: NetworkNode;
  center: string;
  selected: string | null;
  hovered: string | null;
  focus: ReadonlySet<string>;
  scale: number;
}) {
  if (sameArtist(node.id, center)) return true;
  if (hovered && sameArtist(node.id, hovered)) return true;
  if (selected && focus.has(nodeKey(node.id))) return true;
  return scale >= 2;
}

export function nodeRadius(node: NetworkNode, isCenter: boolean) {
  const base = isCenter ? 14 : node.in_library ? 7 : 5;
  return base + Math.max(0, Math.min(1, node.score)) * 8;
}

export function similarityPercent(score: number) {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}
