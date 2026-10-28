import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsMovement } from "./StatsMovement";
import type { StatsStory, StatsStoryArtistSignal } from "./stats-types";

function signal(
  name: string,
  extra: Partial<StatsStoryArtistSignal> = {},
): StatsStoryArtistSignal {
  return {
    artist_name: name,
    artist_slug: name.toLowerCase().replace(/\s+/g, "-"),
    play_count: 10,
    minutes_listened: 30,
    ...extra,
  };
}

function story(parts: Partial<StatsStory> = {}): StatsStory {
  return {
    window: "30d",
    movers: [],
    discoveries: [],
    comebacks: [],
    ...parts,
  } as StatsStory;
}

describe("StatsMovement", () => {
  it("excludes the hero and top three artists", () => {
    renderWithListenProviders(
      <StatsMovement
        scope="personal"
        exclude={["Hero", "Top Two", " Top Three "]}
        story={story({
          movers: [
            signal("Hero", { delta_play_count: 9 }),
            signal("Top Two", { delta_play_count: 8 }),
            signal("Top Three", { delta_play_count: 7 }),
            signal("Riser", { delta_play_count: 6 }),
          ],
          discoveries: [signal("Hero"), signal("Newcomer")],
          comebacks: [signal("top two"), signal("Returner")],
        })}
      />,
    );
    expect(screen.queryByText("Hero")).toBeNull();
    expect(screen.queryByText("Top Two")).toBeNull();
    expect(screen.queryByText("Top Three")).toBeNull();
    expect(screen.getByText("Riser")).toBeInTheDocument();
    expect(screen.getByText("Newcomer")).toBeInTheDocument();
    // Comparison is case-sensitive: "top two" is a different artist.
    expect(screen.getByText("top two")).toBeInTheDocument();
    expect(screen.getByText("Returner")).toBeInTheDocument();
    expect(screen.getByText("+6 plays")).toHaveClass(
      "crate-mono-label",
      "uppercase",
    );
  });

  it("shows only rising on global", () => {
    const { container } = renderWithListenProviders(
      <StatsMovement
        scope="global"
        exclude={[]}
        story={story({
          movers: [signal("Riser", { delta_play_count: 2 })],
          discoveries: [signal("Newcomer")],
          comebacks: [signal("Returner")],
        })}
      />,
    );
    expect(container.querySelector("#movement")).not.toBeNull();
    expect(screen.getByText("Riser")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rising" })).toBeInTheDocument();
    expect(screen.queryByText("Newcomer")).toBeNull();
    expect(screen.queryByText("Returner")).toBeNull();
    expect(screen.queryByRole("heading", { name: "New blood" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Comeback" })).toBeNull();
  });

  it("lands the #movement jump below the fixed Listen header", () => {
    // The shell header is position: fixed over a document-scrolling page, so
    // the anchor target clears it with the shell's own page-top metric.
    const { container } = renderWithListenProviders(
      <StatsMovement scope="personal" exclude={[]} story={story({})} />,
    );
    expect(container.querySelector("#movement")).toHaveClass(
      "scroll-mt-(--listen-mobile-page-top)",
    );
  });

  it("shows empty copy per column", () => {
    renderWithListenProviders(
      <StatsMovement scope="personal" exclude={[]} story={story()} />,
    );
    expect(screen.getByText("No surge yet")).toBeInTheDocument();
    expect(screen.getByText("No new obsession yet")).toBeInTheDocument();
    expect(screen.getByText("No comeback yet")).toBeInTheDocument();
  });

  it("links each artist from its column", () => {
    renderWithListenProviders(
      <StatsMovement
        scope="personal"
        exclude={[]}
        story={story({ movers: [signal("Riser", { delta_play_count: 2 })] })}
      />,
    );
    const rising = screen
      .getByRole("heading", { name: "Rising" })
      .closest("section") as HTMLElement;
    expect(within(rising).getByRole("link", { name: /Riser/ })).toHaveAttribute(
      "href",
      expect.stringContaining("riser"),
    );
  });

  it("keeps only real gains in rising", () => {
    renderWithListenProviders(
      <StatsMovement
        scope="personal"
        exclude={[]}
        story={story({
          movers: [
            signal("Zero", { delta_play_count: 0 }),
            signal("Negative", { delta_play_count: -3 }),
            signal("Missing"),
            signal("Gain", { delta_play_count: 1 }),
          ],
        })}
      />,
    );
    expect(screen.queryByText("Zero")).toBeNull();
    expect(screen.queryByText("Negative")).toBeNull();
    expect(screen.queryByText("Missing")).toBeNull();
    expect(screen.getByText("Gain")).toBeInTheDocument();
    expect(screen.getByText("+1 play")).toBeInTheDocument();
  });

  it("shows the empty copy when no mover gained plays", () => {
    renderWithListenProviders(
      <StatsMovement
        scope="global"
        exclude={[]}
        story={story({
          movers: [
            signal("Zero", { delta_play_count: 0 }),
            signal("Negative", { delta_play_count: -3 }),
          ],
        })}
      />,
    );
    expect(screen.queryByText("Zero")).toBeNull();
    expect(screen.queryByText("Negative")).toBeNull();
    expect(screen.getByText("No surge yet")).toBeInTheDocument();
  });
});
