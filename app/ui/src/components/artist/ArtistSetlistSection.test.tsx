import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("offers refresh in the empty state when the user can edit metadata", async () => {
    const onRefresh = vi.fn();
    render(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Biznaga"
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
          canRefresh
          refreshing={false}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Refresh setlist" }),
    );

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(
      screen.getByText("No concert data available from Setlist.fm"),
    ).toBeInTheDocument();
  });

  it("hides refresh without permission and disables it while running", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Biznaga"
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
          canRefresh={false}
          refreshing={false}
          onRefresh={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Refresh setlist" }),
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Biznaga"
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
          canRefresh
          refreshing
          onRefresh={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Refreshing setlist" }),
    ).toBeDisabled();
  });
});
