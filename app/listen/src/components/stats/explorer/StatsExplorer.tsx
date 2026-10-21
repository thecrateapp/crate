import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";

import { CrateImage } from "@/components/artwork/CrateImage";
import type {
  StatsPeriodKey,
  StatsRangeTrack,
  StatsTape,
} from "@/components/stats/stats-types";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

import {
  StatsExplorerPanel,
  type ExplorerDayDetail,
} from "./StatsExplorerPanel";
import { StatsExplorerView } from "./StatsExplorerView";
import {
  bucketRange,
  clampWindow,
  defaultWindow,
  explorerMode,
  stretchRange,
  summarizeStretch,
  type ExplorerWindow,
} from "./stats-explorer-model";
import { useStatsRange } from "./use-stats-range";

/** Top artist, album, track and discoveries of a stretch. */
const STRETCH_LIMIT = 3;
/** Tracks listed for an opened day (or week). */
const DAY_LIMIT = 20;

const renderCover: MediaCoverProps["renderImage"] = ({
  src,
  alt,
  className,
  onError,
}) => (
  <CrateImage
    src={src}
    alt={alt}
    className={className}
    onError={onError}
    loading="lazy"
  />
);

export interface StatsExplorerProps {
  tape: StatsTape;
  selection: StatsPeriodKey;
  /** `/api/me/stats/range`, `/api/users/{u}/stats/range` or `/api/stats/range`. */
  rangeEndpoint: string;
}

export function StatsExplorer({
  tape,
  selection,
  rangeEndpoint,
}: StatsExplorerProps) {
  if (!tape.points.length) return null;
  // A new period or tape shape starts a fresh explorer and its opening.
  const key = [
    selection,
    tape.granularity,
    tape.start,
    tape.end,
    tape.points.length,
  ].join(":");
  return (
    <ExplorerSession
      key={key}
      tape={tape}
      selection={selection}
      rangeEndpoint={rangeEndpoint}
    />
  );
}

function ExplorerSession({
  tape,
  selection,
  rangeEndpoint,
}: StatsExplorerProps) {
  const count = tape.points.length;
  const mode = useMemo(() => explorerMode(selection, tape), [selection, tape]);
  const [requested, setRequested] = useState<ExplorerWindow>(() =>
    defaultWindow(count, mode),
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { play } = usePlayerActions();

  const { from, to } = clampWindow(requested, count, mode);
  const stretch = useMemo(
    () => stretchRange(tape, { from, to }),
    [tape, from, to],
  );
  const summary = useMemo(
    () => summarizeStretch(tape, { from, to }),
    [tape, from, to],
  );
  const stretchResult = useStatsRange(rangeEndpoint, stretch, STRETCH_LIMIT);

  // Like the prototype, an opened bucket shows while it stays in the window.
  const opened =
    openIndex != null && openIndex >= from && openIndex < to ? openIndex : null;
  const openedPoint = opened != null ? tape.points[opened] : undefined;
  const openedRange = useMemo(
    () => (opened != null ? bucketRange(tape, opened) : null),
    [tape, opened],
  );
  // A silent bucket has nothing to list: no request.
  const dayResult = useStatsRange(
    openedPoint && openedPoint.minutes > 0 ? rangeEndpoint : null,
    openedRange,
    DAY_LIMIT,
  );
  const day: ExplorerDayDetail | null =
    openedPoint && openedRange
      ? {
          bucket: openedPoint.bucket,
          start: openedRange.start,
          end: openedRange.end,
          minutes: openedPoint.minutes,
          plays: openedPoint.plays,
          tracks: dayResult.data?.top_tracks ?? [],
          loading: dayResult.loading,
          available: dayResult.data?.available ?? true,
        }
      : null;

  const discoveryDays = useMemo(
    () => stretchResult.data?.discoveries.map((item) => item.first_day),
    [stretchResult.data],
  );

  const playTrack = useCallback(
    (track: StatsRangeTrack) => {
      if (track.track_id == null) return;
      const cover = track.album
        ? albumCoverApiUrl(
            {
              albumId: track.album_id,
              globalAlbumUid: track.global_album_uid,
              albumName: track.album,
              artistName: track.artist ?? undefined,
            },
            { size: 512 },
          ) || undefined
        : undefined;
      const title = track.title ?? "";
      play(
        toPlayableTrack(
          { ...track, id: track.track_id, title, artist: track.artist ?? "" },
          { cover },
        ),
        { type: "track", name: title },
      );
    },
    [play],
  );

  const backToStretch = useCallback(() => {
    setOpenIndex(null);
    // The Back button disappears with the day: keep focus in the explorer.
    chartRef.current?.focus();
  }, []);

  const openMonth = useCallback(
    (month: string) => navigate({ search: `?month=${month}` }),
    [navigate],
  );

  return (
    <StatsExplorerView
      tape={tape}
      mode={mode}
      window={{ from, to }}
      cursor={cursor}
      selected={opened}
      discoveryDays={discoveryDays}
      chartRef={chartRef}
      onWindowChange={setRequested}
      onCursorChange={setCursor}
      onOpenBucket={setOpenIndex}
      onMonth={openMonth}
      panel={
        <StatsExplorerPanel
          granularity={tape.granularity}
          stretch={stretch}
          summary={summary}
          data={stretchResult.data}
          loading={stretchResult.loading}
          available={stretchResult.data?.available ?? true}
          day={day}
          onBack={backToStretch}
          onPlayTrack={playTrack}
          renderImage={renderCover}
        />
      }
    />
  );
}
