import { describe, expect, it } from "vitest";

import {
  homeUpcomingAlbumKey,
  selectHomeRadarItems,
  type HomeUpcomingItem,
} from "@/components/home/home-model";

function item(
  overrides: Partial<HomeUpcomingItem> &
    Pick<HomeUpcomingItem, "date" | "title">,
): HomeUpcomingItem {
  return {
    type: "release",
    artist: "Artist",
    subtitle: "Album",
    is_upcoming: true,
    ...overrides,
  };
}

describe("home Radar selection", () => {
  it("orders events by date and excludes releases already shown in Lo que viene", () => {
    const selected = selectHomeRadarItems(
      [
        item({ title: "Later", date: "2030-06-20" }),
        item({ title: "Pre-release duplicate", date: "2030-05-01" }),
        item({
          title: "Sooner show",
          date: "2030-04-12",
          type: "show",
          artist: "High Vis",
          subtitle: "Madrid",
        }),
        item({ title: "Middle", date: "2030-05-15" }),
      ],
      new Set([homeUpcomingAlbumKey("Artist", "Pre-release duplicate")]),
    );

    expect(selected.map((entry) => entry.title)).toEqual([
      "Sooner show",
      "Middle",
      "Later",
    ]);
  });

  it("limits the result without mutating the API order", () => {
    const source = [
      item({ title: "Third", date: "2030-04-03" }),
      item({ title: "First", date: "2030-04-01" }),
      item({ title: "Second", date: "2030-04-02" }),
    ];

    expect(
      selectHomeRadarItems(source, new Set(), 2).map((entry) => entry.title),
    ).toEqual(["First", "Second"]);
    expect(source.map((entry) => entry.title)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
  });

  it("keeps a pre-release fallback when deduplication would empty Radar", () => {
    const preRelease = item({
      title: "Crate Countdown Fixture",
      date: "2030-08-20",
    });

    expect(
      selectHomeRadarItems(
        [preRelease],
        new Set([homeUpcomingAlbumKey("Artist", preRelease.title)]),
      ),
    ).toEqual([preRelease]);
  });
});
