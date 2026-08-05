export const ARTIST_HERO_CONTRACT_VERSION = 1 as const;

export type ArtistHeroComposition = "desktop" | "mobile";

export interface ArtistHeroCompositionSize {
  width: number;
  height: number;
}

export interface ArtistHeroArtworkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ArtistHeroCompositionView {
  schema_version: number;
  composition: ArtistHeroComposition;
  render_revision: string;
  recipe_hash: string;
  width: number;
  height: number;
  bounds: ArtistHeroArtworkBounds;
  asset_path: string;
}

export interface ArtistHeroProfileView {
  schema_version: number;
  render_version: string;
  compositions: Partial<
    Record<ArtistHeroComposition, ArtistHeroCompositionView>
  >;
}

export function artistHeroCompositionSize(
  composition: ArtistHeroComposition,
): ArtistHeroCompositionSize {
  return composition === "desktop"
    ? { width: 1480, height: 600 }
    : { width: 1080, height: 1350 };
}

export function artistHeroViewKey(view: ArtistHeroCompositionView): string {
  return `${view.composition}:${view.render_revision}:${view.recipe_hash}`;
}
