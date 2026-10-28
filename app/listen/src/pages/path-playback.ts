import { createPathPlaySource } from "@/components/player/player-source";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import type { PathDetail } from "./paths-model";

export function getPathPlayback(path: PathDetail, startIndex?: number) {
  if (
    startIndex != null &&
    (!Number.isInteger(startIndex) ||
      !path.tracks[startIndex] ||
      path.tracks[startIndex]!.playable === false)
  )
    return null;
  const available = path.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.playable !== false);
  if (!available.length) return null;
  return {
    tracks: available.map(({ track }) =>
      toPlayableTrack(track, {
        cover:
          track.album_id || track.album_entity_uid
            ? albumCoverApiUrl(
                {
                  albumId: track.album_id,
                  albumEntityUid: track.album_entity_uid,
                  artistEntityUid: track.artist_entity_uid,
                },
                { size: 512 },
              )
            : undefined,
      }),
    ),
    index:
      startIndex == null
        ? 0
        : available.findIndex(({ index }) => index === startIndex),
    source: createPathPlaySource(path),
  };
}
