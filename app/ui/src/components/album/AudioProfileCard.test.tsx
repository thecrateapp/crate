import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AudioProfileCard } from "./AudioProfileCard";
import type { AudioAnalysisTrack } from "./audio-analysis";
vi.mock("@nivo/radar", () => ({ ResponsiveRadar: () => null }));
beforeEach(() =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  ),
);
const empty: AudioAnalysisTrack = {
  tempo: null,
  key: null,
  scale: null,
  energy: null,
  mood: null,
  danceability: null,
  valence: null,
  acousticness: null,
  instrumentalness: null,
  loudness: null,
  dynamic_range: null,
  spectral_complexity: null,
};
it("shows measured Smart Mix and Bliss references without rendering vector contents", () => {
  render(
    <AudioProfileCard
      totalTracks={1}
      analysisData={{
        track: {
          ...empty,
          tempo: 120,
          smart_mix: {
            integrated_lufs: -14.2,
            true_peak_dbfs: -0.7,
            intro_bpm: 119.5,
            outro_bpm: 120,
            bpm_confidence: 0.9,
            profile_revision: "mix-r2",
            bliss_vector_revision: "bliss-reference",
            quality: "full",
            analyzer_version: "test-analyzer",
          },
          bliss: {
            available: true,
            dimensions: 20,
            revision: "bliss-reference",
          },
        },
      }}
    />,
  );
  expect(screen.getByText("-14.2 LUFS")).toBeInTheDocument();
  expect(screen.getByText("-0.7 dBFS")).toBeInTheDocument();
  expect(screen.getByText("20 dimensions")).toBeInTheDocument();
  expect(screen.getByText("90%")).toBeInTheDocument();
  expect(screen.getByText("Profile vector reference")).toBeInTheDocument();
});
it("does not turn absent measurements into zero or count empty records as analyzed", () => {
  render(
    <AudioProfileCard
      totalTracks={3}
      analysisData={{
        first: { ...empty, smart_mix: { integrated_lufs: -10 } },
        second: { ...empty, smart_mix: { integrated_lufs: -20 } },
        missing: empty,
      }}
    />,
  );
  expect(
    screen.getByText("0 / 3 tracks with audio features"),
  ).toBeInTheDocument();
  expect(screen.getByText("-15.0 LUFS")).toBeInTheDocument();
  expect(
    screen.getByText("Tempo", { exact: false }).parentElement,
  ).toHaveTextContent("—");
  expect(
    screen.getByText(/not an integrated measurement of the album/),
  ).toBeInTheDocument();
  expect(screen.queryByText("0.0 dBFS")).not.toBeInTheDocument();
});
it("provides an explicit empty state when no analysis was returned", () => {
  render(<AudioProfileCard totalTracks={12} analysisData={{}} />);
  expect(
    screen.getByText(/No audio analysis is available/),
  ).toBeInTheDocument();
  expect(
    screen.getByText("0 / 12 tracks with audio features"),
  ).toBeInTheDocument();
});

it("groups track dialog cues separately from profile provenance and retains the measured values", () => {
  render(
    <AudioProfileCard
      totalTracks={1}
      presentation="track-dialog"
      analysisData={{
        track: {
          ...empty,
          tempo: 120,
          energy: 0.7,
          acousticness: 0.2,
          danceability: 0.6,
          smart_mix: {
            integrated_lufs: -14.2,
            true_peak_dbfs: -0.7,
            bpm_confidence: 0.9,
            intro_cue_ms: 1250,
            outro_cue_ms: 220000,
            intro_bpm: 119.5,
            outro_bpm: 120,
            intro_lufs: -15.5,
            outro_lufs: -16,
            active_start_ms: 100,
            active_end_ms: 225000,
            profile_revision: "mix-r2",
            source_revision: "source-r3",
            quality: "full",
            analyzer_version: "test-analyzer",
            status: "outdated",
          },
          bliss: {
            available: true,
            dimensions: 20,
            revision: "bliss-reference",
          },
        },
      }}
    />,
  );
  const sound = screen.getByRole("region", { name: "Sound profile" });
  expect(within(sound).getByText("Energy")).toBeInTheDocument();
  const mix = screen
    .getByRole("heading", { name: "Smart Mix" })
    .closest("section")!;
  expect(within(mix).getByText("-14.2 LUFS")).toBeInTheDocument();
  expect(within(mix).getByText("-0.7 dBFS")).toBeInTheDocument();
  expect(within(mix).getByText("90%")).toBeInTheDocument();
  expect(
    within(mix).getByText("Intro / outro cue").parentElement,
  ).toHaveTextContent("1.25 s / 220.00 s");
  for (const measurement of [
    "1.25 s",
    "220.00 s",
    "119.5 BPM",
    "120.0 BPM",
    "-15.5 LUFS",
    "-16.0 LUFS",
    "0.10 s",
    "225.00 s",
  ]) {
    expect(within(mix).getByText(measurement)).toHaveClass(
      "inline-block",
      "whitespace-nowrap",
    );
  }
  expect(
    screen.getByRole("region", { name: "Audio analysis" }),
  ).not.toHaveClass("border-t");
  expect(within(mix).queryByText("Profile revision")).not.toBeInTheDocument();
  const provenance = screen.getByRole("region", {
    name: "Analysis provenance",
  });
  expect(within(provenance).getByText("mix-r2")).toBeInTheDocument();
  expect(within(provenance).getByText("source-r3")).toBeInTheDocument();
  expect(within(provenance).getByText("test-analyzer")).toBeInTheDocument();
  expect(within(provenance).getByText("Needs refresh")).toBeInTheDocument();
  expect(
    within(provenance).queryByText("Intro / outro cue"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("bliss-reference")).toBeInTheDocument();
  expect(screen.queryByText("Track loudness range")).not.toBeInTheDocument();
});

it("retains the existing album loudness summary and provenance by default", () => {
  render(
    <AudioProfileCard
      totalTracks={1}
      analysisData={{
        track: {
          ...empty,
          smart_mix: {
            integrated_lufs: -14.2,
            profile_revision: "mix-r2",
            intro_cue_ms: 1250,
          },
        },
      }}
    />,
  );
  expect(screen.getByText("Track loudness range")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Audio analysis" })).toHaveClass(
    "border-t",
  );
  expect(screen.getByText("-14.2–-14.2 LUFS")).toBeInTheDocument();
  expect(screen.getByText("mix-r2")).toBeInTheDocument();
  expect(screen.getByText("Intro / outro cue")).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Analysis provenance" }),
  ).not.toBeInTheDocument();
});
