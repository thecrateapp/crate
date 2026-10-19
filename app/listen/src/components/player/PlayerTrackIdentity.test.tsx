import { fireEvent, screen } from "@testing-library/react";
import { renderWithListenProviders as render } from "@/test/render-with-listen-providers";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: (props: { alt: string; src?: string }) => (
    <img data-testid="crate-image" {...props} />
  ),
}));

import { PlayerTrackIdentity } from "./PlayerTrackIdentity";

const track: Track = {
  id: "track-1",
  title: "Track One",
  artist: "Artist One",
  album: "Album One",
};

describe("PlayerTrackIdentity", () => {
  it("uses semantic tokens for track metadata and artist badge", () => {
    render(
      <PlayerTrackIdentity
        currentTrack={track}
        crossfadeTransition={null}
        crossfadeProgress={1}
        sourceLabel="Queue"
      />,
    );

    expect(screen.getByText("Playing from: Queue")).toHaveClass(
      "text-text-subtle",
    );
    expect(screen.getByRole("heading", { name: "Track One" })).toHaveClass(
      "text-text-primary",
    );
    expect(screen.getByText("Album One")).toHaveClass("text-text-muted");

    const artistButton = screen.getByRole("button", {
      name: "Go to Artist One",
    });
    expect(artistButton).toHaveClass(
      "border-border-subtle",
      "bg-surface-quiet-subtle",
    );
    expect(artistButton.className).not.toContain("white/");
    expect(artistButton.className).not.toContain("black/");
  });

  it("keeps the artist action disabled unless the artist is clickable", () => {
    render(
      <PlayerTrackIdentity
        currentTrack={track}
        crossfadeTransition={null}
        crossfadeProgress={1}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to Artist One" }),
    ).toBeDisabled();
  });

  it("keeps the artist avatar compact through a terminal error and a new source", () => {
    const onError = vi.fn();
    const onClick = vi.fn();
    const props = {
      currentTrack: track,
      crossfadeTransition: null,
      crossfadeProgress: 1,
      artistClickable: true,
      onArtistClick: onClick,
      onArtistAvatarError: onError,
    };
    const { rerender } = render(
      <PlayerTrackIdentity {...props} artistAvatarUrl="/artist.jpg" />,
    );
    const action = screen.getByRole("button", { name: "Go to Artist One" });
    const avatar = action.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveAttribute("data-size", "inline");
    expect(avatar).not.toHaveClass("crate-media-thumbnail");
    fireEvent.error(screen.getByTestId("crate-image"));
    expect(onError).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("crate-image")).not.toBeInTheDocument();
    expect(avatar).toHaveTextContent("AO");
    expect(avatar).toHaveAttribute("data-size", "inline");
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <PlayerTrackIdentity {...props} artistAvatarUrl="/artist-new.jpg" />,
    );
    expect(screen.getByTestId("crate-image")).toHaveAttribute(
      "src",
      "/artist-new.jpg",
    );
  });
});
