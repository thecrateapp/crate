import { useMemo, useRef, useState } from "react";
import {
  StatsExplorerPanel,
  type ExplorerLinks,
} from "../../../app/listen/src/components/stats/explorer/StatsExplorerPanel";
import { StatsExplorerView } from "../../../app/listen/src/components/stats/explorer/StatsExplorerView";
import {
  bucketRange,
  clampWindow,
  defaultWindow,
  explorerMode,
  stretchRange,
  summarizeStretch,
  type ExplorerWindow,
} from "../../../app/listen/src/components/stats/explorer/stats-explorer-model";
import type {
  StatsPeriodKey,
  StatsRange,
  StatsRangeTrack,
  StatsTape,
} from "../../../app/listen/src/components/stats/stats-types";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

const TRACKS: StatsRangeTrack[] = [
  {
    track_id: 1,
    format: "flac",
    bit_depth: 24,
    sample_rate: 96000,
    duration: 364,
    bpm: 76,
    audio_key: "D",
    audio_scale: "minor",
    title: "Darkness",
    artist: "The Lovecraft Sextet",
    album: "Nights of Lust",
    album_id: 1,
    plays: 14,
    minutes: 60,
  },
  {
    track_id: 2,
    format: "mp3",
    bitrate: 320,
    duration: 181,
    bpm: 145,
    audio_key: "C",
    audio_scale: "major",
    title: "Wait",
    artist: "Converge",
    album: "Jane Doe",
    album_id: 2,
    plays: 9,
    minutes: 41,
  },
];

function stretchData(start: string, end: string): StatsRange {
  return {
    start,
    end,
    available: true,
    top_artists: [
      {
        artist_name: "Converge",
        artist_id: 8,
        artist_slug: "converge",
        minutes: 630,
        plays: 120,
        share: 0.42,
      },
    ],
    top_albums: [
      {
        album: "Nights of Lust",
        artist: "The Lovecraft Sextet",
        album_id: 1,
        album_slug: "nights-of-lust",
        minutes: 300,
      },
    ],
    top_tracks: TRACKS,
    discoveries: [{ artist_name: "Duster", first_day: start, minutes: 40 }],
  };
}

const LINKS: ExplorerLinks = {
  albumCover: () => IMAGE_SAMPLES[0]!,
  artistPhoto: () => IMAGE_SAMPLES[1]!,
  artistHref: () => "/fixture/artist",
  albumHref: () => "/fixture/album",
};

/**
 * The real explorer view and panel with local state and fixture blocks: no
 * network, no player and no router navigation.
 */
export function StatsExplorerReview({
  tape,
  selection = "30d",
}: {
  tape: StatsTape;
  selection?: StatsPeriodKey;
}) {
  const count = tape.points.length;
  const mode = useMemo(() => explorerMode(selection, tape), [selection, tape]);
  const [requested, setRequested] = useState<ExplorerWindow>(() =>
    defaultWindow(count, mode),
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const { from, to } = clampWindow(requested, count, mode);
  const stretch = stretchRange(tape, { from, to });
  const summary = summarizeStretch(tape, { from, to });
  const opened =
    openIndex != null && openIndex >= from && openIndex < to ? openIndex : null;
  const point = opened != null ? tape.points[opened] : undefined;
  const range = opened != null ? bucketRange(tape, opened) : null;
  return (
    <StatsExplorerView
      tape={tape}
      mode={mode}
      window={{ from, to }}
      cursor={cursor}
      selected={opened}
      chartRef={chartRef}
      onWindowChange={setRequested}
      onCursorChange={setCursor}
      onOpenBucket={setOpenIndex}
      onMonth={() => {}}
      panel={
        <StatsExplorerPanel
          granularity={tape.granularity}
          stretch={stretch}
          summary={summary}
          data={stretchData(stretch.start, stretch.end)}
          loading={false}
          available
          day={
            point && range
              ? {
                  bucket: point.bucket,
                  start: range.start,
                  end: range.end,
                  minutes: point.minutes,
                  plays: point.plays,
                  tracks: point.minutes > 0 ? TRACKS : [],
                  loading: false,
                  error: false,
                  available: true,
                }
              : null
          }
          onBack={() => {
            setOpenIndex(null);
            chartRef.current?.focus();
          }}
          onPlayTrack={() => {}}
          links={LINKS}
          renderImage={({ alt, className }) => (
            <img src={IMAGE_SAMPLES[0]} alt={alt} className={className} />
          )}
        />
      }
    />
  );
}
