import { useNavigate } from "react-router";
import { genrePagePath } from "@/components/actions/genre-actions";
import { StatsGenreTrendView } from "./StatsGenreTrendView";
import type { StatsGenreTrend } from "./stats-types";
export function StatsGenreTrendCard({ genres }: { genres: StatsGenreTrend[] }) {
  const navigate = useNavigate();
  return (
    <StatsGenreTrendView
      genres={genres}
      onGenreSelect={(slug) => navigate(genrePagePath(slug))}
    />
  );
}
