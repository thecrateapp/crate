import type { ScreencastChapter } from "@crate-web/components/screencast/types";

// The tour's chapters, recorded live on a Ryoku desktop and uploaded to the host's
// media mount like the shots: they stay out of the image and git.
// Bump when the clips are recut: the media location is cached for 30 days (and
// Cloudflare keeps it), so a new cut needs new URLs.
const VERSION = "2026-11-16";
const url = (file: string) => `/media/tour/${file}?v=${VERSION}`;

const CHAPTERS = [
  ["music", "Music"],
  ["bar", "Bar"],
  ["panels", "Panels"],
  ["rashin", "Rashin"],
  ["desktop", "Desktop"],
] as const;

export const TOUR: ScreencastChapter[] = CHAPTERS.map(([id, title], index) => ({
  id,
  number: String(index + 1).padStart(2, "0"),
  title,
  poster: url(`${id}.jpg`),
  webm: url(`${id}.webm`),
  mp4: url(`${id}.mp4`),
}));
