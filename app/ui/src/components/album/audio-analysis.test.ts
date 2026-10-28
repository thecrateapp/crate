import { describe, expect, it } from "vitest";
import { analysisForTrack, type AudioAnalysisTrack } from "./audio-analysis";
const features = {
  tempo: 124,
  key: null,
  scale: null,
  energy: null,
  mood: null,
  danceability: null,
  valence: null,
  acousticness: null,
  instrumentalness: null,
  loudness: null,
  dynamic_range: null,
  spectral_complexity: null,
} satisfies AudioAnalysisTrack;
describe("analysisForTrack", () => {
  it("matches stable identity before a shared title from a different album", () => {
    const data = {
      intro: { ...features, track_id: 1 },
      "track:2": { ...features, track_id: 2, tempo: 92 },
    };
    expect(
      analysisForTrack(data, {
        id: 2,
        filename: "intro.flac",
        tags: { title: "Intro" },
      })?.tempo,
    ).toBe(92);
    expect(
      analysisForTrack(data, {
        id: 3,
        filename: "intro.flac",
        tags: { title: "Intro" },
      }),
    ).toBeUndefined();
  });
  it("keeps compatibility with title-only analysis snapshots", () => {
    expect(
      analysisForTrack(
        { intro: features },
        { id: 2, filename: "intro.flac", tags: { title: "Intro" } },
      ),
    ).toEqual(features);
  });
});
