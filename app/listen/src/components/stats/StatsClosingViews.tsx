import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ReactNode } from "react";
import { Card } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { EmptyState } from "@crate/ui/domain/states";
import type {
  StatsDecadeAlbum,
  StatsMusicAge,
  StatsStoryArtistSignal,
} from "./stats-types";

function formatDay(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const date =
    value.length > 10 ? new Date(value) : new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(value.length > 10 ? {} : { timeZone: "UTC" }),
  });
}

export function StatsDecadeColumnsView({
  musicAge,
  linked = false,
  className,
  renderAlbum,
  getAlbumHref,
}: {
  musicAge: StatsMusicAge;
  linked?: boolean;
  className?: string;
  renderAlbum: (album: StatsDecadeAlbum) => ReactNode;
  getAlbumHref: (album: StatsDecadeAlbum) => string;
}) {
  const { t } = useTranslation();
  const maxShare = Math.max(
    0.01,
    ...musicAge.decades.map((item) => item.share),
  );
  const medianDecade = Math.floor(musicAge.median_year / 10) * 10;
  return (
    <div
      className={className ? `stats-decades ${className}` : "stats-decades"}
      aria-hidden={linked ? undefined : "true"}
    >
      {musicAge.decades.map((item, index) => {
        const album = item.top_album;
        const share = Math.round(item.share * 100);
        const hot = item.decade === medianDecade ? "true" : undefined;
        const content = (
          <>
            {album ? renderAlbum(album) : null}
            <i
              style={{
                height: `${Math.max(4, (item.share / maxShare) * 100)}%`,
                animationDelay: `${index * 120}ms`,
              }}
            />
            <span className="stats-decade-label">
              <b>{`${String(item.decade).slice(2)}s`}</b>
              {`${share}%`}
            </span>
          </>
        );
        return linked && album ? (
          <Link
            key={item.decade}
            to={getAlbumHref(album)}
            className="stats-decade"
            data-hot={hot}
            aria-label={t("stats.musicAge.decadeTop", {
              decade: item.decade,
              share,
              album: album.album,
              artist: album.artist ?? "",
            })}
          >
            {content}
          </Link>
        ) : (
          <div key={item.decade} className="stats-decade" data-hot={hot}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function StatsMusicAgeCardView({
  musicAge,
  decades,
}: {
  musicAge: StatsMusicAge;
  decades: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className="gap-4 p-5">
      <MonoLabel as="h3" tone="accent">
        {t("stats.musicAge.title")}
      </MonoLabel>
      <StatNumber value={musicAge.median_year} size="md" />
      {decades}
      {musicAge.oldest_album ? (
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          {t("stats.musicAge.oldest", {
            album: musicAge.oldest_album.album,
            year: musicAge.oldest_album.year,
          })}
        </p>
      ) : null}
    </Card>
  );
}

export function StatsDiscoveriesCardView({
  discoveries,
  renderArtist,
  getArtistHref,
}: {
  discoveries: StatsStoryArtistSignal[];
  renderArtist: (artist: StatsStoryArtistSignal) => ReactNode;
  getArtistHref: (artist: StatsStoryArtistSignal) => string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card className="gap-4 p-5">
      <MonoLabel as="h3" tone="accent">
        {t("stats.discoveries.title")}
      </MonoLabel>
      {discoveries.length ? (
        <ul className="mt-3 divide-y divide-border-quiet">
          {discoveries.slice(0, 4).map((artist) => {
            return (
              <li key={artist.artist_name}>
                <Link
                  to={getArtistHref(artist)}
                  className="flex items-center gap-3 py-2.5"
                >
                  {renderArtist(artist)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">
                      {artist.artist_name}
                    </div>
                    <MonoLabel>
                      {t("stats.discoveries.since", {
                        date: formatDay(artist.first_played_at, i18n.language),
                      })}
                    </MonoLabel>
                  </div>
                  <MonoLabel as="span" tone="accent">
                    {t("common.playCount", { count: artist.play_count })}
                  </MonoLabel>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState message={t("stats.discoveries.empty")} />
      )}
    </Card>
  );
}
