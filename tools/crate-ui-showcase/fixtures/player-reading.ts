import type { TrackInfo } from "../../../app/listen/src/lib/track-info-data";
import { IMAGE_SAMPLES } from "./image-identity";
export const READING_TRACK = {
  id: "review-low-tide",
  title: "Low Tide",
  artist: "Costa Norte",
  album: "A place by the sea",
  albumCover: IMAGE_SAMPLES[0],
};
export const READING_INFO: TrackInfo = {
  title: READING_TRACK.title,
  artist: READING_TRACK.artist,
  album: READING_TRACK.album,
  format: "flac",
  bitrate: 1411,
  sample_rate: 96000,
  bit_depth: 24,
  bpm: 128,
  audio_key: "C",
  audio_scale: "minor",
  energy: 0.8,
  danceability: 0.62,
  valence: 0.3,
  acousticness: 0.22,
  instrumentalness: 0.9,
  loudness: -8.4,
  dynamic_range: 9.2,
  mood_json: { focused: 0.8, calm: 0.62, warm: 0.46 },
  lastfm_listeners: 24100,
  lastfm_playcount: 184000,
  popularity: 75,
  rating: 4,
  bliss_signature: { texture: 0.7, motion: 0.6, density: 0.8 },
};
export const READING_LINES = [
  { time: 0, text: "When the light comes in" },
  { time: 12, text: "I keep a place for you" },
  { time: 24, text: "A little closer to the sea" },
  { time: 45, text: "And all the roads that brought us here" },
  { time: 60, text: "Are written in the tide" },
];
export function readingInfo(state: string): TrackInfo {
  if (state === "zero")
    return {
      ...READING_INFO,
      energy: 0,
      lastfm_listeners: 0,
      lastfm_playcount: 0,
      popularity: 0,
      acousticness: 0,
      instrumentalness: 0,
    };
  if (state === "partial")
    return {
      ...READING_INFO,
      format: null,
      bitrate: null,
      bit_depth: null,
      sample_rate: null,
      bpm: null,
      audio_key: null,
      audio_scale: null,
      energy: null,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
      loudness: null,
      dynamic_range: null,
      mood_json: null,
      bliss_signature: null,
      rating: null,
      lastfm_listeners: null,
      lastfm_playcount: null,
      popularity: null,
    };
  if (state === "long")
    return {
      ...READING_INFO,
      title:
        "A long title for a song that keeps the words together even on a small screen",
      artist: "An Artist With A Very Long Name",
      album: "A Collection Of Recordings From Another Time",
    };
  return READING_INFO;
}
