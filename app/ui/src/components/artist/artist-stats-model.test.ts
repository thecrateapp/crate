import { albumCoverApiUrl } from "@/lib/library-routes";
import { describe, expect, it } from "vitest";
import {
  releaseObservations,
  audioObservations,
  formatShares,
  rankAlbums,
  catalogueReadout,
  available,
  durationReading,
  releaseYear,
  nearestObservation,
  albumObservationMetadata,
  matchAlbumObservation,
  mostRecentObservationId,
  catalogueTrackCount,
  predominantGenre,
  artistAnalysisReadout,
} from "./artist-stats-model";

describe("artist catalogue summary readings", () => {
  it("uses the stored local track total or sums valid timeline counts", () => {
    const rows = [
      { name: "Local A", year: "2000", track_count: 1 },
      { name: "Local B", year: "2001", track_count: 9 },
    ];
    expect(catalogueTrackCount(rows)).toBe(10);
    expect(catalogueTrackCount(rows, 12)).toBe(12);
    expect(catalogueTrackCount(rows, 0)).toBe(0);
    expect(catalogueTrackCount([], undefined)).toBe(0);
    expect(catalogueTrackCount(rows, Infinity)).toBe(10);
    expect(catalogueTrackCount([{ ...rows[0]!, track_count: NaN }])).toBeNull();
  });

  it("ranks finite editorial weights without turning them into track shares", () => {
    expect(
      predominantGenre(
        [
          { name: "First", weight: 0.2, share: 0.99 },
          { name: "Strongest", weight: 3 },
          { name: "Invalid", weight: Infinity },
        ],
        [{ name: "Fallback", weight: 100 }],
      ),
    ).toBe("Strongest");
    expect(
      predominantGenre(
        [{ name: "Unweighted", share: 1 }],
        [{ name: "Zero weight", weight: 0 }],
      ),
    ).toBe("Zero weight");
    expect(
      predominantGenre(undefined, [{ name: "Unknown", weight: null }]),
    ).toBeNull();
  });

  it("takes the mean per measured track, deduplicating title and identity aliases", () => {
    const current = { is_current_full_profile: true };
    const readout = artistAnalysisReadout({
      one: {
        track_id: 1,
        album_id: 1,
        tempo: 100,
        smart_mix: current,
        bliss: { available: true },
      },
      "track:1": {
        track_entity_uid: "one",
        track_id: 1,
        tempo: 100,
        smart_mix: current,
        bliss: { available: true },
      },
      alias: {
        track_entity_uid: "one",
        tempo: 100,
        smart_mix: current,
        bliss: { available: true },
      },
      two: {
        track_id: 2,
        album_id: 2,
        tempo: 160,
        smart_mix: null,
        bliss: { available: false },
      },
      three: {
        track_id: 3,
        album_id: 2,
        tempo: 160,
        smart_mix: null,
        bliss: { available: true },
      },
      four: {
        track_id: 4,
        album_id: 2,
        tempo: 160,
        smart_mix: { quality: "full", is_current_full_profile: false },
        bliss: { available: false },
      },
    });
    expect(readout).toEqual({
      uniqueTracks: 4,
      meanBpm: 145,
      measuredTracks: 4,
      smartMixTracks: 1,
      blissTracks: 2,
    });
  });

  it("keeps absent currentness flags and unknown vector states unavailable", () => {
    expect(
      artistAnalysisReadout({
        stale: {
          track_id: 1,
          tempo: 0,
          smart_mix: { quality: "full", is_current_full_profile: false },
          bliss: { available: false },
        },
        legacy: { track_id: 2, tempo: null, smart_mix: { quality: "full" } },
        invalid: {
          track_id: 3,
          tempo: Infinity,
          smart_mix: null,
          bliss: { available: true },
        },
        negative: {
          track_id: 4,
          tempo: -20,
          smart_mix: null,
          bliss: { available: false },
        },
      }),
    ).toEqual({
      uniqueTracks: 4,
      meanBpm: null,
      measuredTracks: 0,
      smartMixTracks: null,
      blissTracks: null,
    });
    expect(
      artistAnalysisReadout({ unidentifiable: { tempo: 120 } }),
    ).toMatchObject({
      uniqueTracks: 0,
      meanBpm: null,
      smartMixTracks: null,
      blissTracks: null,
    });
    expect(artistAnalysisReadout({})).toEqual({
      uniqueTracks: 0,
      meanBpm: null,
      measuredTracks: 0,
      smartMixTracks: 0,
      blissTracks: 0,
    });
  });
});

