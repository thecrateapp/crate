import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import {
  BrowseDetailFrame,
  ExploreDecades,
  ExploreMoodChoices,
} from "./ExploreBrowseViews";

describe("Explore choices and context", () => {
  it("treats decade chips as navigation actions rather than pressed filters", () => {
    const onOpen = vi.fn();
    renderWithListenProviders(
      <ExploreDecades decades={["1990s"]} onOpen={onOpen} />,
    );
    const decade = screen.getByRole("button", { name: "1990s" });
    expect(decade).not.toHaveAttribute("aria-pressed");
    fireEvent.click(decade);
    expect(onOpen).toHaveBeenCalledWith("1990s");
  });
  it("keeps zero mood counts and blocks every mood while one request is pending", () => {
    const onPlay = vi.fn();
    const moods = [
      { name: "dark", track_count: 0 },
      { name: "chill", track_count: 2 },
    ];
    const { rerender } = renderWithListenProviders(
      <ExploreMoodChoices moods={moods} pending={null} onPlay={onPlay} />,
    );
    expect(screen.getByText("0 tracks")).toHaveClass("uppercase", "font-mono");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onPlay).toHaveBeenCalledWith("dark");
    rerender(
      <ExploreMoodChoices moods={moods} pending="dark" onPlay={onPlay} />,
    );
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });
  it("keeps category identity casing and places zero counts in the mono context role", () => {
    const onBack = vi.fn();
    renderWithListenProviders(
      <BrowseDetailFrame title="LoFi / DIY" count="0 playlists" onBack={onBack}>
        <p>Empty library</p>
      </BrowseDetailFrame>,
    );
    expect(
      screen.getByRole("heading", { name: "LoFi / DIY" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 playlists")).toHaveClass(
      "uppercase",
      "font-mono",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
