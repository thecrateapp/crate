import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

describe("JustLandedSection", () => {
  it("mounts each artist card once", () => {
    renderWithListenProviders(
      <JustLandedSection
        loading={false}
        artists={[
          {
            id: 1,
            name: "Birds In Row",
            albums: 2,
            tracks: 20,
            has_photo: false,
          },
          { id: 2, name: "High Vis", albums: 1, tracks: 10, has_photo: false },
        ]}
      />,
    );

    expect(screen.getAllByText("Birds In Row")).toHaveLength(1);
    expect(screen.getAllByText("High Vis")).toHaveLength(1);
  });
});
