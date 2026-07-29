import { albumCoverAssetPath } from "@/lib/library-routes";
import {
  PlaylistArtwork as PlaylistArtworkBase,
  type PlaylistArtworkImageProps,
  type PlaylistArtworkTrack,
} from "@crate/ui/domain/playlists/PlaylistArtwork";
import { CrateImage } from "@/components/artwork/CrateImage";

export type { PlaylistArtworkTrack };

function buildCoverUrl(track: PlaylistArtworkTrack): string | null {
  if (!track.artist || !track.album) return null;
  return (
    albumCoverAssetPath(
      {
        albumId: track.album_id,
        globalAlbumUid: track.global_album_uid,
        albumEntityUid: track.album_entity_uid,
        artistEntityUid: track.artist_entity_uid,
        albumSlug: track.album_slug,
        artistName: track.artist,
        albumName: track.album,
      },
      { size: 256 },
    ) || null
  );
}

export function PlaylistArtwork(
  props: Omit<
    React.ComponentProps<typeof PlaylistArtworkBase>,
    "buildCoverUrl" | "logoSrc"
  >,
) {
  return (
    <PlaylistArtworkBase
      {...props}
      coverDataUrl={props.coverDataUrl}
      buildCoverUrl={buildCoverUrl}
      logoSrc="/icons/logo.svg"
      renderImage={({ key, src, ...imageProps }: PlaylistArtworkImageProps) => (
        <CrateImage
          key={key}
          {...imageProps}
          src={typeof src === "string" ? src : null}
        />
      )}
    />
  );
}
