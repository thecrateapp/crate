import { useTranslation } from "react-i18next";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { itemTitle, type BandcampItem } from "./bandcamp-model";

export function BandcampItemCover({
  item,
  compact = false,
}: {
  item: BandcampItem;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const title = itemTitle(item, t("bandcamp.itemFallback"));
  return (
    <MediaCover
      src={item.cover_url}
      alt=""
      fallback={title.slice(0, 2).toUpperCase()}
      className={compact ? "size-14 shrink-0" : "aspect-square w-full"}
      renderImage={(image) => (
        <ArtworkSurface
          source={image.src}
          alt={image.alt}
          className="size-full"
          imageClassName={image.className}
          fallback={image.fallback}
          imageProps={{ loading: "lazy", retryPolicy: "none" }}
        />
      )}
    />
  );
}
