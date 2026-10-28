export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
}

const SIDE_INSET = 12;
const MIN_SHARED_BAND = 24;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (value: number) => Math.round(value * 10) / 10;

function anchors(
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): [number, number] {
  const shared = [
    Math.max(aStart, bStart),
    Math.min(aStart + aSize, bStart + bSize),
  ];
  if (shared[1] - shared[0] >= MIN_SHARED_BAND) {
    const middle = (shared[0] + shared[1]) / 2;
    return [middle, middle];
  }
  return [
    clamp(bStart + bSize / 2, aStart + SIDE_INSET, aStart + aSize - SIDE_INSET),
    clamp(aStart + aSize / 2, bStart + SIDE_INSET, bStart + bSize - SIDE_INSET),
  ];
}

export function edgePath(a: Rect, b: Rect): string {
  const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  let points: number[];
  if (gap > 0) {
    const [y1, y2] = anchors(a.y, a.h, b.y, b.h);
    const x1 = b.x > a.x ? a.x + a.w : a.x;
    const x2 = b.x > a.x ? b.x : b.x + b.w;
    const mid = (x1 + x2) / 2;
    points = [x1, y1, mid, y1, mid, y2, x2, y2];
  } else {
    const [x1, x2] = anchors(a.x, a.w, b.x, b.w);
    const y1 = b.y > a.y ? a.y + a.h : a.y;
    const y2 = b.y > a.y ? b.y : b.y + b.h;
    const mid = (y1 + y2) / 2;
    points = [x1, y1, x1, mid, x2, mid, x2, y2];
  }
  const [x1, y1, ...rest] = points.map(round);
  return `M ${x1} ${y1} C ${rest.join(" ")}`;
}

export function routeEdges(
  route: string[],
  edges: MapEdge[],
): { id: string; reversed: boolean }[] {
  return route.slice(1).map((to, index) => {
    const from = route[index];
    const forward = edges.find((edge) => edge.from === from && edge.to === to);
    if (forward) return { id: forward.id, reversed: false };
    const backward = edges.find((edge) => edge.from === to && edge.to === from);
    if (backward) return { id: backward.id, reversed: true };
    throw new Error(`No edge for ${from} → ${to}`);
  });
}

export function stepAt(progress: number, count: number) {
  const scaled = clamp(progress, 0, 1) * count;
  const index = Math.min(count - 1, Math.floor(scaled));
  return { index, local: scaled - index };
}

export function segmentProgress(local: number, count: number, index: number) {
  return clamp(local * count - index, 0, 1);
}

export function viewBox(rects: Rect[], padding: number): string {
  const minX = Math.min(...rects.map((rect) => rect.x)) - padding;
  const minY = Math.min(...rects.map((rect) => rect.y)) - padding;
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w)) + padding;
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h)) + padding;
  return [minX, minY, maxX - minX, maxY - minY].join(" ");
}
