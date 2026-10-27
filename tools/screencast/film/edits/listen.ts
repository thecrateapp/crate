import type { Cut, ShotEdit, Source } from "../edit";
import { HIGH, LOW, PUSH, REST, TILT_LEFT, TILT_RIGHT } from "./poses";

const CRATE_CLICKS = [0.8, 1.4, 1.9, 2.4, 3.0, 3.5, 4.1, 4.7];

const desktop = (take: string, from: number, speed?: number): Source => ({
  take,
  device: "desktop",
  from,
  speed,
});
const mobile = (take: string, from: number, speed?: number): Source => ({
  take,
  device: "mobile",
  from,
  speed,
});

// One beat per screen, alternating devices, so the build feels like flicking through the app.
const acceleration: Cut[] = [
  {
    beats: 1,
    layout: "desktop",
    sources: [desktop("search", 3)],
    move: [TILT_LEFT, PUSH],
  },
  {
    beats: 1,
    layout: "phone",
    sources: [mobile("explore", 1)],
    move: [HIGH, REST],
  },
  {
    beats: 1,
    layout: "desktop",
    sources: [desktop("radar", 1)],
    move: [TILT_RIGHT, PUSH],
  },
  {
    beats: 1,
    layout: "phone",
    sources: [mobile("acceleration", 1.9)],
    move: [LOW, REST],
  },
  {
    beats: 1,
    layout: "phone",
    sources: [mobile("digging", 0.5)],
    move: [HIGH, PUSH],
  },
  {
    beats: 1,
    layout: "desktop",
    sources: [desktop("artist", 1)],
    move: [TILT_LEFT, REST],
  },
  {
    beats: 1,
    layout: "phone",
    sources: [mobile("crates-index", 0)],
    move: [LOW, PUSH],
  },
  {
    beats: 1,
    layout: "desktop",
    sources: [desktop("stats", 1)],
    move: [TILT_RIGHT, REST],
  },
];

const crates: Cut[] = CRATE_CLICKS.map((click, index) => ({
  beats: 2,
  layout: "desktop",
  sources: [desktop("crates", click - 0.05)],
  move: [index % 2 ? TILT_RIGHT : TILT_LEFT, index % 2 ? REST : PUSH],
  caption: index === 0 ? "Crates." : undefined,
  eyebrow: index === 0 ? "Only on Crate" : undefined,
}));

export const LISTEN_EDIT: ShotEdit[] = [
  {
    shot: "Waveform",
    cuts: [
      {
        beats: 8,
        layout: "card",
        card: "waveform",
        sources: [],
        caption: "Your music.",
      },
    ],
  },
  {
    shot: "Library",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("home-hero", 0.5)],
        move: [TILT_LEFT, PUSH],
      },
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("library", 0.6, 0.6)],
        move: [TILT_RIGHT, REST],
      },
    ],
  },
  {
    shot: "Everywhere",
    cuts: [
      {
        beats: 8,
        layout: "duo",
        sources: [desktop("artist", 0.5), mobile("home-hero", 0.5, 0.6)],
        move: [TILT_RIGHT, REST],
        caption: "Everywhere.",
      },
    ],
  },
  {
    shot: "Album",
    cuts: [
      {
        beats: 8,
        layout: "duo",
        sources: [desktop("album", 0.6), mobile("album", 0.6)],
        move: [REST, PUSH],
      },
    ],
  },
  {
    shot: "Player",
    cuts: [
      {
        beats: 8,
        layout: "duo",
        sources: [desktop("player", 1.4), mobile("player", 1.7)],
        move: [HIGH, REST],
      },
    ],
  },
  {
    shot: "Readouts + lyrics",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("equalizer", 5)],
        move: [TILT_LEFT, PUSH],
        eyebrow: "FLAC · 118 BPM · smart EQ",
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("lyrics", 7.6), mobile("lyrics", 7.6)],
        move: [TILT_RIGHT, REST],
        eyebrow: "Synced lyrics",
      },
    ],
  },
  { shot: "Acceleration", cuts: acceleration },
  {
    shot: "Dig",
    cuts: [
      { beats: 8, layout: "card", card: "word", sources: [], caption: "Dig." },
    ],
  },
  {
    shot: "Playlists",
    cuts: [
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("playlists", 0.5), mobile("playlists", 0.5)],
        move: [HIGH, REST],
        caption: "Playlists.",
      },
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("explore", 0.6, 0.6)],
        move: [TILT_LEFT, PUSH],
      },
      {
        beats: 4,
        layout: "phone",
        sources: [mobile("playlists", 1.2)],
        move: [LOW, PUSH],
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("search", 3), mobile("search", 3)],
        move: [TILT_RIGHT, REST],
      },
    ],
  },
  {
    shot: "Crates",
    cuts: [
      ...crates,
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("crates-index", 0), mobile("crates-index", 0)],
        move: [HIGH, PUSH],
      },
      {
        beats: 4,
        layout: "phone",
        sources: [mobile("crates", 1.4)],
        move: [LOW, REST],
      },
    ],
  },
  {
    shot: "Montage",
    cuts: [
      {
        beats: 2,
        layout: "desktop",
        sources: [desktop("stats", 0.6)],
        move: [TILT_LEFT, PUSH],
        eyebrow: "Stats",
      },
      {
        beats: 2,
        layout: "desktop",
        sources: [desktop("paths", 0.8)],
        move: [TILT_RIGHT, PUSH],
        eyebrow: "Paths",
      },
      {
        beats: 2,
        layout: "desktop",
        sources: [desktop("digging", 0.5)],
        move: [HIGH, REST],
        eyebrow: "Crate Digging",
      },
      {
        beats: 2,
        layout: "phone",
        sources: [mobile("radar", 1)],
        move: [LOW, PUSH],
        eyebrow: "Radar",
      },
    ],
  },
  {
    shot: "End card",
    cuts: [
      {
        beats: 8,
        layout: "card",
        card: "end",
        sources: [],
        caption: "Crate. Listen.",
      },
    ],
  },
];
