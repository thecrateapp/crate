import { describe, expect, it } from "vitest";

import {
  artistShowToUpcomingItem,
  canOpenUpcomingRelease,
  itemKey,
  upcomingReleaseBadgeLabel,
} from "@/components/upcoming/upcoming-model";

describe("upcoming model", () => {
  it("preserves the original artist show event id for expansion keys", () => {
    const item = artistShowToUpcomingItem({
      id: "show-high-vis-99",
      show_id: 99,
      artist_name: "High Vis",
      artist_id: 52,
      artist_slug: "high-vis",
      date: "2026-07-31",
      local_time: "19:00",
      venue: "Grant Park",
      city: "Chicago",
      country: "USA",
      country_code: "US",
    });

    expect(item.event_key).toBe("show-high-vis-99");
    expect(itemKey(item, 0)).toBe("show-high-vis-99");
  });

  it("only opens real albums or future virtual pre-releases", () => {
    expect(
      canOpenUpcomingRelease({
        type: "release",
        date: "2026-07-17",
        artist: "Quicksand",
        artist_slug: "quicksand",
        title: "Bring On The Psychics",
        subtitle: "Album",
        cover_url: null,
        status: "detected",
        is_upcoming: true,
        release_id: 42,
      }),
    ).toBe(true);

    expect(
      canOpenUpcomingRelease({
        type: "release",
        date: "2026-04-30",
        artist: "HEALTH",
        artist_slug: "health",
        title: "ADDENDUM",
        subtitle: "EP",
        cover_url: null,
        status: "detected",
        is_upcoming: false,
        release_id: 43,
      }),
    ).toBe(false);

    expect(
      canOpenUpcomingRelease({
        type: "release",
        date: "2026-04-30",
        artist: "HEALTH",
        artist_slug: "health",
        album_id: 99,
        title: "ADDENDUM",
        subtitle: "EP",
        cover_url: null,
        status: "downloaded",
        is_upcoming: false,
      }),
    ).toBe(true);

    expect(
      canOpenUpcomingRelease({
        type: "release",
        date: "2026-07-17",
        artist: "SOFTPLAY",
        title: "Ghostly",
        subtitle: "EP",
        cover_url: null,
        status: "detected",
        is_upcoming: true,
        release_id: 12,
      }),
    ).toBe(true);
  });

  it("labels release rows by current availability state", () => {
    expect(
      upcomingReleaseBadgeLabel({
        type: "release",
        date: "2026-07-17",
        artist: "Quicksand",
        title: "Bring On The Psychics",
        subtitle: "Album",
        cover_url: null,
        status: "detected",
        is_upcoming: true,
      }),
    ).toBe("Pre-release");

    expect(
      upcomingReleaseBadgeLabel({
        type: "release",
        date: "2026-04-30",
        artist: "HEALTH",
        title: "ADDENDUM",
        subtitle: "EP",
        cover_url: null,
        status: "detected",
        is_upcoming: false,
      }),
    ).toBe("Released");
  });
});
