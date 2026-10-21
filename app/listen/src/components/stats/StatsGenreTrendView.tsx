import { useTranslation } from "react-i18next";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Card } from "@crate/ui/shadcn/card";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";

import type { StatsGenreTrend } from "./stats-types";

/** Signed points for a share fraction; the sign lives in the value (U+2212 for loss). */
function formatGenreDelta(delta: number | null | undefined): string | null {
  if (delta == null) return null;
  const points = Math.round(delta * 100);
  if (points > 0) return `+${points}`;
  if (points < 0) return `\u2212${Math.abs(points)}`;
  return "0";
}

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
      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-2">
        {genres.map((genre) => {
          const delta = formatGenreDelta(genre.delta_vs_previous);
          return (
            <li
              key={genre.genre_name}
              className="flex min-w-0 items-center gap-2"
              data-faller={genre.faller ? "true" : undefined}
            >
              <GenrePill
                item={{
                  name: genre.genre_name,
                  slug: genre.slug,
                  share: genre.share,
                }}
                onClick={
                  genre.slug
                    ? () => onGenreSelect(genre.slug as string)
                    : undefined
                }
              />
              {delta ? (
                <MonoLabel as="span">
                  {t("stats.genreTrend.delta", { delta })}
                </MonoLabel>
              ) : null}
              {genre.faller ? (
                <MonoLabel as="span">{t("stats.genreTrend.falling")}</MonoLabel>
              ) : null}
            </li>
          );
        })}
      </ul>
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
