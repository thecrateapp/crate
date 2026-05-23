import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { ArtistSetlistSection } from "./ArtistSetlistSection";

describe("ArtistSetlistSection", () => {
  it("does not crash when a stale cache returns probable_setlist as an object", () => {
    render(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Biznaga"
          setlistData={
            {
              probable_setlist: { title: "Una historia con las manos" },
              total_shows: 1,
            } as never
          }
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No concert data available from Setlist.fm"),
    ).toBeInTheDocument();
  });

  it("renders normalized probable setlist songs", () => {
    render(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Biznaga"
          setlistData={{
            probable_setlist: [
              {
                title: "Una historia con las manos",
                frequency: 1,
                play_count: 2,
              },
            ],
            total_shows: 2,
          }}
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Probable Setlist")).toBeInTheDocument();
    expect(screen.getByText("Una historia con las manos")).toBeInTheDocument();
  });
});
