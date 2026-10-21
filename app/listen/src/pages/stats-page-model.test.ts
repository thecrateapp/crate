import { describe, expect, it } from "vitest";

import type { StatsStory, StatsTrack } from "@/components/stats/stats-types";
import {
  normalizeSelectionParam,
  buildPreviousSoundProfile,
  pickEnergeticFavourite,
  statsDashboardReadState,
  selectionDays,
  selectionYear,
  statsSelectionOptions,
} from "@/pages/stats-page-model";

import { baseDashboard } from "../test/stats-dashboard-fixture";

describe("stats period selection", () => {
  it("normalizes calendar years, legacy windows and junk", () => {
    expect(normalizeSelectionParam("year", 2026)).toBe("year:2026");
    expect(normalizeSelectionParam("year:2025", 2026)).toBe("year:2025");
    expect(normalizeSelectionParam("year:2031", 2026)).toBe("30d");
    expect(normalizeSelectionParam("365d", 2026)).toBe("365d");
    expect(normalizeSelectionParam("nope", 2026)).toBe("30d");
    expect(normalizeSelectionParam(null, 2026)).toBe("30d");
  });

  it("exposes years and day counts", () => {
    expect(selectionYear("year:2024")).toBe(2024);
    expect(selectionYear("90d")).toBeNull();
    expect(selectionDays("90d")).toBe(90);
    expect(selectionDays("all_time")).toBeNull();
    expect(selectionDays("year:2024")).toBeNull();
  });

  it("offers the calendar year only where it is supported", () => {
    expect(
      statsSelectionOptions(2026, { calendarYear: true }).map((o) => o.value),
    ).toEqual(["30d", "90d", "year:2026", "all_time"]);
    expect(
      statsSelectionOptions(2026, { calendarYear: false }).map((o) => o.value),
    ).toEqual(["30d", "90d", "365d", "all_time"]);
  });
});

it("distinguishes a cold snapshot from versioned cached emptiness and preserves populated cache", () => {
  const empty = baseDashboard();
  expect(
    statsDashboardReadState(
      { ...empty, snapshot: { version: 0, pending: true } },
      false,
      null,
    ),
  ).toBe("loading");
  expect(
    statsDashboardReadState(
      { ...empty, snapshot: { version: 2, pending: true } },
      true,
      "Refresh failed",
    ),
  ).toBe("ready");
  expect(
    statsDashboardReadState(
      {
        ...empty,
        overview: { ...empty.overview, play_count: 1 },
        snapshot: { version: 0, pending: true },
      },
      true,
      null,
    ),
  ).toBe("ready");
  expect(statsDashboardReadState(empty, false, null)).toBe("ready");
  expect(statsDashboardReadState(null, false, "Read failed")).toBe("error");
  expect(statsDashboardReadState(null, true, null)).toBe("loading");
  expect(statsDashboardReadState(undefined, true, null)).toBe("loading");
});

describe("pickEnergeticFavourite", () => {
  const track = (title: string, energy?: number | null) =>
    ({ title, artist: "A", energy }) as StatsTrack;

  it("returns the top track with the highest known energy", () => {
    expect(
      pickEnergeticFavourite([
        track("a", 0.2),
        track("b", 0.9),
        track("c", null),
      ]),
    ).toMatchObject({ title: "b", artist: "A" });
  });

  it("returns null when no top track has energy", () => {
    expect(pickEnergeticFavourite([track("a", null), track("b")])).toBeNull();
    expect(pickEnergeticFavourite([])).toBeNull();
  });
});

describe("buildPreviousSoundProfile", () => {
  const reading = { energy: 0.4, danceability: null, valence: 0.2, bpm: 120 };

  it("uses the previous server profile only next to the current one", () => {
    const story = {
      audio_profile: reading,
      audio_profile_previous: { ...reading, energy: 0.3 },
    } as StatsStory;
    expect(buildPreviousSoundProfile(story)).toEqual({
      energy: 0.3,
      danceability: null,
      valence: 0.2,
      bpm: 120,
    });
  });

  it("is null without a server current profile or a previous window", () => {
    expect(buildPreviousSoundProfile(undefined)).toBeNull();
    expect(
      buildPreviousSoundProfile({ audio_profile: reading } as StatsStory),
    ).toBeNull();
    expect(
      buildPreviousSoundProfile({
        audio_profile_previous: reading,
      } as StatsStory),
    ).toBeNull();
  });
});
