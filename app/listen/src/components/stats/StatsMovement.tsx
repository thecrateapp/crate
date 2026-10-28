import { CrateImage } from "@/components/artwork/CrateImage";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import {
  StatsMovementView,
  type StatsMovementScope,
} from "./StatsMovementView";
import type { StatsStory, StatsStoryArtistSignal } from "./stats-types";

const artistRoute = (artist: StatsStoryArtistSignal) => ({
  artistId: artist.artist_id,
  artistSlug: artist.artist_slug,
  artistName: artist.artist_name,
});

export function StatsMovement({
  story,
  exclude,
  scope,
}: {
  story: Pick<StatsStory, "movers" | "discoveries" | "comebacks">;
  /** Artist of the period plus the top three artist names. */
  exclude: readonly string[];
  scope: StatsMovementScope;
}) {
  return (
    <StatsMovementView
      story={story}
      exclude={exclude}
      scope={scope}
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
