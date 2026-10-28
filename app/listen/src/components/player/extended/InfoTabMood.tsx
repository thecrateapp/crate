import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { useTranslation } from "react-i18next";

import type { TrackInfo } from "../../../lib/track-info-data";

import { MetricBar, SectionCard } from "./InfoTabPrimitives";
import type { MoodEntry } from "./info-tab-data";

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
    >
      {topMoods.length ? (
        <div className="flex flex-wrap gap-2">
          {topMoods.map((mood) => (
            <GenrePill
              key={mood.label}
              item={{ name: mood.label, percent: Math.round(mood.value * 100) }}
            />
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
      />
    </SectionCard>
  );
}
