import { CrateImage } from "@/components/artwork/CrateImage";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { StatsArtistOfPeriodView } from "./StatsArtistOfPeriodView";
import type { StatsArtistOfPeriod as ArtistOfPeriod } from "./stats-types";
export function StatsArtistOfPeriod({
  artist,
  periodStart,
  allTime,
}: {
  artist: ArtistOfPeriod;
  periodStart?: string | null;
  allTime?: boolean;
}) {
  const route = {
    artistId: artist.artist_id,
    globalArtistUid: artist.global_artist_uid,
    artistSlug: artist.artist_slug,
    artistName: artist.artist_name,
  };
  return (
    <StatsArtistOfPeriodView
      artist={artist}
      href={artistPagePath(route)}
      periodStart={periodStart}
      allTime={allTime}
      artwork={
        <CrateImage
          src={artistPhotoApiUrl(route, { size: 1024 })}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      }
    />
  );
}
