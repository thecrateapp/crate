import type { ShowcaseShot } from "@crate-web/components/showcase/types";

// Stills from the director's takes, composed by crate-for-ryoku's tools/cut and
// uploaded with `make ryoku-media-sync`: they stay out of the image and git, like
// the clips they replace until a fluid screencast exists.
// Bump when the shots are recomposed: the media location is cached for 30 days (and
// Cloudflare keeps it), so a new set needs new URLs.
const VERSION = "2026-11-16";
const url = (file: string) => `/media/shots/${file}.webp?v=${VERSION}`;

const shot = (
  id: string,
  title: string,
  caption: string,
  alt: string,
): ShowcaseShot => ({
  title,
  caption,
  alt,
  src: url(id),
  srcSmall: url(`${id}-1280`),
  width: 2560,
  height: 1440,
  portrait: url(`${id}-portrait`),
  portraitSmall: url(`${id}-portrait-1080`),
  portraitWidth: 1620,
  portraitHeight: 2025,
});

export const SHOTS: ShowcaseShot[] = [
  shot(
    "desktop",
    "The Crate desktop",
    "Ryoku in Crate's palette and type: the QS Bar on top, the shima dock on the side, Crate in the middle.",
    "A Ryoku desktop with the Crate theme and the Crate app open on an artist page",
  ),
  shot(
    "qsbar",
    "QS Bar and crate-mark",
    "The Crate mark on the bar: now playing, transport and Crate's equalizer in one panel.",
    "The crate-mark panel open from the QS Bar with now playing and the equalizer",
  ),
  shot(
    "controls",
    "Controls",
    "Super+Esc for power, session and quick toggles, in the same glass as everything else.",
    "The Controls panel with system stats, quick toggles and power profiles",
  ),
  shot(
    "launcher",
    "Launcher",
    "Apps, files and your Crate library in one field. Type cr to search Crate alone.",
    "The launcher searching the Crate library for an artist",
  ),
  shot(
    "gamebar",
    "Game Bar",
    "Ryoku's Game Bar in Crate's type and hairlines.",
    "The Game Bar with its performance panel",
  ),
  shot(
    "kit",
    "Kit",
    "Ryoku's control kit in Crate's palette: the Beam, chips, sliders and toggles.",
    "Ryoku's Kit window listing keybindings",
  ),
  shot(
    "pickers",
    "Pickers",
    "Wallpaper, rice and theme pickers drawn to the same rules.",
    "The wallpaper browser fanning out wallpapers over the desktop",
  ),
  shot(
    "dock",
    "The shima dock",
    "A glass body with 6 px corners, a small lift on hover and a dot for every open window.",
    "The shima dock with a tooltip on the Crate icon",
  ),
  shot(
    "notifications",
    "Notifications",
    "Hairline cards with Crate's type and cyan marks.",
    "Two Crate notifications under the QS Bar",
  ),
];
