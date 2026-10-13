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

const PATH_KEYS = ["5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A"];

export interface PathReadout {
  head: string;
  bpm: number;
  key: string;
}

export function pathReadouts(steps: number, random: Random): PathReadout[] {
  const startBpm = 84 + Math.floor(random() * 20);
  const endBpm = startBpm + 24 + Math.floor(random() * 20);
  const keyStart = Math.floor(random() * 3);
  return Array.from({ length: steps }, (_, i) => ({
    head:
      i === 0
        ? "START"
        : i === steps - 1
          ? "END"
          : String(i + 1).padStart(2, "0"),
    bpm: Math.round(startBpm + ((endBpm - startBpm) * i) / (steps - 1)),
    key: PATH_KEYS[
      Math.min(PATH_KEYS.length - 1, keyStart + Math.round(i * 0.8))
    ],
  }));
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
