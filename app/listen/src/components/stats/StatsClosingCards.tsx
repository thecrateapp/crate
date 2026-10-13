import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import type {
  StatsDecadeAlbum,
  StatsMusicAge,
  StatsStoryArtistSignal,
} from "@/components/stats/stats-model";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

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

function decadeAlbumRoute(album: StatsDecadeAlbum) {
  return {
    albumId: album.album_id ?? undefined,
    albumSlug: album.album_slug ?? undefined,
    artistName: album.artist ?? undefined,
    albumName: album.album,
  };
}

export function StatsDecadeColumns({
  musicAge,
  linked = false,
  className,
}: {
  musicAge: StatsMusicAge;
  linked?: boolean;
  className?: string;
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
            {album ? (
              <CrateImage
                src={albumCoverApiUrl(decadeAlbumRoute(album), { size: 256 })}
                alt=""
                className="stats-decade-cover"
                loading="lazy"
              />
            ) : null}
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
            to={albumPagePath(decadeAlbumRoute(album))}
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

export function StatsMusicAgeCard({ musicAge }: { musicAge: StatsMusicAge }) {
  const { t } = useTranslation();
  return (
    <div className="stats-card rounded-panel p-5">
      <h3 className="text-sm font-semibold text-accent-action">
        {t("stats.musicAge.title")}
      </h3>
      <div className="stats-closing-value">{musicAge.median_year}</div>
      <StatsDecadeColumns musicAge={musicAge} linked />
      {musicAge.oldest_album ? (
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          {t("stats.musicAge.oldest", {
            album: musicAge.oldest_album.album,
            year: musicAge.oldest_album.year,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function StatsDiscoveriesCard({
  discoveries,
}: {
  discoveries: StatsStoryArtistSignal[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="stats-card rounded-panel p-5">
      <h3 className="text-sm font-semibold text-accent-action">
        {t("stats.discoveries.title")}
      </h3>
      {discoveries.length ? (
        <ul className="mt-3 divide-y divide-border-quiet">
          {discoveries.slice(0, 4).map((artist) => {
            const route = {
              artistId: artist.artist_id,
              artistSlug: artist.artist_slug,
              artistName: artist.artist_name,
            };
            return (
              <li key={artist.artist_name}>
                <Link
                  to={artistPagePath(route)}
                  className="flex items-center gap-3 py-2.5"
                >
                  <CrateImage
                    src={artistPhotoApiUrl(route, { size: 128 })}
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">
                      {artist.artist_name}
                    </div>
                    <div className="text-xs text-text-muted">
                      {t("stats.discoveries.since", {
                        date: formatDay(artist.first_played_at, i18n.language),
                      })}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-accent-action">
                    {t("common.playCount", { count: artist.play_count })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          {t("stats.discoveries.empty")}
        </p>
      )}
    </div>
  );
}
