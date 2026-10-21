import { CrateImage } from "@/components/artwork/CrateImage";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { StatsHighlightsView } from "./StatsHighlightsView";
import { toPlayerTrack } from "./stats-model";
import type { StatsHighlights as Highlights } from "./stats-types";
export function StatsHighlights({ highlights }: { highlights: Highlights }) {
  const { playAll } = usePlayerActions();
  const obsession = highlights.obsession;
  const track = obsession?.track;
  function playObsession() {
    if (!obsession || track?.track_id == null) return;
    playAll(
      [
        toPlayerTrack({
          ...track,
          plays: obsession.plays,
          minutes: obsession.minutes,
        }),
      ],
      0,
      { type: "playlist", name: track.title ?? "" },
    );
  }
  const cover = track?.album
    ? albumCoverApiUrl(
        {
          albumId: track.album_id,
          globalAlbumUid: track.global_album_uid,
          albumName: track.album,
          artistName: track.artist,
        },
        { size: 256 },
      )
    : null;
  return (
    <StatsHighlightsView
      highlights={highlights}
      onPlayObsession={playObsession}
      obsessionArtwork={
        track ? (
          <MediaCover
            src={cover}
            alt=""
            className="size-20 shrink-0"
            renderImage={({ src, alt, className, onError }) => (
              <CrateImage
                src={src}
                alt={alt}
                className={className}
                onError={onError}
                loading="lazy"
              />
            )}
          />
        ) : undefined
      }
    />
  );
}
