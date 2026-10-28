import type { ComponentProps } from "react";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { CRATE_ICON_SIZE, Music4 } from "@crate/ui/icons";
export function InfoTabHeroArtworkView({
  src,
  alt,
  renderImage,
}: Pick<ComponentProps<typeof MediaCover>, "src" | "alt" | "renderImage">) {
  return (
    <MediaCover
      src={src}
      alt={alt}
      fallbackIcon={Music4}
      iconSize={CRATE_ICON_SIZE.lg}
      className="size-24 shrink-0 sm:size-28"
      renderImage={renderImage}
    />
  );
}
