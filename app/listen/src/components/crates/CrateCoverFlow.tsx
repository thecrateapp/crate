import { CrateImage } from "@/components/artwork/CrateImage";
import type { NumberedCrateAlbum } from "./crate-model";
import { albumCoverApiUrl } from "@/lib/library-routes";
import {
  CrateCoverFlowView,
  type CrateCoverFlowViewProps,
} from "./CrateCoverFlowView";
export type { CrateCoverUrl } from "./CrateCoverFlowView";
export function authenticatedCrateCoverUrl(
  album: NumberedCrateAlbum,
  size: number,
): string | null {
  if (!album.has_cover) return null;
  return albumCoverApiUrl(
    {
      globalAlbumUid: album.global_album_uid,
      albumName: album.name,
      artistName: album.artist_name,
    },
    { size },
  );
}

export function CrateCoverFlow({
  coverUrl = authenticatedCrateCoverUrl,
  ...props
}: Omit<CrateCoverFlowViewProps, "renderCover" | "coverUrl"> & {
  coverUrl?: CrateCoverFlowViewProps["coverUrl"];
}) {
  return (
    <CrateCoverFlowView
      {...props}
      coverUrl={coverUrl}
      renderCover={(image, album) => (
        <CrateImage
          src={image.src}
          alt={album ? `${album.name} - ${album.artist_name}` : ""}
          width={image.width}
          height={image.height}
          className={image.className}
          draggable={image.draggable}
          sizes={image.sizes}
          loading={image.loading}
        />
      )}
    />
  );
}
