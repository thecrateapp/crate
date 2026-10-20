import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CountUpNumber } from "./CountUpNumber";
import type { StatsToday } from "./stats-types";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

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
    <dl className="flex flex-wrap gap-x-9 gap-y-4">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-1.5">
          <MonoLabel as="dt" className="order-last">
            {item.label}
          </MonoLabel>
          <dd className="m-0">
            <StatNumber
              size="md"
              value={
                <CountUpNumber value={item.value} format={formatInteger} />
              }
            />
          </dd>
        </div>
      ))}
      {today ? (
        <div className="flex flex-col gap-1.5">
          <MonoLabel as="dt" className="order-last flex items-center gap-2">
            <StatusDot tone="on" />
            {t("stats.headline.today")}
          </MonoLabel>
          <dd className="m-0">
            <StatNumber
              size="md"
              value={
                <CountUpNumber value={today.minutes} format={formatInteger} />
              }
            />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
