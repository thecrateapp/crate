// The hero's background loop: a director take (crate-for-ryoku tools/director,
// timelines/background.json), blurred and darkened when it is encoded, uploaded with
// `make ryoku-media-sync` like the shots. Bump VERSION when the loop is re-encoded:
// /media/ is cached for 30 days.
const VERSION = "2026-11-16";
const url = (file: string) => `/media/backdrop/${file}?v=${VERSION}`;

export const BACKDROP = {
  poster: url("background-poster.webp"),
  webm: url("background.webm"),
  mp4: url("background.mp4"),
};
