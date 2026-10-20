import { CrateImage } from "@/components/artwork/CrateImage";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { StatsHighlightsView } from "./StatsHighlightsView";
import type { StatsHighlights as Highlights } from "./stats-types";
export function StatsHighlights({ highlights }: { highlights: Highlights }) {
  const track = highlights.obsession?.track;
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
