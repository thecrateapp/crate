import { expect, it } from "vitest";
import { buildSoundProfile } from "./stats-page-model";
import type { StatsTrack } from "@/components/stats/stats-model";
it("distinguishes unavailable analysis from a confirmed zero", () => {
  expect(buildSoundProfile([])).toEqual({
    energy: null,
    danceability: null,
    valence: null,
    bpm: null,
  });
  expect(
    buildSoundProfile([
      { energy: 0, danceability: 0, valence: 0 } as StatsTrack,
    ]),
  ).toEqual({ energy: 0, danceability: 0, valence: 0, bpm: null });
});
