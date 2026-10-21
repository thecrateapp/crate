import type { TrackRowData } from "@/components/cards/TrackRowModel";
import type { Track } from "@/contexts/PlayerContext";
import { toPlayableTrack } from "@/lib/playable-track";

import type { StatsRangeTrack, StatsTrack } from "./stats-types";
export type * from "./stats-types";
export {
  localizedReplaySubtitle,
  localizedReplayTitle,
} from "./stats-replay-title";
export {
  buildStatsGenreProfile,
  formatStatsMinutes,
  formatStatsPercent,
} from "./stats-format";

/** Dashboard tracks and stretch (range) tracks play the same way. */
export function toPlayerTrack(item: StatsTrack | StatsRangeTrack): Track {
  return toPlayableTrack({
    ...item,
    id: item.track_id || `${item.artist}-${item.title}`,
    artist: item.artist ?? "",
  });
}

export function statsTrackRowData(item: StatsTrack): TrackRowData {
  return {
    id: item.track_id ?? `${item.artist}-${item.title}`,
    library_track_id: item.track_id ?? undefined,
    entity_uid: item.track_entity_uid ?? undefined,
    global_track_uid: item.global_track_uid ?? undefined,
    global_artist_uid: item.global_artist_uid ?? undefined,
    global_album_uid: item.global_album_uid ?? undefined,
    title: item.title,
    artist: item.artist,
    artist_id: item.artist_id ?? undefined,
    artist_slug: item.artist_slug ?? undefined,
    album: item.album,
    album_id: item.album_id ?? undefined,
    album_slug: item.album_slug ?? undefined,
    path: item.track_path ?? undefined,
    bpm: item.bpm,
    audio_key: item.audio_key,
    audio_scale: item.audio_scale,
    energy: item.energy,
    danceability: item.danceability,
    valence: item.valence,
    bliss_vector: item.bliss_vector,
  };
}
