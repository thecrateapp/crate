import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StemsTab } from "./StemsTab";
import {
  buildStemsTabModel,
  decodeLevels,
  hasStemData,
  type SmartMixTrackStemAnalysis,
  type SmartMixTrackStems,
} from "./stems-model";

const REVISION = "863ac21a".padEnd(64, "0");
const OLD_REVISION = "4f1c0a9e".padEnd(64, "1");
const WINDOWS = 128;

function base64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}

function analysis(
  changes: Partial<SmartMixTrackStemAnalysis> = {},
): SmartMixTrackStemAnalysis {
  return {
    producerKind: "server",
    producer: "crate-server/stems-1",
    separatorModel: "htdemucs",
    separatorVersion: "htdemucs-onnx-1",
    sourceRevision: REVISION,
    hopMs: 250,
    durationMs: 32_000,
    levels: {
      drums: base64(Array(WINDOWS).fill(200)),
      bass: base64(Array(WINDOWS).fill(120)),
      other: base64(Array(WINDOWS).fill(30)),
      vocals: base64(Array(WINDOWS).fill(180)),
    },
    drumBeatsMs: [500, 1_000, 1_500],
    current: true,
    chosen: true,
    createdAt: "2026-11-09T02:14:07Z",
    updatedAt: "2026-11-09T02:14:07Z",
    contributedBy: null,
    ...changes,
  };
}

function stems(changes: Partial<SmartMixTrackStems> = {}): SmartMixTrackStems {
  return {
    trackId: 44,
    trackEntityUid: "track-uid",
    durationMs: 32_000,
    sourceRevision: REVISION,
    profileAnalyzedAt: "2026-11-03T12:58:13Z",
    sourceStaleAt: null,
    vocalDetector: "yamnet-2",
    phrases: [
      { startMs: 500, endMs: 16_500, kind: "intro", bars: 8, voiced: false },
      { startMs: 16_500, endMs: 32_000, kind: "body", bars: 8, voiced: true },
    ],
    analyses: [analysis()],
    stems: {
      producer: "crate-server/stems-1",
      separatorModel: "htdemucs",
      separatorVersion: "htdemucs-onnx-1",
      phrases: [
        {
          startMs: 500,
          endMs: 16_500,
          drums: 200,
          bass: 120,
          other: 30,
          vocals: 0,
        },
        {
          startMs: 16_500,
          endMs: 32_000,
          drums: 200,
          bass: 120,
          other: 30,
          vocals: 180,
        },
      ],
    },
    job: {
      state: "ready",
      attempts: 1,
      maxAttempts: 3,
      requestedAt: "2026-11-09T02:10:00Z",
      startedAt: "2026-11-09T02:11:18Z",
      finishedAt: "2026-11-09T02:14:07Z",
      lastError: null,
      secondsPerTrack: 169,
    },
    file: {
      bytes: 42_200_000,
      separatorModel: "htdemucs",
      separatorVersion: "htdemucs-onnx-1",
      sourceRevision: REVISION,
      current: true,
      createdAt: "2026-11-09T02:14:07Z",
      lastUsedAt: "2026-11-09T01:41:52Z",
    },
    playlists: [
      {
        playlistId: 41,
        name: "Warehouse 03:00",
        owner: { id: 2, username: "diego.rin" },
        enabled: true,
        ready: 41,
        total: 48,
      },
    ],
    ...changes,
  };
}

function renderTab(data: SmartMixTrackStems, canManage = true) {
  return render(<StemsTab model={buildStemsTabModel(data, { canManage })} />);
}

