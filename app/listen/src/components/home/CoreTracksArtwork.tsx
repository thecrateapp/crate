import { artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { EditorialPlaylistArtwork } from "@/components/playlists/EditorialPlaylistArtwork";

import type {
  HomeGeneratedPlaylistSummary,
  HomeGeneratedPlaylistDetail,
} from "./home-model";

type CoreTracksLike =
  | HomeGeneratedPlaylistSummary
  | HomeGeneratedPlaylistDetail;

function coreArtistPhoto(item: CoreTracksLike): string | null {
  const firstTrack = item.artwork_tracks?.[0];
  return (
    artistPhotoApiUrl(
      {
        artistId: firstTrack?.artist_id,
        artistSlug: firstTrack?.artist_slug,
        artistName: item.name,
      },
      { size: 384 },
    ) || null
  );
}

export function CoreTracksArtwork({
  item,
  className,
}: {
  item: CoreTracksLike;
  className?: string;
}) {
  const photoUrl = coreArtistPhoto(item);

  return (
    <EditorialPlaylistArtwork
      title={item.name}
      kicker="Core Tracks"
      tracks={item.artwork_tracks}
      backgroundImageUrl={photoUrl}
      variant="core"
      className={cn("rounded-3xl bg-white/5", className)}
    />
  );
}
