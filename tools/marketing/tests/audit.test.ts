import { describe, expect, it } from "vitest";
import {
  contactSheetArgs,
  declaredSoundtracks,
  renderAuditReport,
  type MediaFinding,
} from "../src/audit";

describe("contactSheetArgs", () => {
  it("samples one frame per second into a tiled sheet", () => {
    const args = contactSheetArgs("in/library.mp4", "out/library.jpg", 42);
    expect(args).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      "in/library.mp4",
      "-vf",
      "fps=1,scale=320:-2,tile=6x7",
      "-frames:v",
      "1",
      "out/library.jpg",
    ]);
  });

  it("keeps at least one row for very short clips", () => {
    expect(contactSheetArgs("a.mp4", "a.jpg", 0.4)).toContain(
      "fps=1,scale=320:-2,tile=6x1",
    );
  });
});

describe("declaredSoundtracks", () => {
  it("reads film tracks from the generated films module", () => {
    const source = `export const films = {
  listen: {
    duration: 60,
    track: "Artist — Title (Remix)",
  },
  admin: {
    duration: 45,
    track: "Other — Song",
  },
};`;
    expect(declaredSoundtracks(source)).toEqual([
      { film: "listen", track: "Artist — Title (Remix)" },
      { film: "admin", track: "Other — Song" },
    ]);
  });

  it("ignores interface fields declared before the films object", () => {
    const source = `export interface Film {
  duration: number;
  track: string;
  sources: { "16x9": FilmSources; "4x5": FilmSources };
}

export const films: Record<"listen", Film> = {
  listen: {
    duration: 60,
    track: "Artist — Title",
    sources: {
      "16x9": { webm: "/a.webm" },
    },
  },
};`;
    expect(declaredSoundtracks(source)).toEqual([
      { film: "listen", track: "Artist — Title" },
    ]);
  });
});

describe("renderAuditReport", () => {
  it("flags every file with audio and every declared soundtrack for review", () => {
    const findings: MediaFinding[] = [
      {
        path: "screencast/library.mp4",
        durationSeconds: 21.5,
        hasAudio: false,
        sheet: "out/audit/library.jpg",
      },
      {
        path: "film/listen-4x5.mp4",
        durationSeconds: 60,
        hasAudio: true,
        sheet: "out/audit/listen-4x5.jpg",
      },
    ];
    const report = renderAuditReport(
      findings,
      [{ film: "listen", track: "Artist — Title" }],
      "2026-11-03",
    );
    expect(report).toContain(
      "| `film/listen-4x5.mp4` | 60.0 s | yes | `out/audit/listen-4x5.jpg` | review |",
    );
    expect(report).toContain(
      "| `screencast/library.mp4` | 21.5 s | no | `out/audit/library.jpg` | check visuals |",
    );
    expect(report).toContain(
      "| listen | Artist — Title | needs a licence or replacement |",
    );
  });
});
