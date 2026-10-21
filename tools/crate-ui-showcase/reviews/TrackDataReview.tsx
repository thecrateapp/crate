import { useState } from "react";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  formatMusicalKey,
  formatTrackAnalysis,
} from "@crate/ui/lib/track-meta";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import {
  formatPlayerTime,
  getQualityBadge,
} from "../../../app/listen/src/components/player/bar/player-bar-utils";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

const source = {
  id: 7,
  track_id: 7,
  title: "A complete source track",
  artist: "Caspian",
  album: "Caspian",
  format: "flac",
  bitrate: 1200,
  sample_rate: 96000,
  bit_depth: 24,
  duration: 143,
  bpm: 99,
  audio_key: "D",
  audio_scale: "minor",
};
const rows = [
  ...[
    "Search / Home / playlists / Paths",
    "Artist top tracks",
    "Stats",
    "Radio",
    "Player queue",
    "Offline",
  ].map((label) => [label, source] as const),
  [
    "Lossy source",
    {
      ...source,
      title: "A 320 kbps source track",
      format: "mp3",
      bitrate: 320,
    },
  ],
  [
    "Unknown source metadata",
    {
      ...source,
      title: "An unanalysed track",
      format: undefined,
      bitrate: undefined,
      sample_rate: undefined,
      bit_depth: undefined,
      duration: undefined,
      bpm: undefined,
      audio_key: undefined,
      audio_scale: undefined,
    },
  ],
] as const;

/** Real visual row pieces with complete and unknown source data. All playback is fixture-local. */
export function TrackDataReview() {
  const [played, setPlayed] = useState<string | null>(null);
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Track data consistency"
          subtitle="One source contract across Listen. Known source quality, BPM, key and duration survive every adapter. Unknown metadata keeps its reserved slots."
        />
        {rows.map(([label, track], index) => (
          <FormField key={label} label={label} kind="group">
            <TrackRowView role="group" aria-label={label}>
              <TrackRowContent
                title={track.title}
                details={
                  <p className="text-caption text-text-muted">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ""}
                  </p>
                }
                leading={
                  <TrackRowPlaybackControl
                    disabled={false}
                    index={index + 1}
                    isActive={false}
                    isPlaying={false}
                    label={`Play ${label}`}
                    onClick={() => setPlayed(label)}
                    artwork={
                      <MediaCover
                        src={IMAGE_SAMPLES[0]}
                        alt=""
                        className="size-12"
                      />
                    }
                  />
                }
                quality={getQualityBadge({
                  format: track.format,
                  bitrate: track.bitrate,
                  sampleRate: track.sample_rate,
                  bitDepth: track.bit_depth,
                })}
                tempo={formatTrackAnalysis(track.bpm)}
                musicalKey={formatMusicalKey(
                  track.audio_key,
                  track.audio_scale,
                )}
                duration={
                  track.duration != null
                    ? formatPlayerTime(track.duration)
                    : undefined
                }
                actions={null}
              />
            </TrackRowView>
          </FormField>
        ))}
        <output aria-live="polite">
          <MonoLabel>
            {played ? `Play ${played}` : "No playback action"}
          </MonoLabel>
        </output>
      </main>
    </SettingsFixtureProvider>
  );
}
