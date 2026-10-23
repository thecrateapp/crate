export interface GenreWheelTaxonomyNode {
  slug: string;
  name: string;
  alias_names?: string[];
  origin?: "core" | "overlay";
  top_level: boolean;
  parent_slugs: string[];
  children_slugs?: string[];
  related_slugs: string[];
  influenced_by_slugs?: string[];
  influences_slugs?: string[];
  fusion_of_slugs?: string[];
  fusion_genre_slugs?: string[];
  artist_count: number;
  album_count: number;
  track_count?: number;
  raw_tag_count?: number;
  mapped_raw_tags?: string[];
  catalog_track_count?: number;
  catalog_track_share_pct?: number;
  listening_share_90d_pct?: number | null;
  eq_gains: number[] | null;
  eq_preset_source: string | null;
  eq_preset_inherited_from: string | null;
}

export interface GenreWheelPosition {
  slug: string;
  ring: number;
  angle: number;
  radius: number;
  x: number;
  y: number;
  flip: boolean;
}

export interface GenreWheelModel {
  nodes: GenreWheelTaxonomyNode[];
  positions: Map<string, GenreWheelPosition>;
  parentEdges: { slug: string; parent: string }[];
  relatedPairs: string[];
  semanticEdges: {
    source: string;
    target: string;
    type: "influence" | "fusion";
  }[];
  families: number;
  focusSlug?: string;
  directSlugs?: string[];
  contextSlugs?: string[];
  siblingPairs?: string[];
}

const RELATION_FIELDS = [
  "parent_slugs",
  "children_slugs",
  "related_slugs",
  "influenced_by_slugs",
  "influences_slugs",
  "fusion_of_slugs",
  "fusion_genre_slugs",
] as const;

function normalizeGenreName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve an editable overlay tag to the nearest core genre(s) represented by
 * the wheel. Overlay tags can be linked through other overlay nodes, so only
 * checking their direct relations leaves valid selections visually inert.
 */
export function resolveOverlayCoreTargets(
  selected: GenreWheelTaxonomyNode,
  taxonomyNodes: readonly GenreWheelTaxonomyNode[],
): string[] {
  const bySlug = new Map(taxonomyNodes.map((node) => [node.slug, node]));
  const coreSlugs = new Set(
    taxonomyNodes
      .filter((node) => node.origin === "core")
      .map((node) => node.slug),
  );
  if (!bySlug.has(selected.slug) || coreSlugs.has(selected.slug)) return [];

  const adjacency = new Map<string, Set<string>>(
    taxonomyNodes.map((node) => [node.slug, new Set<string>()]),
  );
  for (const node of taxonomyNodes) {
    for (const field of RELATION_FIELDS) {
      for (const relatedSlug of node[field] ?? []) {
        if (!bySlug.has(relatedSlug)) continue;
        adjacency.get(node.slug)?.add(relatedSlug);
        adjacency.get(relatedSlug)?.add(node.slug);
      }
    }
  }

  const queue = [selected.slug];
  const distance = new Map([[selected.slug, 0]]);
  const targets = new Set<string>();
  let nearestCoreDistance = Number.POSITIVE_INFINITY;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const slug = queue[cursor]!;
    const currentDistance = distance.get(slug)!;
    if (currentDistance >= nearestCoreDistance) continue;
    for (const relatedSlug of adjacency.get(slug) ?? []) {
      const nextDistance = currentDistance + 1;
      if (coreSlugs.has(relatedSlug)) {
        if (nextDistance < nearestCoreDistance) {
          nearestCoreDistance = nextDistance;
          targets.clear();
        }
        if (nextDistance === nearestCoreDistance) targets.add(relatedSlug);
        continue;
      }
      if (distance.has(relatedSlug)) continue;
      distance.set(relatedSlug, nextDistance);
      queue.push(relatedSlug);
    }
  }
  if (targets.size) return [...targets].sort(compareWebsiteGenreOrder);

  // Some imported tags have no graph edge but are already represented as a
  // canonical alias. Exact normalized matching is safe; fuzzy guesses are not.
  const selectedNames = new Set(
    [selected.name, selected.slug, ...(selected.alias_names ?? [])].map(
      normalizeGenreName,
    ),
  );
  return taxonomyNodes
    .filter((node) => {
      if (!coreSlugs.has(node.slug)) return false;
      return [node.name, node.slug, ...(node.alias_names ?? [])].some((name) =>
        selectedNames.has(normalizeGenreName(name)),
      );
    })
    .map((node) => node.slug)
    .sort(compareWebsiteGenreOrder);
}

const WHEEL_CENTER = 380;
const RADII = [0, 132, 212, 256] as const;

