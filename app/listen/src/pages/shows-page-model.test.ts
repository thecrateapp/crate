import { describe, expect, it } from "vitest";
import { buildShowsPageModel } from "./shows-page-model";
import type { UpcomingItem } from "../components/upcoming/upcoming-types";
const event = (
  id: number,
  date: string,
  type: "show" | "release" = "show",
): UpcomingItem => ({
  id,
  date,
  type,
  artist: "Artist",
  title: `Event ${id}`,
  subtitle: "Venue",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
});
describe("Radar list model", () => {
  const model = (items: UpcomingItem[]) =>
    buildShowsPageModel({
      data: {
        items,
        summary: {
          followed_artists: 1,
          show_count: 2,
          release_count: 1,
          attending_count: 0,
          insight_count: 0,
        },
      },
      filter: "all",
      focusShowId: null,
      genreData: null,
      genreLoading: false,
      genreSlug: null,
      search: "",
      today: "2026-10-20",
      upcomingLoading: false,
    });
  it("merges release and show months in chronological order without mutating the payload", () => {
    const items = [
      event(1, "2026-11-03", "release"),
      event(2, "2027-01-03"),
      event(3, "2026-10-22"),
    ];
    expect(model(items).comingUp.map((item) => item.id)).toEqual([3, 1, 2]);
    expect(items.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});
