import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { HeroActions, HeroGenres } from "./HomeHeroContent";

describe("HeroGenres", () => {
  it("renders the weighted genre profile with percentage badges", () => {
    render(
      <HeroGenres
        hero={{
          id: 7,
          name: "Converge",
          genre_profile: [
            { name: "hip-hop", percent: 100 },
            { name: "rap", percent: 88 },
          ],
          listeners: 0,
          scrobbles: 0,
          album_count: 0,
          track_count: 0,
          bio: "",
        }}
      />,
    );

    expect(screen.getByText("hip-hop")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
  });

  it("keeps rendering legacy genre names when no profile is available", () => {
    render(
      <HeroGenres
        hero={{
          id: 7,
          name: "Converge",
          genres: ["hardcore"],
          listeners: 0,
          scrobbles: 0,
          album_count: 0,
          track_count: 0,
          bio: "",
        }}
      />,
    );

    expect(screen.getByText("hardcore")).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

it("uses canonical hero actions while retaining play/follow callbacks", () => {
  const onPlay = vi.fn(),
    onToggleFollow = vi.fn();
  renderWithListenProviders(
    <HeroActions
      hero={{ name: "Sample" }}
      following={false}
      onPlay={onPlay}
      onToggleFollow={onToggleFollow}
    />,
  );
  const play = screen.getByRole("button", { name: "Play Sample" });
  expect(play.className).not.toMatch(
    /home-discovery-play-button|text-base|font-semibold/,
  );
  play.click();
  expect(onPlay).toHaveBeenCalledOnce();
  screen.getByRole("button", { name: "Follow Sample" }).click();
  expect(onToggleFollow).toHaveBeenCalledOnce();
});
