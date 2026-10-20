import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { formatStatsMinutes } from "./stats-format";
export function StatsPlayMeta({
  playCount,
  minutes,
}: {
  playCount: number;
  minutes: number;
}) {
  const { t } = useTranslation();
  return (
    <MonoLabel as="span">
      {t("common.playCount", { count: playCount })} ·{" "}
      {formatStatsMinutes(minutes)}
    </MonoLabel>
  );
}