// Preserve the sector order used by the website's GenreWheel source data.
// The taxonomy API returns nodes in slug order, so relying on response order
// would rotate/reorder the wheel and make the Admin version drift visually.
const WEBSITE_GENRE_ORDER = [
  "rock",
  "alternative",
  "metal",
  "punk",
  "electronic",
  "hip-hop",
  "jazz",
  "blues",
  "soul",
  "funk",
  "folk",
  "country",
  "pop",
  "classical",
  "ambient",
  "indie-rock",
  "post-punk",
  "shoegaze",
  "dream-pop",
  "noise-rock",
  "new-wave",
  "gothic-rock",
  "garage-rock",
  "psychedelic-rock",
  "stoner-rock",
  "grunge",
  "heavy-metal",
  "thrash-metal",
  "crossover-thrash",
  "death-metal",
  "black-metal",
  "doom-metal",
  "sludge-metal",
  "stoner-metal",
  "groove-metal",
  "speed-metal",
  "power-metal",
  "progressive-metal",
  "industrial-metal",
  "post-metal",
  "metalcore",
  "grindcore",
  "nu-metal",
  "hardcore-punk",
  "beatdown-hardcore",
  "powerviolence",
  "melodic-hardcore",
  "post-hardcore",
  "skate-punk",
  "pop-punk",
  "crust-punk",
  "d-beat",
  "anarcho-punk",
  "art-punk",
  "emo",
  "screamo",
  "industrial",
  "synthpop",
  "techno",
  "house",
  "trip-hop",
] as const;
const WEBSITE_GENRE_ORDER_INDEX = new Map<string, number>(
  WEBSITE_GENRE_ORDER.map((slug, index) => [slug, index]),
);

function compareWebsiteGenreOrder(a: string, b: string): number {
  const aIndex = WEBSITE_GENRE_ORDER_INDEX.get(a);
  const bIndex = WEBSITE_GENRE_ORDER_INDEX.get(b);
  if (aIndex !== undefined || bIndex !== undefined) {
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    return aIndex - bIndex;
  }
  return a.localeCompare(b);
}

function relationTargets(node: GenreWheelTaxonomyNode): string[] {
  return [
    ...(node.parent_slugs ?? []),
    ...(node.children_slugs ?? []),
    ...(node.related_slugs ?? []),
    ...(node.influenced_by_slugs ?? []),
    ...(node.influences_slugs ?? []),
    ...(node.fusion_of_slugs ?? []),
    ...(node.fusion_genre_slugs ?? []),
  ];
}

/**
 * Keep the canonical wheel geometry intact while exposing one selected node's
 * full local graph. Core nodes retain their signed wheel coordinates; overlay
 * nodes sit beside their nearest core anchors. Explicit relations are never
 * truncated, while only second-degree overlay context is capped.
 */
