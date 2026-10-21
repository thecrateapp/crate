import { useTranslation } from "react-i18next";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Meter } from "@crate/ui/primitives/Meter";
import { Card } from "@crate/ui/shadcn/card";
import { MiniStat } from "./StatsAnalyticsPrimitives";
import type { SoundProfile } from "./stats-page-model";
import { formatStatsPercent } from "../components/stats/stats-format";

const METRIC_FIELD = {
  energy: "energy",
  movement: "danceability",
  brightness: "valence",
} as const;

export function StatsSoundProfileView({
  profile,
  genres,
  skipRate,
  hideGenres = false,
  onGenreSelect,
  previousProfile = null,
  favourite = null,
}: {
  profile: SoundProfile;
  /** Previous-period reading; only passed when the current one is a server reading. */
  previousProfile?: SoundProfile | null;
  /** The top track with the highest energy, when any is analysed. */
  favourite?: { title: string; artist: string } | null;
  genres: GenreProfileItem[];
  skipRate: number;
  hideGenres?: boolean;
  onGenreSelect?: (genre: GenreProfileItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="gap-0 p-5">
      <InstrumentPanel
        as="section"
        headingLevel={3}
        ruled={false}
        label={{ children: t("stats.soundProfile.title"), tone: "accent" }}
      >
        <div className="grid gap-4">
          {(
            [
              ["energy", profile.energy],
              ["movement", profile.danceability],
              ["brightness", profile.valence],
            ] as const
          ).map(([key, value]) => {
            const previous = previousProfile?.[METRIC_FIELD[key]] ?? null;
            return (
              <div key={key} className="grid gap-1">
                {/* R26: unknown analysis goes through Meter's shared null contract
                    (empty rail, "n/a"). The spec asks for "—", but Meter hard-codes
                    "n/a" and v3 forbids a local copy of its markup; raised with Diego. */}
                <Meter
                  label={t(`stats.soundProfile.${key}`)}
                  value={value}
                  max={1}
                  limit={previous ?? undefined}
                  valueText={value == null ? "" : formatStatsPercent(value)}
                />
                {previous != null ? (
                  <MonoLabel as="span" className="justify-self-end">
                    {t("stats.soundProfile.previous", {
                      value: formatStatsPercent(previous),
                    })}
                  </MonoLabel>
                ) : null}
              </div>
            );
          })}
        </div>
        {favourite ? (
          <p className="mt-4 text-sm text-text-secondary">
            {t("stats.soundProfile.favourite", {
              title: favourite.title,
              artist: favourite.artist,
            })}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniStat
            label={t("stats.soundProfile.avgBpm")}
            value={profile.bpm != null ? String(profile.bpm) : "—"}
          />
          <MiniStat
            label={t("stats.soundProfile.skipRate")}
            value={formatStatsPercent(skipRate)}
          />
        </div>
        {hideGenres ? null : genres.length ? (
          <GenrePillRow
            items={genres}
            max={8}
            className="mt-5"
            onSelect={onGenreSelect}
          />
        ) : (
          <p className="mt-5 text-sm text-text-muted">
            {t("stats.soundProfile.genreEmpty")}
          </p>
        )}
      </InstrumentPanel>
    </Card>
  );
}
