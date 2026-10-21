import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { type GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

import type { SoundProfile } from "@/pages/stats-page-model";
import { genrePagePath } from "@/components/actions/genre-actions";
import {
  buildStatsGenreProfile,
  type StatsGenre,
} from "@/components/stats/stats-model";
import { StatsSoundProfileView } from "./StatsSoundProfileView";

export { MiniStat } from "./StatsAnalyticsPrimitives";

export function SoundProfileCard({
  profile,
  genres,
  skipRate,
  hideGenres = false,
  previousProfile,
  favourite,
}: {
  profile: SoundProfile;
  previousProfile?: SoundProfile | null;
  favourite?: { title: string; artist: string } | null;
  genres: StatsGenre[];
  skipRate: number;
  hideGenres?: boolean;
}) {
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
    <StatsSoundProfileView
      profile={profile}
      previousProfile={previousProfile}
      favourite={favourite}
      genres={genreProfile}
      skipRate={skipRate}
      hideGenres={hideGenres}
      onGenreSelect={hasGenreLinks ? openGenre : undefined}
    />
  );
}
