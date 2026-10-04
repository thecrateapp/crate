import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerBarTrackCopy } from "./PlayerBarTrackCopy";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

function renderCopy(sourceLabel: string | null) {
  return renderWithListenProviders(
    <PlayerBarTrackCopy
      displayTrack={{ id: "t1", title: "Song", artist: "Band" }}
      displayCrossfadeTransition={null}
      crossfadeProgress={0}
      displayPlaySource={null}
      sourceLabel={sourceLabel}
      isDesktop
      onOpenAlbum={vi.fn()}
      onOpenArtist={vi.fn()}
      onOpenSource={vi.fn()}
    />,
    { locale: "en" },
  );
}

describe("PlayerBarTrackCopy", () => {
  it("fills the reserved track slot so the playing-from line never pushes the actions", () => {
    const { container, unmount } = renderCopy(null);
    const withoutSource = (container.firstElementChild as HTMLElement)
      .className;
    unmount();

    const { container: withSourceContainer } = renderCopy(
      "A very long playlist name that is wider than the title",
    );
    const copy = withSourceContainer.firstElementChild as HTMLElement;

    expect(copy).toHaveClass("min-w-0", "flex-1");
    expect(copy.className).not.toMatch(/(?:^|\s)md:flex-none(?:\s|$)/);
    expect(copy.className).not.toMatch(/max-w-/);
    expect(copy.className).toBe(withoutSource);
    expect(
      screen.getByText(/A very long playlist name/).closest("p"),
    ).toHaveClass("truncate");
  });
});
