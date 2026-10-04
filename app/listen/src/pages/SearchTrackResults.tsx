import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

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
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">
          {t("search.tracksCount", { count: data.tracks.length })}
        </h2>
        <Button
          size="xs"
          shape="pill"
          onClick={() =>
            playAll(data.tracks.map(toSearchPlayerTrack), 0, {
              type: "queue",
              name: t("search.playSource", { query }),
            })
          }
          className="h-7 gap-1.5 px-3 shadow-none has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-3"
        >
          <Play size={CRATE_ICON_SIZE.micro} fill="currentColor" />
          {t("search.playAll")}
        </Button>
      </div>
      <div>
        {trackRowData.map((track, index) => (
          <TrackRow
            key={
              track.id ??
              track.global_track_uid ??
              track.entity_uid ??
              track.path ??
              [track.artist, track.album, track.title].join(":")
            }
            track={track}
            index={index}
            showCoverThumb
            showArtist
            showAlbum
            queueTracks={trackRowData}
            albumCover={trackAlbumCover(data.tracks[index]!)}
          />
        ))}
      </div>
    </section>
  );
}
