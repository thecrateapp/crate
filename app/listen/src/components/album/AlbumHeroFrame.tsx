import type { CSSProperties } from "react";
import { PageHero, type PageHeroProps } from "@crate/ui/domain/hero";
export const ALBUM_MOBILE_HERO_SPACING = {
  "--album-mobile-action-overlap": "2rem",
  "--album-mobile-info-action-gap": "20px",
  "--album-mobile-info-y": "0px",
} as CSSProperties;

/** Native/mobile placement stays intact. PageHero owns type and metadata roles. */
export function AlbumHeroFrame(
  props: Omit<PageHeroProps, "variant" | "titleSize">,
) {
  return (
    <PageHero
      {...props}
      variant="media"
      titleSize="compact"
      className="h-auto min-h-hero-2xl sm:h-hero-lg sm:min-h-0 lg:h-hero-xl"
      contentClassName="translate-y-[var(--album-mobile-info-y)] pb-[calc(var(--album-mobile-action-overlap)+var(--album-mobile-info-action-gap))] pt-[var(--listen-mobile-page-top)] sm:translate-y-0 sm:pb-6"
      artworkSize="lg"
      artworkFrame="none"
      actionsClassName="-mt-[var(--album-mobile-action-overlap)] pt-0 sm:mt-0"
    />
  );
}
