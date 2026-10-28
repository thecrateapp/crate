import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ReactNode } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { formatStatsMinutes } from "./stats-format";
import type { StatsArtistOfPeriod as ArtistOfPeriod } from "./stats-types";

function formatDay(value: string | null | undefined, locale: string) {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** ISO day strings compare lexicographically; no Date objects, no timezone shifts. */
function originLine(
  firstEverDay: string | null | undefined,
  periodStart: string | null | undefined,
  allTime: boolean,
): { kind: "discovered" } | { kind: "since"; year: string } | null {
  if (!firstEverDay) return null;
  if (!allTime && periodStart && firstEverDay >= periodStart)
    return { kind: "discovered" };
  return { kind: "since", year: firstEverDay.slice(0, 4) };
}

export function StatsArtistOfPeriodView({
  artist,
  href,
  artwork,
  periodStart,
  allTime = false,
}: {
  artist: ArtistOfPeriod;
  href: string;
  artwork: ReactNode;
  /** First local day of the selected period (tape.start). */
  periodStart?: string | null;
  allTime?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const origin = originLine(artist.first_ever_day, periodStart, allTime);
  const firstDay = formatDay(artist.first_day_in_period, i18n.language);

  return (
    <section className="stats-artist-of-period">
      <div className="stats-artist-of-period-photo">
        {artwork}
        <span className="stats-artist-of-period-rank" aria-hidden="true">
          01
        </span>
      </div>
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <MonoLabel tone="accent">{t("stats.artistOfPeriod.kicker")}</MonoLabel>
        <Link to={href} className="stats-artist-of-period-name">
          {artist.artist_name}
        </Link>
        {origin ? (
          <MonoLabel as="p" className="mt-3">
            {origin.kind === "discovered"
              ? t("stats.artistOfPeriod.discovered")
              : t("stats.artistOfPeriod.since", { year: origin.year })}
          </MonoLabel>
        ) : null}
        <p className="mt-3 max-w-md text-sm leading-6 text-text-secondary">
          {t("stats.artistOfPeriod.body", {
            days: artist.active_days,
            date: firstDay ?? "",
          })}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
          <Metric
            value={String(artist.plays)}
            label={t("stats.artistOfPeriod.plays")}
          />
          <Metric
            value={formatStatsMinutes(artist.minutes)}
            label={t("stats.artistOfPeriod.listened")}
          />
          {artist.top_album?.album ? (
            <Metric
              value={artist.top_album.album}
              label={t("stats.artistOfPeriod.topAlbum")}
            />
          ) : null}
          {artist.listener_top_percent ? (
            <Metric
              value={t("stats.artistOfPeriod.topPercent", {
                percent: artist.listener_top_percent,
              })}
              label={t("stats.artistOfPeriod.topPercentLabel")}
            />
          ) : (
            <Metric
              value={String(artist.active_days)}
              label={t("stats.artistOfPeriod.activeDays")}
            />
          )}
        </dl>
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <StatNumber
        as="dd"
        size="sm"
        value={value}
        className="max-w-full break-words"
      />
      <MonoLabel as="dt">{label}</MonoLabel>
    </div>
  );
}
