import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoreTracksArtwork } from "./CoreTracksArtwork";

describe("CoreTracksArtwork", () => {
  const baseItem = {
    id: "core",
    name: "Test Mix",
    description: "",
    artwork_tracks: [],
    artwork_artists: [],
    track_count: 0,
    badge: "core",
    kind: "core" as const,
  };

  it("renders fallback when no artwork_tracks", () => {
    const { container } = render(<CoreTracksArtwork item={baseItem} />);
    // When no photoUrl, there should be no <img> with alt text
    expect(container.querySelector("img[alt='Test Mix']")).toBeNull();
    expect(screen.getByText("Artist Set")).toBeInTheDocument();
    expect(screen.queryByText("Core Tracks")).toBeNull();
  });

  it("renders photo when first track has artist slug", () => {
    render(
      <CoreTracksArtwork
        item={{
          ...baseItem,
          name: "Mix Name",
          artwork_tracks: [{ artist_id: 1, artist_slug: "the-band" }],
        }}
      />,
    );
    const img = document.querySelector("img[alt='Mix Name']");
    expect(img).toBeInTheDocument();
    expect(img?.tagName).toBe("IMG");
  });

  it("renders global artist photo for remote-only artist sets", () => {
    render(
      <CoreTracksArtwork
        item={{
          ...baseItem,
          name: "High Vis",
          artwork_tracks: [
            {
              artist: "High Vis",
              global_artist_uid: "global-high-vis",
            },
          ],
        }}
      />,
    );

    const img = document.querySelector("img[alt='High Vis']");
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toContain(
      "/api/catalog/artists/global-high-vis/photo",
    );
  });

  it("applies custom className", () => {
    const { container } = render(
      <CoreTracksArtwork
        item={{ ...baseItem, name: "Mix" }}
        className="rounded-xl"
      />,
    );
    expect(container.firstChild).toHaveClass("rounded-xl");
  });
});
