import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";

import { genrePagePath } from "@/components/actions/genre-actions";
import type { StatsGenreTrend } from "@/components/stats/stats-model";

export function StatsGenreTrendCard({ genres }: { genres: StatsGenreTrend[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rising = genres
    .filter((genre) => (genre.delta_vs_previous ?? 0) > 0.005)
    .sort((a, b) => (b.delta_vs_previous ?? 0) - (a.delta_vs_previous ?? 0))[0];

  return (
    <div className="stats-card rounded-panel p-5">
      <h3 className="text-sm font-semibold text-accent-action">
        {t("stats.genreTrend.title")}
      </h3>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {genres.map((genre) => (
          <GenrePill
            key={genre.genre_name}
            item={{
              name: genre.genre_name,
              slug: genre.slug,
              share: genre.share,
            }}
            onClick={
              genre.slug
                ? () => navigate(genrePagePath(genre.slug as string))
                : undefined
            }
          />
        ))}
      </div>
      {rising ? (
        <p className="mt-4 text-sm text-text-secondary">
          {t("stats.genreTrend.rising", {
            genre: rising.genre_name.toLowerCase(),
            points: Math.round((rising.delta_vs_previous ?? 0) * 100),
          })}
        </p>
      ) : null}
    </div>
  );
}
