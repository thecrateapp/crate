import type { Track } from "@/contexts/player-types";
import type { OfflineItemRecord, OfflineManifestTrack } from "@/lib/offline";
import { getOfflineTrackAssetKey } from "@/lib/offline";

export interface OfflineLibraryGroup {
  item: OfflineItemRecord;
  tracks: Track[];
}

function isTrackReady(item: OfflineItemRecord, track: OfflineManifestTrack) {
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) return false;
  if (item.readyAssetKeys) return item.readyAssetKeys.includes(assetKey);
  return item.state === "ready";
}

export function toOfflinePlayerTrack(track: OfflineManifestTrack): Track {
  const identity = getOfflineTrackAssetKey(track);
  if (!identity) throw new Error("Offline track has no asset identity");
  return {
    id: `offline:${identity}`,
    entityUid: track.entity_uid || undefined,
    path: track.storage_id || undefined,
    libraryTrackId: track.track_id ?? undefined,
    title: track.title,
    artist: track.artist,
    artistId: track.artist_id ?? undefined,
    artistSlug: track.artist_slug || undefined,
    album: track.album || undefined,
    albumId: track.album_id ?? undefined,
    albumSlug: track.album_slug || undefined,
    duration: track.duration ?? undefined,
    format: track.format || undefined,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sample_rate ?? null,
    bitDepth: track.bit_depth ?? null,
    origin: "local",
    offlineOnly: true,
  };
}

export function buildOfflineLibraryGroups(
  items: OfflineItemRecord[],
): OfflineLibraryGroup[] {
  return items.flatMap((item) => {
    const tracks = item.tracks
      .filter((track) => isTrackReady(item, track))
      .map(toOfflinePlayerTrack);
    return tracks.length ? [{ item, tracks }] : [];
  });
}
