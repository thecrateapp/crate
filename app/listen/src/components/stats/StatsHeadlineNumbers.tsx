import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CountUpNumber } from "@/components/stats/CountUpNumber";
import type { StatsToday } from "@/components/stats/stats-model";

export function StatsHeadlineNumbers({
  minutes,
  plays,
  activeDays,
  artists,
  today,
}: {
  minutes: number;
  plays: number;
  activeDays: number;
  artists: number | null;
  today: StatsToday | null;
}) {
  const { t, i18n } = useTranslation();
  const formatInteger = useCallback(
    (value: number) =>
      new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(
        Math.round(value),
      ),
    [i18n.language],
  );
  const items = [
    { key: "minutes", value: minutes, label: t("stats.headline.minutes") },
    { key: "plays", value: plays, label: t("stats.headline.plays") },
    { key: "days", value: activeDays, label: t("stats.headline.activeDays") },
    ...(artists === null
      ? []
      : [
          {
            key: "artists",
            value: artists,
            label: t("stats.headline.artists"),
          },
        ]),
  ];

  return (
    <dl className="mt-6 flex flex-wrap gap-x-9 gap-y-4">
      {items.map((item) => (
        <div key={item.key}>
          <dd className="stats-headline-value">
            <CountUpNumber value={item.value} format={formatInteger} />
          </dd>
          <dt className="mt-1 text-xs text-text-muted">{item.label}</dt>
        </div>
      ))}
      {today ? (
        <div>
          <dd className="stats-headline-value text-accent-action">
            <CountUpNumber value={today.minutes} format={formatInteger} />
          </dd>
          <dt className="mt-1 flex items-center gap-2 text-xs text-text-muted">
            <span className="stats-live-dot" aria-hidden="true" />
            {t("stats.headline.today")}
          </dt>
        </div>
      ) : null}
    </dl>
  );
}
