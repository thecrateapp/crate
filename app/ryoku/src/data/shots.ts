import type { ShowcaseShot } from "@crate-web/components/showcase/types";

// Stills from the director's takes, composed by crate-for-ryoku's tools/cut and
// uploaded with `make ryoku-media-sync`: they stay out of the image and git, like
// the clips they replace until a fluid screencast exists.
// Bump when the shots are recomposed: the media location is cached for 30 days (and
// Cloudflare keeps it), so a new set needs new URLs.
const VERSION = "2026-11-16.2";
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
    "Crate's mark on the bar opens a panel in the same glass and cyan as the app.",
    "The crate-mark panel open from the QS Bar with now playing and the equalizer",
  ),
  shot(
    "controls",
    "Controls",
    "Ryoku's Controls in Crate's glass, hairlines and one cyan accent.",
    "The Controls panel with system stats, quick toggles and power profiles",
  ),
  shot(
    "launcher",
    "Launcher",
    "Ryoku's launcher in Crate's type, with album covers from your library.",
    "The launcher searching the Crate library for an artist",
  ),
  shot(
    "ask",
    "Ask Rashin",
    "Ryoku's Ask Rashin, restyled with Crate's field, chips and mono labels.",
    "The Ask Rashin panel with a question about the dock style",
  ),
  shot(
    "rashin",
    "Rashin",
    "Rashin, Ryoku's companion, on Crate's dark canvas and display type.",
    "The Rashin window on its overview with the clock, system load and code intelligence",
  ),
  shot(
    "settings",
    "Settings",
    "Ryoku's settings, drawn with Crate's panels, hairlines and type.",
    "Ryoku's settings window on the Animations page",
  ),
  shot(
    "qsbar-settings",
    "QS Bar layout",
    "The QS Bar's own settings, restyled with Crate's glass and toggles.",
    "The QS Bar settings on the Layout page with the left, centre and right lanes",
  ),
  shot(
    "audio",
    "Audio",
    "Ryoku's audio widget, redrawn in Crate's glass and cyan.",
    "The audio widget with output volume, devices, the Crate app and microphones",
  ),
  shot(
    "network",
    "Network",
    "Ryoku's network widget, in the same glass as every other panel.",
    "The network widget with the connected Wi-Fi network and nearby networks",
  ),
  shot(
    "temperature",
    "Temperature",
    "Ryoku's temperature readout, with Crate's mono numbers and rails.",
    "The temperature widget with CPU package, CPU core, GPU and NVMe readings",
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
    "Ryoku's Kit in Crate's palette and mono labels.",
    "Ryoku's Kit window listing keybindings",
  ),
  shot(
    "pickers",
    "Pickers",
    "Ryoku's wallpaper browser, framed in Crate's glass.",
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
