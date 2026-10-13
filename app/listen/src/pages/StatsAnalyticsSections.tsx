import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";

import type { SoundProfile } from "@/pages/stats-page-model";
import { genrePagePath } from "@/components/actions/genre-actions";
import {
  buildStatsGenreProfile,
  formatStatsPercent,
  type StatsGenre,
} from "@/components/stats/stats-model";
import { MiniStat } from "./StatsAnalyticsPrimitives";

export { MiniStat } from "./StatsAnalyticsPrimitives";

export function SoundProfileCard({
  profile,
  genres,
  skipRate,
  hideGenres = false,
}: {
  profile: SoundProfile;
  genres: StatsGenre[];
  skipRate: number;
  hideGenres?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const genreProfile = useMemo(() => buildStatsGenreProfile(genres), [genres]);
  const hasGenreLinks = genreProfile.some((genre) => genre.slug);
  const openGenre = useCallback(
    (genre: GenreProfileItem) => {
      if (genre.slug) navigate(genrePagePath(genre.slug));
    },
    [navigate],
  );

  return (
    <div className="stats-card rounded-panel p-5">
      <h3 className="mb-4 text-sm font-semibold text-accent-action">
        {t("stats.soundProfile.title")}
      </h3>

      <div className="space-y-4">
        <ProfileBar
          label={t("stats.soundProfile.energy")}
          value={profile.energy}
        />
        <ProfileBar
          label={t("stats.soundProfile.movement")}
          value={profile.danceability}
        />
        <ProfileBar
          label={t("stats.soundProfile.brightness")}
          value={profile.valence}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("stats.soundProfile.avgBpm")}
          value={profile.bpm ? String(profile.bpm) : "—"}
        />
        <MiniStat
          label={t("stats.soundProfile.skipRate")}
          value={formatStatsPercent(skipRate)}
        />
      </div>

      {hideGenres ? null : genreProfile.length ? (
        <GenrePillRow
          items={genreProfile}
          max={8}
          className="mt-5"
          onSelect={hasGenreLinks ? openGenre : undefined}
        />
      ) : (
        <p className="mt-5 text-sm text-text-muted">
          {t("stats.soundProfile.genreEmpty")}
        </p>
      )}
    </div>
  );
}

function ProfileBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{percent}%</span>
      </div>
      <div className="stats-profile-track h-1 overflow-hidden rounded-sm">
        <div
          className="stats-profile-fill h-full"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}
