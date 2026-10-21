import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "@crate/ui/shadcn/card";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Calendar, CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import {
  SectionHeader,
  SectionActionButton,
} from "@crate/ui/domain/lists/SectionHeader";
import { Button } from "@crate/ui/shadcn/button";

import type { HomeUpcomingInsight } from "./home-model";

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
        action={
          <SectionActionButton
            aria-label={t("home.radar.open")}
            onClick={onOpenUpcoming}
          >
            {t("common.viewAll")}
          </SectionActionButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <Card key={`${insight.type}:${insight.show_id}`}>
            <CardHeader>
              <div>
                <MonoLabel tone="accent">
                  {insightLabel(insight.type, t)}
                </MonoLabel>
                <h3 className="mt-3 text-lg font-bold text-text-primary">
                  {insight.title}
                </h3>
                <p className="mt-2 text-sm text-text-muted">
                  {insight.subtitle}
                </p>
              </div>
              {insight.weight === "high" ? (
                <MonoLabel tone="accent">
                  {t("home.radar.showPrep.heavyRotation")}
                </MonoLabel>
              ) : null}
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-text-muted">
                {insight.message}
              </p>
            </CardContent>
            <CardFooter>
              {insight.has_setlist ? (
                <Button size="sm" onClick={() => onPlaySetlist(insight)}>
                  <Play size={CRATE_ICON_SIZE.sm} fill="currentColor" />
                  {t("radar.show.playSetlist")}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSaveReminder(insight)}
              >
                <Calendar size={CRATE_ICON_SIZE.sm} />
                {t("home.radar.showPrep.saveForLater")}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
