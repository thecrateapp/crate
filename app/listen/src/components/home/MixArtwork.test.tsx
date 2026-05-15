import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MixArtwork } from "./MixArtwork";

describe("MixArtwork", () => {
  const baseItem = {
    id: "mix",
    name: "Mix",
    description: "",
    artwork_tracks: [],
    artwork_artists: [],
    track_count: 0,
    badge: "mix",
    kind: "mix" as const,
  };

  it("renders 4 tiles with no artists", () => {
    const { container } = render(<MixArtwork item={baseItem} />);
    expect(container.querySelectorAll("img[aria-hidden='true']")).toHaveLength(
      1,
    );
  });

  it("renders artist images for available artists", () => {
    const { container } = render(
      <MixArtwork
        item={{
          ...baseItem,
          name: "Mix",
          artwork_artists: [
            { artist_id: 1, artist_slug: "a", artist_name: "A" },
            { artist_id: 2, artist_slug: "b", artist_name: "B" },
          ],
        }}
      />,
    );
    expect(container.querySelectorAll("img[alt='A']")).toHaveLength(1);
    expect(container.querySelectorAll("img[alt='B']")).toHaveLength(1);
  });

  it("caps at 4 artists", () => {
    const artists = Array.from({ length: 6 }, (_, i) => ({
      artist_id: i,
      artist_slug: `a${i}`,
      artist_name: `Artist ${i}`,
    }));
    const { container } = render(
      <MixArtwork item={{ ...baseItem, artwork_artists: artists }} />,
    );
    expect(container.querySelectorAll("img[alt^='Artist']")).toHaveLength(4);
  });
});
