import type { Cut, ShotEdit, Source } from "../edit";
import { HIGH, LOW, PUSH, REST, TILT_LEFT, TILT_RIGHT } from "./poses";

const TAB_CLICKS = [0.9, 1.7, 2.4, 3.2];

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

const analysis: Cut[] = [
  {
    beats: 2,
    layout: "duo",
    sources: [desktop("analysis", 0), mobile("analysis", 0)],
    move: [HIGH, PUSH],
  },
  ...TAB_CLICKS.flatMap((click, index): Cut[] => [
    {
      beats: 2,
      layout: "desktop",
      sources: [desktop("analysis", click - 0.05)],
      move: [index % 2 ? TILT_RIGHT : TILT_LEFT, PUSH],
    },
    ...(index < TAB_CLICKS.length - 1
      ? [
          {
            beats: 2,
            layout: "phone" as const,
            sources: [mobile("analysis", click + 0.1)],
            move: [index % 2 ? LOW : HIGH, REST] as Cut["move"],
          },
        ]
      : []),
  ]),
];

export const ADMIN_EDIT: ShotEdit[] = [
  {
    shot: "Health",
    cuts: [
      {
        beats: 8,
        layout: "duo",
        sources: [desktop("health", 0.2, 0.7), mobile("health", 0.2, 0.7)],
        move: [TILT_LEFT, PUSH],
        caption: "Your server.",
      },
      {
        beats: 8,
        layout: "desktop",
        sources: [desktop("library-health", 0.5)],
        move: [TILT_RIGHT, REST],
      },
    ],
  },
  {
    shot: "Scan and import",
    cuts: [
      {
        beats: 8,
        layout: "duo",
        sources: [desktop("imports", 0.2), mobile("imports", 0.2)],
        move: [TILT_RIGHT, REST],
      },
      {
        beats: 8,
        layout: "desktop",
        sources: [desktop("release-radar", 0.5)],
        move: [HIGH, PUSH],
      },
    ],
  },
  {
    shot: "Enrichment",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("enrichment", 0.3)],
        move: [LOW, PUSH],
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("analysis", 0), mobile("analysis", 0)],
        move: [TILT_LEFT, REST],
      },
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("browse", 0.5)],
        move: [TILT_RIGHT, PUSH],
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("enrichment", 2), mobile("enrichment", 1)],
        move: [HIGH, REST],
      },
    ],
  },
  {
    shot: "Analysis queue",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("album", 1)],
        move: [TILT_LEFT, PUSH],
      },
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("analysis-queue", 1.5)],
        move: [HIGH, REST],
      },
      {
        beats: 4,
        layout: "phone",
        sources: [mobile("enrichment", 2.5)],
        move: [LOW, PUSH],
      },
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("health", 2.8)],
        move: [TILT_RIGHT, REST],
      },
    ],
  },
  { shot: "Analysis", cuts: analysis },
  {
    shot: "Acquisition",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("acquisition", 0.1)],
        move: [TILT_RIGHT, PUSH],
        eyebrow: "Tidal · Soulseek",
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("release-radar", 1), mobile("release-radar", 1)],
        move: [HIGH, REST],
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("imports", 2), mobile("imports", 0.5)],
        move: [LOW, PUSH],
      },
    ],
  },
  {
    shot: "Agents",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("agents", 0)],
        move: [TILT_LEFT, PUSH],
        eyebrow: "MCP",
      },
      {
        beats: 4,
        layout: "duo",
        sources: [
          desktop("system-playlists", 0.5),
          mobile("system-playlists", 0.5),
        ],
        move: [TILT_RIGHT, REST],
      },
      {
        beats: 4,
        layout: "phone",
        sources: [mobile("agents", 0)],
        move: [HIGH, PUSH],
      },
    ],
  },
  {
    shot: "Stats",
    cuts: [
      {
        beats: 4,
        layout: "desktop",
        sources: [desktop("stats", 0)],
        move: [TILT_RIGHT, PUSH],
      },
      {
        beats: 4,
        layout: "duo",
        sources: [desktop("stack", 0.5), mobile("stack", 0.5)],
        move: [HIGH, REST],
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
        caption: "Crate. Admin.",
      },
    ],
  },
];
