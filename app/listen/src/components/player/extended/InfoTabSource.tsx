import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { TrackInfo } from "../../../lib/track-info-data";

import { SectionCard, StatCard } from "./InfoTabPrimitives";

export function InfoTabSource({
  info,
  qualityPills,
  badge,
}: {
  info: TrackInfo;
  qualityPills: string[];
  badge?: ReactNode;
}) {
  const { t } = useTranslation();
  const hasSourceDetails =
    qualityPills.length > 0 ||
    info.loudness != null ||
    info.dynamic_range != null;

  return (
    <SectionCard
      title={t("player.info.sections.source.title")}
      subtitle={t("player.info.sections.source.subtitle")}
    >
      {badge ? <div className="flex">{badge}</div> : null}
      <div className="grid grid-cols-2 gap-3">
        {qualityPills.map((pill) => (
          <StatCard
            key={pill}
            label={t("player.info.metric.file")}
            value={pill}
          />
        ))}
        {info.loudness != null ? (
          <StatCard
            label={t("player.info.metric.loudness")}
            value={info.loudness.toFixed(1)}
            unit="dB"
            helper={t("player.info.helper.integratedLevel")}
          />
        ) : null}
        {info.dynamic_range != null ? (
          <StatCard
            label={t("player.info.metric.dynamics")}
            value={info.dynamic_range.toFixed(1)}
            unit="dB"
            helper={t("player.info.helper.dynamicRange")}
          />
        ) : null}
      </div>
      {!hasSourceDetails ? (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.source.empty")}
        </p>
      ) : null}
    </SectionCard>
  );
}
