import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ReactNode } from "react";
import { Card } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import type { StatsDecadeAlbum, StatsMusicAge } from "./stats-types";

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
  shareYear,
  decades,
}: {
  musicAge: StatsMusicAge;
  /** Year `share_this_year` measures: the period's last year, not today's. */
  shareYear: number;
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
      {musicAge.newest_album ? (
        <p className="text-sm leading-6 text-text-secondary">
          {t("stats.musicAge.newest", {
            album: musicAge.newest_album.album,
            year: musicAge.newest_album.year,
          })}
        </p>
      ) : null}
      {musicAge.share_this_year != null ? (
        <p className="text-sm leading-6 text-text-secondary">
          {t("stats.musicAge.shareThisYear", {
            share: Math.round(musicAge.share_this_year * 100),
            // A label, not a quantity: never group it as "2,023".
            year: String(shareYear),
          })}
        </p>
      ) : null}
    </Card>
  );
}
