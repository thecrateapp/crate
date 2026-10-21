// Portable EQ data contracts: no hooks, API clients or audio runtime imports.
export interface EffectiveEq {
  trackId: number;
  trackEntityUid: string | null;
  albumId: number | null;
  albumEntityUid: string | null;
  gains: number[];
  source:
    | "user_track_preset"
    | "instance_track_preset"
    | "instance_album_preset"
    | "genre_taxonomy_preset"
    | "audio_analysis_preset"
    | "flat";
  label: string;
  reasoning: string;
  scope: "user" | "instance" | null;
  targetType: "track" | "album" | null;
  targetEntityUid: string | null;
  userId: number | null;
  genre: { slug: string; name: string; canonical?: boolean } | null;
  inheritedFrom: { slug: string; name: string } | null;
}

export interface EqFeatures {
  energy: number | null;
  loudness: number | null; // LUFS, roughly -30..-6
  dynamicRange: number | null; // dB crest-like
  brightness: number | null; // normalized spectral centroid, 0..1
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
}

export interface TrackGenrePreset {
  gains: number[];
  source: "direct" | "inherited";
  inheritedFrom: { slug: string; name: string } | null;
}

export interface TrackGenre {
  primary: { slug: string; name: string; canonical: boolean } | null;
  topLevel: { slug: string; name: string } | null;
  source: "album" | "artist" | "track" | null;
  preset: TrackGenrePreset | null;
}

export type EqSource = EffectiveEq["source"];
export type EqCurve = Pick<
  EffectiveEq,
  "source" | "gains" | "label" | "reasoning" | "genre"
>;
export type EqDataStatus = "idle" | "loading" | "ready" | "unavailable";
