import { Fragment, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Camera, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { CountUpNumber } from "../CountUpNumber";
import { formatStatsMinutes } from "../stats-format";
import type {
  StatsDashboard,
  StatsArtistOfPeriod,
  StatsMusicAge,
} from "../stats-types";
import type { DiggingChapter } from "./DiggingStory";
type Translate = TFunction;
type Album = StatsDashboard["top_albums"]["items"][number];
export interface DiggingMedia {
  albumCover: (
    item: Pick<Album, "album" | "artist" | "album_id" | "global_album_uid">,
    size: number,
  ) => string | null;
  renderImage: (src: string) => ReactNode;
  renderArtist: (artist: StatsArtistOfPeriod) => ReactNode;
  renderDecades: (age: StatsMusicAge) => ReactNode;
}
export function buildDiggingShareData(
  dashboard: StatsDashboard,
  t: Translate,
  kicker: string,
  owner: string,
  media: DiggingMedia,
) {
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
      .map((item) => media.albumCover(item, 512))
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

export function buildDiggingChapters(
  dashboard: StatsDashboard,
  t: Translate,
  kicker: string,
  owner: string,
  media: DiggingMedia,
  onShare: (summary: ReturnType<typeof buildDiggingShareData>) => void,
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
        <MonoLabel tone="accent">{kicker}</MonoLabel>
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
          {media.renderArtist(artist)}
          <span className="stats-digging-rank" aria-hidden="true">
            01
          </span>
          <div className="stats-digging-artist-text">
            <MonoLabel tone="accent">
              {t("stats.artistOfPeriod.kicker")}
            </MonoLabel>
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
          <MonoLabel tone="accent">
            {t("stats.digging.tracks.kicker")}
          </MonoLabel>
          <h2 className="stats-digging-heading stats-digging-rise">
            {t("stats.topTracks.title")}
          </h2>
          <ol className="stats-digging-list">
            {tracks.map((track, position) => {
              const cover = media.albumCover(track, 256);
              return (
                <li
                  key={`${track.title}-${position}`}
                  style={{ animationDelay: `${200 + position * 120}ms` }}
                >
                  <span className="stats-digging-list-rank">
                    {position + 1}
                  </span>
                  {cover ? (
                    media.renderImage(cover)
                  ) : (
                    <MediaCover alt="" className="size-12" />
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate">{track.title}</strong>
                    <span className="block truncate text-text-muted">
                      {track.artist}
                    </span>
                  </span>
                  <MonoLabel as="span">{track.play_count}×</MonoLabel>
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
    chapters.push({
      key: "age",
      label: t("stats.musicAge.title"),
      tone: "accent",
      render: () => (
        <div className="stats-digging-body">
          <MonoLabel tone="accent">{t("stats.musicAge.title")}</MonoLabel>
          <p className="stats-digging-giant">{age.median_year}</p>
          <p className="stats-digging-copy">
            {t("stats.digging.age.body", { year: age.median_year })}
          </p>
          {media.renderDecades(age)}
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
          <MonoLabel tone="accent">{t("stats.digging.habits.label")}</MonoLabel>
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
        media={media}
        onShare={onShare}
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
  media,
  onShare,
}: {
  dashboard: StatsDashboard;
  t: Translate;
  kicker: string;
  owner: string;
  media: DiggingMedia;
  onShare: (summary: ReturnType<typeof buildDiggingShareData>) => void;
}) {
  const share = buildDiggingShareData(dashboard, t, kicker, owner, media);
  return (
    <div className="stats-digging-body">
      <MonoLabel tone="accent">{kicker}</MonoLabel>
      <h2 className="stats-digging-heading stats-digging-rise">
        {share.headline}
      </h2>
      <div className="stats-digging-covers">
        {share.coverUrls.map((url) => (
          <Fragment key={url}>{media.renderImage(url)}</Fragment>
        ))}
      </div>
      <div className="stats-digging-columns">
        <div>
          <MonoLabel as="h3" tone="accent">
            {share.topArtistsLabel}
          </MonoLabel>
          <ol>
            {share.topArtists.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
        </div>
        <div>
          <MonoLabel as="h3" tone="accent">
            {share.topTracksLabel}
          </MonoLabel>
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
        onClick={() => onShare(share)}
      >
        <Camera size={CRATE_ICON_SIZE.sm} />
        {t("stats.digging.share")}
      </Button>
    </div>
  );
}
