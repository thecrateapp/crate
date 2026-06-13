import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArtistBioModal } from "./ArtistBioModal";
import { ArtistSetlistModal } from "./ArtistSetlistSection";

vi.mock("@/lib/api", () => ({
  api: vi.fn(() => Promise.reject(new Error("skip enrichment in modal tests"))),
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

  it("renders artist genres in the bio sheet with genre pill styling and clean sheet chrome", () => {
    render(
      <MemoryRouter>
        <ArtistBioModal
          open
          onClose={() => {}}
          photoUrl="/artist.jpg"
          tags={["hardcore", "mathcore", "metalcore", "noise"]}
          artist={{
            id: 7,
            name: "Converge",
            albums: [],
            total_tracks: 0,
            total_size_mb: 0,
            primary_format: null,
            genres: ["hardcore", "mathcore", "metalcore", "noise"],
            genre_profile: [
              { name: "Hardcore", slug: "hardcore", source: "lastfm" },
              { name: "Mathcore", slug: "mathcore", source: "lastfm" },
              { name: "Metalcore", slug: "metalcore", source: "lastfm" },
              { name: "Noise", slug: "noise", source: "lastfm" },
            ],
            issue_count: 0,
          }}
          artistInfo={{
            bio: "Converge bio.",
            tags: ["hardcore", "mathcore", "metalcore", "noise"],
            similar: [],
            listeners: 1000,
            playcount: 2000,
            image_url: null,
            url: "",
          }}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByText("Converge").closest(".listen-glass-panel");
    const header = screen.getByTestId("artist-bio-header");
    const hardcore = screen.getByRole("button", { name: /hardcore/i });
    const metalcore = screen.getByRole("button", { name: /metalcore/i });
    const close = screen.getByRole("button", { name: "Close" });

    expect(panel).toContainElement(hardcore);
    expect(panel).toContainElement(metalcore);
    expect(screen.queryByRole("button", { name: /noise/i })).toBeNull();
    expect(hardcore).toHaveClass("rounded-md");
    expect(hardcore).not.toHaveClass("rounded-full", "bg-white/8");
    expect(header).toHaveClass("border-b-0", "bg-transparent");
    expect(header).not.toHaveClass("backdrop-blur-xl");
    expect(close).toHaveClass("hover:text-primary");
    expect(close.className).not.toContain("bg-white/5");
    expect(close.className).not.toContain("border-white/10");
  });
});
