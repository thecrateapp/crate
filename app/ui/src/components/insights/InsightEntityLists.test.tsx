import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  InsightAlbumList,
  InsightChanges,
  InsightOpportunities,
} from "./InsightEntityLists";
import type { CollectionInsights } from "./insights-model";

const data: CollectionInsights = {
  ready: true,
  window: "30d",
  period: {
    start: "2026-09-25",
    end: "2026-10-24",
    previous_start: "2026-08-26",
    previous_end: "2026-09-24",
    history_start: "2026-01-01",
    calendar: "listener_local_days",
    previous_complete: true,
    history_complete: true,
  },
  catalogue: null,
  current: null,
  previous: null,
  excluded: null,
  timeline: [],
  genres: [],
  decades: [],
  rising: [],
  falling: [],
  unheard: { total: 0, items: [] },
  rediscover: { total: 0, items: [] },
  improvements: [
    { key: "bliss", tracks: 1, minutes: 10, albums: [] },
    { key: "full", tracks: 1, minutes: 10, albums: [] },
  ],
};

describe("Insights opportunity actions", () => {
  it("uses shared secondary button links for Discovery and Analysis", () => {
    render(
      <MemoryRouter>
        <InsightOpportunities data={data} fullEnabled />
      </MemoryRouter>,
    );
    const discovery = screen.getByRole("link", { name: "Open Discovery" });
    const analysis = screen.getAllByRole("link", { name: "Open Analysis" });
    for (const action of [discovery, ...analysis]) {
      expect(action).toHaveAttribute("data-slot", "button");
      expect(action).toHaveAttribute("data-variant", "secondary");
    }
    expect(discovery).toHaveAttribute("href", "/discover");
    for (const action of analysis) {
      expect(action).toHaveAttribute("href", "/analysis");
    }
  });

  it("makes the shared album row the navigation target and lets rich metadata wrap", () => {
    render(
      <MemoryRouter>
        <InsightAlbumList
          albums={[
            {
              id: 1,
              entity_uid: "album-1",
              slug: "ur-gardenak",
              title:
                "Ur Gardenak (A long expanded title with additional recordings)",
              artist: "Akauzazte",
              artist_slug: "akauzazte",
              year: "1998",
              has_cover: false,
              tracks: 6,
              played_tracks: 3,
              minutes: 12,
              last_day: "2026-10-24",
            },
          ]}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Ur Gardenak/ });
    expect(link).toHaveAttribute(
      "href",
      "/artists/akauzazte/ur-gardenak-a-long-expanded-title-with-additional-recordings",
    );
    expect(link.parentElement).toHaveAttribute("data-slot", "hairline-row");
    expect(link.querySelector(".truncate")).toBeNull();
    expect(link).toHaveTextContent("Akauzazte · 1998");
    expect(link).toHaveTextContent("3 / 6 tracks with listening · 12 min");
  });

  it("preserves the artist destination and change reading in its shared full row", () => {
    render(
      <MemoryRouter>
        <InsightChanges
          data={{
            ...data,
            rising: [
              {
                id: 1,
                entity_uid: "artist-1",
                slug: "akauzazte",
                name: "Akauzazte",
                has_photo: false,
                current_minutes: 12,
                previous_minutes: 7,
                delta_minutes: 5,
              },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Akauzazte/ });
    expect(link).toHaveAttribute("href", "/artists/akauzazte");
    expect(link.parentElement).toHaveAttribute("data-slot", "hairline-row");
    expect(link.querySelector(".truncate")).toBeNull();
    expect(link).toHaveTextContent("12 min · previous 7 min");
    expect(link).toHaveTextContent("+5 min");
  });
});
