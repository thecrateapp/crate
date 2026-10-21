import type {
  EqCurve,
  EffectiveEq,
} from "../../../app/listen/src/lib/equalizer-types";
export const EQ_SCENARIOS = [
  "smart",
  "smart-genre",
  "manual",
  "adaptive",
  "genre",
  "off",
  "loading",
  "unavailable",
  "legacy",
  "long",
  "short",
] as const;
export type EqScenario = (typeof EQ_SCENARIOS)[number];
export const TRACK_CURVES: EqCurve[] = [
  {
    source: "user_track_preset",
    gains: [3, 2, 0, -2, -3, -1, 2, 4, 4, 3],
    label: "Personal curve",
    reasoning: "Your saved track curve.",
    genre: null,
  },
  {
    source: "genre_taxonomy_preset",
    gains: [2, 1, 0, -1, -2, 0, 1, 3, 3, 2],
    label: "Alternative rock",
    reasoning: "",
    genre: { slug: "alternative-rock", name: "Alternative rock" },
  },
  {
    source: "flat",
    gains: Array(10).fill(0),
    label: "",
    reasoning: "",
    genre: null,
  },
];
export function effectiveCurve(curve: EqCurve): EffectiveEq {
  return {
    ...curve,
    trackId: 10,
    trackEntityUid: "fixture-track",
    albumId: 20,
    albumEntityUid: "fixture-album",
    scope: curve.source === "user_track_preset" ? "user" : null,
    targetType: "track",
    targetEntityUid: "fixture-track",
    userId: null,
    inheritedFrom: null,
  };
}

export const GENRE_GAINS = [2, 5, 6, 4, -3, -2, 4, 5, 2, 0];
export const EQ_FEATURES = {
  brightness: 0.42,
  loudness: -12,
  dynamicRange: 8,
  energy: 0.7,
  danceability: null,
  valence: null,
  acousticness: null,
  instrumentalness: null,
};
export const TRACK_GENRE = {
  primary: { slug: "grindcore", name: "Grindcore", canonical: true },
  topLevel: null,
  source: "album" as const,
  preset: {
    gains: GENRE_GAINS,
    source: "direct" as const,
    inheritedFrom: null,
  },
};
