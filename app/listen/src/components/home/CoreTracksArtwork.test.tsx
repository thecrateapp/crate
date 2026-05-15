import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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

  it("applies custom className", () => {
    const { container } = render(
      <CoreTracksArtwork
        item={{ ...baseItem, name: "Mix" }}
        className="rounded-2xl"
      />,
    );
    expect(container.firstChild).toHaveClass("rounded-2xl");
  });
});