describe("artist statistics observations", () => {
  it("positions releases by valid year and keeps coincident and undated identities", () => {
    const rows = releaseObservations([
      { name: "Same", year: "2000", track_count: 1 },
      { name: "Same", year: "2000-06-01", track_count: 2 },
      { name: "Later", year: "2010", track_count: 3 },
      { name: "Unknown", year: "garbage", track_count: 4 },
      { name: "Invalid", year: "2000-99-99", track_count: 4 },
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(5);
    expect(rows.map((row) => row.yearValue)).toEqual([
      2000,
      2000,
      2010,
      null,
      null,
    ]);
    expect(rows[0]?.position).toBe(rows[1]?.position);
    expect(rows[2]?.position).toBe(1);
    expect(rows[1]?.lane).toBe(1);
  });
  it("keeps duplicate audio rows separate and only plots available axes", () => {
    const rows = audioObservations([
      { album: "Same", avg_bpm: 100, avg_energy: 0 },
      { album: "Same", avg_bpm: null, avg_energy: 0.2 },
    ]);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    expect(rows.map((row) => row.plottable)).toEqual([true, false]);
    expect(rows[0]?.avg_energy).toBe(0);
  });
  it("never substitutes popularity for unavailable listeners", () => {
    const rows = [
      {
        name: "A",
        year: "2000",
        track_count: 1,
        popularity: 99,
        lastfm_listeners: null,
      },
      {
        name: "B",
        year: "2001",
        track_count: 2,
        popularity: 0,
        lastfm_listeners: 0,
      },
    ];
    expect(
      rankAlbums(rows, "lastfm_listeners").map((row) => row.value),
    ).toEqual([0]);
    expect(rankAlbums(rows, "popularity").map((row) => row.value)).toEqual([
      99, 0,
    ]);
  });
  it("uses known formats as the denominator and preserves zero duration", () => {
    expect(
      formatShares([
        { id: "FLAC", value: 3 },
        { id: "MP3", value: 1 },
        { id: "unknown", value: 8 },
      ]).map((row) => row.share),
    ).toEqual([0.75, 0.25]);
    expect(
      catalogueReadout([
        { name: "A", year: "2000", track_count: 1, total_duration: 0 },
        { name: "B", year: "", track_count: 1, total_duration: null },
      ]),
    ).toEqual({ firstYear: 2000, lastYear: 2000, duration: 0 });
  });
});

it("validates unavailable readings and calendar dates without losing zero", () => {
  expect(available(0)).toBe(true);
  expect(available(null)).toBe(false);
  expect(available(Infinity)).toBe(false);
  expect(releaseYear("2020-02-29")).toBe(2020);
  expect(releaseYear("2021-02-29")).toBeNull();
  expect(releaseYear(null)).toBeNull();
  expect(durationReading(null)).toBe("Unavailable");
  expect(durationReading(3600)).toBe("1h 0m");
  expect(durationReading(0)).toBe("0h 0m");
  expect(catalogueReadout([])).toEqual({
    firstYear: null,
    lastYear: null,
    duration: null,
  });
});

describe("plot distance inspection", () => {
  const rows = [
    { id: "first", x: 10, y: 20 },
    { id: "close", x: 15, y: 20 },
    { id: "vertical", x: 10, y: 40 },
    { id: "coincident", x: 10, y: 20 },
  ];
  it.each([
    [10, 20, "first"],
    [15, 20, "close"],
    [10, 39, "vertical"],
    [-20, 10, "first"],
    [12.5, 20, "first"],
  ] as const)("chooses the nearest visible centre at %s,%s", (x, y, id) => {
    expect(nearestObservation(rows, x, y)?.id).toBe(id);
    expect(nearestObservation([...rows].reverse(), x, y, "first")?.id).toBe(id);
  });
  it("keeps explicitly selected coincident observations and handles empty plots", () => {
    expect(nearestObservation(rows, 10, 20, "coincident")?.id).toBe(
      "coincident",
    );
    expect(nearestObservation([], 10, 20)).toBeUndefined();
  });
});

it("resolves album metadata only from unique exact title/year and retains legacy audio fallback", () => {
  const catalogue = [
    {
      id: 7,
      entity_uid: "album-seven",
      name: "Same",
      year: "2000",
      has_cover: true,
    },
    {
      id: 8,
      entity_uid: "album-eight",
      name: "Same",
      year: "2001",
      has_cover: true,
    },
    {
      id: 9,
      entity_uid: "album-nine",
      name: "Legacy",
      year: "2002",
      has_cover: true,
    },
    { id: 10, name: "Ambiguous", year: "2003", has_cover: true },
    { id: 11, name: "Ambiguous", year: "2003", has_cover: true },
  ].map((row) => ({ ...row, tracks: 1, formats: [], size_mb: 1 }));
  const items = albumObservationMetadata(
    [
      { id: "exact", title: "Same", year: "2001" },
      { id: "legacy", title: "Legacy" },
      { id: "ambiguous", title: "Ambiguous", year: "2003" },
      { id: "missing-year", title: "Legacy", year: null },
      { id: "unresolved", title: "Unknown" },
      { id: "duplicate-a", title: "Same", year: "2000" },
      { id: "duplicate-b", title: "Same", year: "2000" },
    ],
    catalogue,
  );
  expect(items[0]).toMatchObject({
    value: "exact",
    title: "Same",
    year: "2001",
    coverUrl: albumCoverApiUrl({ albumId: 8, albumEntityUid: "album-eight" }),
  });
  expect(items[0]?.detail).toBeUndefined();
  expect(items[1]).toMatchObject({
    year: "2002",
    coverUrl: albumCoverApiUrl({ albumId: 9, albumEntityUid: "album-nine" }),
  });
  expect(items[2]?.coverUrl).toBeUndefined();
  expect(items[3]).toMatchObject({ year: null });
  expect(items[3]?.coverUrl).toBeUndefined();
  expect(items[4]?.year).toBeNull();
  expect(items[5]?.detail).toBe("Observation 1 of 2");
  expect(items[6]?.detail).toBe("Observation 2 of 2");
  expect(items[5]?.value).not.toBe(items[6]?.value);
});

it("selects the latest valid calendar date regardless of input order", () => {
  expect(
    mostRecentObservationId([
      { id: "unknown", year: null },
      { id: "month", year: "2021-04" },
      { id: "invalid", year: "2025-02-30" },
      { id: "day", year: "2021-04-09" },
      { id: "earlier", year: "2020" },
    ]),
  ).toBe("day");
  expect(mostRecentObservationId([{ id: "only-unknown", year: null }])).toBe(
    "only-unknown",
  );
  expect(mostRecentObservationId([])).toBe("");
});

it("matches inspector observations by unique title/year without joining ambiguous names", () => {
  const rows = [
    { album: "Same", year: "2000", avg_bpm: 120 },
    { album: "Same", year: "2001", avg_bpm: 130 },
  ];
  expect(
    matchAlbumObservation("Same", "2001", rows, (row) => row.album)?.avg_bpm,
  ).toBe(130);
  expect(
    matchAlbumObservation("Same", undefined, rows, (row) => row.album),
  ).toBeUndefined();
  expect(
    matchAlbumObservation("Same", null, rows, (row) => row.album),
  ).toBeUndefined();
  expect(
    matchAlbumObservation(
      "Same",
      "2001",
      [...rows, rows[1]!],
      (row) => row.album,
    ),
  ).toBeUndefined();
  expect(
    matchAlbumObservation(
      "Legacy",
      "2000",
      [{ album: "Legacy", year: undefined, avg_bpm: 0 }],
      (row) => row.album,
    ),
  ).toBeUndefined();
  expect(
    matchAlbumObservation(
      "Legacy",
      undefined,
      [{ album: "Legacy", year: "2000", avg_bpm: 0 }],
      (row) => row.album,
    )?.avg_bpm,
  ).toBe(0);
});

it("does not associate one undated audio observation with multiple dated releases", () => {
  const legacyAudio = [{ album: "Same", year: undefined, avg_bpm: 120 }];
  for (const year of ["2000", "2001"])
    expect(
      matchAlbumObservation("Same", year, legacyAudio, (row) => row.album),
    ).toBeUndefined();
});
