// Camelot mapping follows crate/bliss.py. Unknown or incomplete keys remain literal.
const MAJOR = [
  "8B",
  "3B",
  "10B",
  "5B",
  "12B",
  "7B",
  "2B",
  "9B",
  "4B",
  "11B",
  "6B",
  "1B",
];
const MINOR = [
  "5A",
  "12A",
  "7A",
  "2A",
  "9A",
  "4A",
  "11A",
  "6A",
  "1A",
  "8A",
  "3A",
  "10A",
];
const PITCH: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};
export function formatMusicalKey(
  key?: string | null,
  scale?: string | null,
): string | null {
  const value = key?.trim();
  if (!value) return null;
  if (/^(?:[1-9]|1[0-2])[ab]$/i.test(value)) return value.toUpperCase();
  const pitch = value.replace(/♯/g, "#").replace(/♭/g, "b");
  const normalized = pitch.charAt(0).toUpperCase() + pitch.slice(1);
  const mode = scale?.trim().toLowerCase();
  const index = Object.prototype.hasOwnProperty.call(PITCH, normalized)
    ? PITCH[normalized]
    : undefined;
  return index !== undefined && (mode === "major" || mode === "minor")
    ? (mode === "major" ? MAJOR : MINOR)[index]!
    : value;
}
export function formatTrackAnalysis(
  bpm?: number | null,
  key?: string | null,
  scale?: string | null,
): string | null {
  const tempo =
    typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0
      ? String(Math.round(bpm))
      : null;
  return (
    [tempo, formatMusicalKey(key, scale)].filter(Boolean).join(" · ") || null
  );
}
export function formatTrackQuality(
  format?: string | null,
  bitDepth?: number | null,
  sampleRate?: number | null,
): string | null {
  const type = format?.replace(/^\./, "").trim().toUpperCase();
  if (!type) return null;
  const lossless = ["FLAC", "ALAC", "WAV", "AIFF"].includes(type);
  const depth =
    bitDepth != null && Number.isFinite(bitDepth) && bitDepth > 0
      ? bitDepth
      : null;
  const rate =
    sampleRate != null && Number.isFinite(sampleRate) && sampleRate > 0
      ? sampleRate / 1000
      : null;
  return lossless && depth && rate
    ? `${type} ${depth}/${Number(rate.toFixed(1))}`
    : type;
}
