import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsGenreTrendView } from "./StatsGenreTrendView";
import type { StatsGenreTrend } from "./stats-types";

describe("StatsGenreTrendView", () => {
  it("shows genre direction and the biggest faller", () => {
    const genres: StatsGenreTrend[] = [
      {
        genre_name: "Metalcore",
        slug: "metalcore",
        share: 0.34,
        delta_vs_previous: 0.09,
      },
      {
        genre_name: "Post-Rock",
        slug: "post-rock",
        share: 0.2,
        delta_vs_previous: -0.04,
      },
      {
        genre_name: "Shoegaze",
        slug: "shoegaze",
        share: 0.1,
        delta_vs_previous: 0,
      },
      {
        genre_name: "Folk",
        slug: "folk",
        share: 0.05,
        delta_vs_previous: null,
      },
      {
        genre_name: "Hardcore",
        slug: "hardcore",
        share: 0,
        delta_vs_previous: -0.12,
        faller: true,
      },
    ];
    renderWithListenProviders(
      <StatsGenreTrendView genres={genres} onGenreSelect={() => {}} />,
    );

    expect(screen.getByText("+9 pts")).toBeInTheDocument();
    expect(screen.getByText("−4 pts")).toBeInTheDocument();
    expect(screen.getByText("0 pts")).toBeInTheDocument();
    const faller = screen.getByText("−12 pts").closest("li");
    expect(faller).toHaveTextContent("hardcore");
    expect(faller).toHaveTextContent("Falling");
    // an unknown delta shows no direction at all
    expect(screen.getAllByText(/pts$/)).toHaveLength(4);
    expect(screen.getAllByText("Falling")).toHaveLength(1);
  });
});
