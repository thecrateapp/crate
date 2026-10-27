import type { Vec3 } from "../field/math";
import type { Random } from "../field/sources";

export function segment(phase: number, start: number, length = 1): number {
  return Math.min(1, Math.max(0, (phase - start) / length));
}

function distanceSq(positions: Float32Array, index: number, point: Vec3) {
  const dx = positions[index * 3] - point[0];
  const dy = positions[index * 3 + 1] - point[1];
  const dz = positions[index * 3 + 2] - point[2];
  return dx * dx + dy * dy + dz * dz;
}

export function nearest(
  positions: Float32Array,
  point: Vec3,
  k: number,
  exclude = -1,
): number[] {
  const best: { index: number; d: number }[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    if (i === exclude) continue;
    const d = distanceSq(positions, i, point);
    if (best.length === k && d >= best[k - 1].d) continue;
    best.push({ index: i, d });
    best.sort((a, b) => a.d - b.d);
    if (best.length > k) best.pop();
  }
  return best.map((entry) => entry.index);
}

export function closestIndex(positions: Float32Array, point: Vec3): number {
  return nearest(positions, point, 1)[0] ?? 0;
}

export interface Candidate {
  index: number;
  x: number;
  y: number;
}

export function pickNodes(
  candidates: Candidate[],
  anchors: { x: number; y: number }[],
): number[] {
  return anchors.map((anchor) => {
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const d = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
    return best.index;
  });
}

export interface PathStop {
  position: number;
  artist: string;
  title: string;
  cover: string;
}

export const PATH_ROUTE = {
  from: "rap",
  to: "punk rock",
  tracks: 34,
  stops: [
    {
      position: 1,
      artist: "JPEGMAFIA",
      title: "either on or off the drugs",
      cover: "/paths/jpegmafia.webp",
    },
    {
      position: 4,
      artist: "Wu-Tang Clan",
      title: "Bring Da Ruckus",
      cover: "/paths/wu-tang-clan.webp",
    },
    {
      position: 8,
      artist: "The Clash",
      title: "Should I Stay or Should I Go",
      cover: "/paths/the-clash.webp",
    },
    {
      position: 16,
      artist: "Bad Brains",
      title: "The Regulator",
      cover: "/paths/bad-brains.webp",
    },
    {
      position: 26,
      artist: "Descendents",
      title: "Catalina",
      cover: "/paths/descendents.webp",
    },
    {
      position: 34,
      artist: "Eskorbuto",
      title: "Historia triste",
      cover: "/paths/eskorbuto.webp",
    },
  ] satisfies PathStop[],
};

export function pathLabels(route: typeof PATH_ROUTE): string[] {
  const last = route.stops.length - 1;
  return route.stops.map((stop, i) => {
    const head =
      i === 0
        ? route.from.toUpperCase()
        : i === last
          ? route.to.toUpperCase()
          : `${String(stop.position).padStart(2, "0")} / ${route.tracks}`;
    return `${head}\n${stop.artist}\n${stop.title}`;
  });
}

export function labelAbove(ys: number[], i: number): boolean {
  const before = ys[i - 1] ?? ys[i + 1] ?? ys[i];
  const after = ys[i + 1] ?? ys[i - 1] ?? ys[i];
  return ys[i] <= (before + after) / 2;
}

export interface LabelBox {
  width: number;
  height: number;
  alignEnd?: boolean;
}

const LABEL_GAP = 14;
const LABEL_INSET = 20;

export function placeLabels(
  points: { x: number; y: number }[],
  boxes: LabelBox[],
  previous: (number | null)[] = [],
  bounds = Infinity,
): (number | null)[] {
  const ys = points.map((p) => p.y);
  const last = points.length - 1;
  const order = [0, last, ...points.keys()].filter(
    (i, n, all) => i >= 0 && all.indexOf(i) === n,
  );
  const placed: { left: number; top: number; right: number; bottom: number }[] =
    [];
  const offsets: (number | null)[] = points.map(() => null);
  for (const i of order) {
    const point = points[i];
    const { width, height, alignEnd } = boxes[i];
    const above = -(height + LABEL_GAP);
    const below = LABEL_GAP;
    const far = height + LABEL_GAP;
    const options = labelAbove(ys, i)
      ? [above, below, above - far, below + far]
      : [below, above, below + far, above - far];
    const left = alignEnd
      ? point.x + LABEL_INSET - width
      : point.x - LABEL_INSET;
    const rect = (offset: number) => ({
      left,
      right: left + width,
      top: point.y + offset,
      bottom: point.y + offset + height,
    });
    const free = (offset: number) => {
      const r = rect(offset);
      return placed.every(
        (o) =>
          r.right <= o.left ||
          r.left >= o.right ||
          r.bottom <= o.top ||
          r.top >= o.bottom,
      );
    };
    const endpoint = i === 0 || i === last;
    const fits = endpoint || (left >= 0 && left + width <= bounds);
    const kept = previous[i] ?? NaN;
    const offset = !fits
      ? null
      : options.includes(kept) && free(kept)
        ? kept
        : options.find(free) ?? (endpoint ? options[0] : null);
    if (offset !== null) placed.push(rect(offset));
    offsets[i] = offset;
  }
  return offsets;
}

const RADIO_KEYS = ["8A", "9A", "8B", "7A", "8A", "9A", "7B"];

export interface RadioPick {
  score: number;
  bpm: number;
  key: string;
}

export function radioPicks(count: number, random: Random): RadioPick[] {
  return Array.from({ length: count }, (_, i) => ({
    score: Math.round((0.94 - i * 0.035 - random() * 0.015) * 100) / 100,
    bpm: 120 + Math.round(random() * 8 - 4),
    key: RADIO_KEYS[i % RADIO_KEYS.length],
  })).sort((a, b) => b.score - a.score);
}

export function densestIndex(
  positions: Float32Array,
  radius: number,
  samples = 300,
  probes = 2000,
): number {
  const count = positions.length / 3;
  const sampleStride = Math.max(1, Math.floor(count / samples));
  const probeStride = Math.max(1, Math.floor(count / probes));
  const r2 = radius * radius;
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < count; i += sampleStride) {
    const point: Vec3 = [
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    ];
    let inside = 0;
    for (let j = 0; j < count; j += probeStride)
      if (distanceSq(positions, j, point) < r2) inside++;
    if (inside > bestCount) {
      bestCount = inside;
      best = i;
    }
  }
  return best;
}
