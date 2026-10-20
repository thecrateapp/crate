import { CrateImage } from "@/components/artwork/CrateImage";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import type {
  StatsDecadeAlbum,
  StatsMusicAge,
  StatsStoryArtistSignal,
} from "./stats-types";
import {
  StatsDecadeColumnsView,
  StatsMusicAgeCardView,
  StatsDiscoveriesCardView,
} from "./StatsClosingViews";
const albumRoute = (album: StatsDecadeAlbum) => ({
  albumId: album.album_id ?? undefined,
  albumSlug: album.album_slug ?? undefined,
  artistName: album.artist ?? undefined,
  albumName: album.album,
});
const artistRoute = (artist: StatsStoryArtistSignal) => ({
  artistId: artist.artist_id,
  artistSlug: artist.artist_slug,
  artistName: artist.artist_name,
});
export function StatsDecadeColumns(props: {
  musicAge: StatsMusicAge;
  linked?: boolean;
  className?: string;
}) {
  return (
    <StatsDecadeColumnsView
      {...props}
      getAlbumHref={(album) => albumPagePath(albumRoute(album))}
      renderAlbum={(album) => (
        <CrateImage
          src={albumCoverApiUrl(albumRoute(album), { size: 256 })}
          alt=""
          className="stats-decade-cover"
          loading="lazy"
        />
      )}
    />
  );
}
export function StatsMusicAgeCard({ musicAge }: { musicAge: StatsMusicAge }) {
  return (
    <StatsMusicAgeCardView
      musicAge={musicAge}
      decades={<StatsDecadeColumns musicAge={musicAge} linked />}
    />
  );
}
export function StatsDiscoveriesCard({
  discoveries,
}: {
  discoveries: StatsStoryArtistSignal[];
}) {
  return (
    <StatsDiscoveriesCardView
      discoveries={discoveries}
      getArtistHref={(artist) => artistPagePath(artistRoute(artist))}
      renderArtist={(artist) => (
        <CrateImage
          src={artistPhotoApiUrl(artistRoute(artist), { size: 128 })}
          alt=""
          className="crate-media-thumbnail size-12 shrink-0 rounded-full object-cover"
          loading="lazy"
        />
      )}
    />
  );
}
