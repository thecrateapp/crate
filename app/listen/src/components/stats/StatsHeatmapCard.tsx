import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  formatStatsPercent,
  type StatsHeatmap,
} from "@/components/stats/stats-model";

const MONDAY = Date.UTC(2024, 0, 1);

export function StatsHeatmapCard({ heatmap }: { heatmap: StatsHeatmap }) {
  const { t, i18n } = useTranslation();
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, {
      weekday: "narrow",
      timeZone: "UTC",
    });
    return Array.from({ length: 7 }, (_, index) =>
      format.format(new Date(MONDAY + index * 86_400_000)),
    );
  }, [i18n.language]);
  const longWeekday = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: "long",
        timeZone: "UTC",
      }),
    [i18n.language],
  );
  const max = Math.max(1, ...heatmap.cells.flat());
  const peak = heatmap.peak;

  return (
    <div className="stats-card rounded-panel p-5">
      <h3 className="text-sm font-semibold text-accent-action">
        {t("stats.heatmap.title")}
      </h3>
      <div
        className="stats-heatmap mt-4"
        role="img"
        aria-label={
          peak
            ? t("stats.heatmap.summary", {
                weekday: longWeekday.format(
                  new Date(MONDAY + peak.weekday * 86_400_000),
                ),
                hour: `${String(peak.hour).padStart(2, "0")}:00`,
              })
            : t("stats.heatmap.title")
        }
      >
        {heatmap.cells.map((row, weekday) => (
          <div key={weekday} className="contents">
            <span className="stats-heatmap-label" aria-hidden="true">
              {weekdays[weekday]}
            </span>
            {row.map((minutes, hour) => (
              <i
                key={hour}
                className="stats-heatmap-cell"
                style={{
                  ["--stats-level" as string]: (minutes / max).toFixed(3),
                  animationDelay: `${(weekday * 24 + hour) * 4}ms`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="stats-heatmap-hours" aria-hidden="true">
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour}>
            {hour % 6 === 0 ? String(hour).padStart(2, "0") : ""}
          </span>
        ))}
      </div>
      {peak ? (
        <p className="mt-4 text-sm text-text-secondary">
          {t("stats.heatmap.detail", {
            weekday: longWeekday.format(
              new Date(MONDAY + peak.weekday * 86_400_000),
            ),
            hour: `${String(peak.hour).padStart(2, "0")}:00`,
            share: formatStatsPercent(heatmap.night_share),
          })}
        </p>
      ) : null}
    </div>
  );
}
