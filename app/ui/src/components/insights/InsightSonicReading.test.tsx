import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsightSonicReading } from "./InsightSonicReading";
import type { SonicTrack } from "./insights-model";

const { neighborsMock } = vi.hoisted(() => ({ neighborsMock: vi.fn() }));
vi.mock("./use-sonic-neighbors", () => ({
  useSonicNeighbors: neighborsMock,
}));
beforeEach(() => {
  neighborsMock.mockReset().mockReturnValue({
    loading: false,
    error: false,
    data: undefined,
    retry: vi.fn(),
  });
});

const track: SonicTrack = {
  id: 1,
  entity_uid: "track-1",
  title: "Sarrera",
  album_id: 2,
  album_entity_uid: "album-2",
  album: "Ur Gardenak",
  album_slug: "ur-gardenak",
  artist: "Akauzazte",
  artist_slug: "akauzazte",
  year: "1998",
  has_cover: true,
  heard: true,
  plays: 1,
  minutes: 11.9,
  bpm: 133.4,
  bpm_confidence: 0.795,
  energy: 0.1,
  integrated_lufs: -48.1,
  true_peak_dbfs: -34.2,
  key_camelot: "9B",
  key_confidence: 0.528,
  tempo_stability: 0.5,
  quality: "partial",
  has_bliss: false,
  acousticness: 0,
  instrumentalness: 0.9,
  valence: 0.5,
};

describe("Sonic track reading composition", () => {
  it("passes the tab activity state to the nearby-data subscription", () => {
    render(
      <MemoryRouter>
        <InsightSonicReading track={track} window="90d" active={false} />
      </MemoryRouter>,
    );
    expect(neighborsMock).toHaveBeenCalledWith(track, "90d", false);
  });

  it("uses shared section headers for track and nearby reading with distinct content spacing", () => {
    render(
      <MemoryRouter>
        <InsightSonicReading track={track} window="30d" />
      </MemoryRouter>,
    );
    for (const [label, heading] of [
      ["Selected sonic track", "Track reading"],
      ["Sound nearby", "Sound nearby"],
    ]) {
      const group = screen.getByRole("group", { name: label });
      const title = within(group).getByRole("heading", { name: heading });
      expect(
        title.closest('[data-slot="instrument-panel-header"]'),
      ).not.toBeNull();
      expect(title.closest('[data-slot="instrument-panel"]')).not.toBeNull();
    }
    const neighbors = screen.getByRole("group", { name: "Sound nearby" });
    expect(
      within(neighbors)
        .getByText(/Stored Bliss similarity/)
        .closest('[data-slot="instrument-panel-description"]'),
    ).not.toBeNull();
    expect(
      within(neighbors).getByText("No stored Bliss vector for this track."),
    ).toBeVisible();
  });

  it("keeps entity navigation as shared secondary buttons with real destinations", () => {
    const { container } = render(
      <MemoryRouter>
        <InsightSonicReading track={track} window="30d" />
      </MemoryRouter>,
    );
    const album = screen.getByRole("link", { name: "Open Ur Gardenak" });
    const artist = screen.getByRole("link", { name: "Open Akauzazte" });
    for (const action of [album, artist]) {
      expect(action).toHaveAttribute("data-slot", "button");
      expect(action).toHaveAttribute("data-variant", "secondary");
    }
    expect(album).toHaveAttribute("href", "/artists/akauzazte/ur-gardenak");
    expect(artist).toHaveAttribute("href", "/artists/akauzazte");
    expect(container.querySelector("[title]")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Track measurements" }),
    ).toHaveTextContent("133.4 BPM");
  });

  it("keeps nearby tracks as full-row links with wrapping metadata", () => {
    const title =
      "A long nearby track title that should remain readable on narrow screens";
    neighborsMock.mockReturnValue({
      loading: false,
      error: false,
      data: {
        seed_track_id: track.id,
        available: true,
        items: [{ track: { ...track, id: 3, title }, distance: 0.12 }],
      },
      retry: vi.fn(),
    });
    render(
      <MemoryRouter>
        <InsightSonicReading
          track={{ ...track, has_bliss: true }}
          window="30d"
        />
      </MemoryRouter>,
    );
    const nearby = screen.getByRole("group", { name: "Sound nearby" });
    const link = within(nearby).getByRole("link", { name: new RegExp(title) });
    expect(link).toHaveAttribute("href", "/artists/akauzazte/ur-gardenak");
    expect(link.parentElement).toHaveAttribute("data-slot", "hairline-row");
    expect(link.querySelector(".truncate")).toBeNull();
    expect(link).toHaveTextContent("Akauzazte · 1998");
    expect(link).toHaveTextContent("Cosine distance 0.12");
  });
});
