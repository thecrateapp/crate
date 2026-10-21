import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardContent } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { HairlineList } from "@crate/ui/primitives/HairlineList";
import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { UpcomingPreviewRow } from "./HomeSectionCards";
export function HomeUpcomingPreviewPanel({
  previewItems,
  summary,
  onOpenUpcoming,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card data-home-slot="radar-list">
      <CardHeader>
        <MonoLabel as="h3">{t("home.radar.nextUp")}</MonoLabel>
        {summary ? (
          <MonoLabel tone="accent">
            {t("home.radar.summary", {
              shows: summary.show_count,
              releases: summary.release_count,
            })}
          </MonoLabel>
        ) : null}
      </CardHeader>
      <CardContent>
        <HairlineList label={t("home.radar.nextUp")}>
          {previewItems.slice(1).map((item) => (
            <UpcomingPreviewRow
              key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
              item={item}
              onClick={onOpenUpcoming}
            />
          ))}
        </HairlineList>
      </CardContent>
    </Card>
  );
}
