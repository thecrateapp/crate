import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { TrackRow } from "@/components/cards/TrackRow";
import { toTrackRowData } from "@/lib/track-row-data";
import type { SimilarTrack } from "./use-suggested-tracks";

export function SuggestedTrackRow({
  track,
  index,
  onPlay,
}: {
  track: SimilarTrack;
  index: number;
  onPlay: (track: SimilarTrack) => void;
}) {
  const { t, i18n } = useTranslation();
  const rowTrack = useMemo(() => toTrackRowData(track), [track]);
  const percentage =
    typeof track.score === "number" && Number.isFinite(track.score)
      ? new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
          Math.max(0, Math.min(1, track.score)),
        )
      : null;
  return (
    <TrackRow
      track={rowTrack}
      albumCover={track.albumCover ?? track.album_cover ?? undefined}
      rank={index + 1}
      density="compact"
      showCoverThumb
      showArtist
      showAlbum
      onPlayOverride={() => onPlay(track)}
      meta={
        percentage ? (
          <InfoBadge>
            {t("player.queue.suggested")} · {percentage}
          </InfoBadge>
        ) : undefined
      }
    />
  );
}
