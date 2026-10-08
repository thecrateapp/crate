import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Camera, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { CrateImage } from "@/components/artwork/CrateImage";
import { CountUpNumber } from "@/components/stats/CountUpNumber";
import {
  formatStatsMinutes,
  type StatsDashboard,
} from "@/components/stats/stats-model";
import {
  DiggingStory,
  type DiggingChapter,
} from "@/components/stats/digging/DiggingStory";
import { useAuth } from "@/contexts/AuthContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { openShareSheet, type DiggingShareData } from "@/lib/social-share";
import {
  formatMonthTitle,
  selectionDays,
  selectionYear,
} from "@/pages/stats-page-model";
import {
  useStatsPageController,
  type StatsPageController,
} from "@/pages/use-stats-page-controller";

type Translate = StatsPageController["t"];

function periodLabel(page: StatsPageController, locale: string): string {
  const { t } = page;
  if (page.selectedMonth) return formatMonthTitle(page.selectedMonth, locale);
  const year = selectionYear(page.selection);
  if (year !== null) return String(year);
  const days = selectionDays(page.selection);
  if (days !== null) return t("stats.digging.lastDays", { count: days });
  return t("stats.window.allTime");
}

function albumCover(
  item: {
    album?: string | null;
    artist?: string | null;
    album_id?: number | null;
    global_album_uid?: string | null;
  },
  size = 512,
): string | null {
  if (!item.album) return null;
  return albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumName: item.album,
      artistName: item.artist,
    },
    { size },
  );
}

function buildShareData(
  dashboard: StatsDashboard,
  t: Translate,
  kicker: string,
  owner: string,
): DiggingShareData {
  const artist = dashboard.artist_of_period?.artist_name;
  const highlights = dashboard.highlights;
  const stats = [
    {
      value: new Intl.NumberFormat().format(
        Math.round(dashboard.overview.minutes_listened),
      ),
      label: t("stats.headline.minutes"),
    },
    ...(dashboard.genre_trend?.[0]
      ? [
          {
            value: dashboard.genre_trend[0].genre_name.toLowerCase(),
            label: t("stats.digging.topGenre"),
          },
        ]
      : []),
    ...(highlights?.longest_streak
      ? [
          {
            value: String(highlights.longest_streak.days),
            label: t("stats.highlights.longestStreak"),
          },
        ]
      : []),
    ...(highlights?.new_artists
      ? [
          {
            value: String(highlights.new_artists.count),
            label: t("stats.highlights.newArtists"),
          },
        ]
      : []),
    ...(dashboard.music_age
      ? [
          {
            value: String(dashboard.music_age.median_year),
            label: t("stats.musicAge.title"),
          },
        ]
      : []),
  ];
  return {
    kicker,
    headline: artist
      ? t("stats.digging.summary.headline", { artist })
      : t("stats.digging.summary.fallback"),
    coverUrls: dashboard.top_albums.items
      .slice(0, 5)
      .map((item) => albumCover(item, 512))
      .filter((url): url is string => Boolean(url)),
    topArtistsLabel: t("stats.topArtists.title"),
    topArtists: dashboard.top_artists.items
      .slice(0, 5)
      .map((item) => item.artist_name),
    topTracksLabel: t("stats.topTracks.title"),
    topTracks: dashboard.top_tracks.items.slice(0, 5).map((item) => item.title),
    stats,
    credit: t("stats.digging.credit", { owner }),
  };
}

export function StatsDigging() {
  const page = useStatsPageController();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const { dashboard, t } = page;
  const label = periodLabel(page, i18n.language);
  const kicker = t("stats.digging.kicker", { period: label });
  const owner =
    user?.instagram_handle?.trim() || user?.username || user?.name || "Crate";

  const chapters = useMemo<DiggingChapter[]>(
    () => (dashboard ? buildChapters(dashboard, t, kicker, owner) : []),
    [dashboard, kicker, owner, t],
  );

  const close = () => navigate(`/stats${window.location.search}`);

  if (!dashboard || !dashboard.overview.play_count || !chapters.length) {
    return null;
  }
  return <DiggingStory chapters={chapters} onClose={close} />;
}

