import { useTranslation } from "react-i18next";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { Meter } from "@crate/ui/primitives/Meter";
import { Card } from "@crate/ui/shadcn/card";
import { MiniStat } from "./StatsAnalyticsPrimitives";
import type { SoundProfile } from "./stats-page-model";
import { formatStatsPercent } from "../components/stats/stats-format";

export function StatsSoundProfileView({
  profile,
  genres,
  skipRate,
  hideGenres = false,
  onGenreSelect,
}: {
  profile: SoundProfile;
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
          ).map(([key, value]) => (
            <Meter
              key={key}
              label={t(`stats.soundProfile.${key}`)}
              value={value ?? Number.NaN}
              max={1}
              valueText={value == null ? "—" : formatStatsPercent(value)}
            />
          ))}
        </div>
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
