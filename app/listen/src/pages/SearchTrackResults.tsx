import { useTranslation } from "react-i18next";
import { SearchTrackResultsView } from "./SearchTrackResultsView";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlayerActionsValue } from "@/contexts/player-context";

import {
  toSearchPlayerTrack,
  trackAlbumCover,
  type SearchData,
} from "./search-results-model";

export function SearchTrackResults({
  data,
  query,
  trackRowData,
  playAll,
}: {
  data: SearchData;
  query: string;
  trackRowData: TrackRowData[];
  playAll: PlayerActionsValue["playAll"];
}) {
  const { t } = useTranslation();

  return (
    <SearchTrackResultsView
      title={t("search.tracksCount", { count: data.tracks.length })}
      playLabel={t("search.playAll")}
      onPlay={() =>
        playAll(data.tracks.map(toSearchPlayerTrack), 0, {
          type: "queue",
          name: t("search.playSource", { query }),
        })
      }
      items={trackRowData}
      itemKey={(track) =>
        track.id ??
        track.global_track_uid ??
        track.entity_uid ??
        track.path ??
        [track.artist, track.album, track.title].join(":")
      }
      renderRow={(track, index) => (
        <TrackRow
          track={track}
          index={index}
          showCoverThumb
          showArtist
          showAlbum
          queueTracks={trackRowData}
          albumCover={trackAlbumCover(data.tracks[index]!)}
        />
      )}
    />
  );
}
