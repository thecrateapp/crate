import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Card } from "@crate/ui/shadcn/card";
import { CountUpNumber } from "./CountUpNumber";
import { formatStatsMinutes, formatStatsPercent } from "./stats-format";
import type { StatsHighlights as Highlights } from "./stats-types";

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

export function StatsHighlightsView({
  highlights,
  obsessionArtwork,
}: {
  highlights: Highlights;
  obsessionArtwork?: ReactNode;
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

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {streak ? (
        <HighlightCard label={t("stats.highlights.longestStreak")}>
          <StatNumber
            size="md"
            value={<CountUpNumber value={streak.days} format={formatInteger} />}
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
        <ObsessionCard obsession={obsession} artwork={obsessionArtwork} />
      ) : null}
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
    <Card className="gap-2 p-5">
      <MonoLabel tone="accent">{label}</MonoLabel>
      <div className="space-y-1">{children}</div>
    </Card>
  );
}

function ObsessionCard({
  obsession,
  artwork,
}: {
  obsession: NonNullable<Highlights["obsession"]>;
  artwork?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const track = obsession.track;
  return (
    <Card className="flex-row items-start gap-4 p-5">
      {artwork}
      <div className="min-w-0">
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
    </Card>
  );
}
