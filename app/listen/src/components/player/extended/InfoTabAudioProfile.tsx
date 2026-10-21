import { useTranslation } from "react-i18next";

import type { TrackInfo } from "../../../lib/track-info-data";

import { MetricBar, SectionCard } from "./InfoTabPrimitives";

export function InfoTabAudioProfile({
  hasAnalysis,
  info,
}: {
  hasAnalysis: boolean;
  info: TrackInfo;
}) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("player.info.sections.audioProfile.title")}
      subtitle={
        hasAnalysis
          ? t("player.info.sections.audioProfile.subtitle")
          : t("player.info.sections.audioProfile.emptySubtitle")
      }
    >
      {hasAnalysis ? (
        <>
          <MetricBar
            label={t("player.info.metric.energy")}
            value={info.energy}
          />
          <MetricBar
            label={t("player.info.metric.danceability")}
            value={info.danceability}
          />
          <MetricBar
            label={t("player.info.metric.valence")}
            value={info.valence}
          />
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.audioProfile.empty")}
        </p>
      )}
    </SectionCard>
  );
}
