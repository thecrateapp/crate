import type { Mood, MoodFilter } from "../../content/listen/viz";
import { gaussian, type Random } from "../field/sources";

export interface Region {
  energy: [number, number];
  valence: [number, number];
}

export function moodRegion(filters: MoodFilter): Region {
  return {
    energy: [filters.energy_min ?? 0, filters.energy_max ?? 1],
    valence: [filters.valence_min ?? 0, filters.valence_max ?? 1],
  };
}

export function moodCentre(mood: Mood): { energy: number; valence: number } {
  const region = moodRegion(mood.filters);
  return {
    energy: mood.lean?.energy ?? (region.energy[0] + region.energy[1]) / 2,
    valence: mood.lean?.valence ?? (region.valence[0] + region.valence[1]) / 2,
  };
}

export function describeFilters(filters: MoodFilter): string[] {
  return Object.entries(filters).map(([key, value]) => {
    const [feature] = key.split("_");
    const op = key.endsWith("_min") ? "≥" : "≤";
    return `${feature} ${op} ${value.toFixed(2)}`;
  });
}

export interface MoodPoint {
  mood: number;
  energy: number;
  valence: number;
}

const clamp = (value: number, [low, high]: [number, number]) =>
  Math.min(high, Math.max(low, value));

export function sampleMoodPoints(
  moods: readonly Mood[],
  perMood: number,
  random: Random,
): MoodPoint[] {
  const points: MoodPoint[] = [];
  moods.forEach((mood, index) => {
    const region = moodRegion(mood.filters);
    const centre = moodCentre(mood);
    const spreadE = Math.min(
      0.11,
      Math.max(0.05, (region.energy[1] - region.energy[0]) / 5),
    );
    const spreadV = Math.min(
      0.11,
      Math.max(0.05, (region.valence[1] - region.valence[0]) / 5),
    );
    for (let i = 0; i < perMood; i += 1) {
      points.push({
        mood: index,
        energy: clamp(
          centre.energy + gaussian(random) * spreadE,
          region.energy,
        ),
        valence: clamp(
          centre.valence + gaussian(random) * spreadV,
          region.valence,
        ),
      });
    }
  });
  return points;
}
