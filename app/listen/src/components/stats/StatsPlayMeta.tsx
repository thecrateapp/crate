import { useTranslation } from "react-i18next";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { formatStatsMinutes } from "./stats-format";
export function StatsPlayMeta({
  playCount,
  minutes,
  isNew = false,
}: {
  playCount: number;
  minutes: number;
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const text = (
    <MonoLabel as="span">
      {t("common.playCount", { count: playCount })} ·{" "}
      {formatStatsMinutes(minutes)}
    </MonoLabel>
  );
  if (!isNew) return text;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {text}
      <InfoBadge tone="accent">{t("stats.badges.new")}</InfoBadge>
    </span>
  );
}