export function buildLocalGenreWheelModel(
  taxonomyNodes: readonly GenreWheelTaxonomyNode[],
  focusSlug: string,
  contextLimit = 18,
): GenreWheelModel {
  const bySlug = new Map(taxonomyNodes.map((node) => [node.slug, node]));
  const focus = bySlug.get(focusSlug);
  if (!focus) {
    return {
      nodes: [],
      positions: new Map(),
      parentEdges: [],
      relatedPairs: [],
      semanticEdges: [],
      families: 0,
      focusSlug,
      directSlugs: [],
      contextSlugs: [],
      siblingPairs: [],
    };
  }

  const base = buildGenreWheelModel(taxonomyNodes);
  const coreSlugs = new Set(base.nodes.map((node) => node.slug));
  const explicit = new Set(
    relationTargets(focus).filter((slug) => slug !== focusSlug && bySlug.has(slug)),
  );
  // Parent nodes do not always include a materialized children_slugs array
  // in older payloads. Derive those outgoing links from child parent_slugs.
  for (const node of taxonomyNodes) {
    if (node.slug !== focusSlug && (node.parent_slugs ?? []).includes(focusSlug)) {
      explicit.add(node.slug);
    }
  }
  const parents = new Set((focus.parent_slugs ?? []).filter((slug) => bySlug.has(slug)));
  const siblingSlugs = new Set<string>();
  for (const node of taxonomyNodes) {
    if (node.slug === focusSlug) continue;
    if ((node.parent_slugs ?? []).some((parent) => parents.has(parent))) {
      siblingSlugs.add(node.slug);
    }
  }

  const neighbors = new Set([...explicit, ...siblingSlugs]);
  const adjacency = new Map<string, Set<string>>(
    taxonomyNodes.map((node) => [node.slug, new Set<string>()]),
  );
  for (const node of taxonomyNodes) {
    for (const target of relationTargets(node)) {
      if (target === node.slug || !bySlug.has(target)) continue;
      adjacency.get(node.slug)?.add(target);
      adjacency.get(target)?.add(node.slug);
    }
  }

  const contextSupport = new Map<string, number>();
  for (const slug of neighbors) {
    for (const neighbor of adjacency.get(slug) ?? []) {
      if (neighbor === focusSlug || neighbors.has(neighbor)) continue;
      if (!coreSlugs.has(neighbor)) {
        contextSupport.set(neighbor, (contextSupport.get(neighbor) ?? 0) + 1);
      }
    }
  }
  const overlayContext = [...contextSupport]
    .sort(([aSlug, aSupport], [bSlug, bSupport]) =>
      bSupport - aSupport || compareWebsiteGenreOrder(aSlug, bSlug),
    )
    .slice(0, Math.max(0, contextLimit))
    .map(([slug]) => slug);

  const context = [
    ...base.nodes
      .map((node) => node.slug)
      .filter((slug) => slug !== focusSlug && !neighbors.has(slug)),
    ...overlayContext,
  ].sort(compareWebsiteGenreOrder);
  const included = new Set([
    ...base.nodes.map((node) => node.slug),
    focusSlug,
    ...neighbors,
    ...overlayContext,
  ]);
  const nodes = [...included]
    .map((slug) => bySlug.get(slug))
    .filter((node): node is GenreWheelTaxonomyNode => Boolean(node))
    .sort((a, b) => compareWebsiteGenreOrder(a.slug, b.slug));
  const positions = new Map(base.positions);
  const stableAngle = (slug: string) => {
    let hash = 0;
    for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return ((hash % 360) * Math.PI) / 180;
  };
  const overlaySlugs = [...included]
    .filter((slug) => !coreSlugs.has(slug))
    .sort((a, b) =>
      a === focusSlug ? -1 : b === focusSlug ? 1 : compareWebsiteGenreOrder(a, b),
    );
  const anchorCounts = new Map<string, number>();
  const relatedCoreAnchors = (node: GenreWheelTaxonomyNode): string[] => {
    const directCore = relationTargets(node).filter((slug) => coreSlugs.has(slug));
    if (directCore.length) return [...new Set(directCore)].sort(compareWebsiteGenreOrder);
    return resolveOverlayCoreTargets(node, taxonomyNodes).filter((slug) => coreSlugs.has(slug));
  };
  const primaryAnchor = (node: GenreWheelTaxonomyNode): string | undefined => {
    const preferred = [
      ...(node.parent_slugs ?? []),
      ...(node.children_slugs ?? []),
      ...relatedCoreAnchors(node),
    ];
    return preferred.find((slug) => coreSlugs.has(slug));
  };
  for (const slug of overlaySlugs) {
    const node = bySlug.get(slug)!;
    let anchors = slug === focusSlug
      ? [primaryAnchor(node)].filter((anchor): anchor is string => Boolean(anchor))
      : focus.origin === "core" && neighbors.has(slug)
        ? [focusSlug]
        : relatedCoreAnchors(node).slice(0, 1);
    if (!anchors.length && focus.origin !== "core" && neighbors.has(slug)) {
      anchors = [focusSlug];
    }
    const anchorPositions = anchors
      .map((anchor) => positions.get(anchor))
      .filter((position): position is GenreWheelPosition => Boolean(position));
    const anchorKey = anchorPositions.length
      ? anchors[0]!
      : focus.origin === "core"
        ? focusSlug
        : "unanchored-overlays";
    const ordinal = anchorCounts.get(anchorKey) ?? 0;
    anchorCounts.set(anchorKey, ordinal + 1);
    const anchorX = anchorPositions.length
      ? anchorPositions.reduce((sum, position) => sum + position.x, 0) / anchorPositions.length
      : focus.origin === "core"
        ? positions.get(focusSlug)?.x ?? WHEEL_CENTER + 285
        : WHEEL_CENTER + 285;
    const anchorY = anchorPositions.length
      ? anchorPositions.reduce((sum, position) => sum + position.y, 0) / anchorPositions.length
      : focus.origin === "core"
        ? positions.get(focusSlug)?.y ?? WHEEL_CENTER
        : WHEEL_CENTER;
    const angle = stableAngle(slug) + ordinal * 2.399963229728653;
    const radius = 28 + ordinal * 13;
    const x = anchorX + Math.cos(angle) * radius;
    const y = anchorY + Math.sin(angle) * radius;
    const wheelAngle = Math.atan2(y - WHEEL_CENTER, x - WHEEL_CENTER) + Math.PI / 2;
    positions.set(slug, {
      slug,
      ring: neighbors.has(slug) || slug === focusSlug ? 1 : 2,
      angle: wheelAngle,
      radius: Math.hypot(x - WHEEL_CENTER, y - WHEEL_CENTER),
      x,
      y,
      flip: x < WHEEL_CENTER,
    });
  }

  const parentEdges = new Map(
    base.parentEdges.map((edge) => [`${edge.parent}:${edge.slug}`, edge]),
  );
  const relatedPairs = new Set(base.relatedPairs);
  const semanticEdges = new Map(
    base.semanticEdges.map((edge) => [`${edge.source}|${edge.target}|${edge.type}`, edge]),
  );
  const addSemantic = (
    source: string,
    target: string,
    type: "influence" | "fusion",
  ) => {
    if (source === target || !included.has(source) || !included.has(target)) return;
    semanticEdges.set(`${source}|${target}|${type}`, { source, target, type });
  };

  for (const node of nodes) {
    for (const parent of node.parent_slugs ?? []) {
      if (included.has(parent)) parentEdges.set(`${parent}:${node.slug}`, { slug: node.slug, parent });
    }
    if (node.slug === focusSlug) {
      for (const child of node.children_slugs ?? []) {
        if (included.has(child)) parentEdges.set(`${focusSlug}:${child}`, { slug: child, parent: focusSlug });
      }
    }
    for (const related of node.related_slugs ?? []) {
      if (included.has(related) && related !== node.slug) {
        relatedPairs.add([node.slug, related].sort().join("|"));
      }
    }
    for (const source of node.influenced_by_slugs ?? []) addSemantic(source, node.slug, "influence");
    for (const target of node.influences_slugs ?? []) addSemantic(node.slug, target, "influence");
    for (const source of node.fusion_of_slugs ?? []) addSemantic(source, node.slug, "fusion");
    for (const target of node.fusion_genre_slugs ?? []) addSemantic(node.slug, target, "fusion");
  }

  const siblingPairs = [...siblingSlugs]
    .filter((slug) => !explicit.has(slug))
    .map((slug) => [focusSlug, slug].sort().join("|"))
    .sort();

  return {
    nodes,
    positions,
    parentEdges: [...parentEdges.values()].sort(
      (a, b) => a.parent.localeCompare(b.parent) || a.slug.localeCompare(b.slug),
    ),
    relatedPairs: [...relatedPairs].sort(),
    semanticEdges: [...semanticEdges.values()].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
    families: base.families,
    focusSlug,
    directSlugs: [...explicit].sort(compareWebsiteGenreOrder),
    contextSlugs: context,
    siblingPairs,
  };
}

