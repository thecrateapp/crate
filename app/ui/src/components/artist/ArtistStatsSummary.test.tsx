import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ArtistStatsSummary } from "./ArtistStatsSummary";
import type {
  ArtistAnalysisTrack,
  ArtistStatsData,
} from "./artist-stats-model";

const data: ArtistStatsData = {
  formats: [],
  albums_timeline: [
    { name: "Small", year: "2000", track_count: 1, total_duration: 300 },
    { name: "Large", year: "2010", track_count: 3, total_duration: 3300 },
  ],
  audio_by_album: [
    { album: "Small", avg_bpm: 100, avg_energy: 0.2 },
    { album: "Large", avg_bpm: 160, avg_energy: 0.4 },
  ],
  genres: [{ name: "Rock", weight: 1 }],
  top_tracks_by_popularity: [],
};
const analysisData: Record<string, ArtistAnalysisTrack> = {
  first: {
    track_id: 1,
    tempo: 100,
    smart_mix: { is_current_full_profile: true },
    bliss: { available: true },
  },
  "track:1": {
    track_id: 1,
    tempo: 100,
    smart_mix: { is_current_full_profile: true },
    bliss: { available: true },
  },
  second: {
    track_id: 2,
    tempo: 160,
    smart_mix: { is_current_full_profile: false },
    bliss: { available: false },
  },
  third: {
    track_id: 3,
    tempo: 160,
    smart_mix: null,
    bliss: { available: true },
  },
  fourth: {
    track_id: 4,
    tempo: 160,
    smart_mix: null,
    bliss: { available: false },
  },
};
const analysis = { data: analysisData, loading: false, error: null };
const capabilities = {
  data: { smart_mix: { available: true } },
  loading: false,
  error: null,
};
const metric = (label: string) => screen.getByRole("group", { name: label });

