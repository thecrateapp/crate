import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import {
  change,
  number,
  percent,
  type CollectionInsights,
} from "./insights-model";
export function InsightSummary({ data }: { data: CollectionInsights }) {
  const { current, previous, catalogue, period } = data;
  if (!current || !catalogue || !period) return null;
  const readings = [
    {
      label: "Registered hours",
      value: number(current.minutes / 60),
      helper:
        previous && period.previous_complete
          ? change(current.minutes / 60, previous.minutes / 60)
          : "Previous comparison unavailable",
    },
    {
      label: "Catalogue reach",
      value: catalogue.tracks
        ? percent((current.tracks / catalogue.tracks) * 100)
        : "Unavailable",
      helper: `${number(current.tracks)} / ${number(catalogue.tracks)} indexed tracks`,
    },
    {
      label: "Albums with listening",
      value: number(current.albums),
      helper: `${number(current.albums)} / ${number(catalogue.albums)} indexed albums`,
    },
    {
      label: "Top 10 concentration",
      value: percent(current.concentration_pct),
      helper: `Of ${number(current.minutes)} min registered local listening time`,
    },
  ];
  return (
    <section aria-label="Collection listening summary" className="space-y-5">
      <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4">
        {readings.map((reading) => (
          <div
            key={reading.label}
            role="group"
            aria-label={reading.label}
            className="min-w-0 space-y-3"
          >
            <StatNumber
              as="div"
              size="sm"
              label={reading.label}
              value={<span className="wrap-anywhere">{reading.value}</span>}
            />
            <MonoLabel as="p" className="wrap-anywhere">
              {reading.helper}
            </MonoLabel>
          </div>
        ))}
      </div>
      <p className="text-sm text-text-muted">
        {number(current.plays)} registered local plays. Both periods use the
        current indexed catalogue as denominator. Registered time includes
        measured listening and scrobble estimates.
      </p>
      {current.plays === 0 ? (
        <p className="text-sm text-text-muted">
          No registered listening in this period.
        </p>
      ) : null}
    </section>
  );
}