function buildChapters(
  dashboard: StatsDashboard,
  t: Translate,
  kicker: string,
  owner: string,
): DiggingChapter[] {
  const chapters: DiggingChapter[] = [];
  const minutes = dashboard.overview.minutes_listened;
  chapters.push({
    key: "minutes",
    label: t("stats.digging.minutes.label"),
    tone: "accent",
    render: () => (
      <div className="stats-digging-body">
        <span className="stats-digging-rings" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p className="stats-digging-kicker">{kicker}</p>
        <CountUpNumber
          value={minutes}
          format={(value) => new Intl.NumberFormat().format(Math.round(value))}
          className="stats-digging-giant"
        />
        <p className="stats-digging-unit">{t("stats.digging.minutes.unit")}</p>
        <p className="stats-digging-copy">
          {t("stats.digging.minutes.body", {
            days: Math.max(1, Math.round(minutes / 1440)),
          })}
        </p>
      </div>
    ),
  });

  const artist = dashboard.artist_of_period;
  if (artist) {
    chapters.push({
      key: "artist",
      label: t("stats.artistOfPeriod.kicker"),
      tone: "photo",
      render: () => (
        <div className="stats-digging-artist">
          <CrateImage
            src={artistPhotoApiUrl(
              {
                artistId: artist.artist_id,
                globalArtistUid: artist.global_artist_uid,
                artistSlug: artist.artist_slug,
                artistName: artist.artist_name,
              },
              { size: 1024 },
            )}
            alt=""
            className="stats-digging-artist-photo"
          />
          <span className="stats-digging-rank" aria-hidden="true">
            01
          </span>
          <div className="stats-digging-artist-text">
            <p className="stats-digging-kicker">
              {t("stats.artistOfPeriod.kicker")}
            </p>
            <h2 className="stats-digging-title stats-digging-rise">
              {artist.artist_name}
            </h2>
            <p className="stats-digging-copy">
              {t("stats.digging.artist.body", {
                plays: artist.plays,
                time: formatStatsMinutes(artist.minutes),
              })}
            </p>
          </div>
        </div>
      ),
    });
  }

  const tracks = dashboard.top_tracks.items.slice(0, 5);
  if (tracks.length) {
    chapters.push({
      key: "tracks",
      label: t("stats.topTracks.title"),
      tone: "dark",
      render: () => (
        <div className="stats-digging-body">
          <p className="stats-digging-kicker">
            {t("stats.digging.tracks.kicker")}
          </p>
          <h2 className="stats-digging-heading stats-digging-rise">
            {t("stats.topTracks.title")}
          </h2>
          <ol className="stats-digging-list">
            {tracks.map((track, position) => {
              const cover = albumCover(track, 256);
              return (
                <li
                  key={`${track.title}-${position}`}
                  style={{ animationDelay: `${200 + position * 120}ms` }}
                >
                  <span className="stats-digging-list-rank">
                    {position + 1}
                  </span>
                  {cover ? <CrateImage src={cover} alt="" /> : <span />}
                  <span className="min-w-0">
                    <strong className="block truncate">{track.title}</strong>
                    <span className="block truncate text-text-muted">
                      {track.artist}
                    </span>
                  </span>
                  <span className="stats-digging-list-count">
                    {track.play_count}×
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ),
    });
  }

  const age = dashboard.music_age;
  if (age) {
    const maxShare = Math.max(0.01, ...age.decades.map((item) => item.share));
    const medianDecade = Math.floor(age.median_year / 10) * 10;
    chapters.push({
      key: "age",
      label: t("stats.musicAge.title"),
      tone: "accent",
      render: () => (
        <div className="stats-digging-body">
          <p className="stats-digging-kicker">{t("stats.musicAge.title")}</p>
          <p className="stats-digging-giant">{age.median_year}</p>
          <p className="stats-digging-copy">
            {t("stats.digging.age.body", { year: age.median_year })}
          </p>
          <div
            className="stats-decades stats-digging-decades"
            aria-hidden="true"
          >
            {age.decades.map((item, position) => (
              <div key={item.decade} className="stats-decade">
                <i
                  data-hot={item.decade === medianDecade ? "true" : undefined}
                  style={{
                    height: `${Math.max(4, (item.share / maxShare) * 100)}%`,
                    animationDelay: `${position * 120}ms`,
                  }}
                />
                <span>{`${String(item.decade).slice(2)}s`}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  }

  const highlights = dashboard.highlights;
  if (highlights?.longest_streak || highlights?.obsession) {
    chapters.push({
      key: "habits",
      label: t("stats.digging.habits.label"),
      tone: "dark",
      render: () => (
        <div className="stats-digging-body">
          <p className="stats-digging-kicker">
            {t("stats.digging.habits.label")}
          </p>
          {highlights.longest_streak ? (
            <>
              <p className="stats-digging-giant">
                {highlights.longest_streak.days}
              </p>
              <p className="stats-digging-unit">
                {t("stats.digging.habits.streak")}
              </p>
            </>
          ) : null}
          {highlights.obsession ? (
            <p className="stats-digging-copy">
              {t("stats.digging.habits.obsession", {
                count: highlights.obsession.plays,
                title: highlights.obsession.track.title ?? "",
              })}
            </p>
          ) : null}
        </div>
      ),
    });
  }

  chapters.push({
    key: "summary",
    label: t("stats.digging.summary.label"),
    tone: "dark",
    render: () => (
      <DiggingSummary
        dashboard={dashboard}
        t={t}
        kicker={kicker}
        owner={owner}
      />
    ),
  });
  return chapters;
}

function DiggingSummary({
  dashboard,
  t,
  kicker,
  owner,
}: {
  dashboard: StatsDashboard;
  t: Translate;
  kicker: string;
  owner: string;
}) {
  const share = buildShareData(dashboard, t, kicker, owner);
  return (
    <div className="stats-digging-body">
      <p className="stats-digging-kicker">{kicker}</p>
      <h2 className="stats-digging-heading stats-digging-rise">
        {share.headline}
      </h2>
      <div className="stats-digging-covers">
        {share.coverUrls.map((url) => (
          <CrateImage key={url} src={url} alt="" />
        ))}
      </div>
      <div className="stats-digging-columns">
        <div>
          <h3>{share.topArtistsLabel}</h3>
          <ol>
            {share.topArtists.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
        </div>
        <div>
          <h3>{share.topTracksLabel}</h3>
          <ol>
            {share.topTracks.map((name, position) => (
              <li key={`${name}-${position}`}>{name}</li>
            ))}
          </ol>
        </div>
      </div>
      <Button
        type="button"
        className="mt-6 self-start"
        onClick={() =>
          openShareSheet({
            kind: "digging",
            title: kicker,
            subtitle: share.headline,
            url: window.location.href,
            imageUrl: share.coverUrls[0] ?? null,
            digging: share,
          })
        }
      >
        <Camera size={CRATE_ICON_SIZE.sm} />
        {t("stats.digging.share")}
      </Button>
    </div>
  );
}
