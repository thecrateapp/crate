import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArtistBioModal } from "./ArtistBioModal";
import { ArtistSetlistModal } from "./ArtistSetlistSection";

vi.mock("@/lib/api", () => ({
  api: vi.fn(() => Promise.resolve({})),
}));

describe("artist mobile modals", () => {
  it("renders probable setlist as a native bottom sheet instead of a floating panel", () => {
    render(
      <ArtistSetlistModal
        artistName="Kneecap"
        artistId={7}
        open
        onClose={() => {}}
        onPlay={() => {}}
        setlist={[
          {
            title: "Smugglers & Scholars",
            frequency: 0.8,
            play_count: 12,
          },
        ]}
      />,
    );

    const panel = screen
      .getByText("Probable Setlist")
      .closest(".listen-glass-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveClass("fixed");
    expect(panel?.className).not.toContain(
      "listen-mobile-bottom-chrome-height",
    );
  });

  it("renders artist bio as a native bottom sheet instead of a floating panel", () => {
    render(
      <MemoryRouter>
        <ArtistBioModal
          open
          onClose={() => {}}
          photoUrl="/artist.jpg"
          tags={["hip-hop"]}
          artist={{
            id: 7,
            name: "Kneecap",
            albums: [],
            total_tracks: 0,
            total_size_mb: 0,
            primary_format: null,
            genres: ["hip-hop"],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "Belfast trio.",
            tags: ["hip-hop"],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByText("Kneecap").closest(".listen-glass-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveClass("fixed");
    expect(panel?.className).not.toContain(
      "listen-mobile-bottom-chrome-height",
    );
  });
});
