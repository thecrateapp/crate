import type { Genre } from "../../content/admin/viz";

export interface Taxonomy {
  slugs: string[];
  top: string[];
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  related: Map<string, Set<string>>;
  eq: Map<string, string>;
}

export function buildTaxonomy(genres: readonly Genre[]): Taxonomy {
  const taxonomy: Taxonomy = {
    slugs: genres.map((genre) => genre.slug),
    top: genres.filter((genre) => genre.top).map((genre) => genre.slug),
    parents: new Map(),
    children: new Map(),
    related: new Map(),
    eq: new Map(),
  };
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const genre of genres) {
    taxonomy.parents.set(genre.slug, [...(genre.parents ?? [])].sort());
    for (const parent of genre.parents ?? []) {
      taxonomy.children.set(parent, [
        ...(taxonomy.children.get(parent) ?? []),
        genre.slug,
      ]);
    }
    for (const other of genre.related ?? []) {
      if (other === genre.slug) continue;
      link(taxonomy.related, genre.slug, other);
      link(taxonomy.related, other, genre.slug);
    }
    if (genre.eq) taxonomy.eq.set(genre.slug, genre.eq);
  }
  return taxonomy;
}

export interface EqResolution {
  preset: string;
  source: "direct" | "inherited";
  from: string;
  path: string[];
}

export function resolveEq(
  taxonomy: Taxonomy,
  slug: string,
): EqResolution | null {
  if (!taxonomy.parents.has(slug)) return null;
  const own = taxonomy.eq.get(slug);
  if (own) return { preset: own, source: "direct", from: slug, path: [slug] };
  const previous = new Map<string, string>();
  const queue = [...taxonomy.parents.get(slug)!];
  queue.forEach((parent) => previous.set(parent, slug));
  const seen = new Set([slug]);
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const preset = taxonomy.eq.get(current);
    if (preset) {
      const path = [current];
      while (path[0] !== slug) path.unshift(previous.get(path[0]!)!);
      return { preset, source: "inherited", from: current, path };
    }
    for (const parent of taxonomy.parents.get(current) ?? []) {
      if (seen.has(parent)) continue;
      if (!previous.has(parent)) previous.set(parent, current);
      queue.push(parent);
    }
  }
  return null;
}

function neighbours(taxonomy: Taxonomy, slug: string): [string, number][] {
  const costs = new Map<string, number>();
  const add = (other: string, cost: number) => {
    if (other === slug || !taxonomy.parents.has(other)) return;
    costs.set(other, Math.min(costs.get(other) ?? cost, cost));
  };
  taxonomy.parents.get(slug)?.forEach((parent) => add(parent, 1));
  taxonomy.children.get(slug)?.forEach((child) => add(child, 1));
  taxonomy.related.get(slug)?.forEach((other) => add(other, 2.5));
  return [...costs].sort(([a, x], [b, y]) => x - y || (a < b ? -1 : 1));
}

export function genreRoute(
  taxonomy: Taxonomy,
  origin: string,
  destination: string,
): string[] {
  if (origin === destination) return [origin];
  const distances = new Map([[origin, 0]]);
  const previous = new Map<string, string>();
  const heap: [number, string][] = [[0, origin]];
  const pop = () => {
    heap.sort(([a, x], [b, y]) => a - b || (x < y ? -1 : x > y ? 1 : 0));
    return heap.shift()!;
  };
  while (heap.length) {
    const [distance, slug] = pop();
    if (slug === destination) break;
    if (distance > (distances.get(slug) ?? Infinity)) continue;
    for (const [next, cost] of neighbours(taxonomy, slug)) {
      const candidate = distance + cost;
      if (candidate >= (distances.get(next) ?? Infinity)) continue;
      distances.set(next, candidate);
      previous.set(next, slug);
      heap.push([candidate, next]);
    }
  }
  if (!distances.has(destination)) return [origin, destination];
  const route = [destination];
  while (route[0] !== origin) route.unshift(previous.get(route[0]!)!);
  return route;
}

export interface RadialNode {
  angle: number;
  ring: number;
  from: number;
  to: number;
  family: string;
}

export function radialLayout(taxonomy: Taxonomy): Map<string, RadialNode> {
  const layout = new Map<string, RadialNode>();
  const weight = (slug: string): number =>
    1 +
    (taxonomy.children.get(slug) ?? []).reduce(
      (sum, child) => sum + weight(child),
      0,
    );
  const share = (slug: string) => weight(slug) + 2;
  const total = taxonomy.top.reduce((sum, slug) => sum + share(slug), 0);
  const place = (
    slug: string,
    ring: number,
    from: number,
    to: number,
    family: string,
  ) => {
    layout.set(slug, { angle: (from + to) / 2, ring, from, to, family });
    const children = taxonomy.children.get(slug) ?? [];
    const span = (to - from) / Math.max(1, weight(slug) - 1);
    let cursor = from;
    for (const child of children) {
      const share = weight(child) * span;
      place(child, ring + 1, cursor, cursor + share, family);
      cursor += share;
    }
  };
  let start = 0;
  for (const slug of taxonomy.top) {
    const sector = (share(slug) / total) * Math.PI * 2;
    place(slug, 1, start, start + sector, slug);
    start += sector;
  }
  return layout;
}
