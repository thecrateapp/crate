import { useTranslation } from "react-i18next";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { HomeUpcomingFeatureView } from "./HomeUpcomingFeatureView";
import type { HomeUpcomingItem } from "./home-model";
import { buildUpcomingPresentation } from "./home-upcoming-model";
const LAZY_IMAGE_PROPS = { loading: "lazy" } as const;
export function HomeUpcomingFeature({
  item,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { i18n } = useTranslation();
  const presentation = buildUpcomingPresentation(item, i18n.language);
  return (
    <HomeUpcomingFeatureView
      item={item}
      {...presentation}
      onOpenUpcoming={onOpenUpcoming}
      onPlaySetlist={onPlaySetlist}
      artwork={
        presentation.artistImage ? (
          <ArtworkSurface
            source={presentation.artistImage}
            alt=""
            fallback={null}
            imageProps={LAZY_IMAGE_PROPS}
            imageClassName="object-cover"
            className="size-full"
          />
        ) : null
      }
    />
  );
}
