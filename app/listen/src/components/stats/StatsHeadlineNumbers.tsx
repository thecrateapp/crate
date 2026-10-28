import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CountUpNumber } from "./CountUpNumber";
import { formatStatsDelta } from "./stats-format";
import type { StatsOverviewPrevious, StatsToday } from "./stats-types";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

export function StatsHeadlineNumbers({
  minutes,
  plays,
  activeDays,
  artists,
  today,
  comparison = null,
}: {
  minutes: number;
  plays: number;
  activeDays: number;
  artists: number | null;
  today: StatsToday | null;
  /** null for all time (no comparison row); `previous: null` for a period without one. */
  comparison?: {
    previous: StatsOverviewPrevious | null;
    /** Localized caption, e.g. "vs previous 30 days". */
    caption: string;
  } | null;
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
    {
      key: "minutes",
      value: minutes,
      label: t("stats.headline.minutes"),
      before: comparison?.previous?.minutes_listened,
    },
    {
      key: "plays",
      value: plays,
      label: t("stats.headline.plays"),
      before: comparison?.previous?.play_count,
    },
    {
      key: "days",
      value: activeDays,
      label: t("stats.headline.activeDays"),
      before: comparison?.previous?.active_days,
    },
    ...(artists === null
      ? []
      : [
          {
            key: "artists",
            value: artists,
            label: t("stats.headline.artists"),
            before: comparison?.previous?.artist_count,
          },
        ]),
  ];

  return (
    <div className="grid gap-3">
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
            {comparison?.previous ? (
              // A second dd of the same group keeps the dl valid and ties the
              // delta to its metric for assistive tech.
              <dd className="order-last m-0">
                <MonoLabel as="span" className="block">
                  {formatStatsDelta(item.value, item.before, i18n.language) ??
                    "\u2014"}
                </MonoLabel>
              </dd>
            ) : null}
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
      {comparison ? (
        <MonoLabel as="p">
          {comparison.previous
            ? comparison.caption
            : t("stats.compare.noPrevious")}
        </MonoLabel>
      ) : null}
    </div>
  );
}
