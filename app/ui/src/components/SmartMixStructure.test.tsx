import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({ useApiMock: vi.fn() }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

import {
  SmartMixStructure,
  SmartMixTrackStructure,
  type SmartMixTrackStructureData,
} from "./SmartMixStructure";

// 100 s at 120 BPM: a bar every 2 s from 0.5 s.
const structure: SmartMixTrackStructureData = {
  trackId: 7,
  analyzerVersion: "smart-mix-audio-v7",
  profileVersion: 1,
  durationMs: 100_000,
  structureConfidence: 0.82,
  phrases: [
    {
      startBeat: 0,
      startMs: 500,
      endMs: 16_500,
      bars: 8,
      energy: 0.4,
      deltaEnergy: null,
      kind: "intro",
      vocalPresence: null,
    },
    {
      startBeat: 32,
      startMs: 16_500,
      endMs: 48_500,
      bars: 16,
      energy: 0.8,
      deltaEnergy: 0.4,
      kind: "peak",
      vocalPresence: null,
    },
    {
      startBeat: 96,
      startMs: 48_500,
      endMs: 64_500,
      bars: 8,
      energy: 0.3,
      deltaEnergy: -0.5,
      kind: "break",
      vocalPresence: null,
    },
  ],
  energyCurve: [0, 51, 102, 153, 204, 255],
  barStartsMs: [500, 2_500, 4_500, 6_500, 8_500, 10_500],
};

describe("SmartMixStructure", () => {
  beforeEach(() => useApiMock.mockReset());

  it("renders phrase boundaries and kinds", () => {
    const { container } = render(<SmartMixStructure structure={structure} />);

    const phrases = within(
      screen.getByRole("list", { name: "Phrases" }),
    ).getAllByRole("listitem");
    expect(phrases.map((phrase) => phrase.textContent)).toEqual([
      "intro · 8",
      "peak · 16",
      "break · 8",
    ]);
    expect(phrases[1]).toHaveAccessibleName(
      "Peak, 16 bars, 0:16.5 to 0:48.5, energy 80%",
    );
    expect(phrases[1]).toHaveAttribute("data-kind", "peak");

    // One 1 px rule at each phrase start and one where the last phrase ends.
    const boundaries = container.querySelectorAll(
      'line[data-slot="phrase-boundary"]',
    );
    expect([...boundaries].map((line) => line.getAttribute("x1"))).toEqual([
      "0.5",
      "16.5",
      "48.5",
      "64.5",
    ]);
    for (const line of boundaries)
      expect(line).toHaveAttribute("vector-effect", "non-scaling-stroke");

    const lane = container.querySelector('polyline[data-slot="energy-lane"]');
    expect(lane?.getAttribute("points")).toBe(
      "0.5,100 2.5,80 4.5,60 6.5,40 8.5,20 10.5,0",
    );
    expect(lane).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(screen.getByText("Confidence 82%")).toBeInTheDocument();
  });

  it("tells a profile without structure from one that could not be segmented", () => {
    const { rerender } = render(
      <SmartMixStructure
        structure={{
          ...structure,
          analyzerVersion: "smart-mix-audio-v6",
          phrases: null,
          energyCurve: null,
          barStartsMs: null,
          structureConfidence: null,
        }}
      />,
    );
    expect(
      screen.getByText(/No phrases are stored for this profile/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Phrases" })).toBeNull();

    rerender(
      <SmartMixStructure
        structure={{ ...structure, phrases: [], structureConfidence: 0 }}
      />,
    );
    expect(
      screen.getByText(/The analyzer found no regular phrases/),
    ).toBeInTheDocument();
    expect(
      document.querySelector('polyline[data-slot="energy-lane"]'),
    ).not.toBeNull();
  });

  it("loads the stored structure of one track", () => {
    useApiMock.mockReturnValue({
      data: structure,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<SmartMixTrackStructure trackId={7} />);

    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/smart-mix/tracks/7/structure",
    );
    expect(screen.getByRole("list", { name: "Phrases" })).toBeInTheDocument();
  });

  it("reports a missing structure without failing the dialog", () => {
    useApiMock.mockReturnValue({
      data: null,
      loading: false,
      error: "Smart Mix profile not found",
      refetch: vi.fn(),
    });

    render(<SmartMixTrackStructure trackId={7} />);

    expect(
      screen.getByText("The phrase structure is unavailable."),
    ).toBeInTheDocument();
  });
});
