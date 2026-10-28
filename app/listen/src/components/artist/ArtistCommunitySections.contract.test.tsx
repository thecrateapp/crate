import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { RelatedArtistsSection } from "./ArtistCommunitySections";
import { ArtistShowPrepView } from "./ArtistShowPrepView";
vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(),
  }),
}));
describe("Artist community views", () => {
  it("shows an actual zero match in the real related ArtistCard", () => {
    renderWithListenProviders(
      <RelatedArtistsSection
        artists={[
          { name: "Mixed Case Artist", match: 0, url: "https://example.com" },
        ]}
      />,
    );
    expect(screen.getByText("0% match")).toHaveClass("font-mono", "uppercase");
    expect(screen.getByText("Mixed Case Artist")).not.toHaveClass("uppercase");
  });
  it("renders solid show preparation and preserves details and playback callbacks", () => {
    const onPlay = vi.fn(),
      onDetails = vi.fn();
    const { rerender } = renderWithListenProviders(
      <ArtistShowPrepView
        title="Venue"
        context="Bristol · October 24, 2026"
        hasSetlist
        onPlay={onPlay}
        onDetails={onDetails}
      />,
    );
    expect(
      screen.getByText("Venue").closest('[data-slot="card"]'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Play probable setlist" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View show details" }));
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onDetails).toHaveBeenCalledOnce();
    rerender(
      <ArtistShowPrepView
        title="Venue"
        context="Bristol"
        hasSetlist={false}
        onPlay={onPlay}
        onDetails={onDetails}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Play probable setlist" }),
    ).not.toBeInTheDocument();
  });
});