function polar(radius: number, angle: number) {
  return {
    x: WHEEL_CENTER + Math.cos(angle - Math.PI / 2) * radius,
    y: WHEEL_CENTER + Math.sin(angle - Math.PI / 2) * radius,
  };
}

function safeParentMap(nodes: readonly GenreWheelTaxonomyNode[]) {
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));
  const preferred = new Map<string, string | undefined>();

  for (const node of nodes) {
    const parent = [...(node.parent_slugs ?? [])]
      .filter((slug) => slug !== node.slug && bySlug.has(slug))
      .sort()[0];
    preferred.set(node.slug, node.top_level ? undefined : parent);
  }

  const parentBySlug = new Map<string, string>();
  for (const slug of [...bySlug.keys()].sort()) {
    const parent = preferred.get(slug);
    const seen = new Set([slug]);
    let cursor = parent;
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor)) {
        cyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = preferred.get(cursor);
    }
    if (parent && !cyclic) parentBySlug.set(slug, parent);
  }

  return parentBySlug;
}

export function buildGenreWheelModel(
  taxonomyNodes: readonly GenreWheelTaxonomyNode[],
): GenreWheelModel {
  const nodes = taxonomyNodes
    .filter((node) => node.origin === "core")
    .slice()
    .sort((a, b) => compareWebsiteGenreOrder(a.slug, b.slug));
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));
  const parentBySlug = safeParentMap(nodes);
  const children = new Map<string, string[]>();
  for (const [slug, parent] of parentBySlug) {
    children.set(parent, [...(children.get(parent) ?? []), slug]);
  }
  for (const childSlugs of children.values())
    childSlugs.sort(compareWebsiteGenreOrder);

  const roots = nodes
    .filter((node) => node.top_level || !parentBySlug.has(node.slug))
    .map((node) => node.slug)
    .sort(compareWebsiteGenreOrder);
  const visited = new Set<string>();
  const weights = new Map<string, number>();
  const weight = (slug: string): number => {
    const cached = weights.get(slug);
    if (cached !== undefined) return cached;
    const value =
      1 +
      (children.get(slug) ?? []).reduce((sum, child) => sum + weight(child), 0);
    weights.set(slug, value);
    return value;
  };

  const positions = new Map<string, GenreWheelPosition>();
  const place = (slug: string, ring: number, from: number, to: number) => {
    if (visited.has(slug)) return;
    visited.add(slug);
    const angle = (from + to) / 2;
    const radius = RADII[ring] ?? Math.min(310, 132 + (ring - 1) * 58);
    const point = polar(radius, angle);
    positions.set(slug, {
      slug,
      ring,
      angle,
      radius,
      ...point,
      flip: angle > Math.PI,
    });

    const childSlugs = children.get(slug) ?? [];
    if (!childSlugs.length) return;
    const span = (to - from) / Math.max(1, weight(slug) - 1);
    let cursor = from;
    for (const child of childSlugs) {
      const childSpan = weight(child) * span;
      place(child, ring + 1, cursor, cursor + childSpan);
      cursor += childSpan;
    }
  };

  const totalWeight = roots.reduce((sum, slug) => sum + weight(slug) + 2, 0);
  let start = 0;
  for (const slug of roots) {
    const sector =
      ((weight(slug) + 2) / Math.max(1, totalWeight)) * Math.PI * 2;
    place(slug, 1, start, start + sector);
    start += sector;
  }

  // Malformed or disconnected core references must remain visible in the audit view.
  // Place any node left outside the rooted forest in its own deterministic sector.
  for (const slug of bySlug.keys()) {
    if (visited.has(slug)) continue;
    const sector = (Math.PI * 2) / Math.max(1, bySlug.size);
    const index = positions.size;
    place(slug, 1, sector * index, sector * (index + 1));
  }

  const parentEdges = [...parentBySlug].map(([slug, parent]) => ({
    slug,
    parent,
  }));
  const relatedPairs = new Set<string>();
  const semanticEdges = new Map<
    string,
    GenreWheelModel["semanticEdges"][number]
  >();
  const addSemanticEdge = (
    source: string,
    target: string,
    type: "influence" | "fusion",
  ) => {
    if (source === target || !bySlug.has(source) || !bySlug.has(target)) return;
    semanticEdges.set(`${source}|${target}|${type}`, { source, target, type });
  };
  for (const node of nodes) {
    for (const related of node.related_slugs ?? []) {
      if (related === node.slug || !bySlug.has(related)) continue;
      relatedPairs.add([node.slug, related].sort().join("|"));
    }
    for (const influencedBy of node.influenced_by_slugs ?? []) {
      addSemanticEdge(influencedBy, node.slug, "influence");
    }
    for (const influence of node.influences_slugs ?? []) {
      addSemanticEdge(node.slug, influence, "influence");
    }
    for (const fusionPart of node.fusion_of_slugs ?? []) {
      addSemanticEdge(fusionPart, node.slug, "fusion");
    }
    for (const fusionGenre of node.fusion_genre_slugs ?? []) {
      addSemanticEdge(node.slug, fusionGenre, "fusion");
    }
  }

  return {
    nodes,
    positions,
    parentEdges,
    relatedPairs: [...relatedPairs].sort(),
    semanticEdges: [...semanticEdges.values()].sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
    families: roots.filter((slug) => bySlug.get(slug)?.top_level).length,
  };
}

export function resolveGenreWheelEqPath(
  node: GenreWheelTaxonomyNode,
  nodes: readonly GenreWheelTaxonomyNode[],
): string[] {
  if (!node.eq_gains || node.eq_gains.length !== 10) return [];
  const from =
    node.eq_preset_source === "direct"
      ? node.slug
      : node.eq_preset_inherited_from;
  if (!from) return [];
  if (from === node.slug) return [node.slug];

  const bySlug = new Map(nodes.map((item) => [item.slug, item]));
  const queue = [node.slug];
  const previous = new Map<string, string | null>([[node.slug, null]]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === from) break;
    const currentNode = bySlug.get(current);
    for (const parent of [...(currentNode?.parent_slugs ?? [])].sort()) {
      if (!bySlug.has(parent) || previous.has(parent)) continue;
      previous.set(parent, current);
      queue.push(parent);
    }
  }
  if (!previous.has(from)) return [node.slug, from];
  const path = [from];
  while (path[0] !== node.slug) {
    const parent = previous.get(path[0]!);
    if (!parent) break;
    path.unshift(parent);
  }
  return path;
}

export function formatGenreWheelGain(gain: number): string {
  const rounded = Math.round(gain);
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}
