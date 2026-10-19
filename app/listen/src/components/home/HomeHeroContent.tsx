import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { artistHeroArtworkFitClassName } from "@crate/ui/domain/ArtistHeroFrame";
import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";
import type { ArtistHeroArtworkBounds } from "@crate/ui/domain/ArtistHeroFrame";

import type { HomeHeroArtist } from "./home-model";

export function HeroBackdrop({
  hero,
  backgroundSrc,
  composition,
  artworkBounds,
}: {
  hero: HomeHeroArtist;
  backgroundSrc?: string;
  composition: "desktop" | "mobile";
  artworkBounds?: ArtistHeroArtworkBounds;
}) {
  const grayscale =
    !hero.artwork_revision && hero.artwork_provenance !== "specific";
  if (!backgroundSrc) return null;

  return (
    <CrateImage
      data-testid={`${composition}-hero-artwork`}
      src={backgroundSrc}
      retryPolicy="eventual"
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn(
        "absolute inset-0 h-full w-full transition-opacity duration-500",
        artistHeroArtworkFitClassName(artworkBounds),
        grayscale ? "grayscale" : "",
      )}
    />
  );
}

export function HeroGenres({ hero }: { hero: HomeHeroArtist }) {
  const genres = hero.genre_profile?.length
    ? hero.genre_profile
    : (hero.genres?.flatMap((name) => (name ? [{ name }] : [])) ?? []);

  if (genres.length === 0) return null;

  return (
    <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
      {genres.slice(0, 2).map((genre) => (
        <GenrePill
          key={genre.name}
          item={genre}
          className="max-w-[42vw] sm:max-w-none"
        />
      ))}
    </div>
  );
}

export { HeroActions } from "./HomeHeroActions";
