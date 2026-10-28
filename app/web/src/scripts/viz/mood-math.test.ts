import { describe, expect, it } from "vitest";
import { MOODS } from "../../content/listen/viz";
import { mulberry32 } from "../field/sources";
import {
  describeFilters,
  moodCentre,
  moodRegion,
  sampleMoodPoints,
} from "./mood-math";

const byId = (id: string) => MOODS.find((mood) => mood.id === id)!;

describe("moods", () => {
  it("keeps the eight Browse by Mood presets", () => {
    expect(MOODS.map((mood) => mood.id)).toEqual([
      "energetic",
      "chill",
      "dark",
      "happy",
      "melancholy",
      "intense",
      "groovy",
      "acoustic",
    ]);
  });

  it("turns filters into an energy x valence region", () => {
    expect(moodRegion(byId("dark").filters)).toEqual({
      energy: [0.4, 1],
      valence: [0, 0.3],
    });
    expect(moodCentre(byId("melancholy"))).toEqual({
      energy: 0.25,
      valence: 0.175,
    });
    expect(moodCentre(byId("acoustic"))).toEqual({
      energy: 0.3,
      valence: 0.48,
    });
  });

  it("describes the real thresholds", () => {
    expect(describeFilters(byId("energetic").filters)).toEqual([
      "energy ≥ 0.70",
      "danceability ≥ 0.50",
    ]);
  });

  it("samples points that stay inside each mood's region", () => {
    const points = sampleMoodPoints(MOODS, 50, mulberry32(1));
    expect(points).toHaveLength(400);
    for (const point of points) {
      const region = moodRegion(MOODS[point.mood]!.filters);
      expect(point.energy).toBeGreaterThanOrEqual(region.energy[0]);
      expect(point.energy).toBeLessThanOrEqual(region.energy[1]);
      expect(point.valence).toBeGreaterThanOrEqual(region.valence[0]);
      expect(point.valence).toBeLessThanOrEqual(region.valence[1]);
    }
  });
});
