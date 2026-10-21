import type { TrackRowData } from "@/components/cards/TrackRowModel";
import type { Track } from "@/contexts/PlayerContext";
import { toPlayableTrack } from "@/lib/playable-track";

import type { StatsRangeTrack, StatsTrack, ReplayMix } from "./stats-types";
export type * from "./stats-types";
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

type ReplayTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function replayYear(replay: ReplayMix): string {
  return /^year:(\d{4})$/.exec(replay.window)?.[1] ?? "";
}

export function localizedReplayTitle(
  replay: ReplayMix | undefined,
  t: ReplayTranslate,
): string | undefined {
  if (replay?.title_key) {
    return t(replay.title_key, {
      defaultValue: replay.title,
      year: replayYear(replay),
    });
  }
  return replay?.title || undefined;
}

export function localizedReplaySubtitle(
  replay: ReplayMix | undefined,
  t: ReplayTranslate,
): string | undefined {
  if (replay?.subtitle_key) {
    return t(replay.subtitle_key, {
      defaultValue: replay.subtitle,
      year: replayYear(replay),
    });
  }
  return replay?.subtitle || undefined;
}
