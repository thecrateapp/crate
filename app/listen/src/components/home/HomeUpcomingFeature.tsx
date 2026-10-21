import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { HomeUpcomingFeature } from "./HomeUpcomingFeatureCard";
import { HomeUpcomingSectionView } from "./HomeUpcomingSectionView";
export function HomeUpcomingSection({
  previewItems,
  summary,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const item = previewItems[0];
  return (
    <HomeUpcomingSectionView
      previewItems={previewItems}
      summary={summary}
      onOpenUpcoming={onOpenUpcoming}
      feature={
        item ? (
          <HomeUpcomingFeature
            item={item}
            onOpenUpcoming={onOpenUpcoming}
            onPlaySetlist={onPlaySetlist}
          />
        ) : null
      }
    />
  );
}