it("renders the eight shared readouts in a responsive two/four-column band", () => {
  render(
    <ArtistStatsSummary
      data={data}
      analysis={analysis}
      capabilities={capabilities}
    />,
  );
  const summary = screen.getByLabelText("Artist catalogue summary");
  expect(summary).toHaveClass("grid-cols-2", "lg:grid-cols-4");
  expect(summary.children).toHaveLength(8);
  expect(within(metric("Local albums")).getByText("2")).toBeInTheDocument();
  expect(within(metric("Tracks")).getByText("4")).toBeInTheDocument();
  expect(
    within(metric("Available duration")).getByText("1h 0m"),
  ).toBeInTheDocument();
  expect(
    within(metric("Publication range")).getByText("2000–2010"),
  ).toBeInTheDocument();
  expect(
    within(metric("Predominant genre")).getByText("Rock"),
  ).toBeInTheDocument();
  expect(within(metric("Mean BPM")).getByText("145")).toBeInTheDocument();
  expect(
    within(metric("Mean BPM")).getByText("4 / 4 tracks measured"),
  ).toBeInTheDocument();
  expect(
    within(metric("Full Smart Mix coverage")).getByText("25%"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("meter", { name: "Current Full" }),
  ).toHaveAttribute("aria-valuetext", "1 / 4");
  expect(within(metric("Bliss coverage")).getByText("50%")).toBeInTheDocument();
  expect(screen.getByRole("meter", { name: "Stored vectors" })).toHaveAttribute(
    "aria-valuetext",
    "2 / 4",
  );
  expect(summary.querySelector("[title], svg")).toBeNull();
});

it("uses the stored total and strongest finite artist editorial tag with wrapping", () => {
  const genre = "Experimentalpsychedelicprogressiveinstrumentalrock";
  render(
    <ArtistStatsSummary
      data={data}
      totalTracks={20}
      genreProfile={[
        { name: "Weak", weight: 0.1, share: 1 },
        { name: genre, weight: 0.9 },
        { name: "Infinite", weight: Infinity },
      ]}
      analysis={analysis}
      capabilities={capabilities}
    />,
  );
  expect(within(metric("Tracks")).getByText("20")).toBeInTheDocument();
  expect(within(metric("Predominant genre")).getByText(genre)).toHaveClass(
    "wrap-anywhere",
  );
  expect(
    within(metric("Predominant genre")).getByText("Strongest editorial tag"),
  ).toBeInTheDocument();
  expect(
    within(metric("Mean BPM")).getByText("4 / 20 tracks measured"),
  ).toBeInTheDocument();
  expect(
    within(metric("Full Smart Mix coverage")).getByText("5%"),
  ).toBeInTheDocument();
});

it.each([
  { loading: true, error: null, value: "Loading" },
  { loading: false, error: "failed", value: "Unavailable" },
  { loading: false, error: null, value: "Unavailable" },
])(
  "keeps catalogue readings useful when analysis is $value",
  ({ loading, error, value }) => {
    render(
      <ArtistStatsSummary
        data={data}
        analysis={{ data: null, loading, error }}
        capabilities={capabilities}
      />,
    );
    expect(within(metric("Tracks")).getByText("4")).toBeInTheDocument();
    expect(
      within(metric("Available duration")).getByText("1h 0m"),
    ).toBeInTheDocument();
    for (const label of [
      "Mean BPM",
      "Full Smart Mix coverage",
      "Bliss coverage",
    ])
      expect(
        within(metric(label)).getByText(value, { exact: true }),
      ).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
  },
);

it("shows Disabled for unavailable server Smart Mix while keeping independent measurements", () => {
  render(
    <ArtistStatsSummary
      data={data}
      analysis={analysis}
      capabilities={{
        ...capabilities,
        data: { smart_mix: { available: false } },
      }}
    />,
  );
  expect(
    within(metric("Full Smart Mix coverage")).getByText("Disabled"),
  ).toBeInTheDocument();
  expect(within(metric("Mean BPM")).getByText("145")).toBeInTheDocument();
  expect(within(metric("Bliss coverage")).getByText("50%")).toBeInTheDocument();
  expect(
    screen.queryByRole("meter", { name: "Current Full" }),
  ).toBeNull();
});

it.each([
  { data: null, loading: true, error: null, value: "Loading" },
  { data: null, loading: false, error: "failed", value: "Unavailable" },
  { data: {}, loading: false, error: null, value: "Unavailable" },
])(
  "does not guess Smart Mix availability when capabilities are $value",
  ({ value, ...state }) => {
    render(
      <ArtistStatsSummary
        data={data}
        analysis={analysis}
        capabilities={state}
      />,
    );
    expect(
      within(metric("Full Smart Mix coverage")).getByText(value, {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("meter", { name: "Current Full" }),
    ).toBeNull();
  },
);

it("does not count a legacy Full profile without its authoritative currentness flag", () => {
  render(
    <ArtistStatsSummary
      data={data}
      analysis={{
        ...analysis,
        data: {
          old: {
            track_id: 1,
            tempo: 120,
            smart_mix: { quality: "full" },
            bliss: { available: true },
          },
        },
      }}
      capabilities={capabilities}
    />,
  );
  expect(
    within(metric("Full Smart Mix coverage")).getByText("Unavailable", {
      exact: true,
    }),
  ).toBeInTheDocument();
  expect(within(metric("Bliss coverage")).getByText("25%")).toBeInTheDocument();
});

it("retains real zero measurements and avoids division for an empty local catalogue", () => {
  render(
    <ArtistStatsSummary
      data={{ ...data, albums_timeline: [], genres: [] }}
      totalTracks={0}
      analysis={{ ...analysis, data: {} }}
      capabilities={capabilities}
    />,
  );
  expect(within(metric("Local albums")).getByText("0")).toBeInTheDocument();
  expect(within(metric("Tracks")).getByText("0")).toBeInTheDocument();
  expect(
    within(metric("Mean BPM")).getByText("Unavailable", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(metric("Mean BPM")).getByText("0 / 0 tracks measured"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("meter")).toBeNull();
  expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
});
