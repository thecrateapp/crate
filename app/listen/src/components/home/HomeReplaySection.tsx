import { StatsMiniTape } from "../stats/StatsMiniTape";
import { TrackRow } from "../cards/TrackRow";
import { toTrackRowData } from "../../lib/track-row-data";
import { albumCoverApiUrl } from "../../lib/library-routes";
import {
  HomeReplaySectionView,
  type HomeListeningSignal,
} from "./HomeReplaySectionView";
import type { ReplayMix, ReplayTrack } from "./home-model";
export type { HomeListeningSignal } from "./HomeReplaySectionView";
function replayCoverUrl(item: ReplayTrack): string | undefined {
  if (item.album_id == null && !item.global_album_uid) return undefined;
  return albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumEntityUid: item.album_entity_uid ?? undefined,
      artistEntityUid: item.artist_entity_uid ?? undefined,
      albumSlug: item.album_slug ?? undefined,
      artistName: item.artist,
      albumName: item.album,
    },
    { size: 256 },
  );
}

export function HomeReplaySection({
  replay,
  replayPreview,
  signal,
  onOpenStats,
  onPlayReplay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  replayPreview: ReplayTrack[];
  signal?: HomeListeningSignal | null;
  onOpenStats: () => void;
  onPlayReplay: () => void;
  onPlayTrack: (track: ReplayTrack) => void;
}) {
  if (!replayPreview.length) return null;
  return (
    <HomeReplaySectionView
      replay={replay}
      signal={signal}
      onOpenStats={onOpenStats}
      onPlayReplay={onPlayReplay}
      signalVisualization={
        signal?.tape?.points.length ? (
          <StatsMiniTape tape={signal.tape} />
        ) : null
      }
      tracks={replayPreview.map((item) => (
        <TrackRow
          key={item.track_id ?? item.track_path ?? item.title}
          track={toTrackRowData(item)}
          albumCover={replayCoverUrl(item)}
          showCoverThumb
          showArtist
          showDuration={false}
          meta={`${item.play_count}×`}
          onPlayOverride={() => onPlayTrack(item)}
        />
      ))}
    />
  );
}
