import { useTranslation } from "react-i18next";

import type { TrackInfo } from "../../../lib/track-info-data";

import { MetricBar, SectionCard } from "./InfoTabPrimitives";

export function InfoTabBliss({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("player.info.sections.bliss.title")}
      subtitle={
        info.bliss_signature
          ? t("player.info.sections.bliss.subtitle")
          : t("player.info.sections.bliss.emptySubtitle")
      }
    >
      {info.bliss_signature ? (
        <>
          <MetricBar
            label={t("player.info.metric.texture")}
            value={info.bliss_signature.texture}
          />
          <MetricBar
            label={t("player.info.metric.motion")}
            value={info.bliss_signature.motion}
          />
          <MetricBar
            label={t("player.info.metric.density")}
            value={info.bliss_signature.density}
          />
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.bliss.empty")}
        </p>
      )}
    </SectionCard>
  );
}
