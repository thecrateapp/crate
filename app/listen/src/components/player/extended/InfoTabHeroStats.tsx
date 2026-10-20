import { useTranslation } from "react-i18next";
import type { TrackInfo } from "../../../lib/track-info-data";
import { StatCard } from "./InfoTabPrimitives";
import { formatKey } from "./info-tab-data";
export function InfoTabHeroStats({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  const musicalKey = formatKey(info.audio_key, info.audio_scale);
  if (info.bpm == null && !musicalKey) return null;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4">
      {info.bpm != null ? (
        <StatCard
          label={t("player.info.metric.tempo")}
          value={String(Math.round(info.bpm))}
          unit="BPM"
        />
      ) : null}
      {musicalKey ? (
        <StatCard label={t("player.info.metric.key")} value={musicalKey} />
      ) : null}
    </div>
  );
}
