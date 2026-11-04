import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

it("groups track dialog cues separately from profile provenance and retains the measured values", async () => {
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
  await userEvent.click(screen.getByRole("tab", { name: "Smart Mix" }));
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
  await userEvent.click(screen.getByRole("tab", { name: "Provenance" }));
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

const dialogTrack = {
  track: {
    ...empty,
    tempo: 120,
    energy: 0.7,
    smart_mix: { quality: "full", analyzer_version: "test-analyzer" },
  },
};

function renderDialog(structure = true) {
  return render(
    <AudioProfileCard
      totalTracks={1}
      presentation="track-dialog"
      analysisData={dialogTrack}
      smartMixStructure={
        structure ? <div data-testid="phrase-structure" /> : undefined
      }
    />,
  );
}

describe("track dialog tabs", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the key readings above tabs that open on Sound", () => {
    renderDialog();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Sound",
      "Smart Mix",
      "Phrases",
      "Provenance",
    ]);
    expect(screen.getByRole("tab", { name: "Sound" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Tempo")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Sound profile" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("phrase-structure")).not.toBeInTheDocument();
  });

  it("shows the phrase structure in its own tab at full width", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("tab", { name: "Phrases" }));

    const structure = screen.getByTestId("phrase-structure");
    expect(screen.getByRole("tabpanel")).toContainElement(structure);
    expect(
      screen.queryByRole("heading", { name: "Smart Mix" }),
    ).not.toBeInTheDocument();
  });

  it("leaves Phrases out without a structure", () => {
    renderDialog(false);

    expect(
      screen.queryByRole("tab", { name: "Phrases" }),
    ).not.toBeInTheDocument();
  });

  it("opens on the last tab chosen in this session", async () => {
    const first = renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: "Phrases" }));
    first.unmount();

    renderDialog();

    expect(screen.getByRole("tab", { name: "Phrases" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to Sound when the remembered tab is not offered", async () => {
    const first = renderDialog();
    await userEvent.click(screen.getByRole("tab", { name: "Phrases" }));
    first.unmount();

    renderDialog(false);

    expect(screen.getByRole("tab", { name: "Sound" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

it("lays out the album's readings beside the sound spectrum", () => {
  render(
    <AudioProfileCard
      totalTracks={3}
      analysisData={{
        "0": {
          ...empty,
          tempo: 80,
          key: "F",
          scale: "major",
          loudness: -14,
          dynamic_range: 20,
          energy: 0.6,
          smart_mix: { bpm: 81 },
        },
        "1": {
          ...empty,
          tempo: 112,
          key: "F",
          scale: "major",
          loudness: -16,
          dynamic_range: 30,
          energy: 0.7,
        },
        "2": { ...empty, tempo: 65, key: "D", scale: "minor", energy: 0.5 },
      }}
      trackLabels={{
        "0": "World In My Eyes",
        "1": "Halo",
        "2": "Personal Jesus",
      }}
    />,
  );

  const layout = document.querySelector('[data-audio-profile-layout="album"]')!;
  const [readings, sound] = [
    ...layout.querySelectorAll('[data-slot="audio-profile-column"]'),
  ];
  // Smart Mix's tempo wins over the library's when both exist, as before.
  expect(
    within(readings as HTMLElement).getByRole("img", {
      name: "Mean tempo: 86 BPM, from 65 BPM (Personal Jesus) to 112 BPM (Halo)",
    }),
  ).toBeInTheDocument();
  expect(
    within(readings as HTMLElement).getByRole("img", {
      name: "Mean loudness: -15.0 dB, from -16.0 dB (Halo) to -14.0 dB (World In My Eyes)",
    }),
  ).toBeInTheDocument();
  expect(
    within(readings as HTMLElement).getByRole("img", {
      name: "Mean dynamic range: 25.0 dB, from 20.0 dB (World In My Eyes) to 30.0 dB (Halo)",
    }),
  ).toBeInTheDocument();
  expect(
    within(within(readings as HTMLElement).getByRole("list", { name: "Keys" }))
      .getAllByRole("listitem")
      .map((chip) => chip.textContent),
  ).toEqual(["F major ×2", "D minor ×1"]);
  expect(
    within(sound as HTMLElement).getByRole("list", { name: "Sound features" }),
  ).toBeInTheDocument();
});

it("draws the album's moods as a rose beside the spectrum", () => {
  render(
    <AudioProfileCard
      totalTracks={2}
      analysisData={{
        "0": { ...empty, energy: 0.6, mood: { sad: 0.6, happy: 0.4 } },
        "1": { ...empty, energy: 0.7, mood: { sad: 0.4, happy: 0.2 } },
      }}
      trackLabels={{ "0": "Halo", "1": "Clean" }}
    />,
  );

  const columns = document.querySelectorAll(
    '[data-audio-profile-layout="album"] [data-slot="audio-profile-column"]',
  );
  expect(columns).toHaveLength(3);
  expect(
    within(columns[2] as HTMLElement).getByRole("img", {
      name: "Mood: sad 50%, happy 30%",
    }),
  ).toBeInTheDocument();
  // The rose replaces the album's mood badges.
  expect(screen.queryByText("sad 50%")).not.toBeInTheDocument();
});

it("keeps the track dialog's plain readings above its tabs", () => {
  render(
    <AudioProfileCard
      totalTracks={1}
      presentation="track-dialog"
      analysisData={{ track: { ...empty, tempo: 119.5 } }}
    />,
  );

  expect(screen.getByText("119.5 BPM")).toBeInTheDocument();
  expect(
    document.querySelector('[data-slot="album-readings"]'),
  ).not.toBeInTheDocument();
});

it("draws the sound features as a spectrum that names the album's extremes", () => {
  render(
    <AudioProfileCard
      totalTracks={2}
      analysisData={{
        "0": { ...empty, energy: 0.4, danceability: 0.5 },
        "1": { ...empty, energy: 0.8, danceability: 0.7 },
      }}
      trackLabels={{ "0": "Halo", "1": "Clean" }}
    />,
  );

  expect(
    screen.getByRole("list", { name: "Sound features" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", {
      name: "Energy: mean 60%, from 40% (Halo) to 80% (Clean)",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("img", { name: "Measured audio features radar" }),
  ).not.toBeInTheDocument();
});
