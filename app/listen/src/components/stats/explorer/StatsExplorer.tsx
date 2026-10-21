import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";

import { CrateImage } from "@/components/artwork/CrateImage";
import { toPlayerTrack } from "@/components/stats/stats-model";
import type {
  StatsPeriodKey,
  StatsRange,
  StatsRangeTrack,
  StatsTape,
} from "@/components/stats/stats-types";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { cacheScopedKey } from "@/lib/cache";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import {
  StatsExplorerPanel,
  type ExplorerDayDetail,
  type ExplorerLinks,
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

export const EXPLORER_LINKS: ExplorerLinks = {
  albumCover: (item) => {
    if (!item.album) return null;
    return (
      albumCoverApiUrl(
        {
          albumId: item.album_id,
          globalAlbumUid: item.global_album_uid,
          albumName: item.album,
          artistName: item.artist ?? undefined,
        },
        { size: 128 },
      ) || null
    );
  },
  artistPhoto: (artist) =>
    artist.artist_id != null
      ? artistPhotoApiUrl(
          {
            artistId: artist.artist_id,
            artistSlug: artist.artist_slug,
            artistName: artist.artist_name,
          },
          { size: 128 },
        )
      : null,
  artistHref: (artist) =>
    artist.artist_id != null || artist.artist_slug
      ? artistPagePath({
          artistId: artist.artist_id,
          artistSlug: artist.artist_slug,
          artistName: artist.artist_name,
        })
      : undefined,
  albumHref: (album) =>
    album.album_id != null || album.global_album_uid
      ? albumPagePath({
          albumId: album.album_id,
          albumSlug: album.album_slug,
          albumName: album.album ?? undefined,
          artistName: album.artist ?? undefined,
          globalAlbumUid: album.global_album_uid,
        })
      : undefined,
};

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

  // Keep the last loaded stretch to show (dimmed) while the next one loads,
  // so the stacked panel does not collapse. Scoped to the server, user and
  // base: a different subject never inherits another subject's blocks.
  const scope = cacheScopedKey(rangeEndpoint);
  const [lastStretch, setLastStretch] = useState<{
    scope: string;
    data: StatsRange;
  } | null>(null);
  if (
    stretchResult.data &&
    (lastStretch?.data !== stretchResult.data || lastStretch.scope !== scope)
  ) {
    setLastStretch({ scope, data: stretchResult.data });
  }
  const carried =
    !stretchResult.data && stretchResult.loading && lastStretch?.scope === scope
      ? lastStretch.data
      : null;
  const shownStretch = stretchResult.data ?? carried;

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
          error: dayResult.error,
          available: dayResult.data?.available ?? true,
        }
      : null;

  // Discovery days are facts about days, so carried-over ones stay valid.
  const discoveryDays = useMemo(
    () => shownStretch?.discoveries.map((item) => item.first_day),
    [shownStretch],
  );

  const playTrack = useCallback(
    (track: StatsRangeTrack) => {
      if (track.track_id == null) return;
      play(toPlayerTrack(track), { type: "track", name: track.title ?? "" });
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
          data={shownStretch}
          loading={stretchResult.loading}
          error={stretchResult.error}
          stale={carried !== null}
          available={shownStretch?.available ?? true}
          day={day}
          onBack={backToStretch}
          onPlayTrack={playTrack}
          renderImage={renderCover}
          links={EXPLORER_LINKS}
        />
      }
    />
  );
}
