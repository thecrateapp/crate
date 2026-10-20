import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Card } from "@crate/ui/shadcn/card";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";

import type { StatsGenreTrend } from "./stats-types";

export function StatsGenreTrendView({
  genres,
  onGenreSelect,
}: {
  genres: StatsGenreTrend[];
  onGenreSelect: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const rising = genres
    .filter((genre) => (genre.delta_vs_previous ?? 0) > 0.005)
    .sort((a, b) => (b.delta_vs_previous ?? 0) - (a.delta_vs_previous ?? 0))[0];

  return (
    <Card className="gap-4 p-5">
      <MonoLabel as="h3" tone="accent">
        {t("stats.genreTrend.title")}
      </MonoLabel>
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
              genre.slug ? () => onGenreSelect(genre.slug as string) : undefined
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
    </Card>
  );
}
