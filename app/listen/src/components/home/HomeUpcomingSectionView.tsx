import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  SectionHeader,
  SectionActionButton,
} from "@crate/ui/domain/lists/SectionHeader";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { HomeUpcomingPreviewPanel } from "./HomeUpcomingPreviewPanel";
import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";

export function HomeUpcomingSectionView({
  previewItems,
  summary,
  feature,
  onOpenUpcoming,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  feature?: ReactNode;
  onOpenUpcoming: () => void;
}) {
  const { t } = useTranslation();
  const hasMore = previewItems.length > 1;
  return (
    <section className="min-w-0 space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        action={
          <SectionActionButton
            onClick={onOpenUpcoming}
            aria-label={t("home.radar.open")}
          >
            {t("common.viewAll")}
          </SectionActionButton>
        }
      />
      {previewItems.length ? (
        <div
          className={hasMore ? "grid min-w-0 gap-4 lg:grid-cols-2" : "min-w-0"}
        >
          {feature}
          {hasMore ? (
            <HomeUpcomingPreviewPanel
              previewItems={previewItems}
              summary={summary}
              onOpenUpcoming={onOpenUpcoming}
            />
          ) : null}
        </div>
      ) : (
        <Card>
          <CardContent>
            <h3 className="font-display text-lg font-bold text-text-primary">
              {t(
                (summary?.followed_artists ?? 0) > 0
                  ? "radar.empty.noSignalsTitle"
                  : "radar.empty.followTitle",
              )}
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              {t(
                (summary?.followed_artists ?? 0) > 0
                  ? "radar.empty.noSignalsBody"
                  : "radar.empty.followBody",
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
