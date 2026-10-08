import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { CountUpNumber } from "@/components/stats/CountUpNumber";
import {
  formatStatsMinutes,
  formatStatsPercent,
  type StatsHighlights as Highlights,
} from "@/components/stats/stats-model";
import { albumCoverApiUrl } from "@/lib/library-routes";

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

export function StatsHighlights({ highlights }: { highlights: Highlights }) {
  const { t, i18n } = useTranslation();
  const formatInteger = useCallback(
    (value: number) => String(Math.round(value)),
    [],
  );
  const streak = highlights.longest_streak;
  const newArtists = highlights.new_artists;
  const session = highlights.longest_session;
  const obsession = highlights.obsession;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {streak ? (
        <HighlightCard label={t("stats.highlights.longestStreak")}>
          <CountUpNumber
            value={streak.days}
            format={formatInteger}
            className="stats-highlight-value"
          />
          <p className="text-xs text-text-muted">
            {t("stats.highlights.streakDetail", {
              count: highlights.current_streak?.days ?? 0,
            })}
          </p>
        </HighlightCard>
      ) : null}
      {newArtists ? (
        <HighlightCard label={t("stats.highlights.newArtists")}>
          <CountUpNumber
            value={newArtists.count}
            format={formatInteger}
            className="stats-highlight-value"
          />
          <p className="text-xs text-text-muted">
            {t("stats.highlights.newArtistsDetail", {
              share: formatStatsPercent(newArtists.share),
            })}
          </p>
        </HighlightCard>
      ) : null}
      {session ? (
        <HighlightCard label={t("stats.highlights.longestSession")}>
          <span className="stats-highlight-value">
            {formatStatsMinutes(session.minutes)}
          </span>
          <p className="text-xs text-text-muted">
            {t("stats.highlights.sessionDetail", {
              date: formatDay(session.started_at, i18n.language),
              count: session.track_count,
            })}
          </p>
        </HighlightCard>
      ) : null}
      {obsession ? <ObsessionCard obsession={obsession} /> : null}
    </div>
  );
}

function HighlightCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stats-card rounded-panel p-5">
      <div className="text-xs font-semibold text-accent-action">{label}</div>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function ObsessionCard({
  obsession,
}: {
  obsession: NonNullable<Highlights["obsession"]>;
}) {
  const { t, i18n } = useTranslation();
  const track = obsession.track;
  const cover = track.album
    ? albumCoverApiUrl(
        {
          albumId: track.album_id,
          globalAlbumUid: track.global_album_uid,
          albumName: track.album,
          artistName: track.artist,
        },
        { size: 256 },
      )
    : null;

  return (
    <div className="stats-card flex gap-4 rounded-panel p-5">
      {cover ? (
        <CrateImage
          src={cover}
          alt=""
          className="size-20 shrink-0 rounded-md object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-accent-action">
          {t("stats.highlights.obsession")}
        </div>
        <div className="mt-1 truncate font-bold text-text-primary">
          {track.title}
        </div>
        <div className="truncate text-xs text-text-muted">{track.artist}</div>
        <div className="stats-highlight-value text-accent-action">
          {obsession.plays}×
        </div>
        <div className="text-xs text-text-muted">
          {t("stats.highlights.obsessionDetail", {
            date: formatDay(obsession.day, i18n.language),
          })}
        </div>
      </div>
    </div>
  );
}
