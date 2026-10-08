import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildStatsGenreProfile,
  type StatsGenre,
} from "@/components/stats/stats-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { SoundProfileCard } from "./StatsAnalyticsSections";

const navigate = vi.fn();

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));

const profile = { energy: 0.5, danceability: 0.4, valence: 0.3, bpm: 120 };

function genre(overrides: Partial<StatsGenre>): StatsGenre {
  return {
    genre_name: "punk",
    play_count: 1,
    complete_play_count: 1,
    minutes_listened: 3,
    ...overrides,
  };
}

describe("buildStatsGenreProfile", () => {
  it("uses server shares and slugs sorted by share", () => {
    const items = buildStatsGenreProfile([
      genre({ genre_name: "post-punk", slug: "post-punk", share: 0.2 }),
      genre({ genre_name: "punk", slug: "punk", share: 0.5 }),
    ]);

    expect(items).toEqual([
      { name: "punk", slug: "punk", share: 0.5 },
      { name: "post-punk", slug: "post-punk", share: 0.2 },
    ]);
  });

  it("splits legacy comma-joined genres and weights them by plays", () => {
    const items = buildStatsGenreProfile([
      genre({ genre_name: "post-punk, Punk Rock", play_count: 6 }),
      genre({ genre_name: "punk rock", play_count: 3 }),
      genre({ genre_name: "shoegaze", play_count: 3 }),
    ]);

    expect(items.map((item) => [item.name, item.share])).toEqual([
      ["Punk Rock", 0.5],
      ["post-punk", 0.25],
      ["shoegaze", 0.25],
    ]);
    expect(items.every((item) => !item.slug)).toBe(true);
  });

  it("caps the profile at eight genres", () => {
    const genres = Array.from({ length: 12 }, (_, index) =>
      genre({ genre_name: `genre ${index}`, play_count: 12 - index }),
    );

    expect(buildStatsGenreProfile(genres)).toHaveLength(8);
  });
});

describe("SoundProfileCard", () => {
  it("renders shared genre pills with percentages and links to genre pages", () => {
    renderWithListenProviders(
      <SoundProfileCard
        profile={profile}
        skipRate={0.1}
        genres={[
          genre({ genre_name: "Shoegaze", slug: "shoegaze", share: 0.314 }),
          genre({ genre_name: "Post-Punk", slug: "post-punk", share: 0.12 }),
        ]}
      />,
    );

    const pill = screen.getByRole("button", { name: /shoegaze/ });
    expect(pill).toHaveClass("genre-pill");
    expect(screen.getByText("31%")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();

    fireEvent.click(pill);
    expect(navigate).toHaveBeenCalledWith("/explore?genre=shoegaze");
  });

  it("falls back to client-side shares for legacy snapshots", () => {
    renderWithListenProviders(
      <SoundProfileCard
        profile={profile}
        skipRate={0}
        genres={[
          genre({ genre_name: "post-punk, punk rock", play_count: 2 }),
          genre({ genre_name: "punk rock", play_count: 2 }),
        ]}
      />,
    );

    expect(screen.getByTitle("punk rock · 75%")).toHaveClass("genre-pill");
    expect(screen.getByTitle("post-punk · 25%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /punk/ })).toBeNull();
  });
});
