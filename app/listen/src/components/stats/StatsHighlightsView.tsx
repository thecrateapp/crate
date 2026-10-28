import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { CRATE_ICON_SIZE, Play } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Card } from "@crate/ui/shadcn/card";
import { CountUpNumber } from "./CountUpNumber";
import { formatStatsMinutes, formatStatsPercent } from "./stats-format";
import type { StatsHighlights as Highlights } from "./stats-types";

function formatDay(
  value: string | null | undefined,
  locale: string,
  withYear = false,
) {
  if (!value) return "";
  const date =
    value.length > 10 ? new Date(value) : new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    ...(value.length > 10 ? {} : { timeZone: "UTC" }),
  });
}

export function StatsHighlightsView({
  highlights,
  obsessionArtwork,
  onPlayObsession,
  allTime = false,
  newArtistsHref,
}: {
  highlights: Highlights;
  obsessionArtwork?: ReactNode;
  /** Plays the obsession track; the adapter owns the player. */
  onPlayObsession?: () => void;
  /** All-time selection: streak dates always carry their year. */
  allTime?: boolean;
  /**
   * Where the New artists card jumps to; omitted, the card is not a link.
   * The page passes `#movement` only while the New column shows someone.
   */
  newArtistsHref?: string;
}) {
  const { t, i18n } = useTranslation();
  const formatInteger = useCallback(
    (value: number) => String(Math.round(value)),
    [],
  );
  const streak = highlights.longest_streak;
  const newArtists = highlights.new_artists;
  const session = highlights.longest_session;
  const obsession = highlights.obsession;
  const withYear =
    allTime ||
    (streak?.start != null &&
      streak.end != null &&
      streak.start.slice(0, 4) !== streak.end.slice(0, 4));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {streak ? (
        <HighlightCard label={t("stats.highlights.longestStreak")}>
          <StatNumber
            size="md"
            value={<CountUpNumber value={streak.days} format={formatInteger} />}
          />
          {streak.start && streak.end ? (
            <p className="text-xs text-text-primary">
              {t("stats.highlights.streakRange", {
                start: formatDay(streak.start, i18n.language, withYear),
                end: formatDay(streak.end, i18n.language, withYear),
              })}
            </p>
          ) : null}
          <p className="text-xs text-text-muted">
            {t("stats.highlights.streakDetail", {
              count: highlights.current_streak?.days ?? 0,
            })}
          </p>
        </HighlightCard>
      ) : null}
      {newArtists ? (
        <HighlightCard
          label={t("stats.highlights.newArtists")}
          href={newArtistsHref}
        >
          <StatNumber
            size="md"
            value={
              <CountUpNumber value={newArtists.count} format={formatInteger} />
            }
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
          <StatNumber size="md" value={formatStatsMinutes(session.minutes)} />
          <p className="text-xs text-text-muted">
            {t("stats.highlights.sessionDetail", {
              date: formatDay(session.started_at, i18n.language),
              count: session.track_count,
            })}
          </p>
        </HighlightCard>
      ) : null}
      {obsession ? (
        <ObsessionCard
          obsession={obsession}
          artwork={obsessionArtwork}
          onPlay={onPlayObsession}
        />
      ) : null}
    </div>
  );
}

function HighlightCard({
  label,
  href,
  children,
}: {
  label: string;
  /** In-page anchor; the whole card becomes the link. */
  href?: string;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <MonoLabel tone="accent">{label}</MonoLabel>
      <div className="space-y-1">{children}</div>
    </>
  );
  return (
    <Card className="gap-2 p-5">
      {href ? (
        <a
          href={href}
          className="flex flex-col gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-border-focus"
        >
          {content}
        </a>
      ) : (
        content
      )}
    </Card>
  );
}

function ObsessionCard({
  obsession,
  artwork,
  onPlay,
}: {
  obsession: NonNullable<Highlights["obsession"]>;
  artwork?: ReactNode;
  onPlay?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const track = obsession.track;
  return (
    <Card className="flex-row items-start gap-4 p-5">
      {artwork}
      <div className="min-w-0 flex-1">
        <MonoLabel tone="accent">{t("stats.highlights.obsession")}</MonoLabel>
        <div className="mt-1 truncate font-bold text-text-primary">
          {track.title}
        </div>
        <div className="truncate text-xs text-text-muted">{track.artist}</div>
        <StatNumber size="md" value={`${obsession.plays}×`} />
        <div className="text-xs text-text-muted">
          {t("stats.highlights.obsessionDetail", {
            date: formatDay(obsession.day, i18n.language),
          })}
        </div>
      </div>
      {onPlay && track.track_id != null ? (
        <ActionIconButton
          variant="card"
          aria-label={t("stats.highlights.playObsession", {
            title: track.title ?? "",
          })}
          onClick={onPlay}
        >
          <Play size={CRATE_ICON_SIZE.sm} />
        </ActionIconButton>
      ) : null}
    </Card>
  );
}
