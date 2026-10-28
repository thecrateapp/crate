import { albumCoverAssetPath } from "../../../../shared/web/library-routes";
import type { PathTrack } from "../../pages/paths-model";
export interface PathCoverStep {
  index: number;
  title: string;
  artist: string;
  coverUrl?: string;
  blissVector?: number[] | null;
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  bpm?: number | null;
}
/** Approved with Diego on the prototype (2026-10-20). */
export const PATH_COVER_TRANSITION_MS = 3000;
export const PATH_COVER_BLUR = 0.5;
export const PATH_COVER_INTENSITY = 1.2;
const PRELOAD_RADIUS = 2;
const NEUTRAL = { energy: 0.5, valence: 0.5, danceability: 0.5, bpm: 120 };
export function buildPathCoverSteps(tracks: PathTrack[]): PathCoverStep[] {
  return tracks.map((track, index) => ({
    index,
    title: track.title,
    artist: track.artist,
    coverUrl:
      track.album_id != null || track.album_entity_uid
        ? albumCoverAssetPath(
            {
              albumId: track.album_id,
              albumEntityUid: track.album_entity_uid,
              artistEntityUid: track.artist_entity_uid,
            },
            { size: 512 },
          ) || undefined
        : undefined,
    blissVector: track.bliss_vector ?? undefined,
    energy: track.energy,
    valence: track.valence,
    danceability: track.danceability,
    bpm: track.bpm,
  }));
}
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
function blissDistance(a: PathCoverStep, b: PathCoverStep): number | null {
  const left = a.blissVector,
    right = b.blissVector;
  if (!left?.length || left.length !== right?.length) return null;
  return Math.hypot(...left.map((value, i) => value - right[i]!));
}
function featureDistance(a: PathCoverStep, b: PathCoverStep): number {
  const value = (step: PathCoverStep, key: keyof typeof NEUTRAL) =>
    step[key] ?? NEUTRAL[key];
  return Math.hypot(
    value(a, "energy") - value(b, "energy"),
    value(a, "valence") - value(b, "valence"),
    value(a, "danceability") - value(b, "danceability"),
    (value(a, "bpm") - value(b, "bpm")) / 120,
  );
}
/** Median bliss distance between consecutive steps; the path's own scale for "a typical step". */
export function medianStepDistance(steps: PathCoverStep[]): number | null {
  const distances = steps
    .slice(1)
    .map((step, i) => blissDistance(steps[i]!, step))
    .filter((distance): distance is number => distance != null && distance > 0)
    .sort((a, b) => a - b);
  if (!distances.length) return null;
  const middle = distances.length >> 1;
  return distances.length % 2
    ? distances[middle]!
    : (distances[middle - 1]! + distances[middle]!) / 2;
}
/** How far apart two steps sound, 0–1: a typical step of this path is about 0.5. */
export function pathStepJump(
  steps: PathCoverStep[],
  from: number,
  to: number,
  median = medianStepDistance(steps),
): number {
  const a = steps[from],
    b = steps[to];
  if (!a || !b || from === to) return 0;
  const bliss = blissDistance(a, b);
  const raw =
    bliss != null && median
      ? bliss / (2 * median)
      : featureDistance(a, b) / 0.55;
  return clamp01(Math.max(raw, (Math.abs(to - from) - 1) / 6));
}
/** Block count across the cover at the coarsest point of the transition. */
export function peakCells(jump: number, intensity = PATH_COVER_INTENSITY) {
  return Math.min(64, Math.max(4, (28 + (8 - 28) * clamp01(jump)) / intensity));
}
export function transitionDirection(from: number, to: number): 1 | -1 {
  return to >= from ? 1 : -1;
}
/**
 * Continue an interrupted transition toward a new step without a coarseness jump: the cover
 * that currently dominates becomes the origin, starting at the same point of the curve.
 */
export function retargetTransition(
  running: { from: number; to: number; t: number },
  next: number,
): { from: number; startT: number } {
  const flipped = running.t >= 0.5;
  const dominant = flipped ? running.to : running.from;
  if (next !== dominant)
    return { from: dominant, startT: Math.min(running.t, 1 - running.t) };
  return {
    from: flipped ? running.from : running.to,
    startT: Math.max(running.t, 1 - running.t),
  };
}
export function coverPreloadWindow(count: number, focus: number): number[] {
  if (count <= 0) return [];
  const center = Math.min(count - 1, Math.max(0, focus));
  const first = Math.max(0, center - PRELOAD_RADIUS);
  const last = Math.min(count - 1, center + PRELOAD_RADIUS);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
