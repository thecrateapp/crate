import { memo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { buildTrackMenuPlayerTrack } from "@/components/actions/shared";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import {
  usePlayerState,
  usePlayerActions,
  type Track,
} from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  hasPlayableTrackReference,
  resolvePlayableTrackId,
  toPlayableTrack,
} from "@/lib/playable-track";
import { resolveRemotePlayableTrack } from "@/lib/remote-track-playback";
import { getOfflineStateLabel } from "@/lib/offline";
import { cn, formatDuration } from "@/lib/utils";
import { toast } from "sonner";
import { albumCoverApiUrl } from "@/lib/library-routes";

import {
  TrackRowActions,
  TrackRowDetails,
  TrackRowLeadingControl,
  TrackRowLikeControl,
} from "@/components/cards/TrackRowParts";

export interface TrackRowData {
  id?: string | number;
  global_track_uid?: string;
  global_artist_uid?: string;
  global_album_uid?: string;
  entity_uid?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration?: number;
  path?: string;
  track_number?: number;
  format?: string;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  library_track_id?: number;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: {
    catalog: boolean;
    stream: boolean;
    import: boolean;
    stale?: boolean;
    local?: boolean;
    remote?: boolean;
    healthy?: boolean;
  };
  disabled?: boolean;
}

interface TrackRowPlaylistOption {
  id: number;
  name: string;
}

export interface TrackRowProps {
  track: TrackRowData;
  index?: number;
  showArtist?: boolean;
  showAlbum?: boolean;
  albumCover?: string;
  showCoverThumb?: boolean;
  playlistOptions?: TrackRowPlaylistOption[];
  onAddToPlaylist?: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist?: (track: TrackRowData) => void | Promise<void>;
  onActionMenuOpen?: () => void;
  onPlayOverride?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (track: TrackRowData, event: MouseEvent<HTMLDivElement>) => void;
  onSelectionActionMenuOpen?: (
    track: TrackRowData,
    event: MouseEvent<HTMLButtonElement>,
  ) => boolean | void;
  /** Pass the full sibling track list so clicking plays all from this track's position. */
  queueTracks?: TrackRowData[];
}

export type TrackRowResolvedState = {
  cover?: string;
  playerTrack: Track;
  isRemote: boolean;
  isGlobalCatalogOnly: boolean;
  showLocalActions: boolean;
  disabled: boolean;
  playbackId: string;
};

function resolveTrackRowState(
  track: TrackRowData,
  albumCover?: string,
): TrackRowResolvedState {
  const globalAlbumUid = track.global_album_uid;
  const cover =
    albumCover ||
    (globalAlbumUid
      ? albumCoverApiUrl({ globalAlbumUid }, { size: 128 })
      : track.album_id != null
        ? albumCoverApiUrl(
            {
              albumId: track.album_id,
              albumEntityUid: track.album_entity_uid,
              artistEntityUid: track.artist_entity_uid,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            },
            { size: 128 },
          )
        : undefined);
  const playerTrack = toPlayableTrack(track, { cover });
  const isRemote = playerTrack.origin === "remote";
  const isGlobalCatalogOnly =
    Boolean(playerTrack.globalTrackUid || track.global_track_uid) &&
    track.availability?.local === false &&
    playerTrack.libraryTrackId == null;
  const showLocalActions = !isRemote && !isGlobalCatalogOnly;
  const disabled =
    Boolean(track.disabled) ||
    (isRemote && playerTrack.remote?.availability.stream === false) ||
    (isGlobalCatalogOnly && track.availability?.healthy === false);

  return {
    cover,
    playerTrack,
    isRemote,
    isGlobalCatalogOnly,
    showLocalActions,
    disabled,
    playbackId: resolvePlayableTrackId(track),
  };
}

function useTrackRowModel({
  track,
  albumCover,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayOverride,
}: Pick<
  TrackRowProps,
  | "track"
  | "albumCover"
  | "playlistOptions"
  | "onAddToPlaylist"
  | "onCreatePlaylist"
  | "onPlayOverride"
>) {
  const { isLiked } = useLikedTracks();
  const { getTrackState } = useOffline();
  const resolved = resolveTrackRowState(track, albumCover);
  const hasTrackRef = hasPlayableTrackReference(track);
  const liked = hasTrackRef
    ? isLiked(
        track.library_track_id ??
          (typeof track.id === "number" ? track.id : null),
        track.entity_uid,
        track.path,
        track.global_track_uid,
      )
    : false;
  const offlineState = resolved.showLocalActions
    ? getTrackState(track.entity_uid)
    : "idle";
  const offlineLabel = resolved.showLocalActions
    ? getOfflineStateLabel(offlineState)
    : "";
  const actions = useTrackActionEntries({
    track,
    albumCover: resolved.cover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayNowOverride: onPlayOverride,
  });
  const actionMenu = useItemActionMenu(actions, {
    placement: "bottom-end",
  });

  return {
    ...resolved,
    actionMenu,
    actions,
    hasTrackRef,
    liked,
    offlineLabel,
    offlineState,
  };
}

