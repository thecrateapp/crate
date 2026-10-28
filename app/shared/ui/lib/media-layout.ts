// Shared geometry for loaded media and reserved placeholders, independent of domain components.
export type MediaGridDensity = "compact" | "default" | "comfortable" | "wide";

export const MEDIA_GRID_BASE_CLASS_NAME = "grid gap-[var(--content-grid-gap)]";
export const MEDIA_GRID_DENSITY_CLASS_NAME: Record<MediaGridDensity, string> = {
  compact:
    "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8",
  default:
    "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
  comfortable: "grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  wide: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
};
export const MEDIA_RAIL_COLUMNS_CLASS_NAME =
  "grid grid-flow-col auto-cols-[var(--content-rail-column-2)] sm:auto-cols-[var(--content-rail-column-3)] md:auto-cols-[var(--content-rail-column-4)] lg:auto-cols-[var(--content-rail-column-5)] xl:auto-cols-[var(--content-rail-column-6)] 2xl:auto-cols-[var(--content-rail-column-7)]";
export const MEDIA_RAIL_BASE_CLASS_NAME =
  "hide-rail-scrollbar snap-x snap-mandatory gap-[var(--content-rail-gap)] overflow-x-auto overflow-y-hidden pb-2 transform-gpu will-change-scroll [&>*]:shrink-0";
