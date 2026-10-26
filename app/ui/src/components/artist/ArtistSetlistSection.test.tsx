import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

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
      screen.getByRole("status", {
        name: "No concert data available from Setlist.fm",
      }),
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
    expect(
      screen
        .getByRole("heading", { name: "Probable Setlist" })
        .closest('[data-slot="artist-detail-section"]'),
    ).not.toHaveClass("border-t");
    expect(screen.getByText("Una historia con las manos")).toBeInTheDocument();
  });

  it("keeps frequency, plays and date in fixed slots whatever their length", () => {
    render(
      <MemoryRouter>
        <ArtistSetlistSection
          artistName="Pixies"
          setlistData={{
            probable_setlist: [
              {
                title: "Where Is My Mind?",
                frequency: 1,
                play_count: 12,
                last_played: "2026-10-12",
              },
              { title: "Caribou", frequency: 0.07, play_count: 1 },
            ],
            total_shows: 12,
          }}
          allTrackTitles={[]}
          onTrackTitlesLoaded={vi.fn()}
        />
      </MemoryRouter>,
    );

    const slots = ["Where Is My Mind? frequency", "Caribou frequency"].map(
      (name) => screen.getByRole("progressbar", { name }).parentElement!,
    );
    for (const row of slots) {
      expect(row).toHaveClass(
        "grid",
        "grid-cols-[3rem_6ch_12ch]",
        "sm:grid-cols-[3rem_6ch_12ch_13ch]",
      );
      expect(row.children).toHaveLength(4);
    }
    expect(screen.getByText("100%")).toHaveClass("text-right");
    expect(screen.getByText("7%")).toHaveClass("text-right");
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
      screen.getByRole("status", {
        name: "No concert data available from Setlist.fm",
      }),
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

function Location() {
  const { pathname } = useLocation();
  return <output aria-label="Current route">{pathname}</output>;
}
it("opens the matched album from the setlist while keeping unmatched songs disabled", async () => {
  render(
    <MemoryRouter>
      <ArtistSetlistSection
        artistName="Artist"
        setlistData={{
          probable_setlist: [
            { title: "Matched Song", frequency: 0.5, play_count: 2 },
            { title: "Not In Library", frequency: 0.1, play_count: 1 },
          ],
        }}
        allTrackTitles={[
          {
            title: "Matched Song",
            album: "Album",
            album_id: 2,
            album_slug: "album",
            path: "/track.flac",
          },
        ]}
        onTrackTitlesLoaded={vi.fn()}
      />
      <Location />
    </MemoryRouter>,
  );
  const matched = screen.getByText("Matched Song").closest("button")!;
  expect(screen.getByText("Not In Library").closest("button")).toBeDisabled();
  await userEvent.click(matched);
  expect(screen.getByLabelText("Current route")).toHaveTextContent(
    "/artists/artist/album",
  );
  expect(
    screen.getByRole("progressbar", { name: "Matched Song frequency" }),
  ).toHaveAttribute("aria-valuenow", "50");
});
