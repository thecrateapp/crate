import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  CRATE_ICON_SIZE,
  Play,
  Sparkles,
  Flame,
} from "@crate/ui/icons";
import { SectionHeader } from "@crate/ui/domain/lists";
import { Button } from "@crate/ui/shadcn/button";

import type { HomeUpcomingInsight } from "./home-model";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

function insightLabel(type: HomeUpcomingInsight["type"], t: TFunction): string {
  if (type === "show_prep") return t("home.radar.insight.showPrep");
  if (type === "one_week") return t("home.radar.insight.thisWeek");
  return t("home.radar.insight.oneMonth");
}

export function HomeShowPrepSection({
  insights,
  onOpenUpcoming,
  onPlaySetlist,
  onSaveReminder,
}: {
  insights: HomeUpcomingInsight[];
  onOpenUpcoming: () => void;
  onPlaySetlist: (insight: HomeUpcomingInsight) => void;
  onSaveReminder: (insight: HomeUpcomingInsight) => void;
}) {
  const { t } = useTranslation();
  if (!insights.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.showPrep.title")}
        subtitle={t("home.radar.showPrep.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.type}:${insight.show_id}`}
            className="home-upcoming-show-prep-card rounded-panel p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <CrateBadge size="md" icon={Sparkles}>
                  {insightLabel(insight.type, t)}
                </CrateBadge>
                <h3 className="mt-3 text-lg font-bold text-text-primary">
                  {insight.title}
                </h3>
                <p className="home-upcoming-show-prep-subtitle mt-1 text-sm">
                  {insight.subtitle}
                </p>
              </div>
              {insight.weight === "high" ? (
                <CrateBadge size="md" icon={Flame}>
                  {t("home.radar.showPrep.heavyRotation")}
                </CrateBadge>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-text-muted">
              {insight.message}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {insight.has_setlist ? (
                <Button
                  size="sm"
                  shape="pill"
                  onClick={() => onPlaySetlist(insight)}
                  className="h-9 gap-2 px-4 shadow-none has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-3.5"
                >
                  <Play size={CRATE_ICON_SIZE.xs} fill="currentColor" />
                  {t("radar.show.playSetlist")}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                shape="pill"
                onClick={() => onSaveReminder(insight)}
                className="home-upcoming-show-prep-reminder h-9 gap-2 px-4 font-normal has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-3.5"
              >
                <Calendar size={CRATE_ICON_SIZE.xs} />
                {t("home.radar.showPrep.saveForLater")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
