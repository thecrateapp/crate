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

export function StatsArtistOfPeriodView({
  artist,
  href,
  artwork,
}: {
  artist: ArtistOfPeriod;
  href: string;
  artwork: ReactNode;
}) {
  const { t, i18n } = useTranslation();
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
