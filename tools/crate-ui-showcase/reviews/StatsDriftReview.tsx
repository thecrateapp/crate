import { useState } from "react";
import { MemoryRouter } from "react-router";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  StatsExplorerPanel,
  type ExplorerLinks,
} from "../../../app/listen/src/components/stats/explorer/StatsExplorerPanel";
import { StatsMovementView } from "../../../app/listen/src/components/stats/StatsMovementView";
import type {
  StatsRangeTrack,
  StatsStory,
} from "../../../app/listen/src/components/stats/stats-types";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

const tracks: StatsRangeTrack[] = [
  {
    track_id: 1,
    title: "Darkness",
    artist: "The Lovecraft Sextet",
    album: "Nights of Lust",
    album_id: 1,
    plays: 14,
    minutes: 60,
    format: "flac",
    bit_depth: 24,
    sample_rate: 96000,
    duration: 364,
    bpm: 76,
    audio_key: "D",
    audio_scale: "minor",
  },
  {
    track_id: 2,
    title: "Wait",
    artist: "Converge",
    album: "Jane Doe",
    album_id: 2,
    plays: 9,
    minutes: 41,
    format: "mp3",
    bitrate: 320,
    duration: 181,
    bpm: 145,
    audio_key: "C",
    audio_scale: "major",
  },
  {
    track_id: null,
    title: "A track removed from the library",
    artist: "Historical artist",
    plays: 1,
    minutes: 3,
  },
];
const links: ExplorerLinks = {
  albumCover: (track) => (track.album_id ? IMAGE_SAMPLES[0]! : null),
  artistPhoto: () => IMAGE_SAMPLES[2]!,
  artistHref: () => undefined,
  albumHref: () => undefined,
};
const story = {
  movers: [
    {
      artist_name: "Converge",
      play_count: 14,
      delta_play_count: 6,
      minutes_listened: 60,
    },
  ],
  discoveries: [{ artist_name: "Low", play_count: 9, minutes_listened: 41 }],
  comebacks: [{ artist_name: "Caspian", play_count: 5, minutes_listened: 24 }],
} as unknown as StatsStory;

export function StatsDriftReview() {
  const [mode, setMode] = useState("loaded");
  const [action, setAction] = useState("No playback action");
  return (
    <SettingsFixtureProvider>
      <MemoryRouter>
        <main className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8">
          <PageHeader
            eyebrow="1BE · Review"
            title="Stats row consistency"
            subtitle="Canonical row presentation, source quality, stable metadata and history that stays readable after a track is removed. Actions in this preview are local."
          />
          <FormField label="Server capability" kind="group">
            <SegmentedControl
              as="radio"
              value={mode}
              onValueChange={setMode}
              items={[
                { value: "loaded", label: "Available" },
                { value: "unsupported", label: "Older server" },
              ]}
            />
          </FormField>
          <div className="stats-explorer">
            <StatsExplorerPanel
              granularity="day"
              stretch={{ start: "2026-10-20", end: "2026-10-20" }}
              summary={{
                buckets: 1,
                minutes: 104,
                average: 104,
                silent: 0,
                energy: 0.7,
                valence: 0.3,
              }}
              data={null}
              loading={false}
              available
              day={{
                bucket: "2026-10-20",
                start: "2026-10-20",
                end: "2026-10-20",
                minutes: 104,
                plays: 24,
                tracks: mode === "loaded" ? tracks : [],
                loading: false,
                error: false,
                available: mode === "loaded",
                unsupported: mode === "unsupported",
              }}
              links={links}
              onBack={() => setAction("Back to the stretch")}
              onPlayTrack={(track) => setAction(`Play ${track.title}`)}
            />
          </div>
          <output aria-live="polite">
            <MonoLabel>{action}</MonoLabel>
          </output>
          <StatsMovementView
            story={story}
            scope="personal"
            exclude={[]}
            getArtistHref={() => "/fixture/artist"}
            renderArtist={() => (
              <MediaCover
                src={IMAGE_SAMPLES[2]}
                alt=""
                shape="circle"
                className="size-12 shrink-0"
              />
            )}
          />
        </main>
      </MemoryRouter>
    </SettingsFixtureProvider>
  );
}
