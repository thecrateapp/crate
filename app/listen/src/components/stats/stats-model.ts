import type { TrackRowData } from "@/components/cards/TrackRowModel";
import type { Track } from "@/contexts/PlayerContext";
import { toTrackRowData } from "@/lib/track-row-data";
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

export function statsTrackRowData(
  item: StatsTrack | StatsRangeTrack,
): TrackRowData {
  return toTrackRowData({
    ...item,
    id: item.track_id ?? `${item.artist}-${item.title}`,
    artist: item.artist ?? "",
  });
}
