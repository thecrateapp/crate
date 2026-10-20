import { albumCoverAssetPath } from "../../../../shared/web/library-routes";
import type { PathTrack } from "../../pages/paths-model";
export interface PathCoverStep {
  index: number;
  title: string;
  artist: string;
  coverUrl?: string;
}
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
  }));
}
export function pathCoverWindow(count: number, focus: number): number[] {
  if (count <= 0) return [];
  const center = Math.min(count - 1, Math.max(0, focus));
  return Array.from(
    { length: Math.min(count, center + 4) - Math.max(0, center - 3) },
    (_, i) => Math.max(0, center - 3) + i,
  );
}
