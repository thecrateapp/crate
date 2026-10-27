import type { BeatGrid } from "./grid";

export type FilmId = "listen" | "admin";
export type Device = "desktop" | "mobile";
export type Cadence = "bar" | "half" | "beat";

export interface Section {
  bar: number;
  bars: number;
  name: string;
}

export interface Shot {
  bar: number;
  bars: number;
  title: string;
  detail: string;
  devices: Device[];
  cadence?: Cadence;
  caption?: string;
}

export interface Storyboard {
  id: FilmId;
  sections: Section[];
  shots: Shot[];
}

export const LISTEN: Storyboard = {
  id: "listen",
  sections: [
    { bar: 163, bars: 8, name: "Breakdown" },
    { bar: 171, bars: 8, name: "Build" },
    { bar: 179, bars: 14, name: "Drop" },
  ],
  shots: [
    {
      bar: 163,
      bars: 2,
      title: "Waveform",
      detail: "Black. The waveform of this very clip draws on the beat.",
      devices: [],
      caption: "Your music.",
    },
    {
      bar: 165,
      bars: 2,
      title: "Library",
      detail:
        "Desktop library grid, real covers, tilted 3D camera on a slow dolly.",
      devices: ["desktop"],
    },
    {
      bar: 167,
      bars: 2,
      title: "Everywhere",
      detail: "The phone joins with the same album.",
      devices: ["desktop", "mobile"],
      caption: "Everywhere.",
    },
    {
      bar: 169,
      bars: 2,
      title: "Album",
      detail: "Album page on both; tap play.",
      devices: ["desktop", "mobile"],
    },
    {
      bar: 171,
      bars: 2,
      title: "Player",
      detail:
        "Full-screen player on desktop, player on the phone. Primative People is playing.",
      devices: ["desktop", "mobile"],
    },
    {
      bar: 173,
      bars: 2,
      title: "Readouts + lyrics",
      detail:
        "Zoom to FLAC, 120 BPM, key, energy. Synced lyrics of Destiny (John Talabot, Pional), one line per bar.",
      devices: ["desktop", "mobile"],
      cadence: "bar",
    },
    {
      bar: 175,
      bars: 2,
      title: "Acceleration",
      detail: "A cut on every beat: queue, suggested, waveform.",
      devices: ["desktop", "mobile"],
      cadence: "beat",
    },
    {
      bar: 177,
      bars: 2,
      title: "Dig",
      detail: "Hard cut to black before the drop.",
      devices: [],
      caption: "Dig.",
    },
    {
      bar: 179,
      bars: 4,
      title: "Playlists",
      detail:
        "On the drop: a mix is generated and its tracks fall into place, desktop and phone together.",
      devices: ["desktop", "mobile"],
      cadence: "bar",
    },
    {
      bar: 183,
      bars: 6,
      title: "Crates",
      detail:
        "Albums flip like records in a crate, one per beat. Collaborators. A public crate shared.",
      devices: ["desktop", "mobile"],
      cadence: "beat",
      caption: "Crates.",
    },
    {
      bar: 189,
      bars: 2,
      title: "Montage",
      detail: "A cut every two beats: radio, paths, stats.",
      devices: ["desktop", "mobile"],
      cadence: "half",
    },
    {
      bar: 191,
      bars: 2,
      title: "End card",
      detail: "Mark on the downbeat, then the call to action.",
      devices: [],
      caption: "Crate. Listen.",
    },
  ],
};

export const ADMIN: Storyboard = {
  id: "admin",
  sections: [
    { bar: 53, bars: 8, name: "Breakdown" },
    { bar: 61, bars: 8, name: "Build" },
    { bar: 69, bars: 14, name: "Drop" },
  ],
  shots: [
    {
      bar: 53,
      bars: 4,
      title: "Health",
      detail: "Instance health panel; slow 3D camera.",
      devices: ["desktop"],
    },
    {
      bar: 57,
      bars: 4,
      title: "Scan and import",
      detail: "The scan and import queue moves.",
      devices: ["desktop", "mobile"],
    },
    {
      bar: 61,
      bars: 4,
      title: "Enrichment",
      detail: "The enrichment pipeline at work: tasks, providers, progress.",
      devices: ["desktop"],
    },
    {
      bar: 65,
      bars: 4,
      title: "Analysis queue",
      detail: "The analysis queue advances one step per beat.",
      devices: ["desktop"],
      cadence: "beat",
      caption: "Analysing LIFT ME UP",
    },
    {
      bar: 69,
      bars: 4,
      title: "Analysis",
      detail:
        "Slam into the instruments: 122 BPM, key, mood map, energy. A cut on every beat.",
      devices: ["desktop", "mobile"],
      cadence: "beat",
    },
    {
      bar: 73,
      bars: 3,
      title: "Acquisition",
      detail: "Soulseek and Tidal downloading into the import queue.",
      devices: ["desktop", "mobile"],
      cadence: "bar",
    },
    {
      bar: 76,
      bars: 3,
      title: "Agents",
      detail: "Crate Agent and MCP acting on the library.",
      devices: ["desktop", "mobile"],
      cadence: "bar",
    },
    {
      bar: 79,
      bars: 2,
      title: "Stats",
      detail: "Listening stats and system.",
      devices: ["desktop", "mobile"],
      cadence: "half",
    },
    {
      bar: 81,
      bars: 2,
      title: "End card",
      detail: "Mark and call to action.",
      devices: [],
      caption: "Crate. Admin.",
    },
  ],
};

export const STORYBOARDS: Record<FilmId, Storyboard> = {
  listen: LISTEN,
  admin: ADMIN,
};

export function storyboardErrors(board: Storyboard, grid: BeatGrid): string[] {
  const errors: string[] = [];
  const end = grid.firstBar + grid.bars;
  for (const [kind, spans] of [
    ["shot", board.shots],
    ["section", board.sections],
  ] as const) {
    let cursor = grid.firstBar;
    for (const span of spans) {
      if (span.bars < 1)
        errors.push(`${kind} at bar ${span.bar} has no length`);
      if (span.bar !== cursor)
        errors.push(`${kind} at bar ${span.bar} should start at bar ${cursor}`);
      cursor = span.bar + span.bars;
    }
    if (cursor !== end)
      errors.push(
        `${kind}s end at bar ${cursor}, the soundtrack at bar ${end}`,
      );
  }
  return errors;
}

export function shotAt(board: Storyboard, bar: number): Shot {
  return board.shots.filter((shot) => shot.bar <= bar).at(-1) ?? board.shots[0];
}

export function sectionAt(board: Storyboard, bar: number): Section {
  return (
    board.sections.filter((section) => section.bar <= bar).at(-1) ??
    board.sections[0]
  );
}
