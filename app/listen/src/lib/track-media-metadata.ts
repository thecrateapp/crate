/** Source metadata shared by every catalog/list wire track. Unknown values stay null. */
export interface TrackMediaMetadata {
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  duration?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
}

/** Legacy library reads use bps; catalog reads use kbps. The UI contract is kbps. */
export function normalizeTrackBitrate(
  value: number | null | undefined,
): number | null {
  return value != null && value > 10000
    ? Math.round(value / 1000)
    : (value ?? null);
}