describe("Stems tab", () => {
  let rect: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // jsdom has no layout: give the lanes the dialog's width.
    rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 1_200, height: 0 } as DOMRect);
  });
  afterEach(() => rect.mockRestore());

  it("the stems tab appears only with stem data", () => {
    expect(hasStemData(null)).toBe(false);
    expect(
      hasStemData(stems({ analyses: [], file: null, job: null, stems: null })),
    ).toBe(false);
    // A finished job alone has nothing to show.
    expect(
      hasStemData(
        stems({ analyses: [], file: null, stems: null, playlists: [] }),
      ),
    ).toBe(false);
    expect(hasStemData(stems())).toBe(true);
    expect(hasStemData(stems({ analyses: [], job: null, stems: null }))).toBe(
      true,
    );
    for (const state of ["pending", "analyzing", "failed"] as const) {
      expect(
        hasStemData(
          stems({
            analyses: [],
            file: null,
            stems: null,
            job: { ...stems().job!, state },
          }),
        ),
      ).toBe(true);
    }
    // A response without the arrays (an older server) is not stem data.
    expect(hasStemData({} as SmartMixTrackStems)).toBe(false);
  });

  it("levels draw one lane per stem", () => {
    const { container } = renderTab(stems());

    const lanes = container.querySelectorAll("g.stem-lanes-lane[data-stem]");
    expect([...lanes].map((lane) => lane.getAttribute("data-stem"))).toEqual([
      "drums",
      "bass",
      "other",
      "vocals",
    ]);
    for (const lane of lanes) {
      expect(lane.querySelectorAll("[data-slot=stem-ridge]")).toHaveLength(1);
      // One lit bar per phrase of the stems layer.
      expect(lane.querySelectorAll("[data-slot=stem-plateau]")).toHaveLength(2);
    }
    // "Other" is neither stored nor read by the planner: a neutral crest, no glow.
    const other = container.querySelector('[data-stem="other"]')!;
    expect(other).toHaveAttribute("data-quiet", "true");
    expect(other.querySelector("polygon")).toHaveAttribute(
      "fill",
      "url(#stem-quiet)",
    );
    expect(other.querySelector("rect")).not.toHaveAttribute("filter");
    expect(
      container
        .querySelector('[data-stem="drums"] [data-slot=stem-plateau]')
        ?.getAttribute("filter"),
    ).toBe("url(#stem-glow)");
    // The track's mean of each stem on the right: 200 is −13 dB.
    expect(
      container.querySelector('[data-stem="drums"] .stem-lanes-value'),
    ).toHaveTextContent("−13 dB");
    expect(screen.getByRole("list", { name: "Phrases" })).toHaveTextContent(
      "intro · 8",
    );
    expect(
      container.querySelectorAll("[data-slot=phrase-boundary]"),
    ).toHaveLength(3);
    expect(container.querySelector("[data-slot=drum-beats]")).toHaveTextContent(
      "Drum beats",
    );
    expect(container.querySelector("[data-slot=voice-row]")).toHaveTextContent(
      "YAMNet voice",
    );
    const layer = screen.getByRole("table", { name: "Stems layer by phrase" });
    expect(within(layer).getAllByRole("row")).toHaveLength(3);
    expect(layer).toHaveTextContent("≤ −60 dB");
  });

  it("draws a stale analysis without accent, plateaus or layer", () => {
    const { container } = renderTab(
      stems({
        sourceStaleAt: "2026-11-07T10:00:00Z",
        analyses: [
          analysis({
            current: false,
            chosen: false,
            sourceRevision: OLD_REVISION,
          }),
        ],
        stems: null,
        file: null,
        job: { ...stems().job!, state: "failed", attempts: 3 },
      }),
    );

    expect(container.querySelector("[data-slot=stem-lanes]")).toHaveAttribute(
      "data-stale",
      "true",
    );
    expect(container.querySelectorAll("[data-slot=stem-plateau]")).toHaveLength(
      0,
    );
    expect(screen.getByText("Stale analysis")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/^file changed /)).toBeInTheDocument();
    expect(screen.getByText(/the planner ignores it/)).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Stems layer by phrase" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "the file of the old revision was released to the quota",
      ),
    ).toBeInTheDocument();
  });

  it("the source says server or Decks upload", () => {
    const { unmount } = renderTab(stems());
    expect(screen.getByText("Server analysis")).toBeInTheDocument();
    expect(screen.getByText("Crate server")).toBeInTheDocument();
    expect(screen.getByText("Current file")).toBeInTheDocument();
    expect(screen.getByText("863ac21a")).toBeInTheDocument();
    expect(screen.getByText("42.2 MB")).toBeInTheDocument();
    expect(screen.getByText("diego.rin · 41/48")).toBeInTheDocument();
    unmount();

    renderTab(
      stems({
        analyses: [
          analysis({
            producerKind: "decks",
            producer: "crate-decks/0.4.0",
            contributedBy: { id: 2, username: "diego.rin" },
          }),
        ],
        job: null,
        file: null,
        playlists: [],
      }),
    );
    expect(screen.getAllByText("Crate Decks upload")).toHaveLength(2);
    expect(screen.getByText("by diego.rin")).toBeInTheDocument();
    expect(screen.getByText("crate-decks/0.4.0")).toBeInTheDocument();
    expect(screen.getByText("in no Smart Mix playlist")).toBeInTheDocument();
    expect(
      screen.getByText("Decks keeps its own lossless sidecar"),
    ).toBeInTheDocument();
  });

  it("admins see the last error and other users don't", () => {
    const failed = stems({
      analyses: [],
      stems: null,
      file: null,
      job: {
        ...stems().job!,
        state: "failed",
        attempts: 3,
        lastError: "ffmpeg could not decode Assimilate.flac",
      },
    });

    const { unmount } = renderTab(failed, true);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText("ffmpeg could not decode Assimilate.flac"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^3 of 3 attempts · last /)).toBeInTheDocument();
    unmount();

    // The server leaves the error out for them; the tab never shows one either.
    renderTab(failed, false);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText(/ffmpeg/)).toBeNull();
  });

  it("shows a separation in progress without levels", () => {
    const now = Date.parse("2026-11-09T02:13:00Z");
    const model = buildStemsTabModel(
      stems({
        analyses: [],
        stems: null,
        file: null,
        job: {
          ...stems().job!,
          state: "analyzing",
          startedAt: "2026-11-09T02:11:00Z",
          finishedAt: null,
          secondsPerTrack: 240,
        },
      }),
      { canManage: false, now },
    );
    expect(model.job?.detail).toBe(
      "attempt 1 of 3 · started 2 min ago · about 2 min left",
    );
    const { container } = render(<StemsTab model={model} />);
    expect(screen.getByText("Separating on the server")).toBeInTheDocument();
    expect(screen.getByText("Separating")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-slot=stem-ridge]")).toHaveLength(
      0,
    );
    expect(
      screen.getByText("Separating on the server · levels appear when it ends"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No stem analysis of this track yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("written when the separation ends"),
    ).toBeInTheDocument();
  });

  it("describes a finished separation by its attempts and time", () => {
    const model = buildStemsTabModel(stems(), { canManage: true });
    expect(model.job?.detail).toMatch(/^1 of 3 attempts · 2 min 49 s · /);
    expect(decodeLevels(base64([0, 128, 255]))).toEqual([0, 128, 255]);
  });
});
