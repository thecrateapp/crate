import { useTranslation } from "react-i18next";
import { Sparkles } from "@crate/ui/icons";

import type { TrackInfo } from "@/lib/track-info";

import { MetricBar, SectionCard } from "./InfoTabPrimitives";
import type { MoodEntry } from "./info-tab-data";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

export function InfoTabMood({
  info,
  topMoods,
}: {
  info: TrackInfo;
  topMoods: MoodEntry[];
}) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("player.info.sections.mood.title")}
      subtitle={
        topMoods.length
          ? t("player.info.sections.mood.subtitle")
          : t("player.info.sections.mood.emptySubtitle")
      }
      icon={Sparkles}
    >
      {topMoods.length ? (
        <div className="flex flex-wrap gap-2">
          {topMoods.map((mood) => (
            <CrateBadge key={mood.label} size="md">
              {mood.label} {Math.round(mood.value * 100)}%
            </CrateBadge>
          ))}
        </div>
      ) : null}
      <MetricBar
        label={t("player.info.metric.acousticness")}
        value={info.acousticness}
      />
      <MetricBar
        label={t("player.info.metric.instrumentalness")}
        value={info.instrumentalness}
        tone="accent"
      />
    </SectionCard>
  );
}
