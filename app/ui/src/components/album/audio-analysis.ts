export interface SmartMixAnalysis {
  analyzer?: string | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  duration_ms?: number | null;
  duration_source?: string | null;
  time_signature?: number | null;
  global_energy?: number | null;
  intro_energy?: number | null;
  outro_energy?: number | null;
  intro_tempo_stability?: number | null;
  outro_tempo_stability?: number | null;
  quality?: string | null;
  status?: string | null;
  profile_version?: number | null;
  analyzer_version?: string | null;
  analyzed_at?: string | null;
  source_stale_at?: string | null;
  integrated_lufs?: number | null;
  true_peak_dbfs?: number | null;
  intro_lufs?: number | null;
  outro_lufs?: number | null;
  intro_bpm?: number | null;
  outro_bpm?: number | null;
  bpm_confidence?: number | null;
  tempo_stability?: number | null;
  camelot?: string | null;
  intro_cue_ms?: number | null;
  outro_cue_ms?: number | null;
  active_start_ms?: number | null;
  active_end_ms?: number | null;
  measurement_version?: string | null;
  profile_revision?: string | null;
  source_revision?: string | null;
  bliss_vector_revision?: string | null;
}
export interface BlissAnalysis {
  available?: boolean;
  state?: string | null;
  revision_source?: string | null;
  dimensions?: number | null;
  revision?: string | null;
  computed_at?: string | null;
  model_version?: string | null;
}
export interface AudioAnalysisTrack {
  track_id?: number;
  track_entity_uid?: string;
  album_id?: number;
  analysis_state?: string | null;
  analysis_completed_at?: string | null;
  tempo: number | null;
  key: string | null;
  scale: string | null;
  energy: number | null;
  mood: Record<string, number> | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  spectral_complexity: number | null;
  smart_mix?: SmartMixAnalysis | null;
  bliss?: BlissAnalysis | null;
}
export function analysisForTrack(
  data: Record<string, AudioAnalysisTrack> | null | undefined,
  track: {
    id?: number;
    entity_uid?: string;
    tags: { title?: string };
    filename: string;
  },
): AudioAnalysisTrack | undefined {
  if (!data) return undefined;
  const entries = Object.values(data);
  const matched = entries.find(
    (entry) =>
      (track.entity_uid && entry.track_entity_uid === track.entity_uid) ||
      (track.id != null && entry.track_id === track.id),
  );
  if (matched) return matched;
  const fallback = data[(track.tags.title || track.filename).toLowerCase()];
  // Identified records from another album must never be reused for a matching title.
  if (fallback && (fallback.track_id != null || fallback.track_entity_uid))
    return undefined;
  return fallback;
}
