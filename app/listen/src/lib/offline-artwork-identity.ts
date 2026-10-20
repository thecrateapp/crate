import { albumCoverAssetPath } from "../../../shared/web/library-routes";
import type { OfflineItemRecord, OfflineManifestTrack } from "./offline-model";

export interface OfflineArtworkRef {
  key: string;
  path: string;
}
export function offlineTrackArtworkPath(
  track: Pick<OfflineManifestTrack, "album_id">,
): string | undefined {
  const id = track.album_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? albumCoverAssetPath({ albumId: id })
    : undefined;
}
/** Canonical API image paths only; credentials and responsive variants never become identity. */
export function offlineArtworkRef(
  source: string | null | undefined,
): OfflineArtworkRef | null {
  if (!source) return null;
  try {
    const path = new URL(source, "https://offline.invalid").pathname;
    const match = path.match(/^\/api\/(albums|playlists)\/([1-9]\d*)\/cover$/);
    return match
      ? {
          key: `artwork:${match[1] === "albums" ? "album" : "playlist"}:${match[2]}`,
          path,
        }
      : null;
  } catch {
    return null;
  }
}
export function offlineItemArtworkPath(
  item: Pick<OfflineItemRecord, "artwork" | "tracks">,
): string | undefined {
  return (
    item.artwork?.cover_url ??
    item.tracks.map(offlineTrackArtworkPath).find(Boolean)
  );
}
export function offlineArtworkRefs(
  items: Pick<OfflineItemRecord, "artwork" | "tracks">[],
): OfflineArtworkRef[] {
  const refs = items
    .flatMap((item) => [
      item.artwork?.cover_url,
      ...item.tracks.map(offlineTrackArtworkPath),
    ])
    .map(offlineArtworkRef)
    .filter((ref): ref is OfflineArtworkRef => Boolean(ref));
  return [...new Map(refs.map((ref) => [ref.key, ref])).values()];
}
export function offlineArtworkRequestPath(ref: OfflineArtworkRef): string {
  return `${ref.path}?size=640&format=webp`;
}
