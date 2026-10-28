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
  it("uses a canonical meter with a true empty rail for a confirmed zero", () => {
    renderWithListenProviders(
      <SoundProfileCard
        profile={{ ...profile, energy: 0 }}
        skipRate={0}
        genres={[]}
      />,
    );
    expect(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByRole("meter", { name: "Energy" })).toHaveAttribute(
      "aria-valuemax",
      "1",
    );
  });

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

    expect(screen.getByText("punk rock").closest(".genre-pill")!).toHaveClass(
      "genre-pill",
    );
    expect(
      screen.getByText("post-punk").closest(".genre-pill")!,
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /punk/ })).toBeNull();
  });

  it("marks the previous sound profile", () => {
    renderWithListenProviders(
      <SoundProfileCard
        profile={profile}
        previousProfile={{
          energy: 0.3,
          danceability: 0,
          valence: null,
          bpm: 118,
        }}
        favourite={{ title: "Wild Thing", artist: "Converge" }}
        skipRate={0}
        genres={[]}
      />,
    );

    expect(screen.getByText("Previous period 30%")).toBeInTheDocument();
    expect(screen.getByText("Previous period 0%")).toBeInTheDocument();
    expect(screen.getAllByText(/^Previous period/)).toHaveLength(2);
    expect(
      screen.getByText("Your most energetic favourite: Wild Thing by Converge"),
    ).toBeInTheDocument();
  });

  it("shows no previous marker or favourite without them", () => {
    renderWithListenProviders(
      <SoundProfileCard profile={profile} skipRate={0} genres={[]} />,
    );

    expect(screen.queryByText(/^Previous period/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/most energetic favourite/),
    ).not.toBeInTheDocument();
  });

  it("renders unknown audio values as a dash", () => {
    // R26: the shared Meter shows "n/a" for unknown values, not "—".
    const { container } = renderWithListenProviders(
      <SoundProfileCard
        profile={{ energy: null, danceability: 0, valence: null, bpm: null }}
        skipRate={0}
        genres={[]}
      />,
    );

    expect(screen.queryByRole("meter", { name: "Energy" })).toBeNull();
    expect(
      screen.getByRole("group", { name: "Energy" }),
    ).toHaveAccessibleDescription("n/a");
    expect(
      screen.getByRole("group", { name: "Brightness" }),
    ).toHaveAccessibleDescription("n/a");
    expect(screen.getAllByText("n/a")).toHaveLength(2);
    // only the real zero (movement) and the skip rate read 0%
    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(container.querySelectorAll(".crate-meter-fill")).toHaveLength(1);
    expect(screen.getByRole("meter", { name: "Movement" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("places the previous marker at the previous value", () => {
    const { container } = renderWithListenProviders(
      <SoundProfileCard
        profile={profile}
        previousProfile={{
          energy: 0.3,
          danceability: 0,
          valence: null,
          bpm: null,
        }}
        skipRate={0}
        genres={[]}
      />,
    );

    const ticks = container.querySelectorAll<HTMLElement>(".crate-meter-limit");
    expect(Array.from(ticks, (tick) => tick.style.left)).toEqual(["30%", "0%"]);
  });
});
