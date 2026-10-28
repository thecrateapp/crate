import { useTranslation } from "react-i18next";

import type { TrackInfo } from "../../../lib/track-info-data";
import { formatCompact } from "../../../lib/utils";

import { SectionCard, StatCard } from "./InfoTabPrimitives";

export function InfoTabReach({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  const hasReach = [
    info.lastfm_listeners,
    info.lastfm_playcount,
    info.popularity,
  ].some((value) => value != null);

  return (
    <SectionCard
      title={t("player.info.sections.reach.title")}
      subtitle={t("player.info.sections.reach.subtitle")}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {info.lastfm_listeners != null ? (
          <StatCard
            label={t("player.info.metric.listeners")}
            value={formatCompact(info.lastfm_listeners)}
            helper={t("player.info.helper.lastfmAudience")}
          />
        ) : null}
        {info.lastfm_playcount != null ? (
          <StatCard
            label={t("player.info.metric.plays")}
            value={formatCompact(info.lastfm_playcount)}
            helper={t("player.info.helper.lastfmScrobbles")}
          />
        ) : null}
        {info.popularity != null ? (
          <StatCard
            label={t("player.info.metric.popularity")}
            value={`${Math.round(info.popularity)}%`}
            helper={t("player.info.helper.normalizedScore")}
          />
        ) : null}
      </div>
      {!hasReach ? (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.reach.empty")}
        </p>
      ) : null}
    </SectionCard>
  );
}