async function activateTrack({
  disabled,
  isActive,
  isPlaying,
  onPlayOverride,
  onRemotePlayback,
  pause,
  play,
  playAll,
  playerTrack,
  queueTracks,
  resume,
  track,
}: {
  disabled: boolean;
  isActive: boolean;
  isPlaying: boolean;
  onPlayOverride?: () => void;
  onRemotePlayback: () => Promise<void>;
  pause: () => void;
  play: (track: Track) => void;
  playAll: (tracks: Track[], index?: number) => void;
  playerTrack: Track;
  queueTracks?: TrackRowData[];
  resume: () => void;
  track: TrackRowData;
}) {
  if (disabled) return;
  if (isActive) {
    if (isPlaying) pause();
    else resume();
    return;
  }
  if (onPlayOverride) {
    await onPlayOverride();
    return;
  }
  if (playerTrack.origin === "remote") {
    await onRemotePlayback();
    return;
  }
  if (queueTracks && queueTracks.length > 1) {
    const myId = resolvePlayableTrackId(track);
    const idx = queueTracks.findIndex(
      (queueTrack) => resolvePlayableTrackId(queueTrack) === myId,
    );
    playAll(
      queueTracks.map((queueTrack) => buildTrackMenuPlayerTrack(queueTrack)),
      Math.max(0, idx),
    );
    return;
  }
  play(playerTrack);
}

function useTrackRowPlayback({
  disabled,
  isActive,
  isPlaying,
  onPlayOverride,
  playerTrack,
  queueTracks,
  track,
}: Pick<TrackRowResolvedState, "disabled" | "playerTrack"> & {
  isActive: boolean;
  isPlaying: boolean;
  onPlayOverride?: () => void;
  queueTracks?: TrackRowData[];
  track: TrackRowData;
}) {
  const { t } = useTranslation();
  const { play, playAll, pause, resume } = usePlayerActions();
  const [resolvingRemote, setResolvingRemote] = useState(false);

  async function handleRemotePlayback() {
    if (resolvingRemote) return;
    setResolvingRemote(true);
    try {
      const resolved = await resolveRemotePlayableTrack(playerTrack);
      play(resolved);
    } catch {
      toast.error(t("search.tryAgain"));
    } finally {
      setResolvingRemote(false);
    }
  }

  async function handleActivate() {
    await activateTrack({
      disabled,
      isActive,
      isPlaying,
      onPlayOverride,
      onRemotePlayback: handleRemotePlayback,
      pause,
      play,
      playAll,
      playerTrack,
      queueTracks,
      resume,
      track,
    });
  }

  return {
    handleActivate,
    playControlLabel: `${
      resolvingRemote ? "Resolving" : isActive && isPlaying ? "Pause" : "Play"
    } ${track.title || "track"}`,
    resolvingRemote,
  };
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  showArtist = false,
  showAlbum = false,
  albumCover,
  showCoverThumb = false,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayOverride,
  selectable = false,
  selected = false,
  onSelect,
  onSelectionActionMenuOpen,
  queueTracks,
}: TrackRowProps) {
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack } = usePlayerActions();
  const { toggleTrackLike } = useLikedTracks();
  const model = useTrackRowModel({
    track,
    albumCover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayOverride,
  });
  const isActive = currentTrack?.id === model.playbackId;
  const playback = useTrackRowPlayback({
    disabled: model.disabled,
    isActive,
    isPlaying,
    onPlayOverride,
    playerTrack: model.playerTrack,
    queueTracks,
    track,
  });

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void playback.handleActivate();
  }

  return (
    <div
      className={cn(
        "group track-row flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
      )}
      data-active={isActive}
      data-disabled={model.disabled}
      data-selected={selected}
      aria-label={track.title}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={(event) => {
        if (model.disabled) return;
        if (!model.showLocalActions) return;
        onActionMenuOpen?.();
        model.actionMenu.handleContextMenu(event);
      }}
      onClick={(event) => {
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        void playback.handleActivate();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event as unknown as MouseEvent<HTMLDivElement>);
          return;
        }
        void playback.handleActivate();
      }}
      role="row"
      tabIndex={model.disabled ? -1 : 0}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void playback.handleActivate();
            }
          : undefined
      }
    >
      <TrackRowLeadingControl
        cover={model.cover}
        disabled={model.disabled}
        index={index}
        isActive={isActive}
        isPlaying={isPlaying}
        playControlLabel={playback.playControlLabel}
        showCoverThumb={showCoverThumb}
        trackNumber={track.track_number}
        onClick={handlePlayControlClick}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              isActive ? "font-medium text-accent-action" : "text-text-primary",
            )}
          >
            {track.title || "Unknown"}
          </div>
          {!model.isRemote ? (
            <OfflineBadge
              state={model.offlineState}
              compact
              subtle
              className="flex-shrink-0"
            />
          ) : null}
          {model.disabled ? (
            <span className="track-row-disabled-badge flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
              Soon
            </span>
          ) : null}
        </div>
        <TrackRowDetails
          globalAlbumUid={track.global_album_uid}
          globalArtistUid={track.global_artist_uid}
          navigate={navigate}
          offlineLabel={model.offlineLabel}
          offlineState={model.offlineState}
          showAlbum={showAlbum}
          showArtist={showArtist}
          track={track}
        />
      </div>

      {/* Duration */}
      {track.duration != null && track.duration > 0 && (
        <span className="text-text-muted flex-shrink-0 text-xs tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      <TrackRowLikeControl
        hasTrackRef={model.hasTrackRef}
        liked={model.liked}
        toggleTrackLike={toggleTrackLike}
        track={track}
      />
      <TrackRowActions
        actionMenu={model.actionMenu}
        actions={model.actions}
        cover={model.cover}
        disabled={model.disabled}
        onActionMenuOpen={onActionMenuOpen}
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
        selectable={selectable}
        selected={selected}
        showLocalActions={model.showLocalActions}
        track={track}
      />
    </div>
  );
});
