import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { CRATE_ICON_SIZE, Plus } from "@crate/ui/icons";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { LibraryContribution } from "@/pages/library-model";

export function ContributionArtwork({
  contribution,
  layout = "row",
}: {
  contribution: LibraryContribution;
  layout?: "row" | "grid";
}) {
  const src = contribution.album_id
    ? albumCoverApiUrl(
        {
          albumId: contribution.album_id,
          albumEntityUid: contribution.album_entity_uid,
          artistName: contribution.artist_name,
          albumName: contribution.album_name,
        },
        { size: layout === "grid" ? 320 : 128 },
      )
    : null;
  return (
    <MediaCover
      src={src}
      alt=""
      className={layout === "grid" ? "size-full" : "size-14 shrink-0"}
      fallback={
        contribution.source === "bandcamp" ? (
          <BandcampLogo size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Plus size={CRATE_ICON_SIZE.lg} />
        )
      }
      renderImage={(image) => (
        <ArtworkSurface
          source={image.src}
          alt={image.alt}
          className="size-full"
          imageClassName={image.className}
          fallback={image.fallback}
          imageProps={{ loading: "lazy" }}
        />
      )}
    />
  );
}
