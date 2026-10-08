import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  formatStatsMinutes,
  type StatsArtistOfPeriod as ArtistOfPeriod,
} from "@/components/stats/stats-model";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

function formatDay(value: string | null | undefined, locale: string) {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function StatsArtistOfPeriod({ artist }: { artist: ArtistOfPeriod }) {
  const { t, i18n } = useTranslation();
  const route = {
    artistId: artist.artist_id,
    globalArtistUid: artist.global_artist_uid,
    artistSlug: artist.artist_slug,
    artistName: artist.artist_name,
  };
  const firstDay = formatDay(artist.first_day_in_period, i18n.language);

  return (
    <section className="stats-artist-of-period">
      <div className="stats-artist-of-period-photo">
        <CrateImage
          src={artistPhotoApiUrl(route, { size: 1024 })}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
        <span className="stats-artist-of-period-rank" aria-hidden="true">
          01
        </span>
      </div>
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <div className="text-sm font-semibold text-accent-action">
          {t("stats.artistOfPeriod.kicker")}
        </div>
        <Link
          to={artistPagePath(route)}
          className="stats-artist-of-period-name"
        >
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
      <dd className="truncate text-2xl font-extrabold tracking-tight text-text-primary">
        {value}
      </dd>
      <dt className="text-xs text-text-muted">{label}</dt>
    </div>
  );
}
